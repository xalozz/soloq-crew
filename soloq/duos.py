"""Partidas de dos miembros del grupo juntos (mismo equipo) o enfrentados (port de duos.mjs)."""

from .js import fixed_num, jround, pct, sort_cmp, orz

RECENT_TOGETHER = 12
DEFAULT_LP = {"win": 25, "loss": -25}


def compute_duos(entries):
    by_id = []
    for e in entries:
        m = {}
        for g in e["games"]:
            m[g["id"]] = g
        by_id.append(m)
    duos, rivals = [], []
    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            together, against = [], []
            for gid, g in by_id[i].items():
                o = by_id[j].get(gid)
                if not o:
                    continue
                (together if o["win"] == g["win"] else against).append((g, o))
            if together:
                duos.append(duo_stats(entries[i], entries[j], together, by_id[i], by_id[j]))
            if against:
                rivals.append(rival_stats(entries[i], entries[j], against))
    duos = sort_cmp(duos, lambda a, b: orz(b["games"] - a["games"], b["wr"] - a["wr"]))
    rivals = sort_cmp(rivals, lambda a, b: b["games"] - a["games"])
    return {"duos": duos, "rivals": rivals}


def lp_of(entry, g):
    x = (entry.get("lpMap") or {}).get(g["id"])
    if x and x["n"] == 1:
        return {"lp": x["d"], "exact": True}
    avg = entry.get("lpAvg") or {}
    if g["win"]:
        v = avg.get("win") if avg.get("win") is not None else DEFAULT_LP["win"]
    else:
        v = avg.get("loss") if avg.get("loss") is not None else DEFAULT_LP["loss"]
    return {"lp": v, "exact": False}


def side(entry, pairs, idx, all_games, together_ids):
    lp = est = k = d = a = 0
    champs = {}
    for pair in pairs:
        g = pair[idx]
        r = lp_of(entry, g)
        lp += r["lp"]
        if not r["exact"]:
            est += 1
        k += g["k"]
        d += g["d"]
        a += g["a"]
        champs[g["champ"]] = champs.get(g["champ"], 0) + 1
    n = len(pairs)
    ow = on = 0
    for g in all_games.values():
        if g["id"] not in together_ids:
            on += 1
            if g["win"]:
                ow += 1
    top = [[c, c2] for c, c2 in sorted(champs.items(), key=lambda x: -x[1])[:3]]
    return {
        "name": entry["name"],
        "lp": jround(lp), "lpEst": est,
        "kda": {"k": fixed_num(k / n, 1), "d": fixed_num(d / n, 1), "a": fixed_num(a / n, 1), "ratio": fixed_num((k + a) / max(1, d), 2)},
        "wrWithout": pct(ow, on), "gamesWithout": on,
        "champs": top,
    }


def duo_stats(A, B, pairs, all_a, all_b):
    ids = {g["id"] for g, _ in pairs}
    wins = sum(1 for g, _ in pairs if g["win"])
    streak = 0
    for g, _ in pairs:
        if g["win"] == pairs[0][0]["win"]:
            streak += 1
        else:
            break
    best_w = best_l = cw = cl = 0
    for g, _ in reversed(pairs):
        if g["win"]:
            cw += 1
            cl = 0
        else:
            cl += 1
            cw = 0
        best_w, best_l = max(best_w, cw), max(best_l, cl)
    dur = sum(g["dur"] for g, _ in pairs)

    def lp_exact(x):
        return x["lp"] if x["exact"] else None

    return {
        "a": A["name"], "b": B["name"],
        "games": len(pairs), "wins": wins, "losses": len(pairs) - wins, "wr": pct(wins, len(pairs)),
        "streak": {"win": pairs[0][0]["win"], "n": streak},
        "bestWin": best_w, "bestLoss": best_l,
        "first": pairs[-1][0]["t"], "last": pairs[0][0]["t"],
        "hours": jround(dur / 360) / 10,
        "sides": [side(A, pairs, 0, all_a, ids), side(B, pairs, 1, all_b, ids)],
        "recent": [{
            "id": g["id"], "t": g["t"], "win": g["win"],
            "c": [g["champ"], o["champ"]], "kda": [[g["k"], g["d"], g["a"]], [o["k"], o["d"], o["a"]]],
            "lp": [lp_exact(lp_of(A, g)), lp_exact(lp_of(B, o))],
        } for g, o in pairs[:RECENT_TOGETHER]],
    }


def rival_stats(A, B, pairs):
    a_wins = sum(1 for g, _ in pairs if g["win"])
    return {
        "a": A["name"], "b": B["name"], "games": len(pairs), "aWins": a_wins, "bWins": len(pairs) - a_wins,
        "recent": [{"id": g["id"], "t": g["t"], "aWin": g["win"], "c": [g["champ"], o["champ"]],
                    "kda": [[g["k"], g["d"], g["a"]], [o["k"], o["d"], o["a"]]]} for g, o in pairs[:RECENT_TOGETHER]],
    }
