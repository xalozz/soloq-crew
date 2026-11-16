"""Roasts: avisos propios por partidas malas (o victorias inmerecidas). Solo el hecho, sin comentario.

Umbrales, qué detectores están activos y el tope diario salen de los ajustes (soloq/ajustes.py, se cambian en /admin);
los textos, de config/roasts.json o de lo guardado en /admin.

- Cada partida nueva pasa por los detectores activos y se queda con el primero que salta (van por orden de gravedad).
  Como mucho «roastsPorDia» avisos de este tipo por jugador y día, para no llenar el canal.
- Daño bajo: según el tipo principal del campeón en Data Dragon (tirador, mago, asesino, luchador); a tanques y
  supports no se les mide el daño, ni a nadie que juegue de support.
"""

import math
from collections import defaultdict

from . import ajustes
from .events import k1, step
from .js import es_1dec, js_str
from .tiempo import day_start, madrid_parts

NTH = ["", "primera", "segunda", "tercera", "cuarta", "quinta", "sexta", "séptima", "octava", "novena", "décima"]
POS_ES = {"TOP": "top", "JUNGLE": "jungla", "MIDDLE": "mid", "BOTTOM": "ADC", "UTILITY": "support"}
ROAST_PER_DAY = ajustes.DEFAULTS["roastsPorDia"]


def _fill(s, vals):
    return s.format_map(defaultdict(str, {k: v for k, v in vals.items() if v is not None}))


# ------------------------------------------------------------------ detectores de partida

def _mins(g):
    return g["dur"] / 60


def _share(g):
    return g["dmg"] / g["teamDmg"] * 100 if g.get("teamDmg") else None


def _team_worst(g, detail, rid, min_deaths):
    """True si en su equipo es a la vez el que menos daño hace y el que más muere (con min_deaths o más)."""
    if not detail or not rid:
        return False
    for team in detail.get("teams") or []:
        me = next((p for p in team["players"] if p.get("rid", "").lower() == rid.lower()), None)
        if not me:
            continue
        others = [p for p in team["players"] if p is not me]
        return (me["d"] >= min_deaths and all(me["d"] > p["d"] for p in others) and all(me["dmg"] < p["dmg"] for p in others))
    return False


def detect_game(g, history, tags, detail=None, rid=None, names=None, avisos=None):
    """(clave, valores) del roast más gordo de una partida, o None. `avisos`: los de ajustes.completar(); solo
    cuentan los detectores que salen en la web o en Discord."""
    avisos = avisos or ajustes.DEFAULTS["avisos"]

    def on(k):
        a = avisos.get(k) or {}
        return a.get("web") or a.get("discord")

    def p(k):
        return (avisos.get(k) or {}).get("p") or ajustes.DEFAULT_PARAMS.get(k, {})

    win, mins = g["win"], _mins(g)
    v = {"champ": (names or {}).get(g["champ"], g["champ"]), "k": g["k"], "d": g["d"], "a": g["a"], "min": js_str(math.floor(mins)), "pos": POS_ES.get(g.get("role"), "")}
    gold = g.get("gold") or {}
    share = _share(g)

    if on("tirada") and not win and (gold.get("maxLead") or 0) >= p("tirada")["oro"]:
        return "tirada", {**v, "lead": k1(gold["maxLead"]), "leadMin": gold.get("maxLeadMin")}
    if on("feed") and g["d"] >= p("feed")["muertes"] and g["k"] + g["a"] < g["d"]:
        return ("feedGana" if win else "feedPierde"), v
    if on("lastre") and g.get("role") != "UTILITY" and _team_worst(g, detail, rid, p("lastre")["muertes"]):
        return ("lastreGana" if win else "lastrePierde"), v
    low = p("danio").get((tags or {}).get(g["champ"]))
    if on("danio") and share is not None and low and g.get("role") not in (None, "UTILITY") and mins >= 15 and share < low:
        return ("mochila" if win else "sinDanio"), {**v, "pct": js_str(round(share))}
    if on("ff") and not win and g.get("ff") and mins < p("ff")["minuto"]:
        return "ff", v
    same = [x for x in history if x["champ"] == g["champ"]]
    n = len(same) + (0 if any(x["id"] == g["id"] for x in same) else 1)
    if on("raro") and len(history) >= p("raro")["temporada"] and n <= p("raro")["veces"]:
        return ("estreno" if n == 1 else "raro") + ("Gana" if win else "Pierde"), {**v, "n": js_str(n), "nth": NTH[n] if n < len(NTH) else f"{n}.ª"}
    cs = p("cs")
    if on("cs") and g.get("role") in ("TOP", "MIDDLE", "BOTTOM") and mins >= cs["minutos"] and g["cs"] / mins < cs["csmin"]:
        return "cs", {**v, "csmin": es_1dec(g["cs"] / mins)}
    vis_floor = p("vision")["support" if g.get("role") == "UTILITY" else "porMin"]
    if on("vision") and mins >= 20 and g["vis"] / mins < vis_floor:
        return "vision", {**v, "vis": js_str(g["vis"])}
    if not win:
        w = sum(1 for x in same if x["win"])
        m = p("maldito")
        if on("maldito") and len(same) >= m["partidas"] and w / len(same) * 100 < m["winrate"]:
            return "maldito", {**v, "w": js_str(w), "l": js_str(len(same) - w)}
        hp = madrid_parts(g["t"])
        if on("madrugada") and p("madrugada")["desde"] <= hp["hh"] < p("madrugada")["hasta"]:
            return "madrugada", {**v, "hora": f"{hp['hh']}:{hp['mm']:02d}"}
    return None


# ------------------------------------------------------------------ todo junto

def add_roasts(events, ctx):
    """Añade los avisos «roast» de las partidas nuevas (solo el hecho, sin comentario).

    ctx: now, log (eventos ya publicados), players, newGames {key: [partidas]}, histories {key: [temporada]}, tags,
    details {id: detalle}, rids {key: riotId}, names; opcionales: ajustes (ajustes.completar()), textos {clave: {texto}}.
    """
    aj = ctx.get("ajustes") or ajustes.completar(None)
    textos = ctx.get("textos")
    if textos is None:
        textos = ajustes.textos_archivo()
    per_day = aj["roastsPorDia"]
    now = ctx["now"]
    log_ = ctx.get("log") or []

    today = day_start(now)
    used = defaultdict(int)
    for x in log_:
        if x.get("type") == "roast" and x["t"] >= today:
            used[x.get("key")] += 1
    for p in ctx.get("players") or []:
        key, name = p["key"], p["name"]
        hist = ctx["histories"].get(key) or []
        for g in sorted(ctx["newGames"].get(key) or [], key=lambda x: x["t"]):
            if used[key] >= per_day or now - g["t"] > 12 * 3600e3:
                continue
            hit = detect_game(g, hist, ctx.get("tags"), (ctx.get("details") or {}).get(g["id"]), ctx["rids"].get(key),
                              ctx.get("names"), aj["avisos"])
            if not hit:
                continue
            k, vals = hit
            cfg = textos.get(k)
            if not cfg or not cfg.get("texto"):
                continue
            vals = {**vals, "name": name}
            eid = f"roast:{key}:{g['id']}:"
            events.append({"name": name, "key": key, "type": "roast", "rk": k, "t": g["t"], "gameId": g["id"], "champ": g["champ"],
                           "k": g["k"], "d": g["d"], "a": g["a"], "win": g["win"], "id": eid, "text": _fill(cfg["texto"], vals)})
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
