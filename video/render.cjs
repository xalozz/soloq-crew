// node render.cjs stills [id:t ...]   |   node render.cjs video [id ...]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const DIR = __dirname, FPS = 30, MODE = process.argv[2] || 'stills', ARGS = process.argv.slice(3);
const MIME = { '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' };

(async () => {
  const server = http.createServer((req, res) => {
    const f = path.join(DIR, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(DIR) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(0);
  const port = server.address().port;
  const spec = JSON.parse(fs.readFileSync(`${DIR}/spec.json`, 'utf8'));
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('ERR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await page.addInitScript((s) => { window.SPEC = s; }, spec);
  await page.goto(`http://localhost:${port}/stage.html`);
  await page.evaluate(async () => {
    await Promise.all(['100px Anton', '600 40px Inter', '400 40px Inter', '500 20px Mono'].map((f) => document.fonts.load(f)));
    await document.fonts.ready; await window.ready;
  });
  const scenes = await page.evaluate(() => window.buildScenes());
  if (MODE === 'stills') {
    fs.mkdirSync(`${DIR}/stills`, { recursive: true });
    for (const a of ARGS) {
      const [id, t] = a.split(':');
      await page.evaluate(([id, t]) => window.renderAt(id, t, 1), [id, Number(t)]);
      await page.screenshot({ path: `${DIR}/stills/${id}-${t}.jpg`, type: 'jpeg', quality: 80 });
    }
  } else {
    fs.mkdirSync(`${DIR}/out`, { recursive: true });
    let frame = 0;
    for (const s of scenes) {
      const n = Math.round(s.dur * FPS);
      if (ARGS.length && !ARGS.includes(s.id)) { frame += n; continue; }
      const tmp = `${DIR}/out/${s.id}.tmp.mp4`;
      const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
        '-c:v', 'libx264', '-crf', '17', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(FPS), tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
      for (let i = 0; i < n; i++) {
        await page.evaluate(([id, t, f]) => window.renderAt(id, t, f), [s.id, i / FPS, frame++]);
        const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      }
      ff.stdin.end();
      const code = await new Promise((r) => ff.on('close', r));
      if (code !== 0) throw new Error(`ffmpeg ${s.id} ${code}`);
      fs.renameSync(tmp, `${DIR}/out/${s.id}.mp4`);
      console.log('ok', s.id, n);
    }
    fs.writeFileSync(`${DIR}/out/list.txt`, scenes.map((s) => `file '${s.id}.mp4'`).join('\n') + '\n');
  }
  await b.close(); server.close();
  console.log('FIN');
})().catch((e) => { console.log('FALLO', e.message); process.exit(1); });
