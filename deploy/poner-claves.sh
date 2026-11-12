#!/bin/bash
# Pone la clave de Riot y el webhook de Discord en /etc/soloq (sin que pasen por ningún chat ni por el repo),
# los comprueba y, si la GitHub Action ya está desactivada, hace el corte final (deploy/corte.sh).
# Lo ejecuta Álvaro en su terminal (es interactivo):
#   ssh -t xalozz "sudo bash /srv/soloq/app/deploy/poner-claves.sh"
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
[ "$(id -u)" = 0 ] || { echo "Ejecútalo con sudo."; exit 1; }
install -d -o root -g root -m 700 /etc/soloq
umask 077

pedir() {   # $1 archivo, $2 pregunta; si ya existe, se puede conservar
  local f=/etc/soloq/$1 v
  if [ -s "$f" ]; then
    read -rp "$2 ya está puesto. ¿Cambiarlo? (s/N) " v
    [ "${v,,}" = s ] || return 0
  fi
  read -rsp "$2 (no se verá al escribir): " v; echo
  v=$(printf '%s' "$v" | tr -d '[:space:]')
  [ -n "$v" ] || { echo "Vacío: no se guarda."; exit 1; }
  printf '%s\n' "$v" > "$f"
  chmod 600 "$f"
}

pedir riot-api-key "Clave de Riot (RGAPI-…)"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Riot-Token: $(cat /etc/soloq/riot-api-key)" \
  https://euw1.api.riotgames.com/lol/status/v4/platform-data || true)
case "$code" in
  200) echo "Clave de Riot: válida." ;;
  401|403) echo "Riot dice que la clave no vale (HTTP $code). Vuelve a ejecutar y ponla bien."; exit 1 ;;
  *) echo "No se ha podido comprobar la clave (HTTP $code); sigo." ;;
esac

pedir discord-webhook "URL del webhook de Discord"
hook=$(cat /etc/soloq/discord-webhook)
[[ "$hook" =~ ^https://(discord\.com|discordapp\.com|canary\.discord\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$ ]] \
  || { echo "Eso no parece una URL de webhook de Discord."; exit 1; }
# GET de un webhook devuelve sus datos sin publicar nada en el canal.
code=$(curl -s -o /dev/null -w '%{http_code}' "$hook" || true)
[ "$code" = 200 ] && echo "Webhook de Discord: válido." || { echo "Discord no reconoce el webhook (HTTP $code)."; exit 1; }

state=$(curl -s https://api.github.com/repos/xalozz/soloq-crew/actions/workflows \
  | python3 -c 'import json,sys; print(next((w["state"] for w in json.load(sys.stdin)["workflows"] if w["path"].endswith("update.yml")), "?"))' \
  2>/dev/null || echo "?")
if [ "$state" = active ]; then
  echo
  echo "Claves guardadas. Falta desactivar la Action en GitHub (Actions → Actualizar datos → ⋯ → Disable workflow)"
  echo "y volver a ejecutar esto: entonces hace el corte. (Hasta el corte el servidor propio no usa las claves.)"
  exit 0
fi
[ "$state" = "?" ] && { read -rp "No he podido mirar GitHub. ¿Has desactivado la Action? (s/N) " v; [ "${v,,}" = s ] || exit 0; }

echo; echo "Action desactivada ($state). Haciendo el corte…"
exec bash /srv/soloq/app/deploy/corte.sh
