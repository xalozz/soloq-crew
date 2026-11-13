"""Roasts: un remate a los hitos de siempre y avisos propios por partidas malas (o victorias inmerecidas).

Las frases están en config/roasts.json (editable sin tocar código). Aquí solo van los detectores y los umbrales.

- Remate: cada hito (subida, bajada, racha, penta, récord…) lleva un campo "roast" con una frase de su lista.
- Partidas: cada partida nueva pasa por todos los detectores y se queda con el primero que salta (van por orden
  de gravedad). Como mucho ROAST_PER_DAY avisos de este tipo por jugador y día, para no llenar el canal.
- Daño por campeón: % del daño del equipo de los 10 jugadores de cada partida descargada, por campeón y posición
  (y por tipo de campeón y por posición, de respaldo). Un daño «bajo» es estar en el ~7 % peor de ese campeón.
"""

import hashlib
import json
import logging
import math
from collections import defaultdict

from . import config
from .events import k1, step
from .js import es_1dec, js_str
from .tiempo import day_start, madrid_parts

log = logging.getLogger("soloq")

ROAST_PER_DAY = 2               # avisos «roast» de partida por jugador y día (los remates de los hitos no cuentan)
BASE_MIN = 30                   # muestras mínimas para fiarse de la media de un campeón (si no, su tipo o su posición)
BASE_IDS_CAP = 6000             # partidas ya contadas en la tabla de daño (para no contar dos veces)
LOW_Z = 1.5                     # ~7 % peor de una normal
NTH = ["", "primera", "segunda", "tercera", "cuarta", "quinta", "sexta", "séptima", "octava", "novena", "décima"]
POS_ES = {"TOP": "top", "JUNGLE": "jungla", "MIDDLE": "mid", "BOTTOM": "ADC", "UTILITY": "support"}

_phrases = None


def phrases():
    global _phrases
    if _phrases is None:
        try:
            _phrases = json.loads((config.CONFIG_DIR / "roasts.json").read_text(encoding="utf-8"))
        except (OSError, ValueError) as err:
            log.warning("  ! roasts.json: %s", err)
            _phrases = {}
    return _phrases


def pick(lst, seed, extra=None):
    """Una frase de la lista, siempre la misma para el mismo evento (web y Discord coinciden)."""
    if not lst:
        return None
    h = int(hashlib.md5(seed.encode()).hexdigest()[:8], 16)
    return _fill(lst[h % len(lst)], extra or {})


def _fill(s, vals):
    return s.format_map(defaultdict(str, {k: v for k, v in vals.items() if v is not None}))


# ------------------------------------------------------------------ tabla de daño por campeón

def add_damage_samples(store, detail, tags=None):
    """Suma a la tabla las 10 muestras de una partida (una sola vez por partida)."""
    if not detail or not detail.get("teams"):
        return
    base = store.get_state("dmgBase") or {"s": {}, "ids": []}
    if detail["id"] in base["ids"]:
        return
    s = base["s"]
    for team in detail["teams"]:
        total = sum(p.get("dmg") or 0 for p in team["players"])
        if not total:
            continue
        for p in team["players"]:
            pos, champ = p.get("pos"), p.get("champ")
            if not pos or not champ:
                continue
            share = (p.get("dmg") or 0) / total * 100
            keys = [f"{champ}|{pos}", f"*|{pos}"]
            tag = (tags or {}).get(champ)
            if tag:
                keys.append(f"#{tag}|{pos}")
            for k in keys:
                n, sm, sq = s.get(k) or [0, 0.0, 0.0]
                s[k] = [n + 1, round(sm + share, 3), round(sq + share * share, 3)]
    base["ids"] = (base["ids"] + [detail["id"]])[-BASE_IDS_CAP:]
    store.set_state("dmgBase", base)


def seed_damage_base(store, tags=None):
    """Primera vez: la tabla sale de los detalles de partida que ya hay guardados."""
    if store.get_state("dmgBase") is not None:
        return
    store.set_state("dmgBase", {"s": {}, "ids": []})
    for mid in store.list_details():
        raw = store.read_detail_raw(mid)
        if raw:
            add_damage_samples(store, json.loads(raw), tags)


def damage_floor(base, champ, pos, tags=None):
    """(umbral de daño bajo en %, media) para ese campeón en esa posición, o None si no hay datos."""
    s = (base or {}).get("s") or {}
    tag = (tags or {}).get(champ)
    for k in (f"{champ}|{pos}", f"#{tag}|{pos}" if tag else None, f"*|{pos}"):
        v = s.get(k) if k else None
        if v and v[0] >= BASE_MIN:
            n, sm, sq = v
            mean = sm / n
            sd = math.sqrt(max(0.0, sq / n - mean * mean))
            return mean - LOW_Z * sd, mean
    return None


# ------------------------------------------------------------------ detectores de partida

def _mins(g):
    return g["dur"] / 60


def _share(g):
    return g["dmg"] / g["teamDmg"] * 100 if g.get("teamDmg") else None


def _team_worst(g, detail, rid):
    """True si en su equipo es a la vez el que menos daño hace y el que más muere (con 7+ muertes)."""
    if not detail or not rid:
        return False
    for team in detail.get("teams") or []:
        me = next((p for p in team["players"] if p.get("rid", "").lower() == rid.lower()), None)
        if not me:
            continue
        others = [p for p in team["players"] if p is not me]
        return (me["d"] >= 7 and all(me["d"] > p["d"] for p in others) and all(me["dmg"] < p["dmg"] for p in others))
    return False


def detect_game(g, history, base, tags, detail=None, rid=None):
    """(clave, valores) del roast más gordo de una partida, o None."""
    win, mins = g["win"], _mins(g)
    v = {"champ": g["champ"], "k": g["k"], "d": g["d"], "a": g["a"], "min": js_str(math.floor(mins)), "pos": POS_ES.get(g.get("role"), "")}
    gold = g.get("gold") or {}
    share = _share(g)

    if not win and (gold.get("maxLead") or 0) >= 6000:
        return "tirada", {**v, "lead": k1(gold["maxLead"]), "leadMin": gold.get("maxLeadMin")}
    if g["d"] >= 10 and g["k"] + g["a"] < g["d"]:
        return ("feedGana" if win else "feedPierde"), v
    if _team_worst(g, detail, rid):
        return ("lastreGana" if win else "lastrePierde"), v
    if share is not None and g.get("role") and mins >= 15:
        fl = damage_floor(base, g["champ"], g["role"], tags)
        if fl and share < fl[0]:
            return ("mochila" if win else "sinDanio"), {**v, "pct": js_str(round(share)), "media": js_str(round(fl[1]))}
    if gold.get("gd15") is not None and gold["gd15"] <= -2500 and g.get("opp"):
        return "linea", {**v, "gd": k1(-gold["gd15"]), "rival": g["opp"].get("champ")}
    if not win and g.get("ff") and mins < 21:
        return "ff", v
    if not win and ((g.get("pg") or {}).get("q") or 0) >= 10:
        return "preguntas", {**v, "q": js_str(g["pg"]["q"])}
    if g.get("role") in ("TOP", "MIDDLE", "BOTTOM") and mins >= 20 and g["cs"] / mins < 5:
        return "cs", {**v, "csmin": es_1dec(g["cs"] / mins)}
    vis_floor = 0.9 if g.get("role") == "UTILITY" else 0.35
    if mins >= 20 and g["vis"] / mins < vis_floor:
        return "vision", {**v, "vis": js_str(g["vis"])}
    if not win:
        same = [x for x in history if x["champ"] == g["champ"]]
        w = sum(1 for x in same if x["win"])
        if len(same) >= 8 and w / len(same) < 0.4:
            return "maldito", {**v, "w": js_str(w), "l": js_str(len(same) - w)}
        hh = madrid_parts(g["t"])["hh"]
        if 3 <= hh < 7:
            p = madrid_parts(g["t"])
            return "madrugada", {**v, "hora": f"{p['hh']}:{p['mm']:02d}"}
    return None


# ------------------------------------------------------------------ todo junto

def _nth(n):
    return NTH[n] if 0 < n < len(NTH) else f"{n}ª"


def add_roasts(events, ctx):
    """Pone el remate a los hitos y añade los avisos «roast» de las partidas nuevas.

    ctx: now, log (eventos ya publicados), players, newGames {key: [partidas]}, histories {key: [temporada]},
         base (tabla de daño), tags, details {id: detalle}, rids {key: riotId}, leader (nombre del primero del grupo).
    """
    P = phrases()
    rem = P.get("remates") or {}
    now = ctx["now"]
    log_ = ctx.get("log") or []

    for e in events:
        if e.get("roast"):
            continue
        t, seed = e["type"], e["id"]
        pool, extra = None, {"name": e.get("name")}
        if t == "down":
            back = [x for x in log_ if x.get("type") == "down" and x.get("key") == e.get("key") and x.get("to") == e.get("to")
                    and now - x["t"] < 14 * 864e5]
            ups = [x for x in log_ if x.get("type") == "up" and x.get("key") == e.get("key") and x.get("to") == e.get("from")
                   and now - x["t"] < 864e5]
            if e.get("name") == ctx.get("leader"):
                pool = "liderBaja"
            elif back:
                pool, extra["nth"] = "ascensor", _nth(len(back) + 1)
            elif ups:
                pool, extra["horas"] = "duraPoco", js_str(max(1, round((now - ups[0]["t"]) / 3600e3)))
            else:
                pool = "bajaLiga" if e.get("tierChange") else "baja"
        elif t == "up":
            pool = "subeLiga" if e.get("tierChange") else "sube"
        elif t == "streak":
            n = e.get("n") or 0
            pool = ("rachaW" if e["kind"] == "W" else "rachaL10" if n >= 10 else "rachaL7" if n >= 7 else "rachaL5")
        elif t == "streakEnd":
            pool = "finRachaW" if e["kind"] == "W" else "finRachaL"
        elif t == "penta":
            pool = "penta" if e.get("win") else "pentaDerrota"
        elif t == "quadra":
            pool = "quadra"
        elif t == "record":
            pool = "record"
        elif t == "placed":
            pool = "clasifica"
        elif t == "games":
            pool = "partidas"
        if pool:
            r = pick(rem.get(pool), seed, extra)
            if r:
                e["roast"] = r

    # Avisos propios de partida: como mucho ROAST_PER_DAY por jugador y día
    games_cfg = P.get("partidas") or {}
    today = day_start(now)
    used = defaultdict(int)
    for x in log_:
        if x.get("type") == "roast" and x["t"] >= today:
            used[x.get("key")] += 1
    for p in ctx.get("players") or []:
        key, name = p["key"], p["name"]
        hist = ctx["histories"].get(key) or []
        for g in sorted(ctx["newGames"].get(key) or [], key=lambda x: x["t"]):
            if used[key] >= ROAST_PER_DAY or now - g["t"] > 12 * 3600e3:
                continue
            hit = detect_game(g, hist, ctx.get("base"), ctx.get("tags"), (ctx.get("details") or {}).get(g["id"]), ctx["rids"].get(key))
            if not hit:
                continue
            k, vals = hit
            cfg = games_cfg.get(k)
            if not cfg or not cfg.get("texto"):
                continue
            vals = {**vals, "name": name}
            eid = f"roast:{key}:{g['id']}:"
            ev = {"name": name, "key": key, "type": "roast", "rk": k, "t": g["t"], "gameId": g["id"], "champ": g["champ"],
                  "k": g["k"], "d": g["d"], "a": g["a"], "win": g["win"], "id": eid, "text": _fill(cfg["texto"], vals)}
            r = pick(cfg.get("remates"), eid, vals)
            if r:
                ev["roast"] = r
            events.append(ev)
            used[key] += 1
    events.sort(key=lambda x: x["t"])
    return events


def leader_of(players, main_acc):
    best, name = -1, None
    for p in players:
        a = main_acc(p)
        s = step((a or {}).get("rank")) if a else None
        if s is not None and s > best:
            best, name = s, p["name"]
    return name

