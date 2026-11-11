"""Flex (cola 440) y Clash (cola 700): historial propio por cuenta y partidas en grupo (port de flex.mjs)."""

import logging

from .js import pct, sort_cmp, orz
from .riot import compact_match, is_key_error

log = logging.getLogger("soloq")

QUEUE_FLEX = 440
QUEUE_CLASH = 700
FLEX_CAP = 400


def update_flex_history(riot, region, puuid, store, dd, budget):
    stored = store.read_flex(puuid)
    games = stored.get("games") or []
    skipped = list(dict.fromkeys(stored.get("skipped") or []))
    skipped_set = set(skipped)
    have = {g["id"] for g in games}
    ids = []
    for queue, count in ((QUEUE_FLEX, 40), (QUEUE_CLASH, 10)):
        try:
            ids += riot.match_ids(region, puuid, {"queue": queue, "count": count})
        except Exception as err:
            if is_key_error(err):
                raise
            log.warning("  ! ids cola %s: %s", queue, err)
    todo = [i for i in ids if i not in have and i not in skipped_set][:max(0, budget["flex"])]
    budget["flex"] -= len(todo)
    for mid in todo:
        try:
            rec = compact_match(riot.match(region, mid), puuid, dd, None)
            if rec:
                games.append(rec)
            elif mid not in skipped_set:
                skipped.append(mid)
                skipped_set.add(mid)
        except Exception as err:
            if is_key_error(err):
                raise
            log.warning("  ! partida flex %s: %s", mid, err)
    games.sort(key=lambda g: -g["t"])
    del games[FLEX_CAP:]
    if todo or not isinstance(stored.get("games"), list):
        store.write_flex(puuid, {"games": games, "skipped": skipped[-500:]})
    if todo:
        log.info("  flex/clash: %d partidas nuevas", len(todo))
    return games


def flex_group_stats(entries):
    players = []
    for e in entries:
        flex = [g for g in e["games"] if g.get("q") == QUEUE_FLEX]
        wins = sum(1 for g in flex if g["win"])
        roles = {}
        for g in flex:
            if g.get("role"):
                roles[g["role"]] = roles.get(g["role"], 0) + 1
        champs = {}
        for g in flex:
            champs[g["champ"]] = champs.get(g["champ"], 0) + 1
        players.append({
            "name": e["name"], "rank": e.get("flexRank"),
            "games": len(flex), "wins": wins, "winrate": pct(wins, len(flex)),
            "clash": sum(1 for g in e["games"] if g.get("q") == QUEUE_CLASH),
            "roles": roles,
            "champs": [list(x) for x in sorted(champs.items(), key=lambda kv: -kv[1])[:3]],
        })

    by_game = {}
    for e in entries:
        for g in e["games"]:
            x = by_game.get(g["id"]) or {"id": g["id"], "t": g["t"], "q": g.get("q"), "dur": g["dur"], "teams": {}}
            team = x["teams"].setdefault(g["win"], [])
            team.append({"name": e["name"], "champ": g["champ"], "role": g.get("role"), "k": g["k"], "d": g["d"], "a": g["a"]})
            by_game[g["id"]] = x
    lineups = {}
    group = []
    for x in by_game.values():
        for win, team in x["teams"].items():
            if len(team) < 2:
                continue
            names = sorted(m["name"] for m in team)
            key = "|".join(names)
            l = lineups.get(key) or {"names": names, "n": 0, "w": 0, "last": 0, "flex": 0, "clash": 0}
            l["n"] += 1
            if win:
                l["w"] += 1
            l["last"] = max(l["last"], x["t"])
            if x["q"] == QUEUE_CLASH:
                l["clash"] += 1
            else:
                l["flex"] += 1
            lineups[key] = l
            group.append({"id": x["id"], "t": x["t"], "q": x["q"], "dur": x["dur"], "win": win, "members": team})
    group.sort(key=lambda g: -g["t"])
    return {
        "players": [p for p in players if p["rank"] or p["games"] or p["clash"]],
        "lineups": sort_cmp([{**l, "wr": pct(l["w"], l["n"])} for l in lineups.values()],
                            lambda a, b: orz(len(b["names"]) - len(a["names"]), b["n"] - a["n"])),
        "recent": [g for g in group if g["q"] == QUEUE_FLEX][:20],
        "clash": [g for g in group if g["q"] == QUEUE_CLASH][:30],
    }
