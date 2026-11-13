"""Una pasada del actualizador: consulta Riot y guarda todo en SQLite (port de scripts/update.mjs).

  python -m soloq.update            pasada completa
  python -m soloq.update --quick    pasada rápida (solo quien ha jugado)

Variables opcionales (las mismas que en Node):
  MATCH_COUNT       partidas recientes a pedir por cuenta (defecto 100, máx. 100)
  MIN_INTERVAL_MS   espaciado entre peticiones (defecto 1250 ms)
  BACKFILL_BUDGET   partidas antiguas a descargar por pasada completa (defecto 350)
  CONDUCT_BUDGET    partidas antiguas a completar con pings y rendiciones (defecto 120)
  DISCORD_WEBHOOK   si está, se avisa en Discord de los hitos y del resumen semanal
  RIOT_API_BASE     solo para pruebas con una API simulada
"""

import json
import logging
import math
import re
import sys
import time

import httpx

from . import config
from .challenges import challenge_embed, challenge_event, challenge_status, compute_challenges
from .discord import send_discord
from .duos import compute_duos
from .events import event_embed, detect_events, main_acc, welcome_embed
from .roasts import add_roasts, leader_of
from .flex import QUEUE_CLASH, flex_group_stats, update_flex_history
from .importer import hash_of
from .js import INF, dumps, jround
from .riot import (MATCH_RECORD_VERSION, Riot, RiotError, compact_match, conduct_of, ddragon_version, is_key_error,
                   load_data_dragon, match_detail, profile_links)
from .stats import compute_account_stats, pick_best_account, rank_score
from .store import Store
from .tiempo import iso, madrid_parts, week_key, week_start
from .weekly import compact_week, compute_week, week_embed

log = logging.getLogger("soloq")

DETAIL_RECENT = 20
DIRTY_MS = 12 * 60e3
LP_HIST_CAP = 3000
LP_HIST_PUBLISHED = 600
QUEUE_SOLO = 420
HISTORY_CAP = 3000
RECENT_PUBLISHED = 20
SEQ_PUBLISHED = 300
EVENTS_DAYS = 30
EVENTS_PUBLISHED = 200
EVENTS_CAP = 300
PENDING_MAX_AGE = 3 * 3600e3
WEEKLY_FROM_MIN = 9 * 60 + 45
DAY = 864e5

_UNDEF = object()


def key_of(acc):
    return acc["riotId"].lower()


def acc_key(a):
    if not a:
        return None
    if a.get("key") is not None:
        return a["key"]
    return a["riotId"].lower() if a.get("riotId") else None


def split_riot_id(riot_id):
    i = riot_id.rfind("#")
    if i < 1 or i == len(riot_id) - 1:
        raise ValueError(f'Riot ID inválido: "{riot_id}" (formato Nombre#TAG)')
    return riot_id[:i].strip(), riot_id[i + 1:].strip()


def rank_of(e):
    if not e:
        return None
    n = e["wins"] + e["losses"]
    return {"tier": e["tier"], "division": e["rank"], "lp": e["leaguePoints"], "wins": e["wins"], "losses": e["losses"],
            "winrate": jround((e["wins"] / n) * 1000) / 10 if n else 0, "hotStreak": bool(e.get("hotStreak"))}


def same_rank(r, e):
    if not r and not e:
        return True
    return bool(r and e and r["tier"] == e["tier"] and r["division"] == e["rank"] and r["lp"] == e["leaguePoints"]
                and r["wins"] == e["wins"] and r["losses"] == e["losses"])


def assign_lp(hist, games):
    """Cambio de LP de cada partida comparando las fotos del rango de antes y de después.
    Si entre dos fotos hubo varias partidas, todas reciben el cambio conjunto (n > 1)."""
    asc = sorted(games, key=lambda g: g["t"])
    out = {}
    used = set()
    for i in range(1, len(hist)):
        tA, sA = hist[i - 1][0], hist[i - 1][1]
        tB, sB = hist[i][0], hist[i][1]
        gA = hist[i - 1][2] if len(hist[i - 1]) > 2 else None
        gB = hist[i][2] if len(hist[i]) > 2 else None
        if gA is None or gB is None:
            continue
        dg = gB - gA
        if dg <= 0:
            continue
        cands = [g for g in asc if g["id"] not in used and g["t"] > tA - 15 * 60e3 and g["t"] <= tB + 60e3]
        if len(cands) < dg:
            continue
        for g in cands[-dg:]:
            used.add(g["id"])
            out[g["id"]] = {"d": sB - sA, "n": dg}
    return out


def lp_averages(games, lp_map):
    exact = [(g, lp_map[g["id"]]) for g in games if g["id"] in lp_map and lp_map[g["id"]]["n"] == 1]

    def avg(xs):
        if not xs:
            return None
        s = 0
        for _, lp in xs:
            s += lp["d"]
        return jround(s / len(xs))

    w = [x for x in exact if x[0]["win"]]
    l = [x for x in exact if not x[0]["win"]]
    return {"win": avg(w), "loss": avg(l), "winN": len(w), "lossN": len(l)}


def _strip(o):
    if isinstance(o, dict):
        return {k: _strip(v) for k, v in o.items() if k not in ("generatedAt", "updatedAt")}
    if isinstance(o, list):
        return [_strip(v) for v in o]
    return o


class Updater:
    def __init__(self, store, players_config, challenge_defs, riot=None, now=None, discord=None, http=None,
                 api_key=None, webhook=_UNDEF, env=None, roasts=True):
        self.store = store
        self.roasts = roasts
        self.config = players_config
        self.challenge_defs = challenge_defs
        self.now_fn = now or (lambda: int(time.time() * 1000))
        self.env = env if env is not None else {}
        self.http = http or httpx.Client(timeout=20)
        self.webhook = config.DISCORD_WEBHOOK if webhook is _UNDEF else webhook
        self.discord = discord or (lambda embeds: send_discord(embeds, url=self.webhook))
        self.riot = riot or Riot(api_key if api_key is not None else config.RIOT_API_KEY,
                                 min_interval_ms=self._num("MIN_INTERVAL_MS", 1250))
        self.status = {"v": 1, "at": 0, "ok": False, "full": False, "err": None, "msg": None, "live": None, "liveErr": None,
                       "accErr": [], "calls": 0}

    def _num(self, name, default):
        v = self.env.get(name)
        try:
            return float(v) if v not in (None, "") else default
        except ValueError:
            return default

    def now(self):
        return self.now_fn()

    # ---------------------------------------------------------------- una cuenta
    def update_account(self, acc, region, cache, dd, budget, prev=None, full=False, flex_changed=False):
        riot, store = self.riot, self.store
        cfg_name, cfg_tag = split_riot_id(acc["riotId"])
        cache_key = key_of(acc)
        puuid = (cache.get(cache_key) or {}).get("puuid")
        if not puuid:
            a = riot.account_by_riot_id(region, cfg_name, cfg_tag)
            puuid = a["puuid"]
            cache[cache_key] = {"puuid": puuid}

        game_name = prev.get("gameName") if prev and prev.get("gameName") is not None else cfg_name
        tag_line = prev.get("tagLine") if prev and prev.get("tagLine") is not None else cfg_tag
        if full:
            try:
                a = riot.account_by_puuid(region, puuid)
                if a and a.get("gameName") and a.get("tagLine"):
                    game_name, tag_line = a["gameName"], a["tagLine"]
            except Exception as err:
                if is_key_error(err):
                    raise
                log.warning("  ! nombre de %s: %s", acc["riotId"], err)

        summoner = riot.summoner_by_puuid(region, puuid)
        league_at = self.now()
        entries = riot.league_entries(region, puuid)
        solo = next((e for e in entries if e.get("queueType") == "RANKED_SOLO_5x5"), None)
        flex_entry = next((e for e in entries if e.get("queueType") == "RANKED_FLEX_SR"), None)

        stored = store.read_history(puuid)
        history = stored if isinstance(stored, list) else (stored.get("games") or [])
        had_history = len(history) > 0
        skipped = dict.fromkeys([] if isinstance(stored, list) else (stored.get("skipped") or []))
        season_complete = not isinstance(stored, list) and stored.get("seasonComplete") is True
        if any((g.get("v") or 0) < MATCH_RECORD_VERSION for g in history):
            season_complete = False
        season_games = solo["wins"] + solo["losses"] if solo else 0
        by_id = {}
        for g in history:
            by_id[g["id"]] = g

        def needs(mid):
            return mid not in skipped and ((by_id.get(mid) or {}).get("v") or 0) < MATCH_RECORD_VERSION

        match_count = min(100, int(self._num("MATCH_COUNT", 100)))
        ids = riot.match_ids(region, puuid, {"queue": QUEUE_SOLO, "count": match_count})
        recent = [i for i in ids if needs(i)]
        new_ids = {i for i in recent if i not in by_id}

        older = []
        if not season_complete and season_games > len(ids) and budget["left"] > 0:
            all_ids = list(ids)
            want = season_games + 20
            start = len(ids)
            while start < want:
                cnt = min(100, want - start)
                page = riot.match_ids(region, puuid, {"queue": QUEUE_SOLO, "start": start, "count": cnt})
                all_ids += page
                if len(page) < cnt:
                    break
                start += 100
            older = [i for i in all_ids[len(ids):] if needs(i)]
            if not older:
                season_complete = True
        elif season_games <= len(ids):
            season_complete = True
        older_now = older[:max(0, budget["left"])]
        budget["left"] -= len(older_now)
        if older and len(older) == len(older_now):
            season_complete = True
        log.info("  %s: %d recientes, %d/%d de temporada por descargar", acc["riotId"], len(recent), len(older_now), len(older))

        older_set = set(older_now)
        for mid in recent + older_now:
            is_recent = mid not in older_set
            try:
                match = riot.match(region, mid)
                timeline = None
                prev_g = by_id.get(mid)
                if is_recent and not (prev_g or {}).get("gold"):
                    try:
                        timeline = riot.timeline(region, mid)
                    except Exception as err:
                        if is_key_error(err):
                            raise
                        log.warning("  ! timeline %s: %s", mid, err)
                rec = compact_match(match, puuid, dd, timeline)
                if rec and not timeline and (prev_g or {}).get("gold"):
                    rec["gold"] = prev_g["gold"]
                if is_recent and rec:
                    store.write_detail(mid, match_detail(match, dd))
                if rec:
                    i = next((k for k, g in enumerate(history) if g["id"] == mid), -1)
                    if i >= 0:
                        history[i] = rec
                    else:
                        history.append(rec)
                else:
                    skipped[mid] = None
            except Exception as err:
                if is_key_error(err):
                    raise
                log.warning("  ! partida %s: %s", mid, err)
        history.sort(key=lambda g: -g["t"])
        del history[HISTORY_CAP:]

        season_slice = history[:season_games] if season_games else history
        lacking = [g for g in season_slice if "pg" not in g]
        n_conduct = max(0, min(budget.get("conduct") or 0, budget.get("conductPer", INF)))
        for g in lacking[:int(n_conduct) if n_conduct != INF else None]:
            budget["conduct"] -= 1
            try:
                m = riot.match(region, g["id"])
                me = next((p for p in m["info"]["participants"] if p.get("puuid") == puuid), None)
                if me:
                    g.update(conduct_of(me))
            except Exception as err:
                if is_key_error(err):
                    raise
                log.warning("  ! pings %s: %s", g["id"], err)
        if lacking:
            log.info("  pings y rendiciones: faltan %d partidas", sum(1 for g in lacking if "pg" not in g))
        store.write_history(puuid, {"games": history, "skipped": list(skipped)[-2000:], "seasonComplete": season_complete})

        if full or flex_changed:
            update_flex_history(riot, region, puuid, store, dd, budget)

        season_hist = history[:season_games] if season_games else history
        stats = compute_account_stats(season_hist)
        detail_ids = dict.fromkeys(g["id"] for g in history[:DETAIL_RECENT])
        if stats:
            extra = [stats["bestGame"], stats["worstGame"],
                     *[x for x in (stats.get("gold") or {}).values() if x and isinstance(x, dict)],
                     *(stats.get("gameRecords") or {}).values()]
            for g in extra:
                if g and g.get("id"):
                    detail_ids[g["id"]] = None
        for mid in detail_ids:
            if store.detail_exists(mid) or budget["details"] <= 0:
                continue
            try:
                budget["details"] -= 1
                store.write_detail(mid, match_detail(riot.match(region, mid), dd))
            except Exception as err:
                if is_key_error(err):
                    raise
                log.warning("  ! detalle %s: %s", mid, err)

        return {
            "key": cache_key,
            "riotId": f"{game_name}#{tag_line}",
            "gameName": game_name, "tagLine": tag_line,
            "label": acc.get("label"),
            "region": region,
            "level": summoner.get("summonerLevel"),
            "profileIconId": summoner.get("profileIconId"),
            "rank": rank_of(solo),
            "flexRank": rank_of(flex_entry),
            "stats": stats,
            "_detailIds": detail_ids,
            "links": profile_links(region, game_name, tag_line),
            "updatedAt": iso(self.now()),
            "_history": history,
            "_newGames": [g for g in history if g["id"] in new_ids] if had_history else [],
            "_leagueAt": league_at,
        }

    # ---------------------------------------------------------------- partida en curso
    def check_live(self, accounts, champ_ids):
        games = {}
        for a in accounts:
            try:
                g = self.riot.active_game(a["region"], a["puuid"])
            except Exception as err:
                self.status["liveErr"] = (err.status or "riot") if isinstance(err, RiotError) else "red"
                if is_key_error(err):
                    return None
                continue
            if not g:
                continue
            me = next((p for p in (g.get("participants") or []) if p.get("puuid") == a["puuid"]), None)
            e = games.get(g["gameId"]) or {"id": g["gameId"], "q": g.get("gameQueueConfigId"), "s": g.get("gameStartTime") or None, "p": []}
            e["p"].append({"n": a["name"], "c": champ_ids.get(str(me.get("championId"))) if me else None,
                           "tm": me.get("teamId") if me else None})
            games[g["gameId"]] = e
        return list(games.values())

    # ---------------------------------------------------------------- pasada
    def run(self, quick_flag=False):
        store, riot, cfg = self.store, self.riot, self.config
        status = self.status
        if not cfg or not cfg.get("players"):
            raise RuntimeError("config/players.json vacío o ilegible")
        challenge_defs = self.challenge_defs or []
        cache = store.read_puuids()
        previous = store.read_published()
        prev_acc = {}
        for p in (previous or {}).get("players") or []:
            for a in p["accounts"]:
                prev_acc[acc_key(a)] = a
        champ_ids = store.get_state("campeones", {})

        def region_of(acc):
            return acc.get("region") or cfg.get("defaultRegion") or "euw1"

        live_accounts = []
        for pl in cfg["players"]:
            for acc in pl["accounts"]:
                puuid = (cache.get(key_of(acc)) or {}).get("puuid")
                if puuid:
                    live_accounts.append({"name": pl["name"], "region": region_of(acc), "puuid": puuid})

        QUICK = bool(quick_flag and previous and not previous.get("demo"))
        status["full"] = not QUICK
        quick_state = store.get_state("rapida", {"dirty": {}}) if QUICK else None
        if quick_state is not None:
            quick_state.setdefault("dirty", {})
        to_update = None
        flex_changed = set()
        if QUICK:
            to_update = []
            now0 = self.now()
            for pl in cfg["players"]:
                for acc in pl["accounts"]:
                    key = key_of(acc)
                    prev = prev_acc.get(key)
                    puuid = (cache.get(key) or {}).get("puuid")
                    if not prev or not puuid or prev.get("error"):
                        to_update.append(key)
                        continue
                    entries = riot.league_entries(region_of(acc), puuid)
                    solo = next((e for e in entries if e.get("queueType") == "RANKED_SOLO_5x5"), None)
                    flex = next((e for e in entries if e.get("queueType") == "RANKED_FLEX_SR"), None)
                    flex_diff = "flexRank" in prev and not same_rank(prev["flexRank"], flex)
                    if flex_diff:
                        flex_changed.add(key)
                    if not same_rank(prev.get("rank"), solo) or flex_diff:
                        quick_state["dirty"][key] = now0 + DIRTY_MS
                    if (quick_state["dirty"].get(key) or 0) > now0:
                        to_update.append(key)
                    else:
                        quick_state["dirty"].pop(key, None)
            status["live"] = self.check_live(live_accounts, champ_ids)
            store.set_state("rapida", quick_state)
            if not to_update:
                log.info("Rápida: sin partidas nuevas (%d peticiones).", riot.calls)
                status["calls"] = riot.calls
                return
            log.info("Rápida: actualizando %s", ", ".join(dict.fromkeys(to_update)))
            to_update = set(to_update)

        dd_version = ddragon_version(self.http)
        if dd_version is None:
            dd_version = (previous or {}).get("ddragonVersion")
        dd = load_data_dragon(dd_version, self.http)
        if dd.get("champs"):
            champ_ids = dd["champs"]
            store.set_state("campeones", champ_ids)
        if not QUICK:
            status["live"] = self.check_live(live_accounts, champ_ids)

        n_acc = max(1, sum(len(p["accounts"]) for p in cfg["players"]))
        if QUICK:
            budget = {"left": 0, "details": 15, "flex": 10, "conduct": 0}
        else:
            budget = {"left": self._num("BACKFILL_BUDGET", 350), "details": 80, "flex": 60, "conduct": self._num("CONDUCT_BUDGET", 120)}
        budget = {k: int(v) if isinstance(v, float) and v.is_integer() else v for k, v in budget.items()}
        budget["conductPer"] = math.ceil(budget["conduct"] / n_acc)

        players = []
        failures = 0
        for pl in cfg["players"]:
            log.info("> %s", pl["name"])
            accounts = []
            for acc in pl["accounts"]:
                region = region_of(acc)
                key = key_of(acc)
                if to_update is not None and key not in to_update:
                    accounts.append({"key": key, **(prev_acc.get(key) or {})})
                    continue
                try:
                    accounts.append(self.update_account(acc, region, cache, dd, budget, prev=prev_acc.get(key), full=not QUICK,
                                                        flex_changed=key in flex_changed))
                except Exception as err:
                    if is_key_error(err):
                        raise
                    failures += 1
                    status["accErr"].append(pl["name"])
                    log.error("  ✗ %s: %s", acc["riotId"], err)
                    old = prev_acc.get(key)
                    if old:
                        accounts.append({"key": key, **old, "error": str(err)})
                    else:
                        gn, tl = split_riot_id(acc["riotId"])
                        accounts.append({"key": key, "riotId": acc["riotId"], "gameName": gn, "tagLine": tl, "label": acc.get("label"),
                                         "region": region, "rank": None, "stats": None, "links": profile_links(region, gn, tl),
                                         "error": str(err)})
            best = pick_best_account(accounts)
            players.append({"name": pl["name"], "links": pl.get("links") or [], "bestAccount": best["index"], "score": best["score"],
                            "accounts": accounts})

        players.sort(key=lambda p: -p["score"])
        store.write_puuids(cache)
        now = self.now()

        lp_hist = store.read_lp_hist()
        keep_details = set()
        peak_before = {}
        new_games = {}
        season_hists, rids = {}, {}
        for p in players:
            for a in p["accounts"]:
                key = acc_key(a)
                arr = lp_hist.get(key) or []
                if arr:
                    peak_before[key] = max(x[1] for x in arr)
                score = rank_score(a.get("rank"))
                total = a["rank"]["wins"] + a["rank"]["losses"] if a.get("rank") else None
                last = arr[-1] if arr else None
                l1 = last[1] if last else _UNDEF
                l2 = last[2] if last and len(last) > 2 else _UNDEF
                if score >= 0 and a.get("_history") is not None and (l1 is _UNDEF or l1 != score or l2 is _UNDEF or l2 != total):
                    arr.append([a.get("_leagueAt") if a.get("_leagueAt") is not None else now, score, total])
                lp_hist[key] = arr[-LP_HIST_CAP:]
                a["lpHist"] = [[x[0], x[1]] for x in lp_hist[key][-LP_HIST_PUBLISHED:]]
                if a.get("_history") is not None:
                    lp_map = assign_lp(lp_hist[key], a["_history"])
                    a["recent"] = [{**g, "lp": lp_map.get(g["id"])} for g in a["_history"][:RECENT_PUBLISHED]]
                    a["seq"] = []
                    for g in a["_history"][:SEQ_PUBLISHED]:
                        lp = lp_map.get(g["id"])
                        a["seq"].append([g["t"], 1 if g["win"] else 0, lp["d"] if lp and lp["n"] == 1 else None])
                    if a.get("stats"):
                        a["stats"]["lp"] = lp_averages(a["_history"], lp_map)
                if a.get("_newGames"):
                    new_games[key] = a["_newGames"]
                if a.get("_history") is not None:
                    season_hists[key] = a["_history"][:a["rank"]["wins"] + a["rank"]["losses"]] if a.get("rank") else a["_history"]
                    rids[key] = a.get("riotId")
                for k in ("_history", "_newGames", "_leagueAt"):
                    a.pop(k, None)
                if a.get("_detailIds"):
                    keep_details.update(a["_detailIds"])
                a.pop("_detailIds", None)
        store.write_lp_hist(lp_hist)

        events = detect_events(previous["players"], players, {"now": now, "newGames": new_games, "peakBefore": peak_before}) \
            if previous and not previous.get("demo") else []
        if self.roasts and previous and not previous.get("demo"):
            try:
                mains_now = [{"name": p["name"], "key": acc_key(main_acc(p))} for p in players if main_acc(p)]
                details = {}
                for gs in new_games.values():
                    for g in gs:
                        raw = store.read_detail_raw(g["id"])
                        if raw:
                            details[g["id"]] = json.loads(raw)
                events = add_roasts(events, {"now": now, "log": store.read_events()["events"], "players": mains_now,
                                             "newGames": new_games, "histories": season_hists,
                                             "tags": dd.get("tags"), "details": details, "rids": rids,
                                             "leader": leader_of(players, main_acc)})
            except Exception:
                log.exception("  ! roasts")

        mains = []
        for p in players:
            accs = p["accounts"]
            bi = p["bestAccount"]
            a = accs[bi] if 0 <= bi < len(accs) and accs[bi] else (accs[0] if accs else None)
            key = acc_key(a)
            puuid = key and (cache.get(key) or {}).get("puuid")
            if not puuid:
                continue
            stored = store.read_history(puuid)
            games = stored if isinstance(stored, list) else (stored.get("games") or [])
            if a.get("rank"):
                games = games[:a["rank"]["wins"] + a["rank"]["losses"]]
            mains.append({"name": p["name"], "key": key, "puuid": puuid, "a": a, "games": games, "points": lp_hist.get(key) or []})

        duo_res = compute_duos([{"name": m["name"], "games": m["games"], "lpMap": assign_lp(m["points"], m["games"]),
                                 "lpAvg": (m["a"].get("stats") or {}).get("lp")} for m in mains])
        duos, rivals = duo_res["duos"], duo_res["rivals"]
        for x in duos + rivals:
            for g in x["recent"]:
                keep_details.add(g["id"])
        if not failures and not QUICK:
            store.delete_details([i for i in store.list_details() if i not in keep_details])

        season_start = min([m["games"][-1]["t"] if m["games"] else INF for m in mains], default=INF)
        flex_entries = []
        for m in mains:
            games = [g for g in (store.read_flex(m["puuid"]).get("games") or [])
                     if g["t"] >= season_start or (g.get("q") == QUEUE_CLASH and g["t"] >= season_start - 90 * DAY)]
            flex_entries.append({"name": m["name"], "flexRank": m["a"].get("flexRank"), "games": games})
        flex = flex_group_stats(flex_entries)

        week_entries = [{"name": m["name"], "games": m["games"], "points": m["points"]} for m in mains]
        this_week = week_start(now)
        weeks_archive = store.read_weeks()
        mp = madrid_parts(now)
        can_close = mp["wd"] > 0 or mp["hh"] * 60 + mp["mm"] >= WEEKLY_FROM_MIN
        archive_changed = False
        if not QUICK and can_close:
            first_point = min([m["points"][0][0] if m["points"] else INF for m in mains], default=INF)
            have = {w["key"] for w in weeks_archive["weeks"]}
            w = week_start(this_week - 1)
            while math.isfinite(first_point) and w + 7 * DAY > first_point:
                if week_key(w) not in have:
                    weeks_archive["weeks"].append(compact_week(compute_week(week_entries, w, week_start(w + 8 * DAY))))
                    archive_changed = True
                    if len(weeks_archive["weeks"]) > 60:
                        break
                w = week_start(w - 1)
            if archive_changed:
                weeks_archive["weeks"].sort(key=lambda x: -x["from"])
                store.write_weeks(weeks_archive)
        current_week = compute_week(week_entries, this_week, None)
        week_wins = {}
        for wk in weeks_archive["weeks"]:
            if wk.get("mvp"):
                week_wins[wk["mvp"]] = week_wins.get(wk["mvp"], 0) + 1

        challenges = compute_challenges(challenge_defs, {"players": [{"name": m["name"], "points": m["points"], "games": m["games"]}
                                                                     for m in mains]}, now)

        log_ = store.read_events()
        known = {e["id"] for e in log_["events"]}
        challenge_events = []
        state = store.read_notify_state()
        if state.get("challenges") is None:
            state["challenges"] = {}
        if not QUICK:
            for c in challenges:
                d = next((x for x in challenge_defs if x.get("id") == c["id"]), None)
                st = challenge_status(d, now)
                s = state["challenges"].get(c["id"]) or {}

                def mark_start(s=s, cid=c["id"]):
                    s["started"] = now
                    state["challenges"][cid] = s

                def mark_end(s=s, cid=c["id"]):
                    if s.get("started") is None:
                        s["started"] = now
                    s["ended"] = now
                    state["challenges"][cid] = s

                if st == "active" and not s.get("started"):
                    challenge_events.append({"e": challenge_event(c, "start", now), "mark": mark_start})
                if st == "finished" and not s.get("ended"):
                    challenge_events.append({"e": challenge_event(c, "end", now), "mark": mark_end})
        fresh = [e for e in events + [x["e"] for x in challenge_events] if e["id"] not in known]
        if fresh:
            log_["events"] = (list(reversed(fresh)) + log_["events"])[:EVENTS_CAP]
            store.write_events(log_)

        nxt = {
            "generatedAt": iso(self.now()),
            "ddragonVersion": dd_version,
            "title": cfg.get("title") if cfg.get("title") is not None else "SoloQ Crew",
            "subtitle": cfg.get("subtitle") if cfg.get("subtitle") is not None else "",
            "players": players,
            "duos": duos,
            "rivals": rivals,
            "events": [e for e in log_["events"] if e["t"] >= week_start(now) - (EVENTS_DAYS - 7) * DAY][:EVENTS_PUBLISHED],
            "week": {"current": current_week, "last": weeks_archive["weeks"][0] if weeks_archive["weeks"] else None},
            "weekWins": week_wins,
            "challenges": challenges,
            "flex": flex,
        }

        self.notify_discord(state, [e for e in events if e["id"] not in known], challenge_events, weeks_archive, dd_version, now, QUICK)

        status["calls"] = riot.calls
        if previous and not previous.get("demo") and dumps(_strip(previous)) == dumps(_strip(nxt)):
            log.info("Sin cambios (%d peticiones, %d cuentas con error).", riot.calls, failures)
            return
        store.write_published(dumps(nxt))
        log.info("Listo: %d peticiones, %d cuentas con error, %d hitos.", riot.calls, failures, len(events))

    def notify_discord(self, state, events, challenge_events, weeks_archive, dd_version, now, quick):
        hook = bool(self.webhook)
        items = []
        last_week = weeks_archive["weeks"][0] if weeks_archive["weeks"] else None
        if last_week and not state.get("weeklySent"):
            state["weeklySent"] = last_week["key"]

        if hook:
            if not state.get("welcomed"):
                items.append({"embed": welcome_embed(), "ok": lambda: state.__setitem__("welcomed", now)})
            pending = [p for p in (state.get("pending") or []) if now - p["at"] < PENDING_MAX_AGE]
            state["pending"] = []
            for p in pending:
                items.append({"embed": p["embed"], "id": p["id"], "at": p["at"], "ok": lambda: None})
            for e in events:
                items.append({"embed": event_embed(e, dd_version), "id": e["id"], "at": now, "ok": lambda: None})
            for c in challenge_events:
                items.append({"embed": challenge_embed(c["e"]), "ok": c["mark"]})
            if not quick and last_week and state.get("weeklySent") != last_week["key"] and now - last_week["to"] < 2 * DAY:
                items.append({"embed": week_embed(last_week), "ok": lambda: state.__setitem__("weeklySent", last_week["key"])})
        else:
            for c in challenge_events:
                c["mark"]()

        for i in range(0, len(items), 8):
            chunk = items[i:i + 8]
            res = self.discord([x["embed"] for x in chunk])
            if res.get("ok"):
                for x in chunk:
                    x["ok"]()
            else:
                log.warning("  ! Discord: %s", res.get("error"))
                self.status["discordErr"] = (res.get("error") or "error")[:120]
                state["pending"] = (state.get("pending") or []) + [
                    {"id": x["id"], "at": x.get("at") if x.get("at") is not None else now, "embed": x["embed"]} for x in chunk if x.get("id")]
        if items:
            log.info("  Discord: %d aviso(s)", len(items))
        self.store.write_notify_state(state)


def load_configs():
    players = json.loads((config.CONFIG_DIR / "players.json").read_text(encoding="utf-8"))
    try:
        ch = json.loads((config.CONFIG_DIR / "challenges.json").read_text(encoding="utf-8"))
        defs = ch.get("challenges") or []
    except (OSError, ValueError):
        defs = []
    return players, defs


def run_pass(quick=False, store=None, env=None, **kw):
    """Ejecuta una pasada y guarda su estado (lo que lee la web en el latido). Devuelve (estado, código)."""
    import os
    own = store is None
    store = store or Store(config.DB_PATH)
    env = env if env is not None else os.environ
    code = 0
    up = None
    status = {"v": 1, "at": 0, "ok": False, "full": not quick, "err": None, "msg": None, "live": None, "liveErr": None, "accErr": [], "calls": 0}
    try:
        try:
            players, defs = load_configs() if "players_config" not in kw else (kw.pop("players_config"), kw.pop("challenge_defs", []))
        except (OSError, ValueError):
            players, defs = None, []
        up = Updater(store, players, defs, env=env, **kw)
        status = up.status
        up.run(quick)
        status["ok"] = True
    except Exception as err:
        if up is not None:
            status = up.status
        if is_key_error(err):
            status["err"] = "key"
            log.warning("%s. Revisa la clave de Riot.", err)
        else:
            status["err"] = "riot" if isinstance(err, (RiotError, httpx.HTTPError)) else "error"
            status["msg"] = re.sub(r"by-puuid/[\w-]+", "by-puuid/…", str(err))[:140]
            log.exception("La pasada ha fallado")
            code = 1
    finally:
        now = up.now() if up is not None else int(time.time() * 1000)
        status["at"] = now
        try:
            store.set_state("pasada", status)
        except Exception:
            pass
        if own:
            store.close()
    return status, code


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    _, code = run_pass("--quick" in argv)
    return code


if __name__ == "__main__":
    sys.exit(main())
