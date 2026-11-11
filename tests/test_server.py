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
        cls.c = TestClient(server.app, base_url=f"https://{HOST}")

    @classmethod
    def tearDownClass(cls):
        config.DB_PATH, config.HOSTS = cls._cfg
        server._local.__dict__.clear()
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
        self.assertEqual(csp.count("'sha256-"), 3)      # los tres <script> en línea de index.html, ninguno más
        self.assertNotIn("unsafe-inline'; font", csp.split("script-src")[1].split(";")[0])
        self.assertIn("noindex", r.headers["x-robots-tag"])
        self.assertEqual(r.headers["x-frame-options"], "DENY")
        self.assertNotIn("access-control-allow-origin", r.headers)

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
