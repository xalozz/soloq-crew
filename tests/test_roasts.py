"""Roasts: remates de los hitos, detectores de partida y tope diario."""

import unittest

from soloq import roasts
from soloq.events import event_embed

NOW = 1_794_000_000_000


def game(i, **kw):
    g = {"id": f"EUW1_{i}", "t": NOW - 3600e3 + i, "dur": 1800, "win": False, "champ": "Jinx", "role": "BOTTOM",
         "k": 5, "d": 5, "a": 5, "cs": 250, "vis": 25, "dmg": 25000, "teamDmg": 100000, "pg": {"q": 0}, "ff": 0, "gold": None}
    g.update(kw)
    return g


TAGS = {"Jinx": "Marksman", "Malphite": "Tank"}


class Roasts(unittest.TestCase):
    def test_danio_por_tipo(self):
        self.assertEqual(roasts.detect_game(game(1, win=True, dmg=11000), [], TAGS)[0], "mochila")
        self.assertIsNone(roasts.detect_game(game(1, win=True, dmg=11000, champ="Malphite", role="TOP"), [], TAGS))
        self.assertIsNone(roasts.detect_game(game(1, win=True, dmg=11000, role="UTILITY", vis=60), [], TAGS))

    def test_detectores(self):
        self.assertEqual(roasts.detect_game(game(1, win=True, dmg=11000), [], TAGS)[0], "mochila")
        self.assertEqual(roasts.detect_game(game(1, dmg=11000), [], TAGS)[0], "sinDanio")
        self.assertEqual(roasts.detect_game(game(1, k=2, d=11, a=3), [], TAGS)[0], "feedPierde")
        self.assertEqual(roasts.detect_game(game(1, gold={"maxLead": 7000, "maxLeadMin": 18}), [], TAGS)[0], "tirada")
        self.assertEqual(roasts.detect_game(game(1, ff=1, dur=960), [], TAGS)[0], "ff")
        self.assertIsNone(roasts.detect_game(game(1, win=True), [], TAGS))

    def test_tope_diario_y_remates(self):
        games = [game(i, k=1, d=12, a=1) for i in range(4)]
        streak = {"name": "Pepe", "key": "pepe", "type": "streak", "kind": "L", "n": 7, "t": NOW, "id": "streak:pepe:7:", "text": "🧊 Pepe lleva 7 derrotas seguidas"}
        evs = roasts.add_roasts([streak], {"now": NOW, "log": [], "players": [{"name": "Pepe", "key": "pepe"}],
                                           "newGames": {"pepe": games}, "histories": {"pepe": games},
                                           "tags": TAGS, "details": {}, "rids": {}, "leader": None})
        rs = [e for e in evs if e["type"] == "roast"]
        self.assertEqual(len(rs), roasts.ROAST_PER_DAY)
        self.assertIn("1/12/1", rs[0]["text"])
        self.assertTrue(all(e.get("roast") for e in evs))
        emb = event_embed(streak)
        self.assertTrue(emb["description"].startswith("**"))
        self.assertNotIn("descansar", emb["description"])

    def test_campeon_raro(self):
        season = [game(100 + i, champ="Ahri", win=True) for i in range(25)]
        g = game(1, champ="Kayn", win=False)
        k, v = roasts.detect_game(g, [g] + season, TAGS, names={"Kayn": "Kayn"})
        self.assertEqual((k, v["n"]), ("estrenoPierde", "1"))
        olds = [game(200 + i, champ="Kayn", win=True) for i in range(2)]
        k, v = roasts.detect_game(game(2, champ="Kayn", win=True), olds + season, TAGS)
        self.assertEqual((k, v["nth"]), ("raroGana", "tercera"))
        self.assertIsNone(roasts.detect_game(game(3, champ="Ahri", win=True), season, TAGS))
        self.assertIsNone(roasts.detect_game(game(4, champ="Kayn", win=True), season[:10], TAGS))

    def test_ascensor(self):
        down = {"name": "Pepe", "key": "pepe", "type": "down", "to": "Oro II", "from": "Oro I", "t": NOW, "id": "down:pepe:Oro II:1"}
        old = [{**down, "t": NOW - 3 * 864e5, "id": "a"}, {**down, "t": NOW - 6 * 864e5, "id": "b"}]
        evs = roasts.add_roasts([down], {"now": NOW, "log": old, "players": [], "newGames": {}, "histories": {}, "rids": {}})
        self.assertIn("tercera", evs[0]["roast"])


if __name__ == "__main__":
    unittest.main()
