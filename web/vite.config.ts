import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';

const WEB = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(WEB, '..');
// Iconos y manifest: los de la raíz del repo (los mismos que usa la web antigua), sin copiarlos aquí
const ROOT_FILES = ['manifest.webmanifest', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const TYPES: Record<string, string> = { '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function soloq(): Plugin {
  return {
    name: 'soloq',
    // En desarrollo: iconos de la raíz y los datos de data/ (como los sirve GitHub Pages)
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
        const ok = ROOT_FILES.includes(path) || /^data\/(data|weeks)\.json$/.test(path) || /^data\/matches\/[A-Z0-9]+_\d+\.json$/.test(path);
        if (!ok) return next();
        try {
          const body = readFileSync(join(REPO, path));
          res.setHeader('Content-Type', TYPES[extname(path)] ?? 'application/octet-stream');
          res.end(body);
        } catch { res.statusCode = 404; res.end(); }
      });
    },
    // Al compilar: los ficheros de la raíz y el service worker con la lista de lo que guardar sin conexión
    async generateBundle(_opts, bundle) {
      for (const f of ROOT_FILES) this.emitFile({ type: 'asset', fileName: f, source: readFileSync(join(REPO, f)) });
      const files = Object.keys(bundle).filter((f) => f.startsWith('assets/'));
      const version = createHash('sha256').update(files.sort().join('\n')).digest('hex').slice(0, 12);
      const precache = ['./', 'viewport.js', 'data/data.json', 'manifest.webmanifest', 'favicon.svg', 'apple-touch-icon.png', ...files];
      const src = readFileSync(join(WEB, 'sw', 'sw.ts'), 'utf8');
      const out = await transformWithEsbuild(src, 'sw.ts', {
        loader: 'ts', format: 'esm', target: 'es2020',
        define: { __VERSION__: JSON.stringify(version), __PRECACHE__: JSON.stringify(precache) },
      });
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: out.code });
    },
  };
}

export default defineConfig({
  // Rutas relativas: funciona en la raíz del servidor propio y en cualquier subcarpeta
  base: './',
  plugins: [react(), soloq()],
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
  server: { port: 5173, fs: { allow: [REPO] } },
});
