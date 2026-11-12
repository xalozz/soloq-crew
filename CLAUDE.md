# SoloQ Crew — contexto para Claude

Ranking de SoloQ del grupo de amigos (cuentas en `config/players.json`). Lo común (VPS, stack, Git) está en
`..\CLAUDE.md`; aquí solo lo de este proyecto. Detalle de funciones y del actualizador en `README.md`.

## Estado (12 nov 2026)
- **Producción hoy**: GitHub Action (`.github/workflows/update.yml`, Node: `scripts/*.mjs`) que hace commit de
  `data/*.json` en `main` cada pocos minutos + GitHub Pages (`xalozz.github.io/soloq-crew`) y el espejo estático
  `soloq.xalozz.es` (clon de `main` en `/srv/soloq/web`, `soloq-espejo.timer`). La web es la de la raíz
  (`index.html`, `app.js`, `style.css`, `sw.js`): **no tocarla mientras sirva a Pages y al espejo**.
- **Reescritura del backend en Python** (`soloq/`, FastAPI + SQLite) ya en `main`, con pruebas de paridad contra los
  scripts de Node. Desplegada en `soloq-nuevo.xalozz.es` (127.0.0.1:8001) leyendo lo que publica la Action
  (`soloq-importar.timer`); su actualizador propio está parado hasta el corte.
- **Corte final pendiente de Álvaro**: desactivar la Action, poner `/etc/soloq/riot-api-key` y
  `/etc/soloq/discord-webhook`, y ejecutar `deploy/corte.sh` (ver README, «Corte final»). Hasta entonces el
  actualizador en Python **no** debe mandar nada a Discord (los avisos saldrían dos veces).
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
