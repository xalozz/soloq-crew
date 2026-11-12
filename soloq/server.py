"""Servidor de la web: la página y los datos desde SQLite.

La página es la web nueva compilada (web/dist: index.html, assets/ con hash, sw.js…) si existe; si no, la
antigua de la raíz del repo (index.html, app.js, style.css…), así un despliegue sin compilar sigue funcionando.

Sirve las mismas rutas que leía la web en GitHub Pages, así el frontend apenas cambia:
  /data/data.json             lo último que publicó el actualizador (texto tal cual)
  /data/weeks.json            archivo de semanas
  /data/matches/<id>.json     detalle de una partida
  /api/latido                 { beat, status }: si el actualizador sigue vivo y cómo fue la última pasada

Pensado para ir detrás de Caddy escuchando solo en 127.0.0.1. Solo lectura: no hay nada que no sea GET.

  python -m soloq.server [--port 8001]
"""

import argparse
import base64
import hashlib
import json
import re
import sqlite3
import threading
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.middleware.gzip import GZipMiddleware

from . import config
from .js import dumps

app = FastAPI(title="SoloQ Crew", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(GZipMiddleware, minimum_size=1024)

STATIC = {
    "index.html": "text/html; charset=utf-8",
    "app.js": "text/javascript; charset=utf-8",
    "style.css": "text/css; charset=utf-8",
    "sw.js": "text/javascript; charset=utf-8",
    "manifest.webmanifest": "application/manifest+json",
    "favicon.svg": "image/svg+xml",
    "favicon-32.png": "image/png",
    "apple-touch-icon.png": "image/png",
    "icon-192.png": "image/png",
    "icon-512.png": "image/png",
    "icon-maskable-512.png": "image/png",
}
# Web nueva (web/dist): sin app.js ni style.css sueltos (van en assets/ con hash) y con viewport.js
DIST_STATIC = {k: v for k, v in STATIC.items() if k not in ("app.js", "style.css")} | {"viewport.js": "text/javascript; charset=utf-8"}
ASSET = re.compile(r"^[\w-]+\.(js|css|png|svg|webp|woff2?)$")
ASSET_TYPES = {"js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8", "png": "image/png",
               "svg": "image/svg+xml", "webp": "image/webp", "woff": "font/woff", "woff2": "font/woff2"}
IMMUTABLE = "public, max-age=31536000, immutable"   # assets/ lleva el hash del contenido en el nombre
MATCH_ID = re.compile(r"^[A-Z0-9]{2,6}_\d{1,15}$")
_hosts = {"port": None}
_local = threading.local()


def configure(port):
    _hosts["port"] = port


def allowed_hosts():
    hosts = set(config.HOSTS)
    if _hosts["port"]:
        hosts |= {f"127.0.0.1:{_hosts['port']}", f"localhost:{_hosts['port']}"}
    return hosts


def _inline_hashes(root):
    """sha256 de los <script> en línea de index.html: la CSP permite esos y ningún otro (la web nueva no tiene)."""
    try:
        html = (root / "index.html").read_text(encoding="utf-8")
    except OSError:
        return ""
    out = []
    for m in re.finditer(r"<script>(.*?)</script>", html, re.S):
        digest = base64.b64encode(hashlib.sha256(m.group(1).encode("utf-8")).digest()).decode()
        out.append(f"'sha256-{digest}'")
    return " ".join(out)


def _csp(root):
    hashes = _inline_hashes(root)
    return (
        f"default-src 'self'; script-src 'self'{' ' + hashes if hashes else ''}; "
        "style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src https://fonts.gstatic.com; "
        "img-src 'self' data: blob: https://ddragon.leagueoflegends.com https://raw.communitydragon.org; "
        "connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    )


_web = {"dir": config.ROOT, "dist": False, "csp": ""}


def configure_web(dist=None):
    """Elige qué web se sirve: la compilada (web/dist) si tiene index.html; si no, la de la raíz. Y su CSP."""
    dist = Path(dist) if dist else config.WEB_DIST
    use = (dist / "index.html").is_file()
    root = dist if use else config.ROOT
    _web.update(dir=root, dist=use, csp=_csp(root))


configure_web()


def db():
    """Una conexión de solo lectura por hilo (y por base de datos, para las pruebas)."""
    path = str(config.DB_PATH)
    con = getattr(_local, "con", None)
    if con is None or getattr(_local, "path", None) != path:
        con = sqlite3.connect(path, timeout=10, check_same_thread=False)
        con.execute("PRAGMA query_only = 1")
        con.execute("PRAGMA busy_timeout = 10000")
        _local.con, _local.path = con, path
    return con


def _one(sql, *args):
    try:
        r = db().execute(sql, args).fetchone()
    except sqlite3.Error:
        return None
    return r[0] if r else None


def _json(text, status=200):
    return Response(text, status_code=status, media_type="application/json; charset=utf-8")


def _error(status, msg):
    return JSONResponse({"error": msg}, status_code=status)


@app.middleware("http")
async def guard(request: Request, call_next):
    if request.method not in ("GET", "HEAD"):
        return _error(405, "solo lectura")
    hosts = allowed_hosts()
    if hosts and request.headers.get("host", "").lower() not in hosts:
        return _error(403, "host no permitido")
    path = request.url.path
    if ".." in path or "\\" in path or "//" in path:
        return _error(404, "no encontrado")
    response = await call_next(request)
    if "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
    response.headers["Content-Security-Policy"] = _web["csp"]
    return response


@app.api_route("/", methods=["GET", "HEAD"])
def index():
    return FileResponse(_web["dir"] / "index.html", media_type=STATIC["index.html"])


@app.api_route("/assets/{name}", methods=["GET", "HEAD"])
def asset(name: str):
    m = ASSET.match(name)
    f = _web["dir"] / "assets" / name
    if not _web["dist"] or not m or not f.is_file():
        return _error(404, "no encontrado")
    return FileResponse(f, media_type=ASSET_TYPES[m.group(1)], headers={"Cache-Control": IMMUTABLE})


IMG = re.compile(r"^(rango/[a-z]+\.png|rol/[a-z]+\.svg)$")


@app.api_route("/img/{folder}/{name}", methods=["GET", "HEAD"])
def img(folder: str, name: str):
    """Emblemas de rango e iconos de posición, copiados de communitydragon (que tarda segundos en servirlos)."""
    rel = f"{folder}/{name}"
    f = _web["dir"] / "img" / rel
    if not _web["dist"] or not IMG.match(rel) or not f.is_file():
        return _error(404, "no encontrado")
    media = "image/png" if name.endswith(".png") else "image/svg+xml"
    return FileResponse(f, media_type=media, headers={"Cache-Control": "public, max-age=604800"})


@app.api_route("/data/data.json", methods=["GET", "HEAD"])
def data_json():
    text = _one("SELECT datos FROM estado WHERE clave = 'publicado'")
    return _json(text) if text else _error(404, "todavía no hay datos")


@app.api_route("/data/weeks.json", methods=["GET", "HEAD"])
def weeks_json():
    try:
        rows = db().execute("SELECT datos FROM semana ORDER BY pos").fetchall()
    except sqlite3.Error:
        rows = []
    return _json('{"weeks":[' + ",".join(r[0] for r in rows) + "]}")


@app.api_route("/data/matches/{name}", methods=["GET", "HEAD"])
def match_json(name: str):
    if not name.endswith(".json") or not MATCH_ID.match(name[:-5]):
        return _error(404, "no encontrado")
    text = _one("SELECT datos FROM detalle WHERE id = ?", name[:-5])
    return _json(text) if text else _error(404, "no encontrado")


@app.api_route("/api/latido", methods=["GET", "HEAD"])
def latido():
    beat = _one("SELECT datos FROM estado WHERE clave = 'latido'")
    status = _one("SELECT datos FROM estado WHERE clave = 'pasada'")
    return _json(dumps({"beat": (json.loads(beat) or {}).get("beat") if beat else None,
                        "status": json.loads(status) if status else None}))


@app.api_route("/{name}", methods=["GET", "HEAD"])
def static(name: str):
    media = (DIST_STATIC if _web["dist"] else STATIC).get(name)
    f = _web["dir"] / name
    if not media or not f.is_file():
        return _error(404, "no encontrado")
    return FileResponse(f, media_type=media)


def main(argv=None):
    import uvicorn
    ap = argparse.ArgumentParser(prog="python -m soloq.server")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8001)
    a = ap.parse_args(argv)
    configure(a.port)
    uvicorn.run(app, host=a.host, port=a.port, proxy_headers=True, forwarded_allow_ips="127.0.0.1",
                server_header=False, date_header=False, log_level="warning")


if __name__ == "__main__":
    main()
