"""Cuentas de usuario: contraseñas, verificación en dos pasos, sesiones, invitaciones y registro de eventos.

Copiado de garmin-panel (``app/accounts.py``) y ampliado con verificación en dos pasos (TOTP, RFC 6238, como Google
Authenticator, Aegis o 1Password) **opcional**: desactivada al crear la cuenta; cada uno la activa en «cuenta». Si la
tiene activada, para entrar hacen falta usuario, contraseña y código; si no, usuario y contraseña.
Copiado de luz y estado; la ruta de la base la pone el servidor (``DB_PATH``).

Sin correo electrónico. Las cuentas nacen de un enlace de invitación de un
solo uso que genera un administrador; si alguien olvida la contraseña, el
administrador le genera un enlace para ponerse una nueva.

* Contraseñas con scrypt (biblioteca estándar).
* Los tokens de sesión e invitación solo se guardan como SHA-256: quien lea la
  base de datos no puede usarlos.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import struct
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

DB_PATH = Path(os.environ.get("CUENTAS_DB", "cuentas.db"))
SESSION_DAYS = 30             # deslizante: cada uso la alarga; caduca tras 30 días sin entrar
SIGNUP_DAYS = 7
RESET_HOURS = 48
TOUCH_SECONDS = 300            # cada cuánto se apunta el «último acceso» de una sesión
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
MIN_PASSWORD = 8

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    username          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pw_hash           TEXT NOT NULL,
    is_admin          INTEGER NOT NULL DEFAULT 0,
    disabled          INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL,
    last_login        TEXT,
    totp_secret       TEXT NOT NULL DEFAULT '',   -- base32; vacío = verificación en dos pasos desactivada
    totp_last         INTEGER NOT NULL DEFAULT 0   -- último paso usado: un código no vale dos veces
);

CREATE TABLE IF NOT EXISTS invites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash  TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL,            -- 'alta' · 'reset'
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    is_admin    INTEGER NOT NULL DEFAULT 0,
    note        TEXT,
    created_by  INTEGER,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    used_at     TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    last_seen   TEXT,
    ip          TEXT,
    agent       TEXT
);

CREATE TABLE IF NOT EXISTS events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    at        TEXT NOT NULL,
    user_id   INTEGER,
    actor_id  INTEGER,
    kind      TEXT NOT NULL,
    detail    TEXT,
    ip        TEXT
);
CREATE INDEX IF NOT EXISTS events_at ON events(at);
"""


class AccountError(Exception):
    """Error con un mensaje listo para enseñar."""


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def connect(path: Path | None = None) -> sqlite3.Connection:
    path = Path(path) if path else DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    con.executescript(SCHEMA)
    return con


# ---------------------------------------------------------------- contraseñas

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    n, r, p = 2 ** 14, 8, 1
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=32)
    b64 = lambda b: base64.b64encode(b).decode("ascii")  # noqa: E731
    return f"scrypt${n}${r}${p}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        if stored.count("$") == 2:     # formato de la entrada antigua de un solo usuario: scrypt$sal_hex$hash_hex
            algo, salt_hex, digest_hex = stored.split("$")
            got = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex), n=2 ** 14, r=8, p=1, dklen=32)
            return algo == "scrypt" and hmac.compare_digest(got.hex(), digest_hex)
        algo, n, r, p, salt, digest = stored.split("$")
        if algo != "scrypt":
            return False
        expected = base64.b64decode(digest)
        got = hashlib.scrypt(password.encode("utf-8"), salt=base64.b64decode(salt),
                             n=int(n), r=int(r), p=int(p), dklen=len(expected))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got, expected)


_DUMMY_HASH = hash_password(secrets.token_urlsafe(12))   # para que un usuario inexistente tarde lo mismo


def check_username(username: str) -> str:
    name = (username or "").strip().lower()
    if not USERNAME_RE.match(name):
        raise AccountError("El usuario tiene que tener entre 3 y 32 caracteres: letras sin tildes, números, punto, guion o guion bajo.")
    return name


def check_password(password: str, username: str = "") -> str:
    if not isinstance(password, str) or len(password) < MIN_PASSWORD:
        raise AccountError(f"La contraseña tiene que tener al menos {MIN_PASSWORD} caracteres.")
    if len(password) > 200:
        raise AccountError("La contraseña es demasiado larga.")
    if username and password.strip().lower() == username.lower():
        raise AccountError("La contraseña no puede ser igual que el usuario.")
    return password


# ---------------------------------------------------------------- verificación en dos pasos (TOTP)

TOTP_STEP = 30
TOTP_WINDOW = 1          # acepta el código anterior y el siguiente (relojes desfasados)
SECRET_RE = re.compile(r"^[A-Z2-7]{16,64}$")


def new_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def check_totp_secret(secret: str) -> str:
    secret = (secret or "").strip().upper().replace(" ", "")
    if not SECRET_RE.match(secret):
        raise AccountError("Falta la clave de la app de códigos. Vuelve a abrir el enlace.")
    return secret


def totp(secret: str, counter: int) -> str:
    key = base64.b32decode(secret.upper() + "=" * (-len(secret) % 8))
    d = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    o = d[-1] & 0x0F
    return f"{(struct.unpack('>I', d[o:o + 4])[0] & 0x7FFFFFFF) % 10 ** 6:06d}"


def totp_step(secret: str, code: str, now: float | None = None, after: int = 0) -> int | None:
    """Paso del código si es válido y posterior a ``after`` (así no se puede reutilizar), o None."""
    code = "".join(c for c in str(code or "") if c.isdigit())
    if len(code) != 6:
        return None
    current = int((now if now is not None else time.time()) // TOTP_STEP)
    for step in range(current - TOTP_WINDOW, current + TOTP_WINDOW + 1):
        if step > after and hmac.compare_digest(totp(secret, step), code):
            return step
    return None


def otpauth_uri(issuer: str, username: str, secret: str) -> str:
    from urllib.parse import quote
    return (f"otpauth://totp/{quote(issuer)}:{quote(username)}?secret={secret}&issuer={quote(issuer)}"
            "&digits=6&period=30")


def has_totp(user: sqlite3.Row) -> bool:
    return bool(user["totp_secret"])


def set_totp(con: sqlite3.Connection, user_id: int, secret: str | None, step: int = 0) -> None:
    """Activa (con su secreto y el paso ya usado al confirmarlo) o desactiva (None) la verificación en dos pasos."""
    con.execute("UPDATE users SET totp_secret=?, totp_last=? WHERE id=?",
                (check_totp_secret(secret) if secret else "", step if secret else 0, user_id))


def use_totp(con: sqlite3.Connection, user: sqlite3.Row, code: str) -> bool:
    """Comprueba el código de un usuario y lo gasta (atómico: con dos peticiones con el mismo código, vale una)."""
    step = totp_step(user["totp_secret"], code, after=int(user["totp_last"] or 0))
    if step is None:
        return False
    cur = con.execute("UPDATE users SET totp_last=? WHERE id=? AND totp_last < ?", (step, user["id"], step))
    return cur.rowcount == 1


# ---------------------------------------------------------------- eventos

def log(con: sqlite3.Connection, kind: str, *, user_id: int | None = None, actor_id: int | None = None,
        detail: str | None = None, ip: str | None = None) -> None:
    con.execute("INSERT INTO events (at, user_id, actor_id, kind, detail, ip) VALUES (?, ?, ?, ?, ?, ?)",
                (_iso(_now()), user_id, actor_id, kind, (detail or "")[:300] or None, ip))


# Categorías del registro (como el «audit log» de Gitea o Authentik): se deducen del tipo de evento.
EVENT_CATS: dict[str, tuple[str, ...]] = {
    "acceso": ("entrada", "entrada fallida", "cerró todas sus sesiones"),
    "cuenta": ("alta", "acceso restablecido", "cambió su contraseña", "cuenta migrada",
               "activó la verificación en dos pasos", "desactivó la verificación en dos pasos"),
    "admin": ("invitación creada", "invitación anulada", "enlace para restablecer el acceso", "sesiones cerradas",
              "sesión cerrada", "datos importados"),
}
ADMIN_PREFIX = "usuario "          # «usuario desactivado», «usuario borrado»…
APP_CAT = "app"                    # lo propio de la app (aquí no hay nada aún)


def event_category(kind: str) -> str:
    for cat, kinds in EVENT_CATS.items():
        if kind in kinds:
            return cat
    return "admin" if kind.startswith(ADMIN_PREFIX) else APP_CAT


def _event_row(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    d["cat"] = event_category(d["kind"])
    d["level"] = "warn" if "fallid" in d["kind"] else "info"
    return d


def events(con: sqlite3.Connection, limit: int = 150, user_id: int | None = None, *, cat: str | None = None,
           query: str | None = None, before: int | None = None, since: str | None = None) -> list[dict[str, Any]]:
    """Eventos del más nuevo al más viejo, con filtros. ``before`` = id para pedir la página siguiente."""
    sql = ("SELECT e.*, u.username AS username, a.username AS actor FROM events e "
           "LEFT JOIN users u ON u.id=e.user_id LEFT JOIN users a ON a.id=e.actor_id")
    where: list[str] = []
    args: list[Any] = []
    if user_id is not None:
        where.append("(e.user_id=? OR e.actor_id=?)")
        args += [user_id, user_id]
    if cat:
        known = [k for kinds in EVENT_CATS.values() for k in kinds]
        if cat == "admin":
            kinds = EVENT_CATS["admin"]
            where.append(f"(e.kind IN ({','.join('?' * len(kinds))}) OR e.kind LIKE ?)")
            args += [*kinds, ADMIN_PREFIX + "%"]
        elif cat in EVENT_CATS:
            kinds = EVENT_CATS[cat]
            where.append(f"e.kind IN ({','.join('?' * len(kinds))})")
            args += list(kinds)
        elif cat == "fallos":
            where.append("e.kind LIKE '%fallid%'")
        else:
            where.append(f"e.kind NOT IN ({','.join('?' * len(known))}) AND e.kind NOT LIKE ?")
            args += [*known, ADMIN_PREFIX + "%"]
    if query:
        like = "%" + query.strip()[:80].replace("\\", "").replace("%", "").replace("_", "") + "%"
        where.append("(e.kind LIKE ? OR e.detail LIKE ? OR e.ip LIKE ? OR u.username LIKE ? OR a.username LIKE ?)")
        args += [like] * 5
    if before is not None:
        where.append("e.id < ?")
        args.append(before)
    if since:
        where.append("e.at >= ?")
        args.append(since)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY e.id DESC LIMIT ?"
    args.append(limit)
    return [_event_row(r) for r in con.execute(sql, args)]


def count_events(con: sqlite3.Connection, kind: str, since: datetime) -> int:
    return con.execute("SELECT COUNT(*) FROM events WHERE kind=? AND at >= ?", (kind, _iso(since))).fetchone()[0]


# ---------------------------------------------------------------- usuarios

def get_user(con: sqlite3.Connection, user_id: int) -> sqlite3.Row | None:
    return con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()


def get_user_by_name(con: sqlite3.Connection, username: str) -> sqlite3.Row | None:
    return con.execute("SELECT * FROM users WHERE username=?", ((username or "").strip().lower(),)).fetchone()


def create_user(con: sqlite3.Connection, username: str, password: str | None, *, totp_secret: str | None = None,
                is_admin: bool = False, pw_hash: str | None = None, totp_last: int = 0) -> int:
    name = check_username(username)
    if pw_hash is None:
        check_password(password or "", name)
        pw_hash = hash_password(password or "")
    secret = check_totp_secret(totp_secret) if totp_secret else ""
    if get_user_by_name(con, name):
        raise AccountError("Ese usuario ya existe. Elige otro.")
    cur = con.execute("INSERT INTO users (username, pw_hash, is_admin, created_at, totp_secret, totp_last) "
                      "VALUES (?, ?, ?, ?, ?, ?)", (name, pw_hash, int(is_admin), _iso(_now()), secret, totp_last))
    return int(cur.lastrowid)


def check_credentials(con: sqlite3.Connection, username: str, password: str) -> sqlite3.Row | None:
    """Usuario y contraseña (sin el código). None si no valen o la cuenta está desactivada."""
    user = get_user_by_name(con, username)
    if user is None:
        verify_password(password or "", _DUMMY_HASH)     # mismo tiempo exista o no el usuario
        return None
    if not verify_password(password or "", user["pw_hash"]) or user["disabled"]:
        return None
    return user


def authenticate(con: sqlite3.Connection, username: str, password: str, code: str) -> sqlite3.Row | None:
    """Usuario, contraseña y, si la cuenta tiene la verificación en dos pasos, código (que se gasta)."""
    user = check_credentials(con, username, password)
    if user is None or (has_totp(user) and not use_totp(con, user, code)):
        return None
    return user


def set_password(con: sqlite3.Connection, user_id: int, password: str, totp_secret: str | None = None) -> None:
    """Contraseña nueva (y, si se da, secreto TOTP nuevo: restablecer el acceso tras perder el móvil). Cierra sus
    sesiones."""
    user = get_user(con, user_id)
    if user is None:
        raise AccountError("Ese usuario no existe.")
    check_password(password, user["username"])
    con.execute("UPDATE users SET pw_hash=? WHERE id=?", (hash_password(password), user_id))
    if totp_secret is not None:
        con.execute("UPDATE users SET totp_secret=?, totp_last=0 WHERE id=?", (check_totp_secret(totp_secret), user_id))
    con.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))


def active_admins(con: sqlite3.Connection) -> int:
    return con.execute("SELECT COUNT(*) FROM users WHERE is_admin=1 AND disabled=0").fetchone()[0]


def set_flags(con: sqlite3.Connection, user_id: int, *, is_admin: bool | None = None, disabled: bool | None = None) -> None:
    user = get_user(con, user_id)
    if user is None:
        raise AccountError("Ese usuario no existe.")
    losing_admin = user["is_admin"] and not user["disabled"] and (is_admin is False or disabled is True)
    if losing_admin and active_admins(con) <= 1:
        raise AccountError("Tiene que quedar al menos un administrador activo.")
    if is_admin is not None:
        con.execute("UPDATE users SET is_admin=? WHERE id=?", (int(is_admin), user_id))
    if disabled is not None:
        con.execute("UPDATE users SET disabled=? WHERE id=?", (int(disabled), user_id))
        if disabled:
            con.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))


def delete_user(con: sqlite3.Connection, user_id: int) -> None:
    user = get_user(con, user_id)
    if user is None:
        raise AccountError("Ese usuario no existe.")
    if user["is_admin"] and not user["disabled"] and active_admins(con) <= 1:
        raise AccountError("No se puede borrar el último administrador.")
    con.execute("DELETE FROM users WHERE id=?", (user_id,))


def list_users(con: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = con.execute(
        "SELECT u.id, u.username, u.is_admin, u.disabled, u.created_at, u.last_login, "
        "COALESCE(u.totp_secret, '') != '' AS totp, "
        "(SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.expires_at > ?) AS sessions, "
        "(SELECT MAX(last_seen) FROM sessions s WHERE s.user_id=u.id) AS last_seen "
        "FROM users u ORDER BY u.id", (_iso(_now()),)
    ).fetchall()
    return [{**dict(r), "totp": bool(r["totp"])} for r in rows]


# ---------------------------------------------------------------- invitaciones

def create_invite(con: sqlite3.Connection, kind: str, *, created_by: int | None, user_id: int | None = None,
                  is_admin: bool = False, note: str | None = None) -> tuple[str, str]:
    """Crea un enlace de un solo uso. Devuelve (token, caduca)."""
    if kind not in ("alta", "reset"):
        raise ValueError(kind)
    if kind == "reset":
        if user_id is None or get_user(con, user_id) is None:
            raise AccountError("Ese usuario no existe.")
        # Solo vale el último enlace de restablecer de cada usuario.
        con.execute("DELETE FROM invites WHERE kind='reset' AND user_id=? AND used_at IS NULL", (user_id,))
    token = secrets.token_urlsafe(32)
    now = _now()
    expires = now + (timedelta(days=SIGNUP_DAYS) if kind == "alta" else timedelta(hours=RESET_HOURS))
    con.execute(
        "INSERT INTO invites (token_hash, kind, user_id, is_admin, note, created_by, created_at, expires_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (_hash_token(token), kind, user_id, int(is_admin), (note or "").strip()[:80] or None, created_by,
         _iso(now), _iso(expires)),
    )
    return token, _iso(expires)


def find_invite(con: sqlite3.Connection, token: str) -> sqlite3.Row | None:
    """Invitación vigente (sin usar y sin caducar) o None."""
    if not token or len(token) > 200:
        return None
    row = con.execute(
        "SELECT i.*, u.username AS username FROM invites i LEFT JOIN users u ON u.id=i.user_id WHERE token_hash=?",
        (_hash_token(token),),
    ).fetchone()
    if row is None or row["used_at"] or row["expires_at"] <= _iso(_now()):
        return None
    if row["kind"] == "reset" and row["username"] is None:
        return None
    return row


def pending_invites(con: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = con.execute(
        "SELECT i.id, i.kind, i.note, i.is_admin, i.user_id, i.created_at, i.expires_at, u.username AS username, "
        "c.username AS created_by FROM invites i LEFT JOIN users u ON u.id=i.user_id "
        "LEFT JOIN users c ON c.id=i.created_by WHERE i.used_at IS NULL AND i.expires_at > ? ORDER BY i.id DESC",
        (_iso(_now()),),
    ).fetchall()
    return [dict(r) for r in rows]


def revoke_invite(con: sqlite3.Connection, invite_id: int) -> None:
    con.execute("DELETE FROM invites WHERE id=? AND used_at IS NULL", (invite_id,))


def check_new_code(secret: str, code: str) -> int:
    """Al activar la verificación en dos pasos: el primer código de la app tiene que valer. Devuelve su paso."""
    step = totp_step(check_totp_secret(secret), code)
    if step is None:
        raise AccountError("El código no es correcto. Comprueba que has añadido la cuenta en la app y escribe el "
                           "código que sale ahora.")
    return step


def redeem_signup(con: sqlite3.Connection, token: str, username: str, password: str) -> int:
    invite = find_invite(con, token)
    if invite is None or invite["kind"] != "alta":
        raise AccountError("Este enlace ya se ha usado o ha caducado. Pide uno nuevo.")
    name = check_username(username)
    check_password(password, name)
    if get_user_by_name(con, name):
        raise AccountError("Ese usuario ya existe. Elige otro.")
    # Se marca como usado antes de crear la cuenta y solo si nadie lo ha usado ya (dos peticiones a la vez).
    claimed = con.execute("UPDATE invites SET used_at=? WHERE id=? AND used_at IS NULL", (_iso(_now()), invite["id"]))
    if claimed.rowcount != 1:
        raise AccountError("Este enlace ya se ha usado o ha caducado. Pide uno nuevo.")
    user_id = create_user(con, username, password, is_admin=bool(invite["is_admin"]))
    con.execute("UPDATE invites SET user_id=? WHERE id=?", (user_id, invite["id"]))
    return user_id


def redeem_reset(con: sqlite3.Connection, token: str, password: str) -> int:
    """Restablecer el acceso: contraseña nueva y verificación en dos pasos desactivada (puede haber perdido el móvil;
    si la quiere, la vuelve a activar en «cuenta»). Cierra todas sus sesiones."""
    invite = find_invite(con, token)
    if invite is None or invite["kind"] != "reset":
        raise AccountError("Este enlace ya se ha usado o ha caducado. Pide uno nuevo.")
    check_password(password, invite["username"])
    claimed = con.execute("UPDATE invites SET used_at=? WHERE id=? AND used_at IS NULL", (_iso(_now()), invite["id"]))
    if claimed.rowcount != 1:
        raise AccountError("Este enlace ya se ha usado o ha caducado. Pide uno nuevo.")
    set_password(con, invite["user_id"], password)
    set_totp(con, invite["user_id"], None)
    return int(invite["user_id"])


# ---------------------------------------------------------------- sesiones

def create_session(con: sqlite3.Connection, user_id: int, ip: str | None = None, agent: str | None = None) -> str:
    token = secrets.token_urlsafe(32)
    now = _now()
    con.execute(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen, ip, agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (_hash_token(token), user_id, _iso(now), _iso(now + timedelta(days=SESSION_DAYS)), _iso(now), ip,
         (agent or "")[:200] or None),
    )
    con.execute("UPDATE users SET last_login=? WHERE id=?", (_iso(now), user_id))
    con.execute("DELETE FROM sessions WHERE expires_at <= ?", (_iso(now),))
    return token


def session_user(con: sqlite3.Connection, token: str | None, touched: list | None = None) -> sqlite3.Row | None:
    if not token or len(token) > 200:
        return None
    now = _now()
    row = con.execute(
        "SELECT s.token_hash, s.last_seen, s.expires_at, u.* FROM sessions s JOIN users u ON u.id=s.user_id "
        "WHERE s.token_hash=?", (_hash_token(token),),
    ).fetchone()
    if row is None or row["expires_at"] <= _iso(now) or row["disabled"]:
        return None
    if not row["last_seen"] or (now - datetime.fromisoformat(row["last_seen"])).total_seconds() > TOUCH_SECONDS:
        # Deslizante: mientras se use, no caduca. Quien la renueve reenvía la cookie (``touched``).
        con.execute("UPDATE sessions SET last_seen=?, expires_at=? WHERE token_hash=?",
                    (_iso(now), _iso(now + timedelta(days=SESSION_DAYS)), row["token_hash"]))
        con.commit()
        if touched is not None:
            touched.append(True)
    return row


def end_session(con: sqlite3.Connection, token: str | None) -> None:
    if token:
        con.execute("DELETE FROM sessions WHERE token_hash=?", (_hash_token(token),))


def end_all_sessions(con: sqlite3.Connection, user_id: int) -> None:
    con.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))


def list_sessions(con: sqlite3.Connection, user_id: int | None = None) -> list[dict[str, Any]]:
    """Sesiones vigentes (el id es el rowid: el token no sale nunca del servidor)."""
    sql = ("SELECT s.rowid AS id, s.token_hash, s.user_id, u.username, s.created_at, s.expires_at, s.last_seen, "
           "s.ip, s.agent FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.expires_at > ?")
    args: list[Any] = [_iso(_now())]
    if user_id is not None:
        sql += " AND s.user_id=?"
        args.append(user_id)
    sql += " ORDER BY COALESCE(s.last_seen, s.created_at) DESC"
    return [dict(r) for r in con.execute(sql, args)]


def end_session_by_id(con: sqlite3.Connection, session_id: int) -> int | None:
    """Cierra una sesión por su id. Devuelve el usuario al que pertenecía (o None si no existe)."""
    row = con.execute("SELECT user_id FROM sessions WHERE rowid=?", (session_id,)).fetchone()
    if row is None:
        return None
    con.execute("DELETE FROM sessions WHERE rowid=?", (session_id,))
    return int(row["user_id"])


def token_hash(token: str | None) -> str | None:
    return _hash_token(token) if token else None


# ---------------------------------------------------------------- intentos fallidos

class Throttle:
    """Limita intentos fallidos por clave (IP, usuario…) en una ventana de tiempo."""

    def __init__(self, max_fails: int, window_s: int) -> None:
        self.max_fails = max_fails
        self.window_s = window_s
        self._fails: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def wait(self, key: str) -> int:
        now = time.monotonic()
        with self._lock:
            fails = [t for t in self._fails.get(key, []) if now - t < self.window_s]
            if fails:
                self._fails[key] = fails
            else:
                self._fails.pop(key, None)
            if len(fails) >= self.max_fails:
                return int(self.window_s - (now - fails[0])) + 1
            return 0

    def fail(self, key: str) -> None:
        with self._lock:
            self._fails.setdefault(key, []).append(time.monotonic())

    def clear(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key, None)
