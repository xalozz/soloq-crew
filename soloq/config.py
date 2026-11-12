"""Opciones por variables de entorno (SOLOQ_*) y rutas.

Secretos (clave de Riot y webhook de Discord): por variable de entorno o, en el servidor, por
credenciales de systemd (LoadCredential → $CREDENTIALS_DIRECTORY/riot-api-key, discord-webhook).
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent           # raíz del repo: la web (index.html, app.js…) y config/
# La web nueva (React) compilada; si no está, se sirve la de la raíz (index.html + app.js)
WEB_DIST = Path(os.environ.get("SOLOQ_WEB") or ROOT / "web" / "dist")
CONFIG_DIR = Path(os.environ.get("SOLOQ_CONFIG") or ROOT / "config")
DATA_DIR = Path(os.environ.get("SOLOQ_DATA") or ROOT / "datos")
DB_PATH = DATA_DIR / "soloq.db"

# Dirección pública de la web (enlaces de Discord y del texto para compartir).
SITE = os.environ.get("SOLOQ_SITE") or "https://xalozz.github.io/soloq-crew/"
HOSTS = [h.strip().lower() for h in (os.environ.get("SOLOQ_HOSTS") or "127.0.0.1,localhost").split(",") if h.strip()]

RIOT_API_BASE = os.environ.get("RIOT_API_BASE") or None      # solo para pruebas con una API simulada
DDRAGON_BASE = os.environ.get("DDRAGON_BASE") or "https://ddragon.leagueoflegends.com"


def _secret(env, cred):
    v = os.environ.get(env)
    if v:
        return v.strip()
    d = os.environ.get("CREDENTIALS_DIRECTORY")
    if d:
        p = Path(d) / cred
        if p.is_file():
            return p.read_text(encoding="utf-8").strip() or None
    return None


RIOT_API_KEY = _secret("RIOT_API_KEY", "riot-api-key")
DISCORD_WEBHOOK = _secret("DISCORD_WEBHOOK", "discord-webhook")


def env_num(name, default):
    v = os.environ.get(name)
    try:
        return float(v) if v not in (None, "") else default
    except ValueError:
        return default
