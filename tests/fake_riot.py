"""API de Riot, Data Dragon y webhook de Discord simulados para comparar el actualizador de Node y el de Python.

Las respuestas salen de forma determinista de los historiales reales (data/) más un «escenario» que
añade partidas nuevas y cambia rangos. Las dos implementaciones ven exactamente lo mismo; el servidor
apunta cada petición para comparar también qué se pide y en qué orden.
"""

import hashlib
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]
CHAMPS = {"1": "Annie", "22": "Ashe", "51": "Caitlyn", "103": "Ahri", "222": "Jinx", "145": "Kaisa", "412": "Thresh", "64": "LeeSin",
          "81": "Ezreal", "122": "Darius", "238": "Zed", "875": "Sett", "21": "MissFortune", "234": "Viego", "86": "Garen", "117": "Lulu",
          "111": "Nautilus", "517": "Sylas", "254": "Vi", "157": "Yasuo"}
SPELLS = {"4": "SummonerFlash", "14": "SummonerDot", "12": "SummonerTeleport", "11": "SummonerSmite", "7": "SummonerHeal",
          "21": "SummonerBarrier", "3": "SummonerExhaust", "6": "SummonerHaste"}
RUNE_STYLES = {8000: "perk-images/Styles/7201_Precision.png", 8100: "perk-images/Styles/7200_Domination.png",
               8200: "perk-images/Styles/7202_Sorcery.png", 8300: "perk-images/Styles/7203_Whimsy.png",
               8400: "perk-images/Styles/7204_Resolve.png"}
KEYSTONES = {8005: "perk-images/Styles/Precision/PressTheAttack/PressTheAttack.png",
             8008: "perk-images/Styles/Precision/LethalTempo/LethalTempoTemp.png",
             8112: "perk-images/Styles/Domination/Electrocute/Electrocute.png",
             8214: "perk-images/Styles/Sorcery/SummonAery/SummonAery.png",
             8437: "perk-images/Styles/Resolve/GraspOfTheUndying/GraspOfTheUndying.png"}


def h(*parts):
    return int(hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest(), 16)


def ddragon_payloads():
    summ = {"data": {v: {"id": v, "key": k} for k, v in SPELLS.items()}}
    style_of = {8005: 8000, 8008: 8000, 8112: 8100, 8214: 8200, 8437: 8400}
    runes = [{"id": sid, "icon": icon, "slots": [{"runes": [{"id": k, "icon": KEYSTONES[k]} for k, s in style_of.items() if s == sid]}]}
             for sid, icon in RUNE_STYLES.items()]
    champ = {"data": {v: {"id": v, "key": k} for k, v in CHAMPS.items()}}
    return {"versions": ["15.22.1", "15.21.1"], "summoner": summ, "runes": runes, "champion": champ}


def _rev(d):
    return {v: k for k, v in d.items()}


SPELL_ID = _rev(SPELLS)
CHAMP_ID = _rev(CHAMPS)
RUNE_ID = {**{v: k for k, v in KEYSTONES.items()}, **{v: k for k, v in RUNE_STYLES.items()}}


class World:
    """Estado del mundo simulado: cuentas, rangos y partidas."""

    def __init__(self, data):
        # data: {'puuids': {key: {puuid}}, 'published': data.json, 'histories': {puuid: [games]}, 'flex': {puuid: [games]}}
        self.puuids = {k: v["puuid"] for k, v in data["puuids"].items()}
        self.key_of = {v: k for k, v in self.puuids.items()}
        self.accounts = {}
        for p in data["published"]["players"]:
            for a in p["accounts"]:
                pu = self.puuids.get(a["key"])
                if not pu:
                    continue
                self.accounts[pu] = {
                    "gameName": a["gameName"], "tagLine": a["tagLine"], "level": a.get("level") or 100,
                    "icon": a.get("profileIconId") or 1, "rank": a.get("rank"), "flexRank": a.get("flexRank")}
        self.games = {}     # id → {puuid: record}
        self.queue_ids = {}  # (puuid, queue) → [ids]
        for src in ("histories", "flex"):
            for pu, games in data[src].items():
                for g in games:
                    self.add_game(pu, g)
        self.live = {}       # puuid → gameId
        self.fail = {}       # ruta → [códigos de error a devolver antes de responder bien]

    def add_game(self, puuid, g, first=False):
        self.games.setdefault(g["id"], {})[puuid] = g
        q = g.get("q") or 420
        lst = self.queue_ids.setdefault((puuid, q), [])
        if g["id"] not in lst:
            lst.append(g["id"])
            lst.sort(key=lambda i: -self.games[i][next(iter(self.games[i]))]["t"])

    def set_rank(self, puuid, queue, rank):
        self.accounts[puuid]["rank" if queue == "solo" else "flexRank"] = rank

    # ------------------------------------------------------------ respuestas
    def league(self, puuid):
        a = self.accounts.get(puuid) or {}
        out = []
        for qt, r in (("RANKED_SOLO_5x5", a.get("rank")), ("RANKED_FLEX_SR", a.get("flexRank"))):
            if r:
                out.append({"queueType": qt, "tier": r["tier"], "rank": r["division"], "leaguePoints": r["lp"], "wins": r["wins"],
                            "losses": r["losses"], "hotStreak": r.get("hotStreak", False)})
        return out

    def participant(self, puuid, g, pid, team):
        pg = g.get("pg") or {}
        spells = g.get("spells") or [None, None]
        runes = g.get("runes") or [None, None]
        p = {
            "puuid": puuid, "participantId": pid, "teamId": team, "win": g["win"],
            "championName": g["champ"], "championId": int(CHAMP_ID.get(g["champ"], 1)),
            "teamPosition": g.get("role") or "", "champLevel": g.get("lvl", 15),
            "kills": g["k"], "deaths": g["d"], "assists": g["a"],
            "totalMinionsKilled": max(0, g.get("cs", 0) - 20), "neutralMinionsKilled": min(20, g.get("cs", 0)),
            "visionScore": g.get("vis", 0), "totalDamageDealtToChampions": g.get("dmg", 0),
            "pentaKills": g.get("penta", 0), "quadraKills": g.get("quadra", 0), "tripleKills": g.get("triple", 0),
            "damageDealtToBuildings": g.get("towerDmg", 0), "goldEarned": g.get("goldEarned", 0),
            "firstBloodKill": g.get("fb", False),
            "gameEndedInSurrender": bool(g.get("ff")), "gameEndedInEarlySurrender": False,
            "summoner1Id": int(SPELL_ID.get(spells[0], 4)), "summoner2Id": int(SPELL_ID.get(spells[1], 14)),
            "perks": {"styles": [{"style": 8000, "selections": [{"perk": RUNE_ID.get(runes[0], 8005)}]},
                                 {"style": RUNE_ID.get(runes[1], 8200)}]},
            "riotIdGameName": (self.accounts.get(puuid) or {}).get("gameName", "Alguien"),
            "riotIdTagline": (self.accounts.get(puuid) or {}).get("tagLine", "EUW"),
        }
        for i, it in enumerate((g.get("items") or [0] * 7)[:7]):
            p[f"item{i}"] = it
        names = {"q": "enemyMissingPings", "ai": "allInPings", "ba": "baitPings", "am": "assistMePings", "dg": "dangerPings",
                 "ow": "onMyWayPings"}
        if g.get("pg"):
            used = 0
            for k, f in names.items():
                p[f] = pg.get(k, 0)
                used += pg.get(k, 0)
            p["getBackPings"] = pg.get("gb", 0)
            used += pg.get("gb", 0)
            p["basicPings"] = max(0, pg.get("t", 0) - used)
        else:
            s = h(g["id"], puuid, "pings")
            p["enemyMissingPings"] = s % 9
            p["allInPings"] = (s >> 4) % 4
            p["getBackPings"] = (s >> 8) % 5
            p["retreatPings"] = (s >> 12) % 2
            p["basicPings"] = (s >> 16) % 30
        return p

    def match(self, mid):
        if mid not in self.games:
            return None
        recs = self.games[mid]
        any_g = next(iter(recs.values()))
        win_team = {True: 100, False: 200}
        parts = []
        used_roles = {100: set(), 200: set()}
        pid = 1
        for pu, g in recs.items():
            team = win_team[g["win"]]
            parts.append(self.participant(pu, g, pid, team))
            used_roles[team].add(g.get("role"))
            pid += 1
        for team in (100, 200):
            have = sum(1 for p in parts if p["teamId"] == team)
            for role in ROLES:
                if have >= 5:
                    break
                if role in used_roles[team]:
                    continue
                s = h(mid, team, role)
                champ = list(CHAMPS.values())[s % len(CHAMPS)]
                win = team == 100
                filler = {"id": mid, "win": win, "champ": champ, "role": role, "k": s % 12, "d": (s >> 5) % 10, "a": (s >> 9) % 15,
                          "cs": 100 + s % 150, "vis": s % 40, "dmg": 8000 + s % 20000, "goldEarned": 8000 + s % 6000, "lvl": 12 + s % 6,
                          "items": [3006, 0, 0, 0, 0, 0, 3340], "spells": ["SummonerFlash", "SummonerHeal"]}
                parts.append(self.participant(f"relleno-{s % 10**8}", filler, pid, team))
                parts[-1]["riotIdGameName"] = f"Rival{s % 1000}"
                parts[-1]["riotIdTagline"] = "EUW"
                pid += 1
                have += 1
        dur = any_g["dur"]
        return {
            "metadata": {"matchId": mid},
            "info": {"queueId": any_g.get("q") or 420, "gameEndTimestamp": any_g["t"], "gameStartTimestamp": any_g["t"] - dur * 1000,
                     "gameDuration": dur, "participants": parts,
                     "teams": [{"teamId": 100, "win": True, "bans": [{"championId": int(k)} for k in list(CHAMPS)[:3]]},
                               {"teamId": 200, "win": False, "bans": [{"championId": int(k)} for k in list(CHAMPS)[3:5]] + [{"championId": -1}]}]},
        }

    def timeline(self, mid):
        m = self.match(mid)
        if not m:
            return None
        n = m["info"]["gameDuration"] // 60 + 1
        frames = []
        for minute in range(n):
            pf = {}
            for p in m["info"]["participants"]:
                s = h(mid, p["participantId"], "oro")
                pf[str(p["participantId"])] = {"totalGold": 500 + minute * (300 + s % 120) + (s % 7) * minute * (1 if p["teamId"] == 100 else -1) * 10}
            frames.append({"participantFrames": pf})
        return {"info": {"frames": frames}}

    def match_ids(self, puuid, q):
        queue = int(q.get("queue", ["420"])[0])
        start = int(q.get("start", ["0"])[0])
        count = int(q.get("count", ["20"])[0])
        return self.queue_ids.get((puuid, queue), [])[start:start + count]

    def active(self, puuid):
        gid = self.live.get(puuid)
        if not gid:
            return None
        parts = []
        for pu, g2 in self.live.items():
            if g2 == gid:
                parts.append({"puuid": pu, "championId": 222, "teamId": 100})
        parts.append({"puuid": "otro", "championId": 22, "teamId": 200})
        return {"gameId": gid, "gameQueueConfigId": 420, "gameStartTime": 1_790_000_000_000, "participants": parts}


class FakeServer:
    def __init__(self, world):
        self.world = world
        self.log = []
        self.discord = []
        self.discord_plan = []   # códigos a devolver en los siguientes envíos (luego 200)
        self.dd = ddragon_payloads()
        srv = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, obj=None, headers=None):
                body = b"" if obj is None else json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}")
                srv.log.append(("POST", self.path))
                code = srv.discord_plan.pop(0) if srv.discord_plan else 200
                if code == 200:
                    srv.discord.append(body)
                    return self._send(200, {"id": "1"})
                if code == 429:
                    return self._send(429, {"retry_after": 0.01})
                return self._send(code, {"message": "fallo simulado"})

            def do_GET(self):
                u = urlparse(self.path)
                path = unquote(u.path)
                q = parse_qs(u.query)
                srv.log.append(("GET", u.path + ("?" + "&".join(f"{k}={v[0]}" for k, v in sorted(q.items())) if q else "")))
                w = srv.world
                plan = w.fail.get(u.path)
                if plan:
                    code = plan.pop(0)
                    return self._send(code, {"status": {"message": "fallo simulado"}}, {"Retry-After": "0"} if code == 429 else None)
                if path.startswith("/ddragon/"):
                    if path.endswith("/api/versions.json"):
                        return self._send(200, srv.dd["versions"])
                    for k in ("summoner", "champion"):
                        if path.endswith(f"/{k}.json"):
                            return self._send(200, srv.dd[k])
                    if path.endswith("/runesReforged.json"):
                        return self._send(200, srv.dd["runes"])
                    return self._send(404, {})
                m = re.match(r"^/[a-z0-9]+(/.*)$", path)
                if not m:
                    return self._send(404, {})
                p = m.group(1)
                if r := re.match(r"^/riot/account/v1/accounts/by-riot-id/(.+)/(.+)$", p):
                    for pu, a in w.accounts.items():
                        if a["gameName"].lower() == r.group(1).lower() and a["tagLine"].lower() == r.group(2).lower():
                            return self._send(200, {"puuid": pu, "gameName": a["gameName"], "tagLine": a["tagLine"]})
                    return self._send(404, {})
                if r := re.match(r"^/riot/account/v1/accounts/by-puuid/(.+)$", p):
                    a = w.accounts.get(r.group(1))
                    return self._send(200, {"puuid": r.group(1), "gameName": a["gameName"], "tagLine": a["tagLine"]}) if a else self._send(404, {})
                if r := re.match(r"^/lol/summoner/v4/summoners/by-puuid/(.+)$", p):
                    a = w.accounts.get(r.group(1))
                    return self._send(200, {"puuid": r.group(1), "summonerLevel": a["level"], "profileIconId": a["icon"]}) if a else self._send(404, {})
                if r := re.match(r"^/lol/league/v4/entries/by-puuid/(.+)$", p):
                    return self._send(200, w.league(r.group(1)))
                if r := re.match(r"^/lol/match/v5/matches/by-puuid/(.+)/ids$", p):
                    return self._send(200, w.match_ids(r.group(1), q))
                if r := re.match(r"^/lol/match/v5/matches/([^/]+)/timeline$", p):
                    t = w.timeline(r.group(1))
                    return self._send(200, t) if t else self._send(404, {})
                if r := re.match(r"^/lol/match/v5/matches/([^/]+)$", p):
                    mm = w.match(r.group(1))
                    return self._send(200, mm) if mm else self._send(404, {})
                if r := re.match(r"^/lol/spectator/v5/active-games/by-summoner/(.+)$", p):
                    g = w.active(r.group(1))
                    return self._send(200, g) if g else self._send(404, {})
                return self._send(404, {})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.httpd.server_address[1]
        self.base = f"http://127.0.0.1:{self.port}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def reset_logs(self):
        self.log = []
        self.discord = []

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()
