#!/bin/bash
# Corte final: el servidor propio pasa a ser SoloQ Crew en soloq.xalozz.es y deja de copiar lo que
# publica la GitHub Action. Se ejecuta UNA vez como root, DESPUÉS de desactivar la Action en GitHub
# (si no, los avisos de Discord saldrían dos veces y las dos gastarían la misma clave de Riot):
#
#   Get-Content -Raw deploy/corte.sh | ssh xalozz "tr -d '\r' | sed '1s/^\xEF\xBB\xBF//' | sudo bash"
#
# Requisitos: /etc/soloq/riot-api-key y /etc/soloq/discord-webhook (root:root 600, una línea cada uno).
# Se puede repetir: si ya está hecho, solo vuelve a dejarlo todo en su sitio.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
APP=/srv/soloq/app
DATA=/srv/soloq/data

for f in riot-api-key discord-webhook; do
  [ -s "/etc/soloq/$f" ] || { echo "Falta /etc/soloq/$f: no se hace el corte."; exit 1; }
  chmod 600 "/etc/soloq/$f"
done

if [ ! -e /etc/soloq/corte ]; then
  # 1. Última copia de lo publicado por la Action, con el estado de la pasada rápida, y fin del espejo.
  systemctl stop soloq-actualizador.service 2>/dev/null || true
  systemctl start soloq-espejo.service
  systemctl disable --now soloq-espejo.timer soloq-importar.timer
  runuser -u soloq -- env SOLOQ_DATA="$DATA" "$APP/.venv/bin/python" -m soloq.importer importar \
    /srv/soloq/web/data --reemplazar --db "$DATA/soloq.db" < /dev/null
  date -Is > /etc/soloq/corte
fi

# 2. Ajustes del corte como «drop-ins» (instalar.sh no los toca): nombre definitivo, ritmo normal de
#    peticiones (ya no se comparte la clave con la Action) y avisos de Discord.
install -d -m 755 /etc/systemd/system/soloq-web.service.d /etc/systemd/system/soloq-actualizador.service.d
cat > /etc/systemd/system/soloq-web.service.d/corte.conf <<'EOF'
[Service]
Environment=SOLOQ_HOSTS=soloq.xalozz.es,soloq-nuevo.xalozz.es
Environment=SOLOQ_SITE=https://soloq.xalozz.es/
EOF
cat > /etc/systemd/system/soloq-actualizador.service.d/corte.conf <<'EOF'
[Service]
UnsetEnvironment=MIN_INTERVAL_MS
Environment=SOLOQ_SITE=https://soloq.xalozz.es/
LoadCredential=discord-webhook:/etc/soloq/discord-webhook
EOF

# 3. Caddy: soloq.xalozz.es al servidor propio; soloq-nuevo redirige allí.
install -m 644 "$APP/deploy/soloq-final.caddy" /etc/caddy/sitios/soloq.caddy
rm -f /etc/caddy/sitios/soloq-nuevo.caddy
sed -i 's|^8001 soloq .*|8001 soloq   -> soloq.xalozz.es (Python + SQLite)|; /^-    soloq /d' /srv/PUERTOS

systemctl daemon-reload
systemctl restart soloq-web.service
systemctl enable -q soloq-actualizador.service
systemctl restart soloq-actualizador.service
sudo -u caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
  || { echo "Caddyfile no válido: no se recarga"; sudo -u caddy caddy validate --config /etc/caddy/Caddyfile; exit 1; }
systemctl reload caddy

sleep 5
systemctl is-active soloq-web.service soloq-actualizador.service
curl -s -o /dev/null -w 'soloq.xalozz.es (local) %{http_code}\n' -H 'Host: soloq.xalozz.es' http://127.0.0.1:8001/data/data.json
journalctl -u soloq-actualizador --no-pager -n 5 -o cat
echo "Corte hecho. /srv/soloq/web (el clon del espejo) se puede borrar cuando se compruebe que todo va bien."
