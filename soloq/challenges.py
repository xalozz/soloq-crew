"""Retos entre los del grupo (config/challenges.json). Port de challenges.mjs.

  race      quién gana más LP entre dos fechas
  target    llegar a un rango antes de una fecha ("target": "DIAMOND IV")
  handicap  cada uno con su objetivo de LP ("targets": {"Nombre": 150}, "target": 100 por defecto)
  games     constancia: al menos "perWeek" partidas cada semana
"""

import math
import re

from . import config
from .events import COLOR, event_text, signed
from .js import INF, js_str, orz, sort_cmp, sub
from .stats import rank_score
from .tiempo import iso, parse_day, week_start, madrid_midnight

TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"]
ES = {"HIERRO": "IRON", "BRONCE": "BRONZE", "PLATA": "SILVER", "ORO": "GOLD", "PLATINO": "PLATINUM", "ESMERALDA": "EMERALD",
      "DIAMANTE": "DIAMOND", "MAESTRO": "MASTER"}
WEEK_MS = 7 * 864e5


def parse_rank(s):
    parts = re.split(r"\s+", str(s).strip().upper())
    t0 = parts[0] if parts else ""
    d0 = parts[1] if len(parts) > 1 else ""
    tier = ES.get(t0, t0)
    if tier not in TIERS:
        return None
    return rank_score({"tier": tier, "division": d0 or "IV", "lp": 0})


def score_at(points, t):
    v = None
    for p in points:
        if p[0] <= t:
            v = p[1]
        else:
            break
    return v


def challenge_window(d):
    frm = parse_day(d["from"])
    y, m, dd = (int(x) for x in str(d["to"]).split("-"))
    return frm, madrid_midnight(y, m, dd + 1)


def challenge_status(d, now):
    frm, to = challenge_window(d)
    return "upcoming" if now < frm else "active" if now < to else "finished"


def _label_weeks(n):
    return "" if n == 1 else "s"


def compute_challenges(defs, ctx, now):
    out = []
    for d in defs or []:
        if not d or not d.get("id") or not d.get("from") or not d.get("to") or not d.get("type"):
            continue
        frm, to = challenge_window(d)
        cutoff = min(now, to)
        pl = d.get("players")
        names = [p["name"] for p in ctx["players"]] if pl == "all" or not isinstance(pl, list) else pl
        parts = [p for p in ctx["players"] if p["name"] in names]
        finished = now >= to
        started = now >= frm
        typ = d["type"]

        standings = []
        for p in parts:
            start = score_at(p["points"], frm)
            if start is None:
                first = next((x for x in p["points"] if x[0] >= frm), None)
                start = first[1] if first else None
            end = score_at(p["points"], cutoff) if started else start
            games = [g for g in p["games"] if frm <= g["t"] < cutoff]
            gained = end - start if start is not None and end is not None else None
            base = {"name": p["name"], "start": start, "end": end, "games": len(games), "wins": sum(1 for g in games if g["win"])}
            if typ == "race":
                standings.append({**base, "value": gained if gained is not None else 0,
                                  "label": "sin datos" if gained is None else f"{signed(gained)} LP"})
            elif typ == "target":
                target = parse_rank(d.get("target"))
                tn = 0 if target is None else target  # en JS, null cuenta como 0 al comparar
                hit = None
                if started:
                    hit = next((x for x in p["points"] if frm <= x[0] <= cutoff and x[1] >= tn), None)
                already = start is not None and start >= tn
                if already or hit:
                    progress = 1
                elif start is not None and end is not None and tn > start:
                    progress = max(0, (end - start) / (tn - start))
                else:
                    progress = 0
                if already:
                    label = "ya estaba"
                elif hit:
                    label = "¡conseguido!"
                elif end is not None:
                    label = f"{js_str(max(0, tn - end))} LP para llegar"
                else:
                    label = "sin datos"
                standings.append({**base, "target": target, "value": progress, "done": bool(already or hit),
                                  "at": frm if already else (hit[0] if hit else None), "label": label})
            elif typ == "handicap":
                goal = float((d.get("targets") or {}).get(p["name"], d.get("target") if d.get("target") is not None else 100))
                goal = int(goal) if goal.is_integer() else goal
                progress = 0 if gained is None else max(0, gained) / max(1, goal)
                standings.append({**base, "goal": goal, "value": progress, "done": progress >= 1,
                                  "label": "sin datos" if gained is None else f"{signed(gained)} de +{js_str(goal)} LP"})
            elif typ == "games":
                per = d.get("perWeek") if d.get("perWeek") is not None else 10
                per = float(per)
                per = int(per) if per.is_integer() else per
                weeks = []
                w = week_start(frm)
                lim = min(to, max(cutoff, frm + 1))
                while w < lim:
                    w_end = w + WEEK_MS
                    weeks.append(sum(1 for g in p["games"] if max(w, frm) <= g["t"] < min(w_end, to)))
                    w += WEEK_MS
                done_weeks = sum(1 for n in weeks if n >= per)
                standings.append({**base, "per": per, "weeks": weeks, "value": done_weeks, "current": weeks[-1] if weeks else 0,
                                  "label": f"{done_weeks} de {len(weeks)} semana{_label_weeks(len(weeks))} cumplida{_label_weeks(len(weeks))}"})
            else:
                standings.append(base)

        def at_or_inf(s):
            return INF if s.get("at") is None else s["at"]

        orders = {
            "race": lambda a, b: orz(b["value"] - a["value"], b["wins"] - a["wins"]),
            "target": lambda a, b: orz((1 if b["done"] else 0) - (1 if a["done"] else 0), sub(at_or_inf(a), at_or_inf(b)), b["value"] - a["value"]),
            "handicap": lambda a, b: b["value"] - a["value"],
            "games": lambda a, b: orz(b["value"] - a["value"], b["games"] - a["games"]),
        }
        standings = sort_cmp(standings, orders.get(typ, lambda a, b: 0))

        winners = None
        if finished and standings:
            if typ == "target":
                winners = [s["name"] for s in standings if s.get("done") and s.get("label") != "ya estaba"][:1]
            else:
                top = standings[0].get("value")
                winners = [s["name"] for s in standings if s.get("value") == top and (s.get("value") or 0) > 0]
        out.append({
            "id": d["id"], "title": d.get("title") if d.get("title") is not None else d["id"], "type": typ,
            "desc": d.get("desc") if d.get("desc") is not None else "", "stake": d.get("stake") if d.get("stake") is not None else "",
            "from": frm, "to": to, "target": d.get("target"), "perWeek": d.get("perWeek"),
            "standings": standings, "winners": winners,
        })
    return out


def challenge_event(c, phase, now):
    e = {"type": "challengeStart" if phase == "start" else "challengeEnd", "t": now, "title": c["title"],
         "winners": c.get("winners") or [], "name": "", "key": c["id"]}
    e["id"] = f"{e['type']}:{c['id']}"
    e["text"] = event_text(e)
    lines = []
    if c.get("desc"):
        lines.append(c["desc"])
    if c.get("stake"):
        lines.append(f"En juego: **{c['stake']}**")
    if phase == "end":
        lines += ["", *[f"{i + 1}. {s['name']} · {s['label'] if 'label' in s else 'undefined'}" for i, s in enumerate(c["standings"][:8])]]
    e["desc"] = "\n".join(lines)
    return e


def challenge_embed(e):
    out = {"title": e["text"], "url": f"{config.SITE}#retos", "color": COLOR["gold"] if e["type"] == "challengeEnd" else COLOR["accent"]}
    if e.get("desc"):
        out["description"] = e["desc"]
    out["timestamp"] = iso(e["t"])
    return out
