# SoloQ Crew

Web estática estilo "SoloQ Challenge" para tu grupo de amigos: ranking de todas las cuentas, elo, LP, winrate,
rachas (actual, mejor y peor), KDA, CS/min, mejor y peor campeón/rol/partida, récords del grupo y enlaces a
OP.GG, U.GG, DPM.LOL y LeagueOfGraphs.

## Cómo funciona

```
GitHub Action (bucle de ~5h30 que se relanza solo)
  cada minuto: pasada rápida (rango de cada cuenta + partida en curso)
  cada 15 min: pasada completa (partidas nuevas, Flex/Clash, nombres, resumen semanal, retos)
        │                                  │
        ▼                                  ▼
  data/*.json (commit)            latido en la rama "heartbeat" con el estado de la pasada
        │                         (si Riot responde, si la clave vale y quién está jugando)
        ▼                                  │
  index.html + app.js  ◄───────────────────┘   + avisos a Discord (webhook DISCORD_WEBHOOK)
```

### Qué hay en la web

- **Ranking** con quién está jugando ahora, aviso de tilt (🧊) y LP de hoy, de la semana o del mes.
- **Novedades**: subidas y bajadas, pentas, rachas, récords del grupo y partidas jugadas (también en Discord).
- **La semana**: resumen de lunes a domingo, historial de semanas, texto para WhatsApp e imagen para compartir.
  Cada lunes a partir de las 9:45 se publica el de la semana anterior en Discord.
- **Retos** definidos en `config/challenges.json` (carrera de LP, llegar a un rango, hándicap o constancia).
- **Flex y Clash**: rango de Flex y alineaciones que más ganan.
- **Tilt y horarios**, **Campeones** (dueños, pool, némesis), **comparador 1 vs 1** (`#vs/Nombre/Nombre`)
  y enlaces directos a partidas (`#partida/EUW1_…`).
- Se puede **instalar como app** (manifest + service worker) y sin conexión enseña los últimos datos.

- La clave de Riot solo la usa el script en el servidor de GitHub; **nunca llega al navegador**.
- El historial se guarda de forma incremental (hasta 500 partidas SoloQ por cuenta), así las rachas y
  estadísticas se acumulan con el tiempo aunque la API solo devuelva las últimas 100.
- **LP por partida:** la API de Riot no da los LP ganados en cada partida, así que el script guarda una foto del rango
  (LP + partidas jugadas) en cada ejecución y asigna a cada partida la diferencia entre la foto de antes y la de después.
  Si entre dos fotos hubo varias partidas, se muestra el cambio conjunto. Solo funciona desde que se empezó a registrar.
- Las estadísticas "mejor/peor" de campeón y rol exigen 3+ partidas para no premiar rachas de una sola partida.

## Puesta en marcha

1. **Prueba local con datos falsos** (sin clave):
   ```bash
   node scripts/update.mjs --demo
   python3 -m http.server 8000     # abre http://localhost:8000
   ```
2. **Edita `config/players.json`** con los Riot ID reales (`Nombre#TAG`). Cada jugador puede tener varias cuentas;
   `region` es opcional (por defecto `euw1`). Otros valores: `eun1`, `na1`, `kr`, `br1`, `la1`, `la2`, `tr1`, `oc1`…
3. **Clave de API**: entra en <https://developer.riotgames.com>, y guárdala en tu repo en
   *Settings → Secrets and variables → Actions → New repository secret* con el nombre `RIOT_API_KEY`.
   (Ver la sección "Sobre la clave de Riot" antes de elegir tipo de clave.)
4. **Sube el proyecto a GitHub** y activa *Settings → Pages → Deploy from a branch → `main` / root*.
5. **Lanza la primera actualización**: pestaña *Actions → Actualizar datos → Run workflow*.
   La primera vez tarda unos minutos (respeta el límite de 100 peticiones cada 2 min); las siguientes son rápidas.

Para ejecutarlo a mano en local: `RIOT_API_KEY=RGAPI-xxxx node scripts/update.mjs` (Node 20+).

## Sobre la clave de Riot (importante)

- **Development key**: se genera sola pero **caduca cada 24 h**. Sirve para probar en local, no para un cron.
- **Personal API key**: se registra como producto en el portal, no caduca y está pensada para proyectos personales
  y comunidades pequeñas. Según la documentación del portal, **no se puede usar para una aplicación de consumo
  público**. Una web abierta a cualquiera en internet cae en zona gris.
- **Production key**: requiere un prototipo funcional y aprobación de Riot.

Recomendación: pide la Personal key y mantén la web **restringida a tus amigos** (ver siguiente sección). Si quieres
abrirla al público, solicita una Production key. Consulta siempre la política vigente:
<https://developer.riotgames.com/docs/portal>.

## Hosting gratuito

| Opción | Coste | Privacidad |
|---|---|---|
| **GitHub Pages** | Gratis con repo **público** (los repos privados con Pages requieren plan de pago) | La web y `config/players.json` son públicos |
| **Cloudflare Pages + Cloudflare Access** | Gratis (Access: plan gratuito hasta 50 usuarios, compruébalo en su web) | Login por email para tus amigos; nada público |

Para Cloudflare Pages: conecta el repo de GitHub, sin comando de build y con el directorio de salida `/`.
El Action seguirá haciendo commits y Cloudflare redespliega en cada uno. Después protege el dominio con una
aplicación de Access que permita solo los emails de tus amigos.

`index.html` incluye `noindex`, así que los buscadores no la listan, pero eso no es una protección real.

## Discord

Crea un webhook en el canal (Editar canal → Integraciones → Webhooks) y guarda su URL como secreto
`DISCORD_WEBHOOK` del repo. Sin ese secreto, todo funciona igual pero no se envía nada.
Lo que ya se ha enviado se apunta en `data/notify-state.json` (si un envío falla, se reintenta durante 3 h).

## Retos

`config/challenges.json` (ver el campo `_ayuda`). Ejemplo:

```json
{ "id": "a-diamante", "title": "A Diamante", "type": "target", "target": "DIAMOND IV",
  "from": "2026-11-01", "to": "2026-12-31", "players": ["xALOzZ", "xPATQ"], "stake": "una cena" }
```

Al empezar y al terminar cada reto se avisa en Discord.

## Personalizar

- Título y subtítulo: `config/players.json` (`title`, `subtitle`).
- Frecuencia: `cron` en `.github/workflows/update.yml` (bucle con `SLEEP_SECONDS`; en repos públicos Actions es gratis).
- Partidas iniciales por cuenta: variable `MATCH_COUNT` (por defecto 40, máximo 100).
- Colores y layout: `style.css`. Récords del grupo: función `buildRecords` en `app.js`.
- Enlaces extra por jugador (por ejemplo Discord o Twitter): añade `"links": [{ "label": "Discord", "url": "…" }]`
  al jugador en `config/players.json`.

## Estructura

```
config/players.json     jugadores y cuentas
scripts/update.mjs      consulta Riot y genera data/data.json
scripts/stats.mjs       cálculo de rachas, KDA, mejor/peor, tilt y horarios…
scripts/riot.mjs        cliente de la API (rate limit, reintentos, partida en curso) y enlaces
scripts/events.mjs      detección de hitos y mensajes de Discord
scripts/weekly.mjs      resumen semanal
scripts/challenges.mjs  retos
scripts/flex.mjs        Flex y Clash
scripts/discord.mjs     envío al webhook
scripts/time.mjs        fechas en hora de Madrid
scripts/demo.mjs        datos falsos para previsualizar
config/challenges.json  retos
data/                   data.json, events.json, weeks.json, notify-state.json, history/ y puuids.json (generado)
index.html app.js style.css sw.js manifest.webmanifest   la web
.github/workflows/update.yml  actualización automática
```

## Limitaciones

- Las estadísticas son de SoloQ (cola 420) y descartan remakes; Flex y Clash van aparte.
- El rango se comprueba cada minuto; Riot tarda unos minutos en publicar el detalle de cada partida.
- Si alguien cambia su Riot ID, la web lo sigue sola (se busca por su identificador interno);
  `config/players.json` puede seguir con el nombre antiguo.
- La web lee el estado del latido de la API de GitHub sin autenticar (60 consultas por hora y por IP),
  por eso lo comprueba cada 2 minutos.
- Proyecto no afiliado a Riot Games.
