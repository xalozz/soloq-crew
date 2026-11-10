# Vídeo tráiler (roast) — prueba

- `spec.mjs`: saca los datos de `data/data.json` y genera `spec.json` (jugadores, datos y frases).
- `stage.html`: escenas animadas (se renderiza con Playwright fotograma a fotograma).
- `render.cjs`: `node render.cjs stills` (capturas) / `node render.cjs video` (escenas en `out/`).
- `music.py`: música sintetizada sincronizada con las escenas (`python3 music.py out/scenes.json music.wav`).

Requisitos: `npm i playwright @fontsource/anton @fontsource/inter @fontsource/jetbrains-mono`, ffmpeg, Python con numpy y scipy.
Servir la carpeta con `python3 -m http.server 8766` antes de renderizar.

Pendiente (guion completo): 7 jugadores, iconos de perfil, splash arts, voces de campeones,
peor partida de FesAo = 0/11/1 con Malzahar, horas = partidas de la temporada × duración media (con periodo).
