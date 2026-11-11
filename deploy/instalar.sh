#!/bin/bash
# Instala o actualiza la versión Python de SoloQ Crew en el VPS. Se ejecuta como root (sudo bash) con el
# paquete del código ya subido a /tmp/soloq-app.tgz. No toca el espejo (/srv/soloq/web, soloq-espejo.*).
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
APP=/srv/soloq/app
DATA=/srv/soloq/data

install -d -o root -g soloq -m 750 "$APP"
install -d -o soloq -g soloq -m 700 "$DATA"
install -d -o root -g root -m 700 /etc/soloq

# Código nuevo conservando el venv
find "$APP" -mindepth 1 -maxdepth 1 ! -name .venv -exec rm -rf {} +
tar -xzf /tmp/soloq-app.tgz -C "$APP"
rm -f /tmp/soloq-app.tgz
[ -x "$APP/.venv/bin/python" ] || python3 -m venv "$APP/.venv"
"$APP/.venv/bin/pip" install -q --disable-pip-version-check -r "$APP/requirements.txt"
chown -R root:soloq "$APP"
chmod -R u=rwX,g=rX,o= "$APP"

install -m 644 "$APP"/deploy/soloq-web.service "$APP"/deploy/soloq-actualizador.service \
  "$APP"/deploy/soloq-importar.service "$APP"/deploy/soloq-importar.timer /etc/systemd/system/
install -m 644 "$APP/deploy/soloq.caddy" /etc/caddy/sitios/soloq-nuevo.caddy
grep -q '^8001 ' /srv/PUERTOS || echo '8001 soloq   -> soloq-nuevo.xalozz.es (Python; en pruebas, convive con el espejo de GitHub)' >> /srv/PUERTOS

cd "$APP"
# Primera carga (o recarga) desde el clon de main que mantiene el espejo, con comprobación
if [ ! -e /etc/soloq/riot-api-key ]; then
  runuser -u soloq -- env SOLOQ_DATA="$DATA" "$APP/.venv/bin/python" -m soloq.importer importar /srv/soloq/web/data --reemplazar \
    --db "$DATA/soloq.db" < /dev/null
  runuser -u soloq -- env SOLOQ_DATA="$DATA" "$APP/.venv/bin/python" -m soloq.importer importar /srv/soloq/web/data --espejo \
    --db "$DATA/soloq.db" < /dev/null
fi

systemctl daemon-reload
systemctl enable -q soloq-web.service soloq-importar.timer soloq-actualizador.service
systemctl restart soloq-web.service
systemctl start soloq-importar.timer
systemctl restart soloq-actualizador.service || true   # sin clave, systemd lo salta (condición)

sudo -u caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -1
systemctl reload caddy
sleep 2
systemctl --no-pager --lines=0 status soloq-web.service | head -3
curl -s -o /dev/null -w 'local %{http_code}\n' -H 'Host: soloq-nuevo.xalozz.es' http://127.0.0.1:8001/data/data.json
