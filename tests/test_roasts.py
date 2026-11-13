"""Roasts: remates de los hitos, detectores de partida, tope diario y tabla de daño por campeón."""

import unittest

from soloq import roasts
from soloq.events import event_embed

NOW = 1_794_000_000_000


class FakeStore:
    def __init__(self):
        self.st = {}

    def get_state(self, k, fallback=None):
        return self.st.get(k, fallback)

    def set_state(self, k, v):
        self.st[k] = v


def game(i, **kw):
    g = {"id": f"EUW1_{i}", "t": NOW - 3600e3 + i, "dur": 1800, "win": False, "champ": "Jinx", "role": "BOTTOM",
         "k": 5, "d": 5, "a": 5, "cs": 250, "vis": 25, "dmg": 25000, "teamDmg": 100000, "pg": {"q": 0}, "ff": 0, "gold": None}
    g.update(kw)
    return g


def base_with(champ, pos, shares):
    st = FakeStore()
    for i, s in enumerate(shares):
        roasts.add_damage_samples(st, {"id": f"M{i}", "teams": [{"players": [
            {"champ": champ, "pos": pos, "dmg": s}, {"champ": "X", "pos": "TOP", "dmg": 100 - s}]}]})
    return st.get_state("dmgBase")


class Roasts(unittest.TestCase):
    def test_tabla_de_danio(self):
        base = base_with("Jinx", "BOTTOM", [20, 22, 24, 26, 28] * 8)
        floor, mean = roasts.damage_floor(base, "Jinx", "BOTTOM")
        self.assertAlmostEqual(mean, 24)
        self.assertTrue(19 < floor < 21)
        self.assertIsNone(roasts.damage_floor(base, "Malphite", "UTILITY"))
        st = FakeStore()
        st.set_state("dmgBase", base)
        roasts.add_damage_samples(st, {"id": "M0", "teams": []})        # ya contada: no suma
        self.assertEqual(st.get_state("dmgBase")["s"]["Jinx|BOTTOM"][0], 40)

    def test_detectores(self):
        base = base_with("Jinx", "BOTTOM", [20, 22, 24, 26, 28] * 8)
        self.assertEqual(roasts.detect_game(game(1, win=True, dmg=11000), [], base, {})[0], "mochila")
        self.assertEqual(roasts.detect_game(game(1, dmg=11000), [], base, {})[0], "sinDanio")
        self.assertEqual(roasts.detect_game(game(1, k=2, d=11, a=3), [], base, {})[0], "feedPierde")
        self.assertEqual(roasts.detect_game(game(1, gold={"maxLead": 7000, "maxLeadMin": 18}), [], base, {})[0], "tirada")
        self.assertEqual(roasts.detect_game(game(1, ff=1, dur=960), [], base, {})[0], "ff")
        self.assertIsNone(roasts.detect_game(game(1, win=True), [], base, {}))

    def test_tope_diario_y_remates(self):
        base = base_with("Jinx", "BOTTOM", [20, 22, 24, 26, 28] * 8)
        games = [game(i, k=1, d=12, a=1) for i in range(4)]
        streak = {"name": "Pepe", "key": "pepe", "type": "streak", "kind": "L", "n": 7, "t": NOW, "id": "streak:pepe:7:", "text": "🧊 Pepe lleva 7 derrotas seguidas"}
        evs = roasts.add_roasts([streak], {"now": NOW, "log": [], "players": [{"name": "Pepe", "key": "pepe"}],
                                           "newGames": {"pepe": games}, "histories": {"pepe": games}, "base": base,
                                           "tags": {}, "details": {}, "rids": {}, "leader": None})
        rs = [e for e in evs if e["type"] == "roast"]
        self.assertEqual(len(rs), roasts.ROAST_PER_DAY)
        self.assertIn("1/12/1", rs[0]["text"])
        self.assertTrue(all(e.get("roast") for e in evs))
        emb = event_embed(streak)
        self.assertTrue(emb["description"].startswith("**"))
        self.assertNotIn("descansar", emb["description"])

    def test_ascensor(self):
        down = {"name": "Pepe", "key": "pepe", "type": "down", "to": "Oro II", "from": "Oro I", "t": NOW, "id": "down:pepe:Oro II:1"}
        old = [{**down, "t": NOW - 3 * 864e5, "id": "a"}, {**down, "t": NOW - 6 * 864e5, "id": "b"}]
        evs = roasts.add_roasts([down], {"now": NOW, "log": old, "players": [], "newGames": {}, "histories": {}, "rids": {}})
        self.assertIn("tercera", evs[0]["roast"])


if __name__ == "__main__":
    unittest.main()
