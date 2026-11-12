# SoloQ Crew — contexto para Claude

Ranking de SoloQ del grupo de amigos (cuentas en `config/players.json`). Lo común (VPS, stack, Git) está en
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
