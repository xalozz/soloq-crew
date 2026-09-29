# SoloQ Crew

Web estática estilo "SoloQ Challenge" para tu grupo de amigos: ranking de todas las cuentas, elo, LP, winrate,
rachas (actual, mejor y peor), KDA, CS/min, mejor y peor campeón/rol/partida, récords del grupo y enlaces a
OP.GG, U.GG, DPM.LOL y LeagueOfGraphs.

## Cómo funciona

```
GitHub Action (cada 10 min) ─► scripts/update.mjs ─► API de Riot
                                     │
                                     ▼
                     data/data.json + data/history/*.json  (commit al repo)
                                     │
                                     ▼
              index.html + app.js leen data/data.json (hosting estático gratis)
```

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

## Personalizar

- Título y subtítulo: `config/players.json` (`title`, `subtitle`).
- Frecuencia: `cron` en `.github/workflows/update.yml` (10 min; en repos públicos Actions es gratis).
- Partidas iniciales por cuenta: variable `MATCH_COUNT` (por defecto 40, máximo 100).
- Colores y layout: `style.css`. Récords del grupo: función `buildRecords` en `app.js`.
- Enlaces extra por jugador (por ejemplo Discord o Twitter): añade `"links": [{ "label": "Discord", "url": "…" }]`
  al jugador en `config/players.json`.

## Estructura

```
config/players.json     jugadores y cuentas
scripts/update.mjs      consulta Riot y genera data/data.json
scripts/stats.mjs       cálculo de rachas, KDA, mejor/peor…
scripts/riot.mjs        cliente de la API (rate limit, reintentos) y enlaces
scripts/demo.mjs        datos falsos para previsualizar
data/                   data.json, history/ y puuids.json (generado)
index.html app.js style.css   la web
.github/workflows/update.yml  actualización automática
```

## Limitaciones

- Solo cuenta partidas de SoloQ (cola 420) y descarta remakes.
- Los datos van con el retraso del cron (10 min por defecto) y GitHub puede retrasar los cron unos minutos.
- Si cambias tu Riot ID en el juego, actualiza `config/players.json`.
- Proyecto no afiliado a Riot Games.
