"""Cliente mínimo de la API de Riot con espaciado entre peticiones y reintentos (port de riot.mjs)."""

import logging
import time
from urllib.parse import quote, urlencode

import httpx

from . import config
from .js import jround

log = logging.getLogger("soloq")

PLATFORM_TO_ACCOUNT_REGION = {
    "euw1": "europe", "eun1": "europe", "tr1": "europe", "ru": "europe", "me1": "europe",
    "na1": "americas", "br1": "americas", "la1": "americas", "la2": "americas", "oc1": "americas",
    "kr": "asia", "jp1": "asia",
    "ph2": "asia", "sg2": "asia", "th2": "asia", "tw2": "asia", "vn2": "asia",
}
PLATFORM_TO_MATCH_REGION = {**PLATFORM_TO_ACCOUNT_REGION, "oc1": "sea", "ph2": "sea", "sg2": "sea", "th2": "sea", "tw2": "sea", "vn2": "sea"}


class RiotError(Exception):
    def __init__(self, status, url, body=None):
        super().__init__(f"Riot API {status} en {url}" + (f" — {body}" if body else ""))
        self.status = status


def is_key_error(err):
    return isinstance(err, RiotError) and err.status in (401, 403)


def _enc(s):
    return quote(str(s), safe="-_.!~*'()")


class Riot:
    # min_interval_ms: 1250 respeta 100 peticiones / 2 min (límite de claves dev/personal).
    def __init__(self, api_key, min_interval_ms=1250, base_url=None, sleep=time.sleep, clock=time.time):
        if not api_key:
            raise RuntimeError("Falta RIOT_API_KEY")
        self.api_key = api_key
        self.min_interval = min_interval_ms / 1000
        self.base_url = base_url or config.RIOT_API_BASE or None
        self.last_call = 0.0
        self.calls = 0
        self.match_cache = {}
        self.sleep = sleep
        self.clock = clock
        self.http = httpx.Client(timeout=20, headers={"User-Agent": "soloq-crew"})

    def get(self, host, path, params=None):
        qs = urlencode(params or {})
        base = f"{self.base_url}/{host}" if self.base_url else f"https://{host}.api.riotgames.com"
        url = f"{base}{path}{'?' + qs if qs else ''}"
        for attempt in range(5):
            wait = self.last_call + self.min_interval - self.clock()
            if wait > 0:
                self.sleep(wait)
            self.last_call = self.clock()
            self.calls += 1
            try:
                res = self.http.get(url, headers={"X-Riot-Token": self.api_key})
            except httpx.HTTPError:
                if attempt == 4:
                    raise
                self.sleep(2 * (attempt + 1))
                continue
            if res.is_success:
                return res.json()
            if res.status_code == 429:
                try:
                    retry = float(res.headers.get("retry-after") or 10)
                except ValueError:
                    retry = 10
                log.warning("  429 rate limit, esperando %ss…", retry)
                self.sleep(retry + 1)
                continue
            if res.status_code >= 500:
                self.sleep(3 * (attempt + 1))
                continue
            if res.status_code in (401, 403):
                raise RiotError(res.status_code, path, "clave inválida o caducada (¿dev key de 24h?)")
            raise RiotError(res.status_code, path, res.text[:200])
        raise RiotError(0, path, "demasiados reintentos")

    def account_by_riot_id(self, platform, game_name, tag_line):
        return self.get(PLATFORM_TO_ACCOUNT_REGION[platform], f"/riot/account/v1/accounts/by-riot-id/{_enc(game_name)}/{_enc(tag_line)}")

    def account_by_puuid(self, platform, puuid):
        return self.get(PLATFORM_TO_ACCOUNT_REGION[platform], f"/riot/account/v1/accounts/by-puuid/{puuid}")

    def summoner_by_puuid(self, platform, puuid):
        return self.get(platform, f"/lol/summoner/v4/summoners/by-puuid/{puuid}")

    def league_entries(self, platform, puuid):
        return self.get(platform, f"/lol/league/v4/entries/by-puuid/{puuid}")

    def match_ids(self, platform, puuid, params):
        return self.get(PLATFORM_TO_MATCH_REGION[platform], f"/lol/match/v5/matches/by-puuid/{puuid}/ids", params)

    def match(self, platform, mid):
        if mid not in self.match_cache:
            self.match_cache[mid] = self.get(PLATFORM_TO_MATCH_REGION[platform], f"/lol/match/v5/matches/{mid}")
        return self.match_cache[mid]

    def timeline(self, platform, mid):
        return self.get(PLATFORM_TO_MATCH_REGION[platform], f"/lol/match/v5/matches/{mid}/timeline")

    def active_game(self, platform, puuid):
        """Partida en curso (Spectator-V5). None si no está jugando."""
        try:
            return self.get(platform, f"/lol/spectator/v5/active-games/by-summoner/{puuid}")
        except RiotError as err:
            if err.status == 404:
                return None
            raise


OPGG_REGION = {"euw1": "euw", "eun1": "eune", "na1": "na", "kr": "kr", "br1": "br", "la1": "lan", "la2": "las",
               "oc1": "oce", "tr1": "tr", "ru": "ru", "jp1": "jp"}
LOG_REGION = OPGG_REGION


def profile_links(platform, game_name, tag_line):
    slug = f"{_enc(game_name)}-{_enc(tag_line)}"
    return {
        "opgg": f"https://www.op.gg/summoners/{OPGG_REGION.get(platform, 'euw')}/{slug}",
        "ugg": f"https://u.gg/lol/profile/{platform}/{slug}/overview",
        "dpm": f"https://dpm.lol/{slug}",
        "log": f"https://www.leagueofgraphs.com/summoner/{LOG_REGION.get(platform, 'euw')}/{slug}",
    }


MATCH_RECORD_VERSION = 4


def _dd(dd, kind, key):
    if not dd:
        return None
    return (dd.get(kind) or {}).get(str(key)) if key is not None else None


def loadout(p, dd):
    styles = (p.get("perks") or {}).get("styles") or []
    sel = (styles[0] or {}).get("selections") if styles else None
    keystone = (sel[0] or {}).get("perk") if sel else None
    secondary = (styles[1] or {}).get("style") if len(styles) > 1 else None
    return {
        "champ": p.get("championName"),
        "spells": [_dd(dd, "spells", p.get("summoner1Id")), _dd(dd, "spells", p.get("summoner2Id"))],
        "runes": [_dd(dd, "runes", keystone), _dd(dd, "runes", secondary)],
    }


PING_FIELDS = ["allInPings", "assistMePings", "baitPings", "basicPings", "commandPings", "dangerPings", "enemyMissingPings",
               "enemyVisionPings", "getBackPings", "holdPings", "needVisionPings", "onMyWayPings", "pushPings", "retreatPings",
               "visionClearedPings"]


def _n(p, k):
    try:
        v = float((p or {}).get(k) or 0)
    except (TypeError, ValueError):
        return 0
    if v != v:
        return 0
    return int(v) if v.is_integer() else v


def conduct_of(p):
    return {
        "pg": {
            "t": sum(_n(p, k) for k in PING_FIELDS),
            "q": _n(p, "enemyMissingPings"),
            "ai": _n(p, "allInPings"),
            "gb": _n(p, "getBackPings") + _n(p, "retreatPings"),
            "ba": _n(p, "baitPings"),
            "am": _n(p, "assistMePings"),
            "dg": _n(p, "dangerPings"),
            "ow": _n(p, "onMyWayPings"),
        },
        "ff": 1 if (p or {}).get("gameEndedInSurrender") else 0,
    }


def _or0(v):
    return v or 0


def compact_match(match, puuid, dd, timeline):
    info = match["info"]
    parts = info["participants"]
    me = next((p for p in parts if p.get("puuid") == puuid), None)
    if not me:
        return None
    if me.get("gameEndedInEarlySurrender") or info["gameDuration"] < 300:
        return None
    team = [p for p in parts if p.get("teamId") == me.get("teamId")]
    opp = None
    if me.get("teamPosition"):
        opp = next((p for p in parts if p.get("teamId") != me.get("teamId") and p.get("teamPosition") == me["teamPosition"]), None)
    team_kills = sum(_or0(p.get("kills")) for p in team)
    t = info.get("gameEndTimestamp")
    if t is None:
        t = info["gameStartTimestamp"] + info["gameDuration"] * 1000
    tower = me.get("damageDealtToBuildings")
    if tower is None:
        tower = me.get("damageDealtToTurrets")
    if tower is None:
        tower = 0
    lo = loadout(me, dd)
    return {
        "v": MATCH_RECORD_VERSION,
        "id": match["metadata"]["matchId"],
        "q": info.get("queueId"),
        "t": t,
        "dur": info["gameDuration"],
        "win": bool(me.get("win")),
        "champ": me.get("championName"),
        "role": me.get("teamPosition") or None,
        "lvl": me.get("champLevel"),
        "k": me.get("kills"), "d": me.get("deaths"), "a": me.get("assists"),
        "kp": jround(((me["kills"] + me["assists"]) / team_kills) * 100) if team_kills else 0,
        "cs": _or0(me.get("totalMinionsKilled")) + _or0(me.get("neutralMinionsKilled")),
        "vis": _or0(me.get("visionScore")),
        "dmg": _or0(me.get("totalDamageDealtToChampions")),
        "teamDmg": sum(_or0(p.get("totalDamageDealtToChampions")) for p in team),
        "penta": _or0(me.get("pentaKills")),
        "quadra": _or0(me.get("quadraKills")),
        "triple": _or0(me.get("tripleKills")),
        "towerDmg": tower,
        "goldEarned": _or0(me.get("goldEarned")),
        "fb": bool(me.get("firstBloodKill")),
        **conduct_of(me),
        "items": [_or0(me.get(f"item{i}")) for i in range(7)],
        "spells": lo["spells"], "runes": lo["runes"],
        "opp": loadout(opp, dd) if opp else None,
        "gold": gold_from_timeline(info, timeline, me, opp) if timeline else None,
    }


def gold_from_timeline(info, timeline, me, opp):
    frames = ((timeline or {}).get("info") or {}).get("frames")
    if not frames:
        return None
    team_of = {p["participantId"]: p["teamId"] for p in info["participants"]}
    max_lead = max_def = 0
    tgd15 = gd15 = None
    max_lead_min = 0
    for minute, f in enumerate(frames):
        diff = 0
        pfs = f.get("participantFrames") or {}
        for pid, pf in pfs.items():
            diff += (1 if team_of.get(int(pid)) == me["teamId"] else -1) * _or0(pf.get("totalGold"))
        if diff > max_lead:
            max_lead, max_lead_min = diff, minute
        if diff < max_def:
            max_def = diff
        if minute == 15:
            tgd15 = diff
            mine = (pfs.get(str(me["participantId"])) or {}).get("totalGold")
            theirs = (pfs.get(str(opp["participantId"])) or {}).get("totalGold") if opp else None
            if mine is not None and theirs is not None:
                gd15 = mine - theirs
    return {"maxLead": max_lead, "maxLeadMin": max_lead_min, "maxDef": max_def, "tgd15": tgd15, "gd15": gd15}


ORDER = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]


def _order(pos):
    return ORDER.index(pos) if pos in ORDER else -1


def match_detail(match, dd):
    info = match["info"]
    teams = []
    for team_id in (100, 200):
        t = next((x for x in (info.get("teams") or []) if x.get("teamId") == team_id), None)
        players = []
        for p in info["participants"]:
            if p.get("teamId") != team_id:
                continue
            rid = f"{p['riotIdGameName']}#{p.get('riotIdTagline')}" if p.get("riotIdGameName") else (p.get("summonerName") or "?")
            lo = loadout(p, dd)
            players.append({
                "rid": rid,
                "pos": p.get("teamPosition") or None,
                "lvl": p.get("champLevel"),
                "champ": lo["champ"], "spells": lo["spells"], "runes": lo["runes"],
                "k": p.get("kills"), "d": p.get("deaths"), "a": p.get("assists"),
                "cs": _or0(p.get("totalMinionsKilled")) + _or0(p.get("neutralMinionsKilled")),
                "dmg": _or0(p.get("totalDamageDealtToChampions")),
                "gold": _or0(p.get("goldEarned")),
                "items": [_or0(p.get(f"item{i}")) for i in range(7)],
            })
        players.sort(key=lambda x: _order(x["pos"]))
        teams.append({
            "teamId": team_id,
            "win": bool(t and t.get("win")),
            "kills": sum(p["k"] for p in players),
            "gold": sum(p["gold"] for p in players),
            "bans": [c for c in (_dd(dd, "champs", b.get("championId")) for b in ((t or {}).get("bans") or [])) if c],
            "players": players,
        })
    return {"id": match["metadata"]["matchId"], "t": info.get("gameEndTimestamp"), "dur": info["gameDuration"], "teams": teams}


def load_data_dragon(version, http=None):
    """Diccionarios de Data Dragon para hechizos, runas y campeones (una vez por pasada)."""
    if not version:
        return {"spells": {}, "runes": {}}
    base = f"{config.DDRAGON_BASE}/cdn/{version}/data/en_US"
    spells, runes, champs, tags = {}, {}, {}, {}
    client = http or httpx.Client(timeout=20)
    try:
        s = client.get(f"{base}/summoner.json").json()
        for sp in s["data"].values():
            spells[str(sp["key"])] = sp["id"]
    except Exception:
        pass
    try:
        r = client.get(f"{base}/runesReforged.json").json()
        for style in r:
            runes[str(style["id"])] = style["icon"]
            for slot in style["slots"]:
                for rune in slot["runes"]:
                    runes[str(rune["id"])] = rune["icon"]
    except Exception:
        pass
    try:
        c = client.get(f"{base}/champion.json").json()
        for ch in c["data"].values():
            champs[str(ch["key"])] = ch["id"]
            if ch.get("tags"):
                tags[ch["id"]] = ch["tags"][0]
    except Exception:
        pass
    return {"spells": spells, "runes": runes, "champs": champs, "tags": tags}


def ddragon_version(http=None):
    try:
        client = http or httpx.Client(timeout=20)
        return client.get(f"{config.DDRAGON_BASE}/api/versions.json").json()[0]
    except Exception:
        return None
