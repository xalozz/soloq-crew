"""Resumen semanal (lunes a domingo, hora de Madrid): web y mensaje de los lunes (port de weekly.mjs)."""

import math

from . import config
from .events import COLOR, match_link, score_label, signed
from .js import INF, js_str, jround, r1, reduce_first, sort_cmp, orz
from .tiempo import range_label, week_key

MAX_SAFE_INTEGER = 2**53 - 1


def kda_of(g):
    return (g["k"] + g["a"]) / max(1, g["d"])


def score_at(points, t, until):
    v = None
    for p in points:
        if p[0] < t:
            v = p[1]
        else:
            break
    if v is None:
        first = next((p for p in points if t <= p[0] < until), None)
        v = first[1] if first else None
    return v


def compute_week(entries, frm, to):
    until = INF if to is None else to
    players = []
    for e in entries:
        games = sorted((g for g in e["games"] if frm <= g["t"] < until), key=lambda g: g["t"])
        wins = sum(1 for g in games if g["win"])
        run_w = run_l = best_w = worst_l = 0
        for g in games:
            if g["win"]:
                run_w += 1
                run_l = 0
            else:
                run_l += 1
                run_w = 0
            best_w, worst_l = max(best_w, run_w), max(worst_l, run_l)
        s0 = score_at(e["points"], frm, until)
        s1 = score_at(e["points"], MAX_SAFE_INTEGER if until == INF else until, INF)
        long = [g for g in games if g["dur"] >= 600]
        best = reduce_first(long, lambda m, g: g if (kda_of(g) > kda_of(m) or (kda_of(g) == kda_of(m) and g["k"] > m["k"])) else m) if long else None

        def brief(g):
            return {"id": g["id"], "t": g["t"], "champ": g["champ"], "k": g["k"], "d": g["d"], "a": g["a"],
                    "win": g["win"], "kda": r1(kda_of(g))} if g else None

        if games and s0 is not None and s1 is not None:
            lp = s1 - s0
        elif games:
            lp = None
        else:
            lp = 0
        players.append({
            "name": e["name"],
            "games": len(games), "wins": wins, "losses": len(games) - wins,
            "hours": r1(sum(g.get("dur") or 0 for g in games) / 3600),
            "lp": lp,
            "start": s0, "end": s1,
            "bestW": best_w, "worstL": worst_l,
            "k": sum(g["k"] for g in games), "d": sum(g["d"] for g in games), "a": sum(g["a"] for g in games),
            "best": brief(best),
            "pentas": [brief(g) for g in games if g.get("penta")],
            "ffLosses": sum(1 for g in games if not g["win"] and g.get("ff")),
            "pingGames": sum(1 for g in games if g.get("pg")),
            "q": sum(((g.get("pg") or {}).get("q") or 0) for g in games),
            "ids": [[g["id"], g["win"]] for g in games],
        })

    duo = None
    for i in range(len(players)):
        mine = {}
        for gid, w in players[i]["ids"]:
            mine[gid] = w
        for j in range(i + 1, len(players)):
            shared = [x for x in players[j]["ids"] if x[0] in mine and mine[x[0]] == x[1]]
            if len(shared) >= 2 and (not duo or len(shared) > duo["games"]):
                duo = {"a": players[i]["name"], "b": players[j]["name"], "games": len(shared), "wins": sum(1 for x in shared if x[1])}
    for p in players:
        del p["ids"]

    active = [p for p in players if p["games"]]

    def pick(arr, f):
        return reduce_first(arr, lambda m, x: x if f(x) > f(m) else m) if arr else None

    with_lp = [p for p in active if p["lp"] is not None]
    mvp = pick(with_lp, lambda p: p["lp"] * 1000 + p["wins"])
    worst = pick(with_lp, lambda p: -p["lp"] * 1000 - p["losses"]) if len(with_lp) > 1 else None
    grinder = pick(active, lambda p: p["games"] * 1000 + p["hours"])
    hot = pick(active, lambda p: p["bestW"])
    cold = pick(active, lambda p: p["worstL"])
    gotw = pick([p for p in active if p["best"]], lambda p: p["best"]["kda"] * 100 + p["best"]["k"])
    coward = pick([p for p in active if p["ffLosses"] >= 2], lambda p: p["ffLosses"] * 1000 - p["losses"])
    q_king = pick([p for p in active if p["pingGames"] >= 3 and p["q"]], lambda p: p["q"] / p["pingGames"])

    def lp_key(p):
        return -1e9 if p["lp"] is None else p["lp"]

    hours = 0
    for p in active:
        hours += p["hours"]
    return {
        "key": week_key(frm), "from": frm, "to": to,
        "players": sort_cmp(players, lambda a, b: orz(lp_key(b) - lp_key(a), b["games"] - a["games"])),
        "totals": {"games": sum(p["games"] for p in active), "wins": sum(p["wins"] for p in active), "hours": r1(hours)},
        "mvp": mvp["name"] if mvp and mvp["lp"] > 0 else None,
        "worst": worst["name"] if worst and worst["lp"] < 0 else None,
        "grinder": grinder["name"] if grinder else None,
        "hot": {"name": hot["name"], "n": hot["bestW"]} if hot and hot["bestW"] >= 3 else None,
        "cold": {"name": cold["name"], "n": cold["worstL"]} if cold and cold["worstL"] >= 3 else None,
        "duo": duo,
        "gotw": {"name": gotw["name"], **gotw["best"]} if gotw else None,
        "pentas": [{"name": p["name"], **g} for p in active for g in p["pentas"]],
        "coward": {"name": coward["name"], "n": coward["ffLosses"], "of": coward["losses"]} if coward else None,
        "qKing": {"name": q_king["name"], "avg": r1(q_king["q"] / q_king["pingGames"]), "total": q_king["q"]} if q_king else None,
    }


def week_embed(w):
    by_name = {p["name"]: p for p in w["players"]}
    lines = []
    for i, p in enumerate(w["players"]):
        if not p["games"]:
            lines.append(f"{i + 1}. {p['name']} · no jugó")
            continue
        lp = "¿? LP" if p["lp"] is None else f"{signed(p['lp'])} LP"
        lines.append(f"{i + 1}. **{p['name']}** · {lp} · {p['wins']}V {p['losses']}D")
    fields = []

    def f(name, value):
        if value:
            fields.append({"name": name, "value": value, "inline": True})

    if w.get("mvp"):
        p = by_name[w["mvp"]]
        f("🏆 MVP", f"{p['name']} · {signed(p['lp'])} LP ({p['wins']}V {p['losses']}D)")
    if w.get("worst"):
        p = by_name[w["worst"]]
        f("📉 Peor semana", f"{p['name']} · {signed(p['lp'])} LP")
    if w.get("grinder"):
        p = by_name[w["grinder"]]
        f("🎮 Más viciado", f"{p['name']} · {p['games']} partidas ({js_str(p['hours']).replace('.', ',', 1)} h)")
    if w.get("hot"):
        f("🔥 Mejor racha", f"{w['hot']['name']} · {w['hot']['n']} victorias seguidas")
    if w.get("cold"):
        f("💀 Peor racha", f"{w['cold']['name']} · {w['cold']['n']} derrotas seguidas")
    if w.get("duo"):
        d = w["duo"]
        f("🤝 Dúo de la semana", f"{d['a']} & {d['b']} · {d['games']} partidas · {d['wins']}V {d['games'] - d['wins']}D")
    if w.get("gotw"):
        g = w["gotw"]
        f("⭐ Partida de la semana", f"{g['name']} · [{g['champ']} {g['k']}/{g['d']}/{g['a']}]({match_link(g['id'])})")
    if w.get("pentas"):
        f("🖐️ Pentakills", ", ".join(f"{g['name']} ({g['champ']})" for g in w["pentas"]))
    if w.get("coward"):
        c = w["coward"]
        f("🏳️ El más cobarde", f"{c['name']} · rendición en {c['n']} de sus {c['of']} derrotas")
    if w.get("qKing"):
        f('❓ El rey del "?"', f"{w['qKing']['name']} · {js_str(w['qKing']['avg']).replace('.', ',', 1)} por partida")
    moves = [f"{p['name']}: {score_label(p['start']).split(' · ')[0]} → {score_label(p['end']).split(' · ')[0]}"
             for p in w["players"]
             if p["games"] and p.get("start") is not None and p.get("end") is not None
             and math.floor(p["start"] / 100) != math.floor(p["end"] / 100)]
    if moves:
        fields.append({"name": "↕️ Cambios de división", "value": "\n".join(moves), "inline": False})
    tg = w["totals"]["games"]
    return {
        "title": f"📊 Resumen de la semana · {range_label(w['from'], w['to'])}",
        "url": f"{config.SITE}#semana",
        "color": COLOR["accent"],
        "description": "\n".join([
            f"{tg} partidas entre todos · {jround((w['totals']['wins'] / tg) * 100) if tg else 0} % de victorias · "
            f"{js_str(w['totals']['hours']).replace('.', ',', 1)} h jugadas",
            "",
            *lines,
        ]),
        "fields": fields,
        "footer": {"text": "SoloQ Crew · LP registrados en la web"},
    }


def compact_week(w):
    keys = ["name", "games", "wins", "losses", "lp", "hours", "start", "end", "bestW", "worstL", "k", "d", "a", "best", "ffLosses", "q", "pingGames"]
    return {
        "key": w["key"], "from": w["from"], "to": w["to"], "totals": w["totals"],
        "mvp": w["mvp"], "worst": w["worst"], "grinder": w["grinder"], "hot": w["hot"], "cold": w["cold"], "duo": w["duo"],
        "gotw": w["gotw"], "pentas": w["pentas"],
        "coward": w.get("coward"), "qKing": w.get("qKing"),
        "players": [{k: p.get(k) for k in keys} for p in w["players"]],
    }
