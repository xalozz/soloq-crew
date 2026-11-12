"""Servidor: rutas, filtro de Host, solo lectura, cabeceras de seguridad y datos desde SQLite."""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from soloq import config, server
from soloq.store import Store

HOST = "soloq-nuevo.xalozz.es"


class Servidor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls._cfg = (config.DB_PATH, config.HOSTS)
        config.DB_PATH = cls.tmp / "soloq.db"
        config.HOSTS = [HOST]
        st = Store(config.DB_PATH)
        st.write_published('{"generatedAt":"2026-11-11T10:00:00.000Z","players":[]}')
        st.write_weeks({"weeks": [{"key": "2026-W45", "from": 1, "to": 2}, {"key": "2026-W44", "from": 0, "to": 1}]})
        st.write_detail("EUW1_123", {"id": "EUW1_123", "teams": []})
        st.set_state("latido", {"beat": 1794000000000})
        st.set_state("pasada", {"v": 1, "ok": True, "live": [{"id": 1, "p": [{"n": "xALOzZ"}]}]})
        st.close()
        server._local.__dict__.clear()
        server.configure_web(cls.tmp / "sin-compilar")   # la web antigua de la raíz, haya o no web/dist
        cls.c = TestClient(server.app, base_url=f"https://{HOST}")

    @classmethod
    def tearDownClass(cls):
        config.DB_PATH, config.HOSTS = cls._cfg
        server._local.__dict__.clear()
        server.configure_web()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_pagina_y_estaticos(self):
        r = self.c.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("SoloQ", r.text)
        for name in ("app.js", "style.css", "sw.js", "manifest.webmanifest", "favicon.svg", "icon-192.png"):
            self.assertEqual(self.c.get(f"/{name}").status_code, 200, name)
        for bad in ("/README.md", "/config/players.json", "/soloq/server.py", "/.git/config", "/scripts/update.mjs", "/data/soloq.db"):
            self.assertEqual(self.c.get(bad).status_code, 404, bad)

    def test_datos(self):
        r = self.c.get("/data/data.json?t=123")
        self.assertEqual(r.json()["generatedAt"], "2026-11-11T10:00:00.000Z")
        self.assertEqual([w["key"] for w in self.c.get("/data/weeks.json").json()["weeks"]], ["2026-W45", "2026-W44"])
        self.assertEqual(self.c.get("/data/matches/EUW1_123.json").json()["id"], "EUW1_123")
        self.assertEqual(self.c.get("/data/matches/EUW1_999.json").status_code, 404)
        self.assertEqual(self.c.get("/data/matches/..%2Fsoloq.db").status_code, 404)
        self.assertEqual(self.c.get("/data/matches/x.json").status_code, 404)

    def test_latido(self):
        j = self.c.get("/api/latido").json()
        self.assertEqual(j["beat"], 1794000000000)
        self.assertEqual(j["status"]["live"][0]["p"][0]["n"], "xALOzZ")

    def test_host_y_metodos(self):
        self.assertEqual(self.c.get("/", headers={"host": "evil.example"}).status_code, 403)
        self.assertEqual(self.c.post("/data/data.json").status_code, 405)
        self.assertEqual(self.c.delete("/").status_code, 405)
        self.assertEqual(self.c.head("/").status_code, 200)
        self.assertEqual(self.c.head("/data/data.json").status_code, 200)

    def test_cabeceras(self):
        r = self.c.get("/")
        csp = r.headers["content-security-policy"]
        self.assertIn("default-src 'self'", csp)
        self.assertEqual(csp.count("'sha256-"), 1)      # el <script> en línea de index.html (redirección), ninguno más
        self.assertNotIn("unsafe-inline'; font", csp.split("script-src")[1].split(";")[0])
        self.assertIn("noindex", r.headers["x-robots-tag"])
        self.assertEqual(r.headers["x-frame-options"], "DENY")
        self.assertNotIn("access-control-allow-origin", r.headers)

    def test_web_compilada(self):
        """Con web/dist se sirve la web nueva: assets/ con caché larga, sin app.js suelto y CSP sin scripts en línea."""
        dist = self.tmp / "dist"
        (dist / "assets").mkdir(parents=True)
        (dist / "index.html").write_text('<!doctype html><html><head><script src="./viewport.js"></script>'
                                         '<script type="module" src="./assets/index-Ab12_cD.js"></script></head>'
                                         '<body><div id="root"></div></body></html>', encoding="utf-8")
        (dist / "assets" / "index-Ab12_cD.js").write_text("console.log('SoloQ')", encoding="utf-8")
        (dist / "assets" / "index-Zz9.css").write_text("body{}", encoding="utf-8")
        for name in ("sw.js", "viewport.js", "manifest.webmanifest", "favicon.svg", "icon-192.png"):
            (dist / name).write_bytes(b"x")
        (dist / "img" / "rango").mkdir(parents=True)
        (dist / "img" / "rango" / "gold.png").write_bytes(b"png")
        try:
            server.configure_web(dist)
            r = self.c.get("/")
            self.assertEqual(r.status_code, 200)
            self.assertIn('id="root"', r.text)
            self.assertEqual(r.headers["cache-control"], "no-cache")
            csp = r.headers["content-security-policy"]
            self.assertIn("script-src 'self';", csp)
            self.assertNotIn("sha256-", csp)
            self.assertNotIn("unsafe-inline'", csp.split("script-src")[1].split(";")[0])
            a = self.c.get("/assets/index-Ab12_cD.js")
            self.assertEqual(a.status_code, 200)
            self.assertIn("immutable", a.headers["cache-control"])
            self.assertTrue(a.headers["content-type"].startswith("text/javascript"))
            self.assertTrue(self.c.get("/assets/index-Zz9.css").headers["content-type"].startswith("text/css"))
            for name in ("sw.js", "viewport.js", "manifest.webmanifest", "favicon.svg", "icon-192.png", "index.html"):
                r = self.c.get(f"/{name}")
                self.assertEqual(r.status_code, 200, name)
                self.assertEqual(r.headers["cache-control"], "no-cache", name)
            for bad in ("/app.js", "/style.css", "/assets/..%2Findex.html", "/assets/nada.js", "/assets/x.map", "/assets/a.b.js",
                        "/icon-512.png", "/README.md"):
                self.assertEqual(self.c.get(bad).status_code, 404, bad)
            g = self.c.get("/img/rango/gold.png")
            self.assertEqual((g.status_code, g.headers["content-type"]), (200, "image/png"))
            for bad in ("/img/rango/plata.png", "/img/rango/Gold.png", "/img/otra/gold.png", "/img/rango/..%2F..%2Findex.html"):
                self.assertEqual(self.c.get(bad).status_code, 404, bad)
            self.assertEqual(self.c.get("/data/data.json").json()["generatedAt"], "2026-11-11T10:00:00.000Z")
        finally:
            server.configure_web(self.tmp / "sin-compilar")
        # Sin web/dist (o sin su index.html) vuelve la web antigua
        self.assertEqual(self.c.get("/app.js").status_code, 200)
        self.assertEqual(self.c.get("/assets/index-Ab12_cD.js").status_code, 404)
        self.assertEqual(self.c.get("/").headers["content-security-policy"].count("'sha256-"), 1)

    def test_sin_datos(self):
        tmp = Path(tempfile.mkdtemp())
        old = config.DB_PATH
        try:
            config.DB_PATH = tmp / "vacia.db"
            Store(config.DB_PATH).close()
            server._local.__dict__.clear()
            self.assertEqual(self.c.get("/data/data.json").status_code, 404)
            self.assertEqual(self.c.get("/api/latido").json(), {"beat": None, "status": None})
        finally:
            config.DB_PATH = old
            server._local.__dict__.clear()
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
