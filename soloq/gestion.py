"""API de /admin propia de SoloQ Crew (solo administradores): novedades, umbrales, jugadores, retos, textos de los
roasts, aviso de prueba de Discord y estado del actualizador. Lo guarda en la tabla `estado` de soloq.db (claves
cfg_*), que el actualizador lee en cada pasada. Cada cambio queda en el registro de la administración.
"""

from __future__ import annotations

import json
import sqlite3
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from . import accounts, ajustes, config, cuentas_api
from .ajustes import Invalido

router = APIRouter()
MAX_BODY = 16 * 1024


def _con() -> sqlite3.Connection:
    con = sqlite3.connect(str(config.DB_PATH), timeout=10)
    con.execute("PRAGMA busy_timeout = 10000")
    con.execute("CREATE TABLE IF NOT EXISTS estado (clave TEXT PRIMARY KEY, datos TEXT NOT NULL)")
    return con


def get_state(key: str) -> Any:
    try:
        con = sqlite3.connect(f"file:{config.DB_PATH}?mode=ro", uri=True, timeout=10)
    except sqlite3.Error:
        return None
    try:
        r = con.execute("SELECT datos FROM estado WHERE clave = ?", (key,)).fetchone()
    except sqlite3.Error:
        return None
    finally:
        con.close()
    return json.loads(r[0]) if r else None


def _set_state(key: str, obj: Any) -> None:
    con = _con()
    try:
        con.execute("INSERT INTO estado VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET datos = excluded.datos",
                    (key, json.dumps(obj, ensure_ascii=False, separators=(",", ":"))))
        con.commit()
    finally:
        con.close()


def _admin(request: Request):
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Tienes que entrar.")
    if not user["is_admin"]:
        raise HTTPException(status_code=403, detail="Solo para administradores.")
    return user


async def _body(request: Request) -> Any:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(status_code=413, detail="Petición demasiado grande.")
    try:
        return json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Petición no válida.") from None


def _log(request: Request, kind: str, detail: str | None = None) -> None:
    con = accounts.connect()
    try:
        accounts.log(con, kind, actor_id=request.state.user["id"], ip=cuentas_api.client_ip(request), detail=detail)
        con.commit()
    finally:
        con.close()


def _err(msg: str) -> JSONResponse:
    return JSONResponse({"detail": msg}, status_code=400)


def info_servidor() -> dict:
    """Para el resumen de la administración: cómo fue la última pasada del actualizador."""
    return {"pasada": get_state("pasada"), "latido": (get_state("latido") or {}).get("beat"),
            "prueba": get_state(ajustes.K_PRUEBA)}


@router.get("/api/admin/soloq")
def leer(request: Request) -> dict:
    _admin(request)
    c = ajustes.leer(get_state)
    base = ajustes.textos_archivo()
    publicado = get_state("publicado") or {}
    cuentas = {}
    for p in publicado.get("players") or []:
        for a in p.get("accounts") or []:
            if a.get("riotId"):
                r = a.get("rank") or {}
                cuentas[a["riotId"].lower()] = {"error": a.get("error"), "tier": r.get("tier"), "division": r.get("division"),
                                                "lp": r.get("lp"), "games": (r.get("wins") or 0) + (r.get("losses") or 0) if r else None}
    return {"catalogo": [{**x, "p": [{"k": k, "label": lbl, "tipo": t, "min": lo, "max": hi} for k, lbl, t, lo, hi in x.get("p") or []]}
                         for x in ajustes.CATALOGO],
            "defectos": ajustes.DEFAULT_PARAMS, "ajustes": c["ajustes"], "jugadores": c["jugadores"], "retos": c["retos"],
            "textos": c["textos"], "textosBase": base, "huecos": sorted(ajustes.HUECOS), "regiones": list(ajustes.REGIONES),
            "cuentas": cuentas, **info_servidor()}


@router.put("/api/admin/soloq/ajustes")
async def guardar_ajustes(request: Request) -> JSONResponse:
    _admin(request)
    try:
        nuevo = ajustes.validar(await _body(request))
    except Invalido as e:
        return _err(str(e))
    antes = ajustes.completar(get_state(ajustes.K_AJUSTES))
    _set_state(ajustes.K_AJUSTES, nuevo)
    despues = ajustes.completar(nuevo)
    cambios = []
    for c in ajustes.CATALOGO:
        a, d = antes["avisos"][c["k"]], despues["avisos"][c["k"]]
        for canal, nombre in (("web", "web"), ("discord", "Discord")):
            if a[canal] != d[canal]:
                cambios.append(f"{c['nombre']}: {nombre} {'sí' if d[canal] else 'no'}")
        if a["p"] != d["p"]:
            cambios.append(f"{c['nombre']}: umbrales")
    if antes["roastsPorDia"] != despues["roastsPorDia"]:
        cambios.append(f"roasts por día: {despues['roastsPorDia']}")
    if antes["discord"]["activo"] != despues["discord"]["activo"]:
        cambios.append("Discord " + ("activado" if despues["discord"]["activo"] else "en pausa"))
    _log(request, "novedades cambiadas", "; ".join(cambios) or "sin cambios")
    return JSONResponse({"ok": True, "ajustes": despues})


@router.put("/api/admin/soloq/jugadores")
async def guardar_jugadores(request: Request) -> JSONResponse:
    _admin(request)
    try:
        nuevo = ajustes.validar_jugadores(await _body(request))
    except Invalido as e:
        return _err(str(e))
    antes = ajustes.leer(get_state)["jugadores"] or {"players": []}
    _set_state(ajustes.K_JUGADORES, nuevo)
    na = {p["name"] for p in antes.get("players") or []}
    nd = {p["name"] for p in nuevo["players"]}
    ca = {a["riotId"].lower() for p in antes.get("players") or [] for a in p["accounts"]}
    cd = {a["riotId"].lower() for p in nuevo["players"] for a in p["accounts"]}
    det = [f"+ {x}" for x in sorted(nd - na)] + [f"− {x}" for x in sorted(na - nd)]
    det += [f"+ cuenta {x}" for x in sorted(cd - ca)] + [f"− cuenta {x}" for x in sorted(ca - cd)]
    _log(request, "jugadores cambiados", ", ".join(det) or "nombres, regiones o títulos")
    return JSONResponse({"ok": True, "jugadores": nuevo})


@router.put("/api/admin/soloq/retos")
async def guardar_retos(request: Request) -> JSONResponse:
    _admin(request)
    nombres = {p["name"] for p in (ajustes.leer(get_state)["jugadores"] or {}).get("players") or []}
    try:
        nuevo = ajustes.validar_retos(await _body(request), nombres)
    except Invalido as e:
        return _err(str(e))
    _set_state(ajustes.K_RETOS, nuevo)
    _log(request, "retos cambiados", ", ".join(r["title"] for r in nuevo) or "sin retos")
    return JSONResponse({"ok": True, "retos": nuevo})


@router.put("/api/admin/soloq/textos")
async def guardar_textos(request: Request) -> JSONResponse:
    _admin(request)
    try:
        nuevo = ajustes.validar_textos(await _body(request))
    except Invalido as e:
        return _err(str(e))
    base = ajustes.textos_archivo()
    propios = {k: v for k, v in nuevo.items() if v["texto"] != (base.get(k) or {}).get("texto")}
    _set_state(ajustes.K_TEXTOS, propios)
    _log(request, "textos de roasts cambiados", ", ".join(sorted(propios)) or "los de serie")
    return JSONResponse({"ok": True, "textos": {**base, **propios}})


@router.post("/api/admin/soloq/discord-prueba")
def discord_prueba(request: Request) -> JSONResponse:
    _admin(request)
    req = {"pedida": int(time.time() * 1000)}
    _set_state(ajustes.K_PRUEBA, req)
    _log(request, "aviso de prueba a Discord")
    return JSONResponse({"ok": True, "prueba": req})


# ------------------------------------------------------------------ novedades visibles en la web

_cache: dict[str, Any] = {"key": None, "text": None}


def filtrar_publicado(text: str) -> str:
    """data.json sin las novedades que no salen en la web según los ajustes (cacheado hasta que cambie algo)."""
    raw = get_state(ajustes.K_AJUSTES)
    key = (hash(text), json.dumps(raw, sort_keys=True))
    if _cache["key"] == key:
        return _cache["text"]
    avisos = ajustes.completar(raw)["avisos"]
    if all(a["web"] for k, a in avisos.items() if not ajustes.POR_CLAVE[k].get("soloDiscord")):
        out = text
    else:
        data = json.loads(text)
        data["events"] = [e for e in data.get("events") or []
                          if (avisos.get(ajustes.clave_evento(e)) or {}).get("web", True)]
        out = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    _cache.update(key=key, text=out)
    return out
