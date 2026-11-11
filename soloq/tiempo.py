"""Fechas en hora de Madrid (semanas de lunes a domingo, meses naturales). Igual que scripts/time.mjs.

Todos los instantes son milisegundos desde 1970 (como Date.now() en JS).
"""

import math
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Madrid")
DAY_MS = 864e5


def madrid_parts(t):
    """{y, m (1-12), d, hh, mm, ss, wd (lunes = 0)} en hora de Madrid."""
    dt = datetime.fromtimestamp(math.floor(t / 1000), TZ)
    return {"y": dt.year, "m": dt.month, "d": dt.day, "hh": dt.hour, "mm": dt.minute, "ss": dt.second, "wd": dt.weekday()}


def madrid_midnight(y, m, d):
    """00:00 de Madrid del día y-m-d (admite días fuera de rango, p. ej. d = 0 o 32)."""
    day = date(y, m, 1) + timedelta(days=d - 1)
    return int(datetime(day.year, day.month, day.day, tzinfo=TZ).timestamp()) * 1000


def day_start(t):
    p = madrid_parts(t)
    return madrid_midnight(p["y"], p["m"], p["d"])


def week_start(t):
    p = madrid_parts(t)
    return madrid_midnight(p["y"], p["m"], p["d"] - p["wd"])


def month_start(t):
    p = madrid_parts(t)
    return madrid_midnight(p["y"], p["m"], 1)


def parse_day(s):
    y, m, d = (int(x) for x in str(s).split("-"))
    return madrid_midnight(y, m, d)


def week_key(t):
    """Semana ISO ("2026-W43") del día de Madrid que contiene t."""
    p = madrid_parts(t)
    y, w, _ = date(p["y"], p["m"], p["d"]).isocalendar()
    return f"{y}-W{w:02d}"


MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"]


def short_day(t):
    p = madrid_parts(t)
    return f"{p['d']} {MONTHS[p['m'] - 1]}"


def range_label(frm, to_exclusive):
    a, b = madrid_parts(frm), madrid_parts(to_exclusive - 1)
    if a["m"] == b["m"]:
        return f"{a['d']}–{b['d']} {MONTHS[b['m'] - 1]}"
    return f"{a['d']} {MONTHS[a['m'] - 1]} – {b['d']} {MONTHS[b['m'] - 1]}"


def iso(t):
    """new Date(t).toISOString()"""
    t = int(t)
    dt = datetime.fromtimestamp(t // 1000, timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + f".{t % 1000:03d}Z"


def madrid_day_str(t):
    """Intl sv-SE: "YYYY-MM-DD" del día de Madrid."""
    p = madrid_parts(t)
    return f"{p['y']:04d}-{p['m']:02d}-{p['d']:02d}"
