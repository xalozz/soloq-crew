"""Cuentas en la web: entrar, salir, alta por invitación, tu cuenta y administración (``/api/admin/*``).

Copiado de luz y estado. La administración tiene la misma API que la de Bitácora y la Agenda, así que la
página (``web/admin.js``) es la misma. Lo propio de cada app se pasa con ``configurar()``.

Entrada: usuario + contraseña, y el código TOTP solo si esa cuenta tiene activada la verificación en dos pasos (es
opcional; cada uno la activa en «cuenta»). Si la contraseña vale y falta el código, la respuesta es ``{"codigo": true}``
sin sesión y la página lo pide (como GitHub). Límite de intentos por IP, por usuario y por usuario+IP, como en
Bitácora; cada fallo se escribe en el registro del servicio (``<app>: entrada fallida desde IP``).
"""

from __future__ import annotations

import json
import math
import sqlite3
from datetime import datetime, timedelta
from typing import Any, Callable

import segno
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from . import accounts

MAX_BODY = 8 * 1024

CONF: dict[str, Any] = {
    "app": "panel",              # nombre para el registro y la app de códigos (emisor del TOTP)
    "cookie": "panel",
    "secure": True,
    "public_url": "",            # https://luz.xalozz.es (para los enlaces de invitación)
    "server_info": None,         # () -> dict con lo propio de la app para el resumen
}

router = APIRouter()

_login_ip = accounts.Throttle(max_fails=10, window_s=900)
_login_user = accounts.Throttle(max_fails=30, window_s=900)     # aunque vengan de muchas IPs
_login_pair = accounts.Throttle(max_fails=5, window_s=900)      # mismo usuario desde la misma IP
_password_user = accounts.Throttle(max_fails=5, window_s=900)   # cambio de contraseña con la sesión abierta
_invite_ip = accounts.Throttle(max_fails=10, window_s=900)


def configurar(app: str, *, secure: bool, public_url: str = "", server_info: Callable[[], dict] | None = None) -> None:
    CONF.update(app=app, cookie=f"__Host-{app}" if secure else app, secure=secure, public_url=public_url.rstrip("/"),
                server_info=server_info)


def reiniciar() -> None:
    """Para las pruebas."""
    for t in (_login_ip, _login_user, _login_pair, _password_user, _invite_ip):
        t._fails.clear()


# ---------------------------------------------------------------- utilidades

def client_ip(request: Request) -> str:
    # Solo escucha en 127.0.0.1 detrás de Caddy, que pone la IP real al final de X-Forwarded-For.
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[-1].strip()[:64]
    return (request.client.host if request.client else "")[:64]


def log_failure(kind: str, ip: str) -> None:
    print(f"{CONF['app']}: {kind} fallida desde {ip}", flush=True)


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


def _con() -> sqlite3.Connection:
    return accounts.connect()


def session_user(request: Request, touched: list | None = None) -> sqlite3.Row | None:
    token = request.cookies.get(CONF["cookie"])
    if not token:
        return None
    con = _con()
    try:
        return accounts.session_user(con, token, touched)
    finally:
        con.close()


def _user(request: Request) -> sqlite3.Row:
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Tienes que entrar.")
    return user


def _admin(request: Request) -> sqlite3.Row:
    user = _user(request)
    if not user["is_admin"]:
        raise HTTPException(status_code=403, detail="Solo para administradores.")
    return user


async def json_body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(status_code=413, detail="Petición demasiado grande.")
    try:
        body = json.loads(raw)
    except Exception:
        body = None
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Petición no válida.")
    return body


def set_cookie(response, token: str) -> None:
    # Lax (no Strict): al abrir el panel desde un enlace (portada, mensajería…) el navegador sí manda la cookie.
    response.set_cookie(CONF["cookie"], token, max_age=accounts.SESSION_DAYS * 86400, httponly=True,
                        secure=CONF["secure"], samesite="lax", path="/")



def _link(request: Request, token: str) -> str:
    base = CONF["public_url"] or f"{request.url.scheme}://{request.headers.get('host', '')}"
    return f"{base}/cuenta#t={token}"


def _wait(*pairs: tuple[accounts.Throttle, str]) -> JSONResponse | None:
    wait = max(t.wait(k) for t, k in pairs)
    return _error(429, f"Demasiados intentos. Espera {math.ceil(wait / 60)} min.") if wait else None


# ---------------------------------------------------------------- entrar y salir

@router.post("/api/entrar")
def entrar(request: Request, body: dict[str, Any] = Depends(json_body)) -> JSONResponse:
    username = str(body.get("usuario") or "").strip().lower()[:64]
    password = str(body.get("clave") or "")[:200]
    code = str(body.get("codigo") or "")[:20]
    ip = client_ip(request)
    pair = f"{username}|{ip}"
    blocked = _wait((_login_ip, ip), (_login_user, username), (_login_pair, pair))
    if blocked:
        return blocked
    con = _con()
    try:
        user = accounts.check_credentials(con, username, password)
        if user is not None and accounts.has_totp(user) and not code.strip():
            return JSONResponse({"codigo": True})        # contraseña buena: falta el código de la app
        if user is None or (accounts.has_totp(user) and not accounts.use_totp(con, user, code)):
            log_failure("entrada", ip)
            _login_ip.fail(ip)
            _login_user.fail(username)
            _login_pair.fail(pair)
            known = accounts.get_user_by_name(con, username)
            detail = f"usuario «{username[:32]}»" if not known else ("código incorrecto" if user is not None else None)
            accounts.log(con, "entrada fallida", user_id=known["id"] if known else None, ip=ip, detail=detail)
            con.commit()
            return _error(401, "El código no es correcto." if user is not None else "Usuario o contraseña incorrectos.")
        _login_pair.clear(pair)
        token = accounts.create_session(con, user["id"], ip, request.headers.get("user-agent"))
        accounts.log(con, "entrada", user_id=user["id"], ip=ip)
        con.commit()
    finally:
        con.close()
    response = JSONResponse({"ok": True})
    set_cookie(response, token)
    return response


@router.post("/api/salir")
def salir(request: Request) -> JSONResponse:
    con = _con()
    try:
        accounts.end_session(con, request.cookies.get(CONF["cookie"]))
        con.commit()
    finally:
        con.close()
    response = JSONResponse({"ok": True})
    response.delete_cookie(CONF["cookie"], path="/", secure=CONF["secure"], httponly=True, samesite="lax")
    return response


@router.post("/api/salir-todo")
def salir_todo(request: Request) -> JSONResponse:
    user = _user(request)
    con = _con()
    try:
        accounts.end_all_sessions(con, user["id"])
        accounts.log(con, "cerró todas sus sesiones", user_id=user["id"], ip=client_ip(request))
        con.commit()
    finally:
        con.close()
    response = JSONResponse({"ok": True})
    response.delete_cookie(CONF["cookie"], path="/", secure=CONF["secure"], httponly=True, samesite="lax")
    return response


# ---------------------------------------------------------------- tu cuenta

@router.get("/api/me")
def me(request: Request) -> dict[str, Any]:
    user = _user(request)
    con = _con()
    try:
        sessions = accounts.list_sessions(con, user["id"])
    finally:
        con.close()
    mine = accounts.token_hash(request.cookies.get(CONF["cookie"]))
    return {"id": user["id"], "username": user["username"], "is_admin": bool(user["is_admin"]),
            "created_at": user["created_at"], "app": CONF["app"], "totp": accounts.has_totp(user),
            "sessions": [{k: v for k, v in s.items() if k != "token_hash"} | {"current": s["token_hash"] == mine}
                         for s in sessions]}


@router.post("/api/clave")
def cambiar_clave(request: Request, body: dict[str, Any] = Depends(json_body)) -> JSONResponse:
    user = _user(request)
    ip = client_ip(request)
    key = str(user["id"])
    blocked = _wait((_password_user, key))
    if blocked:
        return blocked
    con = _con()
    try:
        if not accounts.verify_password(str(body.get("actual") or ""), user["pw_hash"]):
            _password_user.fail(key)
            log_failure("cambio de contraseña", ip)
            return _error(400, "La contraseña actual no es correcta.")
        try:
            accounts.set_password(con, user["id"], str(body.get("nueva") or ""))
        except accounts.AccountError as exc:
            return _error(400, str(exc))
        token = accounts.create_session(con, user["id"], ip, request.headers.get("user-agent"))
        accounts.log(con, "cambió su contraseña", user_id=user["id"], ip=ip)
        con.commit()
    finally:
        con.close()
    response = JSONResponse({"ok": True})
    set_cookie(response, token)       # las demás sesiones se cierran; esta sigue
    return response


def _qr(uri: str) -> str:
    return segno.make(uri, error="m").svg_data_uri(scale=5, border=2, dark="#000", light="#fff")


@router.get("/api/2fa/nuevo")
def totp_nuevo(request: Request) -> dict[str, Any]:
    """Secreto nuevo y su QR para activarla. No se guarda hasta que vuelve con un código que valga."""
    user = _user(request)
    secret = accounts.new_totp_secret()
    return {"totp_secret": secret,
            "totp_qr": _qr(accounts.otpauth_uri(CONF["app"] + ".xalozz.es", user["username"], secret))}


@router.post("/api/2fa")
def totp_cambiar(request: Request, body: dict[str, Any] = Depends(json_body)) -> JSONResponse:
    """Activar (``activar: true``, con ``totp_secret`` y el primer ``codigo``) o desactivar (con el ``codigo`` actual).
    Siempre pide la contraseña. Cierra las demás sesiones de la cuenta."""
    user = _user(request)
    ip = client_ip(request)
    key = str(user["id"])
    blocked = _wait((_password_user, key))
    if blocked:
        return blocked
    activar = bool(body.get("activar"))
    code = str(body.get("codigo") or "")[:20]
    con = _con()
    try:
        if not accounts.verify_password(str(body.get("clave") or ""), user["pw_hash"]):
            _password_user.fail(key)
            log_failure("cambio de verificación", ip)
            return _error(400, "La contraseña no es correcta.")
        try:
            if activar:
                step = accounts.check_new_code(str(body.get("totp_secret") or ""), code)
                accounts.set_totp(con, user["id"], str(body.get("totp_secret")), step)
            else:
                if accounts.has_totp(user) and not accounts.use_totp(con, user, code):
                    _password_user.fail(key)
                    return _error(400, "El código no es correcto.")
                accounts.set_totp(con, user["id"], None)
        except accounts.AccountError as exc:
            return _error(400, str(exc))
        accounts.end_all_sessions(con, user["id"])
        token = accounts.create_session(con, user["id"], ip, request.headers.get("user-agent"))
        accounts.log(con, "activó la verificación en dos pasos" if activar else "desactivó la verificación en dos pasos",
                     user_id=user["id"], ip=ip)
        con.commit()
    finally:
        con.close()
    response = JSONResponse({"ok": True, "totp": activar})
    set_cookie(response, token)       # las demás sesiones se cierran; esta sigue
    return response


# ---------------------------------------------------------------- invitaciones (alta y restablecer el acceso)

@router.get("/api/invite/{token}")
def invite_info(token: str, request: Request) -> JSONResponse:
    ip = client_ip(request)
    blocked = _wait((_invite_ip, ip))
    if blocked:
        return blocked
    con = _con()
    try:
        invite = accounts.find_invite(con, token)
    finally:
        con.close()
    if invite is None:
        log_failure("enlace", ip)
        _invite_ip.fail(ip)
        return _error(404, "Este enlace ya se ha usado o ha caducado. Pide uno nuevo a quien te lo mandó.")
    return JSONResponse({"kind": invite["kind"], "username": invite["username"] if invite["kind"] == "reset" else None,
                         "note": invite["note"] if invite["kind"] == "alta" else None, "app": CONF["app"],
                         "expires_at": invite["expires_at"]})


@router.post("/api/invite/{token}")
def invite_redeem(token: str, request: Request, body: dict[str, Any] = Depends(json_body)) -> JSONResponse:
    ip = client_ip(request)
    blocked = _wait((_invite_ip, ip))
    if blocked:
        return blocked
    con = _con()
    try:
        invite = accounts.find_invite(con, token)
        if invite is None:
            log_failure("enlace", ip)
            _invite_ip.fail(ip)
            return _error(404, "Este enlace ya se ha usado o ha caducado. Pide uno nuevo a quien te lo mandó.")
        password = str(body.get("password") or "")
        try:
            if invite["kind"] == "alta":
                user_id = accounts.redeem_signup(con, token, str(body.get("username") or ""), password)
                accounts.log(con, "alta", user_id=user_id, actor_id=invite["created_by"], ip=ip, detail=invite["note"])
            else:
                user_id = accounts.redeem_reset(con, token, password)
                accounts.log(con, "acceso restablecido", user_id=user_id, ip=ip,
                             detail="contraseña nueva; verificación en dos pasos desactivada")
        except accounts.AccountError as exc:
            con.rollback()
            return _error(400, str(exc))
        session = accounts.create_session(con, user_id, ip, request.headers.get("user-agent"))
        con.commit()
    finally:
        con.close()
    response = JSONResponse({"ok": True, "next": "/"})
    set_cookie(response, session)
    return response


# ---------------------------------------------------------------- administración (misma API que Bitácora y Agenda)

def _sessions_out(request: Request, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    mine = accounts.token_hash(request.cookies.get(CONF["cookie"]))
    return [{**{k: v for k, v in r.items() if k != "token_hash"}, "current": r["token_hash"] == mine} for r in rows]


def _target(con: sqlite3.Connection, user_id: int) -> sqlite3.Row:
    user = accounts.get_user(con, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Ese usuario no existe.")
    return user


@router.get("/api/admin/overview")
def admin_overview(request: Request) -> dict[str, Any]:
    admin = _admin(request)
    con = _con()
    try:
        users = accounts.list_users(con)
        invites = accounts.pending_invites(con)
        security = {"sessions": len(accounts.list_sessions(con)),
                    "failed_24h": accounts.count_events(con, "entrada fallida", datetime.now() - timedelta(hours=24))}
        recent = accounts.events(con, limit=8)
    finally:
        con.close()
    server = CONF["server_info"]() if CONF["server_info"] else {}
    return {"me": admin["id"], "users": users, "invites": invites, "security": security, "recent": recent,
            "server": server}


@router.get("/api/admin/users/{user_id}")
def admin_user_detail(user_id: int, request: Request) -> dict[str, Any]:
    _admin(request)
    con = _con()
    try:
        _target(con, user_id)
        user = next(u for u in accounts.list_users(con) if u["id"] == user_id)
        sessions = _sessions_out(request, accounts.list_sessions(con, user_id))
        events = accounts.events(con, limit=30, user_id=user_id)
    finally:
        con.close()
    return {"user": user, "sessions": sessions, "events": events}


@router.get("/api/admin/sessions")
def admin_sessions(request: Request) -> dict[str, Any]:
    _admin(request)
    con = _con()
    try:
        return {"sessions": _sessions_out(request, accounts.list_sessions(con))}
    finally:
        con.close()


@router.delete("/api/admin/sessions/{session_id}")
def admin_end_session(session_id: int, request: Request) -> JSONResponse:
    admin = _admin(request)
    con = _con()
    try:
        user_id = accounts.end_session_by_id(con, session_id)
        if user_id is None:
            return _error(404, "Esa sesión ya no existe.")
        accounts.log(con, "sesión cerrada", user_id=user_id, actor_id=admin["id"], ip=client_ip(request))
        con.commit()
    finally:
        con.close()
    return JSONResponse({"ok": True})


@router.get("/api/admin/events")
def admin_events(request: Request, user: int | None = None, cat: str | None = None, q: str | None = None,
                 before: int | None = None, limit: int = 100) -> dict[str, Any]:
    _admin(request)
    limit = max(1, min(limit, 500))
    con = _con()
    try:
        rows = accounts.events(con, limit=limit + 1, user_id=user, cat=cat, query=q, before=before)
    finally:
        con.close()
    return {"events": rows[:limit], "more": len(rows) > limit}


@router.post("/api/admin/invites")
def admin_invite(request: Request, body: dict[str, Any] = Depends(json_body)) -> JSONResponse:
    admin = _admin(request)
    note = str(body.get("note") or "")
    con = _con()
    try:
        token, expires = accounts.create_invite(con, "alta", created_by=admin["id"], is_admin=bool(body.get("is_admin")),
                                                note=note)
        accounts.log(con, "invitación creada", actor_id=admin["id"], ip=client_ip(request),
                     detail=note[:80] + (" (admin)" if body.get("is_admin") else ""))
        con.commit()
    finally:
        con.close()
    return JSONResponse({"link": _link(request, token), "expires_at": expires})


@router.delete("/api/admin/invites/{invite_id}")
def admin_revoke_invite(invite_id: int, request: Request) -> JSONResponse:
    admin = _admin(request)
    con = _con()
    try:
        accounts.revoke_invite(con, invite_id)
        accounts.log(con, "invitación anulada", actor_id=admin["id"], ip=client_ip(request))
        con.commit()
    finally:
        con.close()
    return JSONResponse({"ok": True})


@router.post("/api/admin/users/{user_id}/reset")
def admin_reset_link(user_id: int, request: Request) -> JSONResponse:
    admin = _admin(request)
    con = _con()
    try:
        target = _target(con, user_id)
        token, expires = accounts.create_invite(con, "reset", created_by=admin["id"], user_id=user_id)
        accounts.log(con, "enlace para restablecer el acceso", user_id=user_id, actor_id=admin["id"],
                     ip=client_ip(request))
        con.commit()
    finally:
        con.close()
    return JSONResponse({"link": _link(request, token), "expires_at": expires, "username": target["username"]})


@router.patch("/api/admin/users/{user_id}")
def admin_update_user(user_id: int, request: Request, body: dict[str, Any] = Depends(json_body)) -> JSONResponse:
    admin = _admin(request)
    flags = {k: bool(body[k]) for k in ("is_admin", "disabled") if k in body}
    if not flags:
        return _error(400, "Nada que cambiar.")
    if user_id == admin["id"] and (flags.get("disabled") or flags.get("is_admin") is False):
        return _error(400, "No puedes quitarte el acceso de administrador ni desactivarte a ti mismo.")
    con = _con()
    try:
        _target(con, user_id)
        try:
            accounts.set_flags(con, user_id, **flags)
        except accounts.AccountError as exc:
            return _error(400, str(exc))
        words = []
        if "disabled" in flags:
            words.append("desactivado" if flags["disabled"] else "reactivado")
        if "is_admin" in flags:
            words.append("ahora es administrador" if flags["is_admin"] else "ya no es administrador")
        accounts.log(con, "usuario " + ", ".join(words), user_id=user_id, actor_id=admin["id"], ip=client_ip(request))
        con.commit()
    finally:
        con.close()
    return JSONResponse({"ok": True})


@router.post("/api/admin/users/{user_id}/logout")
def admin_logout_user(user_id: int, request: Request) -> JSONResponse:
    admin = _admin(request)
    con = _con()
    try:
        _target(con, user_id)
        accounts.end_all_sessions(con, user_id)
        accounts.log(con, "sesiones cerradas", user_id=user_id, actor_id=admin["id"], ip=client_ip(request))
        con.commit()
    finally:
        con.close()
    return JSONResponse({"ok": True})


@router.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, request: Request, body: dict[str, Any] = Depends(json_body)) -> JSONResponse:
    admin = _admin(request)
    if user_id == admin["id"]:
        return _error(400, "No puedes borrarte a ti mismo.")
    con = _con()
    try:
        target = _target(con, user_id)
        if str(body.get("confirm") or "").strip().lower() != target["username"]:
            return _error(400, "Para borrar, escribe el nombre de usuario exacto.")
        try:
            accounts.delete_user(con, user_id)
        except accounts.AccountError as exc:
            return _error(400, str(exc))
        accounts.log(con, "usuario borrado", actor_id=admin["id"], ip=client_ip(request),
                     detail=f"«{target['username']}»")
        con.commit()
    finally:
        con.close()
    return JSONResponse({"ok": True})
