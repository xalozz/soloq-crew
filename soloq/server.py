"""Servidor de la web: la página y los datos desde SQLite.

La página es la web nueva compilada (web/dist: index.html, assets/ con hash, sw.js…) si existe; si no, la
antigua de la raíz del repo (index.html, app.js, style.css…), así un despliegue sin compilar sigue funcionando.

Sirve las mismas rutas que leía la web en GitHub Pages, así el frontend apenas cambia:
  /data/data.json             lo último que publicó el actualizador (texto tal cual)
  /data/weeks.json            archivo de semanas
  /data/matches/<id>.json     detalle de una partida
  /api/latido                 { beat, status }: si el actualizador sigue vivo y cómo fue la última pasada

Y la administración (/admin, con cuentas por invitación como luz y estado: /entrar, /cuenta, /ajustes y /api/…): lo
único que escribe. Todo lo que no es GET exige la cabecera X-Panel y va bajo /api/. El ranking sigue siendo público.

Pensado para ir detrás de Caddy escuchando solo en 127.0.0.1.

  python -m soloq.server [--port 8001]
"""

import argparse
import base64
import hashlib
import json
import os
import re
import sqlite3
import threading
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from starlette.middleware.gzip import GZipMiddleware

from . import accounts, config, cuentas_api, gestion
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

# Cuentas y administración (páginas en panel/, mismas piezas que luz y estado)
PANEL_DIR = config.ROOT / "panel"
PANEL = {"/entrar": "entrar.html", "/entrar.js": "entrar.js", "/cuenta": "cuenta.html", "/cuenta.js": "cuenta.js",
         "/ajustes": "ajustes.html", "/ajustes.js": "ajustes.js", "/admin": "admin.html", "/admin.js": "admin.js",
         "/admin.css": "admin.css", "/admin-tema.css": "admin-tema.css", "/admin-app.js": "admin-app.js",
         "/menu.js": "menu.js", "/panel.css": "panel.css"}
PANEL_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8"}
PRIVADOS = {"/admin", "/admin.js", "/admin-app.js", "/ajustes", "/ajustes.js", "/api/me", "/api/clave", "/api/salir-todo",
            "/api/2fa", "/api/2fa/nuevo"}
SOLO_ADMIN = {"/admin", "/admin.js", "/admin-app.js"}
SEGURO = os.environ.get("SOLOQ_SEGURO", "1") == "1"
accounts.DB_PATH = config.DATA_DIR / "cuentas.db"
cuentas_api.configurar("soloq", secure=SEGURO, public_url=os.environ.get("SOLOQ_SITE", "").rstrip("/"),
                       server_info=gestion.info_servidor)


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
    path = request.url.path
    if request.method not in ("GET", "HEAD"):
        if not path.startswith("/api/"):
            return _error(405, "solo lectura")
        if request.headers.get("x-panel") != "1":
            return _error(403, "petición no permitida")
        try:
            if int(request.headers.get("content-length") or 0) > gestion.MAX_BODY:
                return _error(413, "demasiado grande")
        except ValueError:
            return _error(400, "petición no válida")
    hosts = allowed_hosts()
    if hosts and request.headers.get("host", "").lower() not in hosts:
        return _error(403, "host no permitido")
    if ".." in path or "\\" in path or "//" in path:
        return _error(404, "no encontrado")
    request.state.user = None
    touched: list = []
    cuenta = path in PANEL or path.startswith("/api/") and path not in ("/api/latido",)
    if path in PRIVADOS or path.startswith("/api/admin/"):
        user = cuentas_api.session_user(request, touched)
        if user is None:
            if path.startswith("/api/"):
                return JSONResponse({"detail": "Tienes que entrar."}, status_code=401)
            return RedirectResponse("/entrar", status_code=303)
        request.state.user = user
        if path in SOLO_ADMIN and not user["is_admin"]:
            return RedirectResponse("/ajustes", status_code=303)
    elif path == "/entrar":
        user = cuentas_api.session_user(request)
        if user is not None:
            return RedirectResponse("/admin" if user["is_admin"] else "/ajustes", status_code=303)
    response = await call_next(request)
    cookie = request.cookies.get(cuentas_api.CONF["cookie"])
    if touched and cookie and cuentas_api.CONF["cookie"] not in response.headers.get("set-cookie", ""):
        cuentas_api.set_cookie(response, cookie)        # sesión renovada: la cookie dura otros 30 días
    if cuenta:
        response.headers["Cache-Control"] = "no-store"
    elif "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
    response.headers["Content-Security-Policy"] = _web["csp"]
    return response


app.include_router(cuentas_api.router)
app.include_router(gestion.router)


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
    return _json(gestion.filtrar_publicado(text)) if text else _error(404, "todavía no hay datos")


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
    panel = PANEL.get("/" + name)
    if panel:
        f = PANEL_DIR / panel
        return FileResponse(f, media_type=PANEL_TYPES[f.suffix])
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
