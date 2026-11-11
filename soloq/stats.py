"""Estadísticas a partir del historial compacto de partidas (port de scripts/stats.mjs).

`history` siempre va ordenado de más reciente a más antiguo.
"""

from .js import INF, jround, pct, r1, r2, reduce_first, sort_cmp, orz
from .tiempo import TZ, madrid_day_str
from datetime import datetime
import math

TIER_ORDER = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"]
DIVISION_ORDER = {"IV": 0, "III": 1, "II": 2, "I": 3}
APEX = {"MASTER", "GRANDMASTER", "CHALLENGER"}


def rank_score(rank):
    """Puntuación para ordenar rangos: cada división = 100 LP."""
    if not rank or not rank.get("tier"):
        return -1
    if rank["tier"] not in TIER_ORDER:
        return -1
    tier = TIER_ORDER.index(rank["tier"])
    if rank["tier"] in APEX:
        return 2800 + rank["lp"]
    div = DIVISION_ORDER.get(rank.get("division"), 0)
    return tier * 400 + div * 100 + rank["lp"]


MIN_GAMES_GROUP = 3


def kda(k, d, a):
    return (k + a) / max(1, d)


def first_of_day(history):
    first = {}
    for g in history:
        k = madrid_day_str(g["t"])
        if k not in first or g["t"] < first[k]["t"]:
            first[k] = g
    days = list(first.values())
    wins = sum(1 for g in days if g["win"])
    rest = len(history) - len(days)
    rest_w = sum(1 for g in history if g["win"]) - wins
    return {"games": len(days), "wins": wins, "winrate": pct(wins, len(days)), "restWinrate": pct(rest_w, rest)}


def streaks(history):
    current = {"type": None, "count": 0}
    if history:
        typ = "W" if history[0]["win"] else "L"
        count = 0
        for g in history:
            if ("W" if g["win"] else "L") != typ:
                break
            count += 1
        current = {"type": typ, "count": count}
    best_win = worst_loss = run_w = run_l = 0
    for g in reversed(history):
        if g["win"]:
            run_w += 1
            run_l = 0
        else:
            run_l += 1
            run_w = 0
        best_win = max(best_win, run_w)
        worst_loss = max(worst_loss, run_l)
    return {"current": current, "bestWin": best_win, "worstLoss": worst_loss}


def group_by(history, key_fn):
    m = {}
    for g in history:
        key = key_fn(g)
        if not key:
            continue
        e = m.get(key) or {"key": key, "games": 0, "wins": 0, "k": 0, "d": 0, "a": 0}
        e["games"] += 1
        if g["win"]:
            e["wins"] += 1
        e["k"] += g["k"]
        e["d"] += g["d"]
        e["a"] += g["a"]
        m[key] = e
    return [{"key": e["key"], "games": e["games"], "wins": e["wins"], "winrate": pct(e["wins"], e["games"]),
             "kda": r2(kda(e["k"], e["d"], e["a"]))} for e in m.values()]


def best_worst(groups):
    q = [g for g in groups if g["games"] >= MIN_GAMES_GROUP]
    if len(q) < 2:
        return {"best": q[0] if q else None, "worst": None}
    s = sort_cmp(q, lambda x, y: orz(y["winrate"] - x["winrate"], y["games"] - x["games"], y["kda"] - x["kda"]))
    return {"best": s[0], "worst": s[-1]}


def game_brief(g):
    return {"id": g["id"], "t": g["t"], "dur": g["dur"], "champ": g["champ"], "role": g.get("role"),
            "k": g["k"], "d": g["d"], "a": g["a"], "win": g["win"], "kda": r2(kda(g["k"], g["d"], g["a"]))}


def compute_account_stats(history):
    n = len(history)
    if not n:
        return None
    wins = sum(1 for g in history if g["win"])

    def total(f):
        s = 0
        for g in history:
            s += f(g)
        return s

    K, D, A = total(lambda g: g["k"]), total(lambda g: g["d"]), total(lambda g: g["a"])
    minutes = total(lambda g: g["dur"]) / 60
    team_dmg = total(lambda g: g.get("teamDmg") or 0)

    champs = sort_cmp(group_by(history, lambda g: g["champ"]), lambda a, b: b["games"] - a["games"])
    roles = group_by(history, lambda g: g.get("role"))
    cw = best_worst(champs)
    rw = best_worst(roles)

    pool = [g for g in history if g["dur"] >= 600]
    with_kda = [{"g": g, "v": kda(g["k"], g["d"], g["a"])} for g in (pool or history)]
    best_game = reduce_first(with_kda, lambda m, x: x if (x["v"] > m["v"] or (x["v"] == m["v"] and x["g"]["k"] > m["g"]["k"])) else m)
    worst_pool = [x for x in with_kda if x["g"]["d"] >= 5]
    worst_game = reduce_first(worst_pool or with_kda,
                              lambda m, x: x if (x["v"] < m["v"] or (x["v"] == m["v"] and x["g"]["d"] > m["g"]["d"])) else m)

    def wr_last(cnt):
        s = history[:cnt]
        w = sum(1 for g in s if g["win"])
        return {"games": len(s), "wins": w, "losses": len(s) - w, "winrate": pct(w, len(s))}

    roles_sorted = sort_cmp(roles, lambda a, b: b["games"] - a["games"])
    main_role = roles_sorted[0]["key"] if roles_sorted else None

    with_kp = [g for g in history if g.get("kp") is not None]

    def champ_row(c):
        games = [g for g in history if g["champ"] == c["key"]]
        mins = sum(g["dur"] for g in games) / 60
        return {**c, "csPerMin": r1(sum(g["cs"] for g in games) / max(1, mins))}

    return {
        "games": n,
        "wins": wins,
        "losses": n - wins,
        "winrate": pct(wins, n),
        "avgK": r1(K / n), "avgD": r1(D / n), "avgA": r1(A / n),
        "kda": r2(kda(K, D, A)),
        "csPerMin": r1(total(lambda g: g["cs"]) / max(1, minutes)),
        "visPerMin": r2(total(lambda g: g["vis"]) / max(1, minutes)),
        "dmgShare": jround((total(lambda g: g["dmg"]) / team_dmg) * 1000) / 10 if team_dmg else None,
        "avgDurationMin": r1(minutes / n),
        "streak": streaks(history),
        "firstOfDay": first_of_day(history),
        "form": ["W" if g["win"] else "L" for g in history[:10]],
        "trend": [1 if g["win"] else 0 for g in reversed(history[:20])],
        "mainRole": main_role,
        "last10": wr_last(10),
        "last20": wr_last(20),
        "topChamps": champs[:5],
        "bestChamp": cw["best"],
        "worstChamp": cw["worst"],
        "bestRole": rw["best"],
        "worstRole": rw["worst"],
        "bestGame": game_brief(best_game["g"]),
        "worstGame": game_brief(worst_game["g"]),
        "firstGameAt": history[n - 1]["t"],
        "lastGameAt": history[0]["t"],
        "totals": {"k": K, "d": D, "a": A},
        "dmgPerMin": jround(total(lambda g: g["dmg"]) / max(1, minutes)),
        "avgVision": r1(total(lambda g: g["vis"]) / n),
        "pentas": total(lambda g: g.get("penta") or 0),
        "firstBloods": total(lambda g: 1 if g.get("fb") else 0),
        "maxKills": max(g["k"] for g in history),
        "maxDurationMin": r1(max(g["dur"] for g in history) / 60),
        "avgKp": jround(sum(g["kp"] for g in with_kp) / len(with_kp)) if with_kp else None,
        "champs": [champ_row(c) for c in champs],
        "roles": roles_sorted,
        "gold": gold_stats(history),
        "byRole": role_breakdown(history),
        "awards": award_stats(history),
        "gameRecords": game_records(history),
        "tilt": tilt_stats(history),
        "vs": vs_champs(history),
        "conduct": conduct_stats(history),
    }


FF_EARLY_S = 20 * 60


def conduct_stats(history):
    g = [x for x in history if x.get("pg")]
    if not g:
        return None
    n = len(g)

    def avg(f):
        s = 0
        for x in g:
            s += f(x) or 0
        return r2(s / n)

    losses = [x for x in g if not x["win"]]
    wins = [x for x in g if x["win"]]
    ff_l = [x for x in losses if x.get("ff")]
    ff_w = [x for x in wins if x.get("ff")]
    max_q = None
    for x in g:
        if x["pg"]["q"] > (max_q["pg"]["q"] if max_q else 0):
            max_q = x
    return {
        "games": n,
        "pings": r1(sum(x["pg"]["t"] for x in g) / n),
        "q": avg(lambda x: x["pg"]["q"]),
        "allIn": avg(lambda x: x["pg"]["ai"]),
        "back": avg(lambda x: x["pg"]["gb"]),
        "bait": avg(lambda x: x["pg"]["ba"]),
        "danger": avg(lambda x: x["pg"]["dg"]),
        "omw": avg(lambda x: x["pg"]["ow"]),
        "maxQ": {**game_brief(max_q), "val": max_q["pg"]["q"]} if max_q else None,
        "losses": len(losses),
        "ffLosses": len(ff_l),
        "ffPct": pct(len(ff_l), len(losses)),
        "ffEarly": sum(1 for x in ff_l if x["dur"] < FF_EARLY_S),
        "ffAvgMin": r1(sum(x["dur"] for x in ff_l) / len(ff_l) / 60) if ff_l else None,
        "wins": len(wins),
        "ffWins": len(ff_w),
        "ffWinPct": pct(len(ff_w), len(wins)),
    }


def hour_dow(t):
    dt = datetime.fromtimestamp(math.floor(t / 1000), TZ)
    return dt.hour, dt.weekday()


SESSION_GAP_MS = 40 * 60e3


def tilt_stats(history):
    if len(history) < 10:
        return None
    asc = sorted(history, key=lambda g: g["t"])

    def z(n):
        return [[0, 0] for _ in range(n)]

    out = {"hour": z(24), "dow": z(7), "grid": z(42), "session": z(6), "prev": z(8), "hoursIn": z(4), "sessions": 0}

    def add(cell, win):
        if win:
            cell[0] += 1
        cell[1] += 1

    prev_end, sess_start, idx, run_w, run_l = -INF, 0, 0, 0, 0
    for g in asc:
        start = g["t"] - (g.get("dur") or 0) * 1000
        if start - prev_end > SESSION_GAP_MS:
            out["sessions"] += 1
            sess_start, idx, run_w, run_l = start, 0, 0, 0
        idx += 1
        hh, wd = hour_dow(start)
        add(out["hour"][hh], g["win"])
        add(out["dow"][wd], g["win"])
        add(out["grid"][wd * 6 + hh // 4], g["win"])
        add(out["session"][min(idx, 6) - 1], g["win"])
        prev_idx = 3 if idx == 1 else (3 - min(run_w, 3) if run_w else 3 + min(run_l, 4))
        add(out["prev"][prev_idx], g["win"])
        add(out["hoursIn"][min(3, math.floor((start - sess_start) / 3600e3))], g["win"])
        if g["win"]:
            run_w += 1
            run_l = 0
        else:
            run_l += 1
            run_w = 0
        prev_end = g["t"]
    return out


def vs_champs(history):
    m = {}
    for g in history:
        c = (g.get("opp") or {}).get("champ")
        if not c:
            continue
        e = m.setdefault(c, [0, 0])
        e[0] += 1
        if g["win"]:
            e[1] += 1
    return m


def award_stats(history):
    if not history:
        return None
    champs = group_by(history, lambda g: g["champ"])
    one_trick = None
    for c in champs:
        if not one_trick or c["wins"] > one_trick["wins"] or (c["wins"] == one_trick["wins"] and c["games"] < one_trick["games"]):
            one_trick = c
    main = None
    for c in champs:
        if c["games"] >= 30 and (not main or c["winrate"] > main["winrate"]):
            main = c

    def lane(r):
        return "SOLO" if r in ("TOP", "MIDDLE") else r

    lane_count = {}
    for g in history:
        if g.get("role"):
            lane_count[lane(g["role"])] = lane_count.get(lane(g["role"]), 0) + 1
    lc = sorted(lane_count.items(), key=lambda kv: -kv[1])
    main_lane = lc[0][0] if lc else None
    off = [g for g in history if g.get("role") and lane(g["role"]) != main_lane]
    off_w = sum(1 for g in off if g["win"])
    run = best_run = 0
    for g in reversed(history):
        if kda(g["k"], g["d"], g["a"]) >= 5:
            run += 1
            best_run = max(best_run, run)
        else:
            run = 0
    s = 0
    for g in history:
        s += kda(g["k"], g["d"], g["a"])
    per_game_kda = s / len(history)
    with_full = [g for g in history if g.get("quadra") is not None]
    return {
        "oneTrick": {"champ": one_trick["key"], "wins": one_trick["wins"], "games": one_trick["games"]} if one_trick else None,
        "mainChar": {"champ": main["key"], "winrate": main["winrate"], "games": main["games"]} if main else None,
        "autofill": {"lane": main_lane, "games": len(off), "wins": off_w, "winrate": pct(off_w, len(off))},
        "champPool": len({g["champ"] for g in history if g["win"]}),
        "kdaStreak": best_run,
        "avgKda": r2(per_game_kda),
        "pentas": sum(g.get("penta") or 0 for g in history),
        "quadras": sum(g.get("quadra") or 0 for g in with_full),
        "quadraGames": len(with_full),
        "firstBloods": sum(1 for g in history if g.get("fb")),
    }


def game_records(history):
    long = [g for g in history if g["dur"] >= 600]

    def best(arr, f):
        x = None
        for g in arr:
            v = f(g)
            if v is not None and (x is None or v > f(x)):
                x = g
        return {**game_brief(x), "val": f(x)} if x else None

    out = {
        "kills": best(long, lambda g: g["k"]),
        "assists": best(long, lambda g: g["a"]),
        "damage": best(long, lambda g: g["dmg"]),
        "vision": best(long, lambda g: g["vis"]),
        "longestWin": best([g for g in history if g["win"]], lambda g: g["dur"]),
        "kda": best(long, lambda g: r2(kda(g["k"], g["d"], g["a"]))),
        "kp": best([g for g in long if g.get("kp") is not None and g["k"] + g["a"] >= 15], lambda g: g["kp"]),
        "towers": best([g for g in long if g.get("towerDmg") is not None], lambda g: g["towerDmg"]),
        "gold": best([g for g in long if g.get("goldEarned") is not None], lambda g: g["goldEarned"]),
        "csMin": best([g for g in history if g["dur"] >= 900], lambda g: r1(g["cs"] / (g["dur"] / 60))),
        "q": best([g for g in history if (g.get("pg") or {}).get("q")], lambda g: g["pg"]["q"]),
    }
    return {k: v for k, v in out.items() if v}


def role_breakdown(history):
    out = {}
    for role in ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]:
        games = [g for g in history if g.get("role") == role]
        if not games:
            continue
        wins = sum(1 for g in games if g["win"])
        K = sum(g["k"] for g in games)
        D = sum(g["d"] for g in games)
        A = sum(g["a"] for g in games)
        gd = [g for g in games if (g.get("gold") or {}).get("gd15") is not None]
        out[role] = {
            "games": len(games), "wins": wins, "winrate": pct(wins, len(games)), "kda": r2(kda(K, D, A)),
            "gd15": jround(sum(g["gold"]["gd15"] for g in gd) / len(gd)) if gd else None,
            "champs": sort_cmp(group_by(games, lambda g: g["champ"]), lambda a, b: b["games"] - a["games"])[:6],
        }
    return out


THROW_MIN = 3000


def gold_stats(history):
    g = [x for x in history if x.get("gold")]
    if not g:
        return None

    def brief(x, val):
        return {**game_brief(x), "val": val, "dur": x["dur"], "min": x["gold"]["maxLeadMin"]} if x else None

    def by(arr, f, d=1):
        if not arr:
            return None
        return reduce_first(arr, lambda m, x: x if d * (f(x) - f(m)) > 0 else m)

    losses = [x for x in g if not x["win"]]
    wins = [x for x in g if x["win"]]
    with15 = [x for x in g if x["gold"].get("gd15") is not None]
    throw_g = by(losses, lambda x: x["gold"]["maxLead"])
    comeback_g = by(wins, lambda x: x["gold"]["maxDef"], -1)
    lead_g = by(g, lambda x: x["gold"]["maxLead"])
    best15 = by(with15, lambda x: x["gold"]["gd15"])
    worst15 = by(with15, lambda x: x["gold"]["gd15"], -1)
    t15 = [x for x in g if x["gold"].get("tgd15") is not None]
    acc = 0
    for x in t15:
        acc = acc + x["gold"]["tgd15"] / len(t15)
    return {
        "games": len(g),
        "avgGd15": jround(sum(x["gold"]["gd15"] for x in with15) / len(with15)) if with15 else None,
        "avgTgd15": jround(acc),
        "throws": sum(1 for x in losses if x["gold"]["maxLead"] >= THROW_MIN),
        "comebacks": sum(1 for x in wins if x["gold"]["maxDef"] <= -THROW_MIN),
        "biggestThrow": brief(throw_g, throw_g["gold"]["maxLead"]) if throw_g and throw_g["gold"]["maxLead"] > 0 else None,
        "biggestComeback": brief(comeback_g, comeback_g["gold"]["maxDef"]) if comeback_g and comeback_g["gold"]["maxDef"] < 0 else None,
        "biggestLead": brief(lead_g, lead_g["gold"]["maxLead"]) if lead_g else None,
        "best15": brief(best15, best15["gold"]["gd15"]) if best15 else None,
        "worst15": brief(worst15, worst15["gold"]["gd15"]) if worst15 else None,
    }


def pick_best_account(accounts):
    best, best_score = -1, -2
    for i, acc in enumerate(accounts):
        s = rank_score(acc.get("rank"))
        if s > best_score:
            best_score, best = s, i
    return {"index": best, "score": best_score}
