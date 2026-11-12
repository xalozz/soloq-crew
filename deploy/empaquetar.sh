#!/bin/bash
# Paquete del código para el VPS (sin datos, venv, pruebas, scripts de Node ni vídeo): deploy-paquete.tgz
# Desde la carpeta de trabajo: para desplegar, deploy/desplegar.ps1 (sale del último commit y compila la web).
# Incluye web/dist si está compilada (cd web && npm ci && npm run build).
cd "$(dirname "$0")/.."
DIST=; [ -f web/dist/index.html ] && DIST=web/dist
tar --force-local --exclude=__pycache__ -czf deploy-paquete.tgz soloq config deploy index.html app.js style.css sw.js \
  manifest.webmanifest favicon.svg favicon-32.png apple-touch-icon.png icon-192.png icon-512.png icon-maskable-512.png \
  requirements.txt README.md $DIST
