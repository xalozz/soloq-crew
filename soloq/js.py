"""Equivalentes exactos de las operaciones de JavaScript que usaba el actualizador en Node.

Python redondea distinto (round() es «al par», format() también) y escribe los números de otra
forma (50.0 frente a 50). Aquí está todo lo necesario para que los resultados coincidan bit a bit.
"""

import json
import math
from decimal import ROUND_HALF_UP, Decimal
from functools import cmp_to_key

INF = math.inf


def jround(x):
    """Math.round: al entero más cercano; los empates hacia +infinito."""
    if x is None:
        return 0
    if isinstance(x, int):
        return x
    if math.isnan(x) or math.isinf(x):
        return x
    r = math.floor(x)
    return r + 1 if x - r >= 0.5 else r


def r1(x):
    return jround(x * 10) / 10


def r2(x):
    return jround(x * 100) / 100


def pct(w, n):
    return jround((w / n) * 1000) / 10 if n else 0


def to_fixed(x, digits):
    """Number.prototype.toFixed: sobre el valor exacto del double, empates lejos del cero."""
    q = Decimal(1).scaleb(-digits)
    return format(Decimal(x).quantize(q, rounding=ROUND_HALF_UP), "f")


def fixed_num(x, digits):
    """+(x).toFixed(n)"""
    return num(float(to_fixed(x, digits)))


def num(x):
    """Un float entero se guarda como int (JSON.stringify escribe 50, no 50.0)."""
    if isinstance(x, float) and x.is_integer() and abs(x) < 2**53:
        return int(x)
    return x


def js_str(x):
    """String(número) para números «normales» (sin notación exponencial)."""
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, float):
        if x.is_integer() and abs(x) < 1e21:
            return str(int(x))
        return repr(x)
    return str(x)


def es_1dec(v):
    """v.toLocaleString('es-ES', {minimumFractionDigits: 1, maximumFractionDigits: 1})."""
    s = to_fixed(v, 1)
    neg = s.startswith("-")
    if neg:
        s = s[1:]
    ent, dec = s.split(".")
    # es-ES agrupa miles solo a partir de 5 cifras (minimumGroupingDigits = 2)
    if len(ent) >= 5:
        g = []
        while len(ent) > 3:
            g.insert(0, ent[-3:])
            ent = ent[:-3]
        g.insert(0, ent)
        ent = ".".join(g)
    return ("-" if neg else "") + ent + "," + dec


def _clean(o):
    if isinstance(o, float):
        return num(o)
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    return o


def dumps(o, indent=None):
    """JSON.stringify(o) / JSON.stringify(o, null, 2)."""
    if indent:
        return json.dumps(_clean(o), ensure_ascii=False, indent=indent)
    return json.dumps(_clean(o), ensure_ascii=False, separators=(",", ":"))


def sort_cmp(arr, cmp):
    """Array.prototype.sort con comparador (estable; NaN cuenta como 0)."""
    def wrap(a, b):
        v = cmp(a, b)
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return 0
        return -1 if v < 0 else 1 if v > 0 else 0
    return sorted(arr, key=cmp_to_key(wrap))


def orz(*vals):
    """a || b || c para restas numéricas en comparadores (0 y NaN son «falsos»)."""
    for v in vals:
        if v and not (isinstance(v, float) and math.isnan(v)):
            return v
    return vals[-1] if vals else 0


def sub(a, b):
    """a - b con la aritmética de JS para infinitos (Infinity - Infinity = NaN)."""
    try:
        return a - b
    except TypeError:
        return math.nan


def reduce_first(arr, f):
    """arr.reduce(f) sin valor inicial."""
    it = iter(arr)
    acc = next(it)
    for x in it:
        acc = f(acc, x)
    return acc
