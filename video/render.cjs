// node render.cjs stills  |  node render.cjs video
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const DIR = __dirname, FPS = 30, MODE = process.argv[2] || 'stills';
(async () => {
  const spec = JSON.parse(fs.readFileSync(`${DIR}/spec.json`, 'utf8'));
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('ERR', e.message));
  await page.addInitScript((s) => { window.SPEC = s; }, spec);
  await page.goto('http://localhost:8766/stage.html');
  await page.evaluate(async () => { await document.fonts.load('100px Anton'); await document.fonts.load('600 40px Inter'); await document.fonts.load('400 40px Inter'); await document.fonts.load('500 20px Mono'); await document.fonts.ready; });
  const scenes = await page.evaluate(() => window.buildScenes());
  if (MODE === 'stills') {
    const shots = [['intro', 3.6], ['p0', .6], ['p0', 8.6], ['p1', 8.6], ['p1', 10.0], ['outro', 2.5]];
    for (const [id, t] of shots) {
      await page.evaluate(([id, t]) => window.renderAt(id, t, 1), [id, t]);
      await page.screenshot({ path: `${DIR}/still-${id}-${t}.jpg`, type: 'jpeg', quality: 85 });
    }
  } else {
    fs.mkdirSync(`${DIR}/out`, { recursive: true });
    let frame = 0;
    for (const s of scenes) {
      const n = Math.round(s.dur * FPS), tmp = `${DIR}/out/${s.id}.tmp.mp4`;
      const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
        '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(FPS), tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
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
    fs.writeFileSync(`${DIR}/out/scenes.json`, JSON.stringify(scenes));
  }
  await b.close();
})();
