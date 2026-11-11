"""Hitos: subidas y bajadas, pentas, rachas, récords del grupo y partidas jugadas (port de events.mjs)."""

import math
from urllib.parse import quote

from . import config
from .js import es_1dec, js_str
from .stats import rank_score
from .tiempo import iso

TIER_ES = {
    "IRON": "Hierro", "BRONZE": "Bronce", "SILVER": "Plata", "GOLD": "Oro", "PLATINUM": "Platino", "EMERALD": "Esmeralda",
    "DIAMOND": "Diamante", "MASTER": "Maestro", "GRANDMASTER": "Gran Maestro", "CHALLENGER": "Aspirante",
}
TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"]
DIVS = ["IV", "III", "II", "I"]
APEX = {"MASTER", "GRANDMASTER", "CHALLENGER"}
TIER_COLOR = {
    "IRON": 0x8a7f79, "BRONZE": 0xc07f4c, "SILVER": 0xa9b8c6, "GOLD": 0xe8b949, "PLATINUM": 0x45c8b6, "EMERALD": 0x35d08e,
    "DIAMOND": 0x74a9ff, "MASTER": 0xb77cf2, "GRANDMASTER": 0xf06a6a, "CHALLENGER": 0xf5d76e,
}
COLOR = {"win": 0x33d69a, "loss": 0xf2657e, "accent": 0xd6ff3d, "gold": 0xf5c542, "neutral": 0x8e8e97}


def encode_uri_component(s):
    return quote(str(s), safe="-_.!~*'()")


def rank_label(r):
    if not r:
        return "Sin clasificar"
    if r["tier"] in APEX:
        return f"{TIER_ES[r['tier']]} · {r['lp']} LP"
    return f"{TIER_ES.get(r['tier'], r['tier'])} {r['division']}"


def score_label(score):
    if score is None or score < 0:
        return "–"
    if score >= 2800:
        return f"Maestro+ · {js_str(score - 2800)} LP"
    t, d = math.floor(score / 400), math.floor((score % 400) / 100)
    return f"{TIER_ES[TIERS[t]]} {DIVS[d]} · {js_str(score % 100)} LP"


def crest_url(tier):
    return f"https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/{str(tier).lower()}.png"


def champ_url(ver, champ):
    return f"https://ddragon.leagueoflegends.com/cdn/{ver}/img/champion/{encode_uri_component(champ)}.png" if ver and champ else None


def match_link(id_):
    return f"{config.SITE}#partida/{encode_uri_component(id_)}"


def signed(n):
    return f"+{js_str(n)}" if n > 0 else js_str(n)


def k1(v):
    return f"{es_1dec(v / 1000)}k"


def mmss(sec):
    return f"{math.floor(sec / 60)}:{int(sec % 60):02d}"


def step(rank):
    if not rank or not rank.get("tier"):
        return None
    if rank["tier"] in APEX:
        return 28 + TIERS.index(rank["tier"]) - 7
    return TIERS.index(rank["tier"]) * 4 + (DIVS.index(rank["division"]) if rank.get("division") in DIVS else -1)


RECORD_DEFS = {
    "kills": ("Más kills", lambda v: f"{js_str(v)} kills"),
    "assists": ("Más asistencias", lambda v: f"{js_str(v)} asistencias"),
    "damage": ("Más daño a campeones", lambda v: f"{k1(v)} de daño"),
    "vision": ("Más visión", lambda v: f"{js_str(v)} de visión"),
    "longestWin": ("Victoria más larga", lambda v: mmss(v)),
    "kda": ("Mejor KDA", lambda v: f"{js_str(v).replace('.', ',', 1)} de KDA"),
    "kp": ("Mayor participación", lambda v: f"{js_str(v)}% de participación"),
    "towers": ("Más daño a torres", lambda v: f"{k1(v)} a torres"),
    "gold": ("Más oro", lambda v: f"{k1(v)} de oro"),
    "csMin": ("Mejor CS/min", lambda v: f"{js_str(v).replace('.', ',', 1)} CS/min"),
    "q": ('Más "?" en una partida', lambda v: f'{js_str(v)} pings de "?"'),
}

STREAK_STEPS = [5, 7, 10, 15, 20]
GAME_MILESTONES = [100, 200, 300, 500, 750, 1000, 1500, 2000]
GAME_EVENT_MAX_AGE = 12 * 3600e3
MAX_EVENTS = 12


def main_acc(p):
    if not p or not p.get("accounts"):
        return None
    accs = p["accounts"]
    i = p.get("bestAccount")
    if isinstance(i, int) and 0 <= i < len(accs) and accs[i]:
        return accs[i]
    return accs[0] if accs else None


def acc_key(a):
    if not a:
        return None
    if a.get("key") is not None:
        return a["key"]
    return a["riotId"].lower() if a.get("riotId") else None


def _last(xs):
    return xs[-1] if xs else None


def detect_events(prev_players, players, ctx):
    now = ctx.get("now")
    events = []
    prev_by_name = {p["name"]: p for p in (prev_players or [])}

    def complete(p):
        st = (main_acc(p) or {}).get("stats")
        return not st or ((st.get("conduct") or {}).get("games") or 0) >= st["games"] * 0.97

    pings_complete = all(complete(p) for p in (prev_players or []))
    group_best = {}
    for p in prev_players or []:
        recs = ((main_acc(p) or {}).get("stats") or {}).get("gameRecords") or {}
        for key, g in recs.items():
            if g and (key not in group_best or g["val"] > group_best[key]["val"]):
                group_best[key] = {**g, "name": p["name"]}

    for p in players:
        prev_p = prev_by_name.get(p["name"])
        a, b = main_acc(p), main_acc(prev_p)
        if not a or not b or not b.get("stats") or a.get("error"):
            continue
        key = acc_key(a)
        base = {"name": p["name"], "key": key}

        s0, s1 = step(b.get("rank")), step(a.get("rank"))
        if s0 is None and s1 is not None:
            events.append({**base, "type": "placed", "t": now, "tier": a["rank"]["tier"], "to": rank_label(a["rank"])})
        elif s0 is not None and s1 is not None and s0 != s1:
            up = s1 > s0
            tier_change = a["rank"]["tier"] != b["rank"]["tier"]
            pb = (ctx.get("peakBefore") or {}).get(key)
            sc = rank_score(a["rank"])
            peak = bool(up and pb is not None and sc > pb and math.floor(sc / 100) > math.floor(pb / 100))
            events.append({**base, "type": "up" if up else "down", "t": now, "tier": a["rank"]["tier"], "tierChange": tier_change,
                           "peak": peak, "from": rank_label(b["rank"]), "to": rank_label(a["rank"]), "lp": a["rank"]["lp"]})

        g0 = b["rank"]["wins"] + b["rank"]["losses"] if b.get("rank") else 0
        g1 = a["rank"]["wins"] + a["rank"]["losses"] if a.get("rank") else 0
        ms = _last([m for m in GAME_MILESTONES if g0 < m <= g1])
        if ms:
            events.append({**base, "type": "games", "t": now, "n": ms})

        fresh = [g for g in ((ctx.get("newGames") or {}).get(key) or []) if now - g["t"] < GAME_EVENT_MAX_AGE]
        if not fresh:
            continue

        for g in fresh:
            typ = "penta" if g.get("penta") else "quadra" if g.get("quadra") else None
            if typ:
                events.append({**base, "type": typ, "t": g["t"], "gameId": g["id"], "champ": g["champ"],
                               "k": g["k"], "d": g["d"], "a": g["a"], "win": g["win"]})

        c0 = (b["stats"].get("streak") or {}).get("current") or {}
        c1 = ((a.get("stats") or {}).get("streak") or {}).get("current") or {}
        if c1.get("type") and c1.get("count"):
            before = c0.get("count") if c0.get("type") == c1["type"] else 0
            hit = _last([x for x in STREAK_STEPS if before < x <= c1["count"]])
            if hit:
                events.append({**base, "type": "streak", "t": fresh[0]["t"], "kind": c1["type"], "n": c1["count"]})
            if c0.get("type") and c0["type"] != c1["type"] and c0["count"] >= 5:
                events.append({**base, "type": "streakEnd", "t": fresh[0]["t"], "kind": c0["type"], "n": c0["count"]})

        fresh_ids = {g["id"] for g in fresh}
        for rk, g in ((a.get("stats") or {}).get("gameRecords") or {}).items():
            prev = group_best.get(rk)
            if not g or g["id"] not in fresh_ids or rk not in RECORD_DEFS or (rk == "q" and not pings_complete):
                continue
            if prev and g["val"] <= prev["val"]:
                continue
            events.append({**base, "type": "record", "t": g["t"], "gameId": g["id"], "rec": rk, "val": g["val"], "champ": g["champ"],
                           "k": g["k"], "d": g["d"], "a": g["a"], "win": g["win"],
                           "prevName": prev["name"] if prev else None, "prevVal": prev["val"] if prev else None})
            group_best[rk] = {**g, "name": p["name"]}

    for e in events:
        mid = e.get("gameId")
        if mid is None:
            mid = e.get("to")
        if mid is None:
            mid = e.get("n")
        if mid is None:
            mid = ""
        e["id"] = f"{e['type']}:{e['key']}:{js_str(mid)}:{'' if e.get('gameId') else math.floor(e['t'] / 60000)}"
        e["text"] = event_text(e)
    return sorted(events, key=lambda x: x["t"])[-MAX_EVENTS:]


def event_text(e):
    t = e["type"]
    n = js_str(e.get("n"))
    if t == "placed":
        return f"🆕 {e['name']} se clasifica en {e['to']}"
    if t == "up":
        return f"🎉 {e['name']} asciende a {e['to']}" if e.get("tierChange") else f"⬆️ {e['name']} sube a {e['to']}"
    if t == "down":
        return f"😬 {e['name']} desciende a {e['to']}" if e.get("tierChange") else f"⬇️ {e['name']} baja a {e['to']}"
    if t == "games":
        return f"🎮 {e['name']} llega a {n} partidas esta temporada"
    if t == "penta":
        return f"🖐️ ¡Pentakill de {e['name']} con {e['champ']}!"
    if t == "quadra":
        return f"✋ Cuádruple de {e['name']} con {e['champ']}"
    if t == "streak":
        return f"🔥 {e['name']} lleva {n} victorias seguidas" if e["kind"] == "W" else f"🧊 {e['name']} lleva {n} derrotas seguidas"
    if t == "streakEnd":
        return (f"✂️ Se acaba la racha de {n} victorias de {e['name']}" if e["kind"] == "W"
                else f"🌤️ {e['name']} corta su racha de {n} derrotas")
    if t == "record":
        d = RECORD_DEFS.get(e["rec"])
        return f"🏆 Nuevo récord del grupo ({d[0] if d else e['rec']}): {e['name']}, {d[1](e['val']) if d else js_str(e['val'])}"
    if t == "challengeStart":
        return f"🏁 Empieza el reto «{e['title']}»"
    if t == "challengeEnd":
        w = e.get("winners") or []
        if w:
            return f"🏆 {' y '.join(w)} gana{'n' if len(w) > 1 else ''} el reto «{e['title']}»"
        return f"🏁 Termina el reto «{e['title']}»"
    return t


def event_embed(e, dd_version=None):
    kda = f"{e['champ']} · {e['k']}/{e['d']}/{e['a']} · {'victoria' if e['win'] else 'derrota'}" if e.get("k") is not None else None
    base = {"title": e["text"], "url": match_link(e["gameId"]) if e.get("gameId") else f"{config.SITE}#novedades", "timestamp": iso(e["t"])}
    t = e["type"]
    thumb = champ_url(dd_version, e.get("champ"))
    if t == "placed":
        return {**base, "color": TIER_COLOR.get(e["tier"], COLOR["accent"]), "thumbnail": {"url": crest_url(e["tier"])}}
    if t in ("up", "down"):
        lines = [f"Viene de {e['from']}" + (f" · ahora con {e['lp']} LP" if e.get("lp") is not None else "")]
        if e.get("peak"):
            lines.append("🏔️ Su mejor elo desde que la web lo registra")
        return {**base, "description": "\n".join(lines),
                "color": TIER_COLOR.get(e["tier"], COLOR["win"]) if t == "up" else COLOR["loss"], "thumbnail": {"url": crest_url(e["tier"])}}
    if t == "games":
        return {**base, "color": COLOR["accent"]}
    if t in ("penta", "quadra"):
        out = {**base, "description": kda, "color": COLOR["gold"]}
        if thumb:
            out["thumbnail"] = {"url": thumb}
        return out
    if t == "streak":
        return {**base, "description": "Que no pare 🚀" if e["kind"] == "W" else "Igual toca descansar un rato",
                "color": COLOR["win"] if e["kind"] == "W" else COLOR["loss"]}
    if t == "streakEnd":
        return {**base, "color": COLOR["loss"] if e["kind"] == "W" else COLOR["win"]}
    if t == "record":
        d = RECORD_DEFS.get(e["rec"])
        prev = f"Antes: {e['prevName']}, {d[1](e['prevVal']) if d else js_str(e['prevVal'])}" if e.get("prevName") else None
        out = {**base, "description": "\n".join(x for x in [kda, prev] if x), "color": COLOR["accent"]}
        if thumb:
            out["thumbnail"] = {"url": thumb}
        return out
    out = {**base, "color": COLOR["neutral"]}
    if e.get("desc") is not None:
        out["description"] = e["desc"]
    return out


def welcome_embed():
    return {
        "title": "✅ Avisos de SoloQ Crew activados",
        "url": config.SITE,
        "color": COLOR["accent"],
        "description": "\n".join([
            "A partir de ahora este canal recibe:",
            "• ⬆️⬇️ Subidas y bajadas de división o liga",
            "• 🖐️ Pentakills, 🔥 rachas de 5+ victorias o derrotas y 🏆 récords del grupo",
            "• 📊 Cada lunes, el resumen de la semana",
            "",
            f"Todo lo demás, en {config.SITE}",
        ]),
    }
