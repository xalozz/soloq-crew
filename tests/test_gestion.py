"""/admin de SoloQ: permisos, guardar ajustes, jugadores, retos y textos, el filtro de novedades de la web y que el
actualizador lo lee."""

import json
import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("SOLOQ_SEGURO", "0")

from fastapi.testclient import TestClient  # noqa: E402

from soloq import accounts, ajustes, config, cuentas_api, gestion, roasts, server, update  # noqa: E402
from soloq.store import Store  # noqa: E402

H = {"X-Panel": "1"}
CLAVE = "una-clave-larga"


class Gestion(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)   # el servidor deja abierta su conexión de lectura
        self.addCleanup(self.tmp.cleanup)
        d = Path(self.tmp.name)
        self._db = config.DB_PATH
        config.DB_PATH = d / "soloq.db"
        self.addCleanup(lambda: setattr(config, "DB_PATH", self._db))
        accounts.DB_PATH = d / "cuentas.db"
        cuentas_api.CONF.update(secure=False, cookie="sesion_prueba")
        cuentas_api.reiniciar()
        gestion._cache.update(key=None, text=None)
        self.store = Store(config.DB_PATH)
        self.addCleanup(self.store.close)
        self.store.write_published(json.dumps({"players": [], "events": [
            {"type": "down", "id": "a", "t": 1, "name": "Pepe", "key": "p"},
            {"type": "roast", "rk": "feedPierde", "id": "b", "t": 2, "name": "Pepe", "key": "p"},
            {"type": "streak", "kind": "W", "id": "c", "t": 3, "name": "Pepe", "key": "p"}]}))

    def cliente(self, *, admin=True):
        con = accounts.connect()
        token, _ = accounts.create_invite(con, "alta", created_by=None, is_admin=admin)
        con.commit()
        con.close()
        c = TestClient(server.app, base_url="http://localhost")
        r = c.post(f"/api/invite/{token}", json={"username": "admin" if admin else "pepe", "password": CLAVE}, headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        return c

    def test_permisos(self):
        anon = TestClient(server.app, base_url="http://localhost")
        self.assertEqual(anon.get("/api/admin/soloq").status_code, 401)
        self.assertEqual(anon.get("/admin", follow_redirects=False).headers["location"], "/entrar")
        self.assertEqual(anon.get("/entrar").status_code, 200)
        self.assertEqual(anon.get("/data/data.json").status_code, 200, "el ranking sigue siendo público")
        user = self.cliente(admin=False)
        self.assertEqual(user.get("/api/admin/soloq").status_code, 403)
        self.assertEqual(user.put("/api/admin/soloq/ajustes", json={}, headers=H).status_code, 403)
        adm = self.cliente()
        self.assertEqual(adm.put("/api/admin/soloq/ajustes", json={}).status_code, 403, "sin X-Panel")
        self.assertEqual(adm.post("/data/data.json", headers=H).status_code, 405)

    def test_ajustes_y_filtro_de_la_web(self):
        adm = self.cliente()
        d = adm.get("/api/admin/soloq").json()
        self.assertTrue(d["ajustes"]["avisos"]["down"]["web"])
        self.assertEqual(len(adm.get("/data/data.json").json()["events"]), 3)
        aj = d["ajustes"]
        aj["avisos"]["down"]["web"] = False
        aj["avisos"]["feed"]["web"] = False
        aj["avisos"]["feed"]["p"]["muertes"] = "12"
        aj["avisos"]["vision"]["p"]["porMin"] = "0.4"
        r = adm.put("/api/admin/soloq/ajustes", json=aj, headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual([e["id"] for e in adm.get("/data/data.json").json()["events"]], ["c"])
        guardado = ajustes.completar(self.store.get_state(ajustes.K_AJUSTES))
        self.assertEqual(guardado["avisos"]["feed"]["p"]["muertes"], 12)
        self.assertEqual(guardado["avisos"]["vision"]["p"]["porMin"], 0.4)
        self.assertTrue(guardado["avisos"]["feed"]["discord"])
        aj["avisos"]["games"]["p"]["hitos"] = "100, abc"
        r = adm.put("/api/admin/soloq/ajustes", json=aj, headers=H)
        self.assertEqual(r.status_code, 400)
        self.assertIn("Partidas jugadas", r.json()["detail"])
        kinds = [e["kind"] for e in adm.get("/api/admin/events").json()["events"]]
        self.assertIn("novedades cambiadas", kinds)

    def test_jugadores_retos_y_textos(self):
        adm = self.cliente()
        jug = {"title": "Crew", "subtitle": "", "defaultRegion": "euw1",
               "players": [{"name": "Pepe", "accounts": [{"riotId": "Pepe # EUW"}]},
                           {"name": "Ana", "accounts": [{"riotId": "Ana#EUW", "region": "eun1"}, {"riotId": "AnaSmurf#1234"}]}]}
        r = adm.put("/api/admin/soloq/jugadores", json=jug, headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["jugadores"]["players"][0]["accounts"][0]["riotId"], "Pepe#EUW")
        jug["players"].append({"name": "pepe", "accounts": [{"riotId": "Otro#EUW"}]})
        self.assertIn("repetido", adm.put("/api/admin/soloq/jugadores", json=jug, headers=H).json()["detail"])
        jug["players"][-1] = {"name": "Luis", "accounts": [{"riotId": "sin-tag"}]}
        self.assertEqual(adm.put("/api/admin/soloq/jugadores", json=jug, headers=H).status_code, 400)

        retos = [{"title": "Carrera", "type": "race", "from": "2026-12-01", "to": "2026-12-31", "players": ["Pepe", "Ana"]},
                 {"title": "Diamante", "type": "target", "target": "diamante iv", "from": "2026-12-01", "to": "2026-12-31", "players": "all"}]
        r = adm.put("/api/admin/soloq/retos", json=retos, headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual([x["id"] for x in r.json()["retos"]], ["carrera", "diamante"])
        retos[0]["players"] = ["Nadie"]
        self.assertIn("Nadie", adm.put("/api/admin/soloq/retos", json=retos, headers=H).json()["detail"])

        r = adm.put("/api/admin/soloq/textos", json={"cs": {"texto": "🌾 {name} {csmin} CS/min con {champ}. vaya"}}, headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(adm.put("/api/admin/soloq/textos", json={"cs": {"texto": "{nombre}"}}, headers=H).status_code, 400)

        players, defs, aj, textos = update.load_configs(self.store)
        self.assertEqual([p["name"] for p in players["players"]], ["Pepe", "Ana"])
        self.assertEqual(players["title"], "Crew")
        self.assertEqual(len(defs), 2)
        self.assertTrue(textos["cs"]["texto"].endswith("vaya"))
        self.assertIn("tirada", textos, "los demás textos siguen siendo los del archivo")

    def test_aviso_de_prueba(self):
        adm = self.cliente()
        self.assertEqual(adm.post("/api/admin/soloq/discord-prueba", headers=H).status_code, 200)
        enviados = []
        update.discord_test(self.store, "https://hook", lambda embeds: enviados.append(embeds) or {"ok": True}, 5)
        update.discord_test(self.store, "https://hook", lambda embeds: enviados.append(embeds) or {"ok": True}, 6)
        self.assertEqual(len(enviados), 1, "una sola vez por petición")
        self.assertTrue(adm.get("/api/admin/soloq").json()["prueba"]["ok"])


class Detectores(unittest.TestCase):
    def test_umbrales_y_desactivados(self):
        g = {"id": "x", "t": 0, "dur": 1800, "win": False, "champ": "Jinx", "role": "BOTTOM", "k": 2, "d": 10, "a": 3,
             "cs": 250, "vis": 25, "dmg": 25000, "teamDmg": 100000, "ff": 0, "gold": None}
        tags = {"Jinx": "Marksman"}
        self.assertEqual(roasts.detect_game(g, [], tags)[0], "feedPierde")
        aj = ajustes.completar({"avisos": {"feed": {"p": {"muertes": 11}}}})
        self.assertIsNone(roasts.detect_game(g, [], tags, avisos=aj["avisos"]))
        aj = ajustes.completar({"avisos": {"feed": {"web": False, "discord": False}}})
        self.assertIsNone(roasts.detect_game(g, [], tags, avisos=aj["avisos"]))
        g2 = {**g, "d": 5, "cs": 140}
        self.assertEqual(roasts.detect_game(g2, [], tags)[0], "cs")
        aj = ajustes.completar({"avisos": {"cs": {"p": {"csmin": 4}}}})
        self.assertIsNone(roasts.detect_game(g2, [], tags, avisos=aj["avisos"]))

    def test_clave_evento(self):
        self.assertEqual(ajustes.clave_evento({"type": "streak", "kind": "L"}), "streakL")
        self.assertEqual(ajustes.clave_evento({"type": "roast", "rk": "mochila"}), "danio")
        self.assertEqual(ajustes.clave_evento({"type": "up"}), "up")
        self.assertEqual(set(ajustes.textos_archivo()) - {"tirada", "cs", "vision", "ff", "maldito", "madrugada"},
                         {k for k in ajustes._ROAST_GRUPO}, "cada texto tiene su casilla en Novedades")


if __name__ == "__main__":
    unittest.main()
