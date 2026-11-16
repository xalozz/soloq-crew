# SoloQ Crew — contexto para Claude

Ranking de SoloQ del grupo de amigos (jugadores y cuentas se gestionan en `/admin`; `config/players.json` solo vale
hasta que se guarden desde ahí). Lo común (VPS, stack, Git) está en
`..\CLAUDE.md`; aquí solo lo de este proyecto. Detalle de funciones y del actualizador en `README.md`.

## Estado (12 nov 2026, corte hecho)
- **Producción**: `soloq.xalozz.es` → servidor propio (FastAPI + SQLite, 127.0.0.1:8001) con la web nueva de `web/`
  (React + TypeScript + Vite; Node solo para compilar). El actualizador (`soloq-actualizador`, Python) consulta a
  Riot y avisa a Discord. `soloq-nuevo.xalozz.es` redirige a `soloq.xalozz.es`.
- La GitHub Action está **desactivada** y el espejo e importador apagados. GitHub Pages solo sirve `index.html` de la
  raíz, que redirige a `soloq.xalozz.es` (conserva el `#…`): no quitar Pages mientras queden enlaces viejos. Lo demás
  de la raíz (`app.js`, `sw.js`, `scripts/*.mjs`, `data/`) es la web y el actualizador viejos: se puede borrar (ojo:
  `web/` importa `../style.css`; muévelo dentro de `web/` antes). `/srv/soloq/web` (clon del espejo) también sobra.
- Claves en `/etc/soloq/riot-api-key` y `/etc/soloq/discord-webhook` (root, 600), por `LoadCredential`.
- Estado del corte: marca `/etc/soloq/corte` y drop-ins `corte.conf`; `instalar.sh` lo respeta en cada despliegue.
- La rama `video-trailer` es el vídeo «roast» (aparcado; lo generado está en `.gitignore`).

## Administración (/admin, 16 nov 2026)
- Cuentas por invitación con verificación en dos pasos opcional, como luz y estado: `soloq/accounts.py`,
  `soloq/cuentas_api.py` y `soloq/admin.py` (consola) copiados de luz; páginas en `panel/` (`admin.js`/`admin.css`
  son los comunes; `admin-app.js` lo propio). Base de cuentas: `/srv/soloq/data/cuentas.db`. El ranking sigue público;
  solo `/admin`, `/ajustes` y `/api/admin/*`, `/api/me`… piden sesión. Lo que no es GET exige `X-Panel: 1`.
  Consola (desde /tmp; `alvaro` no entra en /srv/soloq/app): `sudo -u soloq env SOLOQ_DATA=/srv/soloq/data SOLOQ_SITE=https://soloq.xalozz.es/ PYTHONPATH=/srv/soloq/app /srv/soloq/app/.venv/bin/python -m soloq.admin usuarios|invitar [--admin]|restablecer <usuario>`.
  Primera cuenta admin: invitación creada así el 16 nov 2026.
- Secciones propias (`soloq/gestion.py` + `soloq/ajustes.py`): Novedades (web/Discord por tipo, umbrales, roasts por
  día, textos de los roasts, aviso de prueba), Jugadores y Retos. Se guardan en la tabla `estado` (`cfg_ajustes`,
  `cfg_jugadores`, `cfg_retos`, `cfg_textos`; si falta una, vale `config/*.json` o los valores por defecto de
  `ajustes.py`). El actualizador las lee en cada pasada; la web filtra las novedades al servir `data.json`
  (`gestion.filtrar_publicado`), así que desactivar una en la web también oculta las ya publicadas.
- La web no tiene salida a internet: el aviso de prueba lo deja pedido (`discord_prueba`) y lo manda el actualizador.
- Pensado para que más adelante entren los amigos sin ser admin: hoy solo los admin ven `/admin`.

## Comandos
```powershell
py -3.13 -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -t .      # necesita Node para la paridad
powershell -ExecutionPolicy Bypass -File deploy\desplegar.ps1      # despliega el último commit en el VPS
```

## Cuidado
- La Action hace commits en `main` continuamente: antes de `git push`, `git pull --no-rebase`.
- La clave de Riot y el webhook de Discord nunca en el repo: en GitHub Secrets (Action) o en `/etc/soloq/`
  (credenciales de systemd).
