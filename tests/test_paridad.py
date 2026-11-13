"""Paridad con el actualizador de Node: mismas entradas → mismos resultados.

1. Funciones puras (fechas, estadísticas, semana, retos, hitos, dúos, Flex, partidas) sobre los datos reales.
2. Pasadas completas y rápidas de punta a punta contra una API de Riot simulada, con el reloj congelado:
   se compara todo lo que queda escrito (data.json, historiales, fotos de LP, semanas, eventos, avisos,
   detalle de partidas, estado de la pasada), las peticiones a Riot (cuáles y en qué orden) y los
   mensajes enviados a Discord.

Necesita Node 20+ en el PATH y los datos reales en data/ (se saltan si faltan).
"""

import copy
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from soloq import config
from soloq.challenges import challenge_embed, challenge_event, challenge_status, compute_challenges, parse_rank
from soloq.duos import compute_duos
from soloq.events import detect_events, event_embed, event_text, score_label
from soloq.flex import flex_group_stats
from soloq.importer import _same, export_dir, import_dir
from soloq.js import dumps
from soloq.riot import compact_match, match_detail
from soloq.stats import compute_account_stats
from soloq.store import Store
from soloq.tiempo import day_start, madrid_parts, month_start, parse_day, range_label, short_day, week_key, week_start
from soloq.update import assign_lp, run_pass
from soloq.weekly import compact_week, compute_week, week_embed

from tests.fake_riot import FakeServer, World, ddragon_payloads

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
NODE = shutil.which("node")
DAY = 86_400_000


def norm(o):
    """JSON de ida y vuelta (como lo vería la web), con los números como los escribe JSON.stringify."""
    return json.loads(dumps(o))


def diff(a, b, path="$"):
    errs = []
    _same(norm(a), norm(b), path, errs)
    return errs


def madrid(y, m, d, hh=0, mm=0):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return int(datetime(y, m, d, hh, mm, tzinfo=ZoneInfo("Europe/Madrid")).timestamp()) * 1000


@unittest.skipUnless(NODE and (DATA / "data.json").exists(), "hace falta Node y data/")
class FuncionesPuras(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        tmp = Path(tempfile.mkdtemp())
        cls.tmp = tmp
        store = Store(tmp / "s.db")
        import_dir(DATA, store)
        cls.pub = store.read_published()
        cache = store.read_puuids()
        lp = store.read_lp_hist()
        cls.entries, cls.hists, cls.flex = [], [], []
        for p in cls.pub["players"]:
            a = p["accounts"][p["bestAccount"]]
            pu = cache[a["key"]]["puuid"]
            games = store.read_history(pu)["games"]
            cls.hists.append(games)
            season = games[: a["rank"]["wins"] + a["rank"]["losses"]] if a.get("rank") else games
            cls.entries.append({"name": p["name"], "games": season, "points": lp.get(a["key"], [])})
            cls.flex.append({"name": p["name"], "flexRank": a.get("flexRank"), "games": store.read_flex(pu)["games"]})
        cls.log = store.read_events()["events"]
        store.close()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def build_input(self):
        times = [madrid(2026, 3, 29, h, 30) for h in range(0, 5)] + [madrid(2026, 10, 25, h, 30) for h in range(0, 5)]
        times += [madrid(2026, 1, 1), madrid(2026, 12, 31, 23, 59), madrid(2027, 1, 4), madrid(2024, 12, 30), madrid(2026, 11, 16, 9, 44)]
        times += [1_790_000_000_000 + i * 37_123_457_891 % (400 * DAY) for i in range(60)]
        days = ["2026-11-01", "2026-11-31", "2026-12-32", "2026-02-29", "2026-03-29", "2026-10-25", "2027-01-00"]
        weeks = []
        w = week_start(min(p[0] for e in self.entries for p in e["points"]))
        end = week_start(1_794_500_000_000) + 14 * DAY
        while w < end:
            weeks.append([w, week_start(w + 8 * DAY)])
            w = week_start(w + 8 * DAY)
        weeks.append([week_start(1_794_400_000_000), None])
        ch_defs = [
            {"id": "carrera", "title": "Carrera", "type": "race", "from": "2026-10-01", "to": "2026-11-30", "players": "all", "desc": "d", "stake": "una cena"},
            {"id": "diamante", "type": "target", "target": "Diamante IV", "from": "2026-09-01", "to": "2026-12-31", "players": "all"},
            {"id": "oro", "type": "target", "target": "GOLD", "from": "2026-10-15", "to": "2026-11-10", "players": [e["name"] for e in self.entries[:3]]},
            {"id": "malo", "type": "target", "target": "Patata", "from": "2026-10-15", "to": "2026-11-10", "players": "all"},
            {"id": "hand", "type": "handicap", "targets": {self.entries[0]["name"]: 150}, "from": "2026-10-20", "to": "2026-11-05", "players": "all"},
            {"id": "const", "type": "games", "perWeek": 5, "from": "2026-10-01", "to": "2026-11-20", "players": "all"},
            {"id": "raro", "type": "otro", "from": "2026-10-01", "to": "2026-11-20"},
            {"id": "sin-fecha", "type": "race", "from": "2026-10-01"},
        ]
        ch_nows = [madrid(2026, 9, 15), madrid(2026, 10, 25, 12), madrid(2026, 11, 11, 20), madrid(2027, 1, 2)]
        # Hitos: lo publicado con rangos, rachas y récords cambiados como «antes»
        pairs = []
        nxt = self.pub["players"]
        for variant in range(4):
            prev = copy.deepcopy(nxt)
            ng, pb = {}, {}
            for i, p in enumerate(prev):
                a = p["accounts"][p["bestAccount"]]
                key = a["key"]
                r = a.get("rank")
                if r and (i + variant) % 3 == 0:
                    r["division"] = {"I": "II", "II": "III", "III": "IV", "IV": "I"}[r["division"]]
                    if r["division"] == "I":
                        r["tier"] = {"IRON": "IRON", "BRONZE": "IRON", "SILVER": "BRONZE", "GOLD": "SILVER", "PLATINUM": "GOLD",
                                     "EMERALD": "PLATINUM", "DIAMOND": "EMERALD"}.get(r["tier"], r["tier"])
                    r["wins"] -= 3 + variant * 40
                if r and (i + variant) % 3 == 1:
                    a["rank"] = None
                st = a.get("stats") or {}
                if st and variant % 2:
                    st["streak"]["current"] = {"type": "L" if st["streak"]["current"]["type"] == "W" else "W", "count": 6}
                for rk, g in list((st.get("gameRecords") or {}).items()):
                    if (i + variant) % 2:
                        g["val"] = g["val"] - 1 if isinstance(g["val"], int) else g["val"] / 2
                recs = [g for g in (st.get("gameRecords") or {}).values()]
                games = [{"id": g["id"], "t": g["t"], "penta": (i + variant) % 4 == 0, "quadra": True, "champ": g["champ"],
                          "k": g["k"], "d": g["d"], "a": g["a"], "win": g["win"]} for g in recs[:3]]
                ng[key] = games
                pb[key] = 1500 + i * 100 if variant < 3 else 0
            t_now = max(g["t"] for gs in ng.values() for g in gs) + 3600_000 * variant
            pairs.append([prev, nxt, {"now": t_now, "newGames": ng, "peakBefore": pb}])
        # Partidas simuladas con el mundo falso
        world = World({"puuids": {}, "published": {"players": []}, "histories": {}, "flex": {}})
        for i, games in enumerate(self.hists[:3]):
            for g in games[:15]:
                world.add_game(f"pu{i}", g)
        mids = list(world.games)[:30]
        matches = [[world.match(m), next(iter(world.games[m])), world.timeline(m) if j % 2 else None] for j, m in enumerate(mids)]
        dd = ddragon_payloads()
        ddd = {"spells": {v["key"]: v["id"] for v in dd["summoner"]["data"].values()},
               "runes": {}, "champs": {v["key"]: v["id"] for v in dd["champion"]["data"].values()}}
        for st in dd["runes"]:
            ddd["runes"][str(st["id"])] = st["icon"]
            for sl in st["slots"]:
                for r in sl["runes"]:
                    ddd["runes"][str(r["id"])] = r["icon"]
        duo_entries = [{"name": e["name"], "games": e["games"], "lpMap": assign_lp(e["points"], e["games"]),
                        "lpAvg": (p["accounts"][p["bestAccount"]].get("stats") or {}).get("lp")}
                       for e, p in zip(self.entries, self.pub["players"])]
        scores = [-1, 0, 99, 100, 399, 1234, 2799, 2800, 3150, None]
        return {"times": times, "days": days, "histories": self.hists, "weeks": weeks, "entries": self.entries,
                "chDefs": ch_defs, "chNows": ch_nows, "eventPairs": pairs, "logEvents": self.log, "scores": scores,
                "duoEntries": duo_entries, "flexEntries": self.flex, "matches": matches, "dd": ddd,
                "ranks": ["DIAMOND IV", "diamante", "Esmeralda II", "MASTER", "maestro I", "patata", "", "GOLD  III"]}

    def test_paridad(self):
        inp = self.build_input()
        r = subprocess.run([NODE, str(ROOT / "tests" / "node_battery.mjs"), str(ROOT)], input=dumps(inp).encode(),
                           capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr.decode(errors="replace")[-3000:])
        node = json.loads(r.stdout)
        py = {
            "time": [[madrid_parts(t), day_start(t), week_start(t), month_start(t), week_key(t), short_day(t), range_label(t, t + 6 * DAY)]
                     for t in inp["times"]],
            "days": [parse_day(d) for d in inp["days"]],
            "stats": [compute_account_stats(h) for h in inp["histories"]],
        }
        wk = []
        for frm, to in inp["weeks"]:
            w = compute_week(inp["entries"], frm, to)
            wk.append([w, compact_week(w), week_embed(w) if to else None])
        py["weeks"] = wk
        chs = []
        for now in inp["chNows"]:
            cs = compute_challenges(inp["chDefs"], {"players": inp["entries"]}, now)
            chs.append([cs, [[challenge_status(next(d for d in inp["chDefs"] if d["id"] == c["id"]), now),
                              challenge_embed(challenge_event(c, "start", now)), challenge_embed(challenge_event(c, "end", now))] for c in cs]])
        py["challenges"] = chs
        py["events"] = [detect_events(prev, nxt, ctx) for prev, nxt, ctx in inp["eventPairs"]]
        py["embeds"] = [[event_text(e), event_embed(e, "15.22.1")] for e in inp["logEvents"]]
        py["scoreLabels"] = [score_label(s) for s in inp["scores"]]
        py["duos"] = compute_duos(inp["duoEntries"])
        py["flex"] = flex_group_stats(inp["flexEntries"])
        py["matches"] = [[compact_match(m, pu, inp["dd"], tl), match_detail(m, inp["dd"])] for m, pu, tl in inp["matches"]]
        py["parseRank"] = [parse_rank(x) for x in inp["ranks"]]
        n_events = sum(len(x) for x in py["events"])
        self.assertGreater(n_events, 10, "el caso de prueba de hitos debería generar hitos")
        for k in node:
            with self.subTest(k):
                errs = diff(node[k], py[k], k)
                self.assertEqual(errs[:15], [])


# ---------------------------------------------------------------------------------------------- de punta a punta

CHALLENGES = {"challenges": [
    {"id": "carrera-noviembre-2026", "title": "Carrera de noviembre", "type": "race", "from": "2026-11-01", "to": "2026-11-30",
     "players": "all", "desc": "Gana quien más LP sume.", "stake": ""},
    {"id": "hand", "title": "Hándicap", "type": "handicap", "from": "2026-11-20", "to": "2026-12-31", "players": "all", "target": 80, "stake": "pizza"},
    {"id": "meta", "title": "A Esmeralda", "type": "target", "target": "EMERALD IV", "from": "2026-11-10", "to": "2026-11-28", "players": "all"},
]}


def bump(rank, wins=0, losses=0, lp=0, div=0):
    r = dict(rank)
    r["wins"] += wins
    r["losses"] += losses
    r["lp"] = max(0, r["lp"] + lp)
    divs = ["IV", "III", "II", "I"]
    tiers = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND"]
    if div and r["tier"] in tiers:
        i = tiers.index(r["tier"]) * 4 + divs.index(r["division"]) + div
        i = max(0, min(len(tiers) * 4 - 1, i))
        r["tier"], r["division"] = tiers[i // 4], divs[i % 4]
    return r


def new_game(mid, t, win, champ, role, k, d, a, **kw):
    g = {"v": 4, "id": mid, "q": kw.pop("q", 420), "t": t, "dur": kw.pop("dur", 1800), "win": win, "champ": champ, "role": role, "lvl": 16,
         "k": k, "d": d, "a": a, "kp": 50, "cs": 210, "vis": 25, "dmg": 30000 + k * 1000, "teamDmg": 110000, "penta": 0, "quadra": 0,
         "triple": 0, "towerDmg": 4000, "goldEarned": 14000, "fb": False, "pg": {"t": 20, "q": 3, "ai": 1, "gb": 2, "ba": 0, "am": 1, "dg": 0, "ow": 1},
         "ff": 0, "items": [3006, 3031, 0, 0, 0, 0, 3340], "spells": ["SummonerFlash", "SummonerHeal"],
         "runes": [None, None]}
    g.update(kw)
    return g


@unittest.skipUnless(NODE and (DATA / "data.json").exists(), "hace falta Node y data/")
class PasadasDePuntaAPunta(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.db = self.tmp / "py" / "soloq.db"
        self.db.parent.mkdir()
        store = Store(self.db)
        import_dir(DATA, store)
        # Una cuenta con la temporada a medio bajar (para probar la descarga de partidas antiguas)
        cache = store.read_puuids()
        self.pu = {k: v["puuid"] for k, v in cache.items()}
        self.hist0 = {pu: store.read_history(pu) for pu in self.pu.values()}
        self.flex0 = {pu: store.read_flex(pu) for pu in self.pu.values()}
        victim = self.pu["xpatq#euw"]
        h = copy.deepcopy(self.hist0[victim])
        h["games"] = h["games"][:60] + h["games"][100:]
        h["seasonComplete"] = False
        store.write_history(victim, h)
        self.pub0 = store.read_published()
        store.close()
        # Copia para Node: el repo (scripts, config) y data/ exportado desde la misma base de datos
        self.node_root = self.tmp / "node"
        shutil.copytree(ROOT / "scripts", self.node_root / "scripts")
        (self.node_root / "config").mkdir()
        shutil.copy(ROOT / "config" / "players.json", self.node_root / "config" / "players.json")
        (self.node_root / "config" / "challenges.json").write_text(json.dumps(CHALLENGES, ensure_ascii=False), encoding="utf-8")
        store = Store(self.db)
        export_dir(store, self.node_root / "data")
        store.close()
        self.world = World({"puuids": cache, "published": self.pub0, "histories": {pu: v["games"] for pu, v in self.hist0.items()},
                            "flex": {pu: v["games"] for pu, v in self.flex0.items()}})
        self.srv = FakeServer(self.world)
        self.players_cfg = json.loads((ROOT / "config" / "players.json").read_text(encoding="utf-8"))
        self._cfg = (config.RIOT_API_BASE, config.DDRAGON_BASE)
        config.RIOT_API_BASE = self.srv.base
        config.DDRAGON_BASE = f"{self.srv.base}/ddragon"

    def tearDown(self):
        config.RIOT_API_BASE, config.DDRAGON_BASE = self._cfg
        self.srv.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def env(self, now):
        return {"MIN_INTERVAL_MS": "0", "BACKFILL_BUDGET": "25", "CONDUCT_BUDGET": "30", "MATCH_COUNT": "100"}

    def run_both(self, now, quick=False, riot_fail=None, discord_plan=None, webhook=True):
        hook = f"{self.srv.base}/webhook" if webhook else ""
        # Node
        self.world.fail = copy.deepcopy(riot_fail or {})
        self.srv.discord_plan = list(discord_plan or [])
        self.srv.reset_logs()
        env = {**os.environ, **self.env(now), "FAKE_NOW": str(now), "FAKE_BASE": self.srv.base, "RIOT_API_BASE": self.srv.base,
               "RIOT_API_KEY": "RGAPI-prueba", "DISCORD_WEBHOOK": hook}
        r = subprocess.run([NODE, "--import", (ROOT / "tests" / "node_freeze.mjs").as_uri(), "scripts/update.mjs"] + (["--quick"] if quick else []),
                           cwd=self.node_root, env=env, capture_output=True, text=True, encoding="utf-8")
        node_out = r.stdout + r.stderr
        node_log, node_discord = self.srv.log, self.srv.discord
        # Python
        self.world.fail = copy.deepcopy(riot_fail or {})
        self.srv.discord_plan = list(discord_plan or [])
        self.srv.reset_logs()
        store = Store(self.db)
        status, code = run_pass(quick, store=store, env=self.env(now), players_config=self.players_cfg, challenge_defs=CHALLENGES["challenges"],
                                now=lambda: now, webhook=hook, api_key="RGAPI-prueba", roasts=False)
        py_log, py_discord = self.srv.log, self.srv.discord
        out = self.tmp / "py-export"
        shutil.rmtree(out, ignore_errors=True)
        export_dir(store, out)
        extra = {"rapida": store.get_state("rapida"), "campeones": store.get_state("campeones"), "pasada": store.get_state("pasada")}
        store.close()
        self.compare(node_out, node_log, py_log, node_discord, py_discord, out, extra)
        if os.environ.get("PARIDAD_DETALLE"):
            last = [l for l in node_out.splitlines() if l.startswith(("Listo", "Sin cambios", "Rápida", "::warning"))]
            print(f"\n[{'rápida' if quick else 'completa'}] {len(node_log)} peticiones, {sum(len(m['embeds']) for m in node_discord)} avisos,"
                  f" estado {extra['pasada'].get('err') or 'ok'} · {' | '.join(last)}")
        return node_log, node_discord, node_out

    def compare(self, node_out, node_log, py_log, node_discord, py_discord, out, extra):
        nd = self.node_root / "data"
        self.assertEqual(node_log, py_log, f"peticiones distintas\n{node_out[-3000:]}")
        self.assertEqual(diff(node_discord, py_discord, "discord")[:10], [])
        files_n = sorted(str(p.relative_to(nd)) for p in nd.rglob("*.json"))
        files_p = sorted(str(p.relative_to(out)) for p in out.rglob("*.json"))
        self.assertEqual(files_n, files_p)
        for f in files_n:
            a = json.loads((nd / f).read_text(encoding="utf-8"))
            b = json.loads((out / f).read_text(encoding="utf-8"))
            with self.subTest(f):
                self.assertEqual(diff(a, b, f)[:10], [])
        for name, key in ((".quick-state.json", "rapida"), (".champ-ids.json", "campeones"), (".status.json", "pasada")):
            p = self.node_root / name
            a = json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
            with self.subTest(name):
                self.assertEqual(diff(a, extra[key], name)[:10], [])

    def test_escenario(self):
        W, pu = self.world, self.pu
        acc = {p: W.accounts[pu[p]] for p in pu}
        t1 = madrid(2026, 11, 16, 10, 0)  # lunes: se cierra la semana y se manda el resumen
        # Paso 1 (completa): partidas nuevas, penta, subidas y bajadas, Flex en grupo, una partida en curso
        a = pu["xalozz#euw"]
        for i, (win, k) in enumerate([(True, 12), (True, 9), (True, 31)]):
            W.add_game(a, new_game(f"EUW1_99000000{i}", t1 - (3 - i) * 3600_000, win, "Jinx", "BOTTOM", k, 2, 8,
                                   penta=1 if i == 2 else 0, quadra=1 if i == 2 else 0, dur=2400 if i == 2 else 1800))
        acc["xalozz#euw"]["rank"] = bump(acc["xalozz#euw"]["rank"], wins=3, lp=60, div=1)
        b = pu["arnoobal#euw"]
        for i in range(2):
            W.add_game(b, new_game(f"EUW1_99100000{i}", t1 - (2 - i) * 3000_000, False, "Thresh", "UTILITY", 1, 9, 4, ff=1))
        acc["arnoobal#euw"]["rank"] = bump(acc["arnoobal#euw"]["rank"], losses=2, lp=-40, div=-1)
        d, e = pu["el desgracias v2#euw"], pu["fesao 11#euw"]
        for who, ch, role in ((d, "Garen", "TOP"), (e, "Ahri", "MIDDLE")):
            W.add_game(who, new_game("EUW1_992000000", t1 - 5 * 3600_000, True, ch, role, 7, 3, 9, q=440))
        if acc["el desgracias v2#euw"].get("flexRank"):
            acc["el desgracias v2#euw"]["flexRank"] = bump(acc["el desgracias v2#euw"]["flexRank"], wins=1, lp=20)
        W.live = {pu["xperis#6969"]: 777, pu["xalozz#euw"]: 777}
        fail = {f"/euw1/lol/summoner/v4/summoners/by-puuid/{pu['xpatq#euw']}": [429],
                f"/europe/lol/match/v5/matches/EUW1_991000001/timeline": [404]}
        log1, disc1, _ = self.run_both(t1, riot_fail=fail, discord_plan=[429])
        self.assertTrue(any("EUW1_990000002" in p for _, p in log1))
        self.assertTrue(disc1, "debería haber avisos en Discord")
        self.assertTrue(any("Resumen de la semana" in (em.get("title") or "") for m in disc1 for em in m["embeds"]))

        # Paso 2 (rápida): otra cuenta juega; Discord falla → queda pendiente
        f = pu["teyeno tuniña#euw"]
        W.add_game(f, new_game("EUW1_993000000", t1 + 30_000, True, "Lux", "MIDDLE", 8, 1, 10))
        acc["teyeno tuniña#euw"]["rank"] = bump(acc["teyeno tuniña#euw"]["rank"], wins=1, lp=22)
        W.live = {}
        self.run_both(t1 + 60_000, quick=True, discord_plan=[400])
        # Paso 3 (rápida): sin cambios de rango, pero la cuenta sigue «pendiente» y se reenvía lo pendiente
        self.run_both(t1 + 120_000, quick=True)
        # Paso 4 (rápida pasados 12 min): nadie pendiente → no se actualiza nada
        _, _, out4 = self.run_both(t1 + 20 * 60_000, quick=True)
        # Paso 5 (completa, 1 dic): termina la carrera de noviembre, empieza el hándicap; una cuenta falla
        t2 = madrid(2026, 12, 1, 10, 0)
        W.add_game(a, new_game("EUW1_994000000", t2 - 3600_000, False, "Jinx", "BOTTOM", 2, 8, 3))
        acc["xalozz#euw"]["rank"] = bump(acc["xalozz#euw"]["rank"], losses=1, lp=-18)
        fail = {f"/euw1/lol/summoner/v4/summoners/by-puuid/{pu['xpatq#euw']}": [404]}
        _, disc5, _ = self.run_both(t2, riot_fail=fail)
        titles = [em.get("title") or "" for m in disc5 for em in m["embeds"]]
        self.assertTrue(any("reto" in t for t in titles), titles)
        # Paso 6 (completa): todo bien → se borran detalles que sobran; sin cambios reales
        self.run_both(t2 + 15 * 60_000)
        # Paso 7: sin webhook (los retos se marcan igual)
        self.run_both(t2 + 30 * 60_000, webhook=False)


@unittest.skipUnless(NODE and (DATA / "data.json").exists(), "hace falta Node y data/")
class ClaveCaducada(PasadasDePuntaAPunta):
    def test_escenario(self):
        t = madrid(2026, 11, 12, 18, 0)
        fail = {f"/euw1/lol/league/v4/entries/by-puuid/{self.pu['xalozz#euw']}": [403]}
        self.run_both(t, quick=True, riot_fail=fail)
        fail = {f"/euw1/lol/summoner/v4/summoners/by-puuid/{self.pu['arnoobal#euw']}": [403]}
        self.run_both(t + 60_000, riot_fail=fail)


if __name__ == "__main__":
    unittest.main()
