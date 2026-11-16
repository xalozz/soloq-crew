"""Lo que se puede cambiar desde /admin: qué novedades salen (web y Discord), sus umbrales, los jugadores, los retos y
los textos de los roasts. Todo vive en la tabla `estado` de soloq.db (claves cfg_*); si una clave no está, vale lo de
config/*.json (jugadores, retos, textos) o los valores por defecto de aquí (ajustes).

La web escribe (con sesión de administrador) y el actualizador lee en cada pasada. La web filtra las novedades al
servirlas, así que activar o desactivar una se nota en el momento (también en las que ya salieron).
"""

import copy
import json
import re

from . import config

K_AJUSTES, K_JUGADORES, K_RETOS, K_TEXTOS, K_PRUEBA = "cfg_ajustes", "cfg_jugadores", "cfg_retos", "cfg_textos", "discord_prueba"

# Parámetros: (clave, etiqueta, tipo, mín, máx). Tipos: int, float, list (enteros separados por comas).
CATALOGO = [
    # ---- hitos
    {"k": "placed", "grupo": "hitos", "nombre": "Se clasifica", "ej": "🆕 Pepe se clasifica en Oro II"},
    {"k": "up", "grupo": "hitos", "nombre": "Sube de división o asciende de liga", "ej": "⬆️ Pepe sube a Oro I · 🎉 Pepe asciende a Platino IV"},
    {"k": "down", "grupo": "hitos", "nombre": "Baja de división o desciende de liga", "ej": "⬇️ Pepe baja a Oro II · 😬 Pepe desciende a Plata I"},
    {"k": "games", "grupo": "hitos", "nombre": "Partidas jugadas en la temporada", "ej": "🎮 Pepe llega a 300 partidas esta temporada",
     "p": [("hitos", "Al llegar a", "list", 1, 100000)]},
    {"k": "streakW", "grupo": "hitos", "nombre": "Racha de victorias", "ej": "🔥 Pepe lleva 5 victorias seguidas",
     "p": [("pasos", "Avisar al llevar", "list", 2, 100)]},
    {"k": "streakL", "grupo": "hitos", "nombre": "Racha de derrotas", "ej": "🧊 Pepe lleva 5 derrotas seguidas",
     "p": [("pasos", "Avisar al llevar", "list", 2, 100)]},
    {"k": "streakEndW", "grupo": "hitos", "nombre": "Se acaba una racha de victorias", "ej": "✂️ Se acaba la racha de 6 victorias de Pepe",
     "p": [("minimo", "Si la racha era de al menos", "int", 2, 100)]},
    {"k": "streakEndL", "grupo": "hitos", "nombre": "Corta una racha de derrotas", "ej": "🌤️ Pepe corta su racha de 6 derrotas",
     "p": [("minimo", "Si la racha era de al menos", "int", 2, 100)]},
    {"k": "penta", "grupo": "hitos", "nombre": "Pentakill", "ej": "🖐️ ¡Pentakill de Pepe con Jinx!"},
    {"k": "quadra", "grupo": "hitos", "nombre": "Cuádruple", "ej": "✋ Cuádruple de Pepe con Jinx"},
    {"k": "record", "grupo": "hitos", "nombre": "Récord del grupo", "ej": "🏆 Nuevo récord del grupo (kills): Pepe, 24"},
    {"k": "challengeStart", "grupo": "hitos", "nombre": "Empieza un reto", "ej": "🏁 Empieza el reto «Carrera de noviembre»"},
    {"k": "challengeEnd", "grupo": "hitos", "nombre": "Termina un reto", "ej": "🏆 Pepe gana el reto «Carrera de noviembre»"},
    {"k": "semana", "grupo": "hitos", "nombre": "Resumen semanal", "ej": "El lunes por la mañana, el resumen de la semana", "soloDiscord": True},
    # ---- roasts de partida (el primero que salta, en este orden)
    {"k": "tirada", "grupo": "roasts", "nombre": "Pierde yendo muy por delante en oro", "ej": "🎁 Pepe pierde con Jinx después de ir +6,5k de oro",
     "p": [("oro", "Ventaja de oro de al menos", "int", 1000, 30000)]},
    {"k": "feed", "grupo": "roasts", "nombre": "Feedeo", "ej": "💀 Pepe 2/12/3 con Jinx",
     "p": [("muertes", "Muertes de al menos (y kills + asistencias < muertes)", "int", 3, 40)]},
    {"k": "lastre", "grupo": "roasts", "nombre": "El que menos daño hace y más muere de su equipo", "ej": "🧱 Pepe es el que menos daño hace y el que más muere de su equipo",
     "p": [("muertes", "Con al menos estas muertes", "int", 1, 40)]},
    {"k": "danio", "grupo": "roasts", "nombre": "Muy poco daño para su campeón", "ej": "🎒 Pepe gana con Jinx haciendo el 11% del daño de su equipo",
     "p": [("Marksman", "Tirador: menos del %", "int", 1, 60), ("Mage", "Mago: menos del %", "int", 1, 60),
           ("Assassin", "Asesino: menos del %", "int", 1, 60), ("Fighter", "Luchador: menos del %", "int", 1, 60)]},
    {"k": "ff", "grupo": "roasts", "nombre": "Se rinde pronto", "ej": "🏳️ Pepe se rinde en el minuto 16 con Jinx",
     "p": [("minuto", "Antes del minuto", "int", 15, 40)]},
    {"k": "raro", "grupo": "roasts", "nombre": "Campeón que no juega nunca", "ej": "🎲 Pepe se juega su primera partida de la temporada con Kayn y pierde",
     "p": [("veces", "Hasta su partida n.º", "int", 1, 10), ("temporada", "Si lleva al menos estas partidas en la temporada", "int", 0, 500)]},
    {"k": "cs", "grupo": "roasts", "nombre": "Farmeo muy bajo (top, mid y ADC)", "ej": "🌾 Pepe 4,7 CS/min con Galio",
     "p": [("csmin", "Menos de CS por minuto", "float", 1, 12), ("minutos", "En partidas de al menos (min)", "int", 10, 40)]},
    {"k": "vision", "grupo": "roasts", "nombre": "Visión muy baja", "ej": "🙈 Pepe 8 de visión en 31 minutos con Jinx",
     "p": [("porMin", "Menos de visión por minuto", "float", 0, 5), ("support", "Support: menos de visión por minuto", "float", 0, 5)]},
    {"k": "maldito", "grupo": "roasts", "nombre": "Vuelve a perder con un campeón con el que va mal", "ej": "🔁 Pepe vuelve a perder con Yasuo (3V–9D esta temporada)",
     "p": [("partidas", "Con al menos estas partidas", "int", 3, 100), ("winrate", "Y menos de este % de victorias", "int", 1, 60)]},
    {"k": "madrugada", "grupo": "roasts", "nombre": "Pierde de madrugada", "ej": "🌙 Pepe pierde a las 4:12 con Jinx",
     "p": [("desde", "Desde las (h)", "int", 0, 23), ("hasta", "Hasta las (h)", "int", 1, 24)]},
]
POR_CLAVE = {c["k"]: c for c in CATALOGO}

DEFAULT_PARAMS = {
    "games": {"hitos": [100, 200, 300, 500, 750, 1000, 1500, 2000]},
    "streakW": {"pasos": [5, 7, 10, 15, 20]},
    "streakL": {"pasos": [5, 7, 10, 15, 20]},
    "streakEndW": {"minimo": 5},
    "streakEndL": {"minimo": 5},
    "tirada": {"oro": 6000},
    "feed": {"muertes": 10},
    "lastre": {"muertes": 7},
    "danio": {"Marksman": 15, "Mage": 15, "Assassin": 13, "Fighter": 11},
    "ff": {"minuto": 21},
    "raro": {"veces": 3, "temporada": 20},
    "cs": {"csmin": 5, "minutos": 20},
    "vision": {"porMin": 0.35, "support": 0.9},
    "maldito": {"partidas": 8, "winrate": 40},
    "madrugada": {"desde": 3, "hasta": 7},
}

DEFAULTS = {
    "avisos": {c["k"]: {"web": not c.get("soloDiscord"), "discord": True, "p": copy.deepcopy(DEFAULT_PARAMS.get(c["k"], {}))}
               for c in CATALOGO},
    "roastsPorDia": 2,
    "discord": {"activo": True},
}

# Tipo de evento → clave del catálogo
_ROAST_GRUPO = {"feedPierde": "feed", "feedGana": "feed", "lastrePierde": "lastre", "lastreGana": "lastre",
                "mochila": "danio", "sinDanio": "danio", "estrenoPierde": "raro", "estrenoGana": "raro",
                "raroPierde": "raro", "raroGana": "raro"}


def clave_evento(e):
    t = e.get("type")
    if t in ("streak", "streakEnd"):
        return t + ("W" if e.get("kind") == "W" else "L")
    if t == "roast":
        rk = e.get("rk") or ""
        return _ROAST_GRUPO.get(rk, rk)
    return t


# ------------------------------------------------------------------ ajustes

def completar(raw):
    """Los ajustes guardados encima de los valores por defecto (lo que falte o no valga, por defecto)."""
    out = copy.deepcopy(DEFAULTS)
    raw = raw if isinstance(raw, dict) else {}
    for k, v in (raw.get("avisos") or {}).items():
        if k not in out["avisos"] or not isinstance(v, dict):
            continue
        dst = out["avisos"][k]
        for canal in ("web", "discord"):
            if isinstance(v.get(canal), bool):
                dst[canal] = v[canal]
        if POR_CLAVE[k].get("soloDiscord"):
            dst["web"] = False
        for pk, val in (v.get("p") or {}).items():
            if pk in dst["p"]:
                dst["p"][pk] = val
    n = raw.get("roastsPorDia")
    if isinstance(n, int) and not isinstance(n, bool) and 0 <= n <= 20:
        out["roastsPorDia"] = n
    d = raw.get("discord") or {}
    if isinstance(d.get("activo"), bool):
        out["discord"]["activo"] = d["activo"]
    return out


class Invalido(ValueError):
    pass


def validar(raw):
    """Comprueba lo que llega de la web y lo devuelve limpio (o Invalido con el motivo, para enseñarlo)."""
    if not isinstance(raw, dict):
        raise Invalido("Ajustes no válidos.")
    avisos = {}
    for k, v in (raw.get("avisos") or {}).items():
        c = POR_CLAVE.get(k)
        if not c or not isinstance(v, dict):
            continue
        a = {"web": bool(v.get("web")) and not c.get("soloDiscord"), "discord": bool(v.get("discord")), "p": {}}
        for pk, etiqueta, tipo, lo, hi in c.get("p") or []:
            val = (v.get("p") or {}).get(pk, DEFAULT_PARAMS[k][pk])
            a["p"][pk] = _param(val, tipo, lo, hi, f"{c['nombre']} · {etiqueta}")
        if k == "madrugada" and a["p"]["desde"] >= a["p"]["hasta"]:
            raise Invalido("Pierde de madrugada: «desde» tiene que ser antes que «hasta».")
        avisos[k] = a
    n = raw.get("roastsPorDia", DEFAULTS["roastsPorDia"])
    if not isinstance(n, int) or isinstance(n, bool) or not 0 <= n <= 20:
        raise Invalido("Roasts por persona y día: entre 0 y 20.")
    return {"avisos": avisos, "roastsPorDia": n, "discord": {"activo": bool((raw.get("discord") or {}).get("activo", True))}}


def _param(val, tipo, lo, hi, nombre):
    try:
        if tipo == "list":
            xs = val if isinstance(val, list) else [x for x in re.split(r"[\s,;]+", str(val)) if x]
            xs = sorted({int(x) for x in xs})
            if not xs or len(xs) > 30 or any(not lo <= x <= hi for x in xs):
                raise ValueError
            return xs
        x = float(val) if tipo == "float" else int(val)
        if isinstance(val, bool) or not lo <= x <= hi:
            raise ValueError
        return round(x, 2) if tipo == "float" else x
    except (TypeError, ValueError):
        rango = f"números entre {lo} y {hi}, separados por comas" if tipo == "list" else f"entre {lo} y {hi}"
        raise Invalido(f"{nombre}: {rango}.") from None


# ------------------------------------------------------------------ jugadores, retos y textos

def jugadores_archivo():
    return json.loads((config.CONFIG_DIR / "players.json").read_text(encoding="utf-8"))


def retos_archivo():
    try:
        return json.loads((config.CONFIG_DIR / "challenges.json").read_text(encoding="utf-8")).get("challenges") or []
    except (OSError, ValueError):
        return []


def textos_archivo():
    try:
        return json.loads((config.CONFIG_DIR / "roasts.json").read_text(encoding="utf-8")).get("partidas") or {}
    except (OSError, ValueError):
        return {}


RIOT_ID = re.compile(r"^[^#]{3,16}#[A-Za-z0-9]{2,5}$")
REGIONES = ("euw1", "eun1", "na1", "kr", "br1", "la1", "la2", "oc1", "tr1", "ru", "jp1", "me1", "ph2", "sg2", "th2", "tw2", "vn2")


def validar_jugadores(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("players"), list):
        raise Invalido("Lista de jugadores no válida.")
    title = str(raw.get("title") or "").strip()[:60] or "SoloQ Crew"
    subtitle = str(raw.get("subtitle") or "").strip()[:120]
    region = str(raw.get("defaultRegion") or "euw1")
    if region not in REGIONES:
        raise Invalido("Región por defecto no válida.")
    players, nombres, ids = [], set(), set()
    for p in raw["players"]:
        if not isinstance(p, dict):
            raise Invalido("Jugador no válido.")
        name = re.sub(r"\s+", " ", str(p.get("name") or "")).strip()
        if not 1 <= len(name) <= 32:
            raise Invalido("Cada jugador necesita un nombre (hasta 32 caracteres).")
        if name.lower() in nombres:
            raise Invalido(f"El nombre «{name}» está repetido.")
        nombres.add(name.lower())
        accs = []
        for a in p.get("accounts") or []:
            rid = re.sub(r"\s*#\s*", "#", str((a or {}).get("riotId") or "").strip())
            if not RIOT_ID.match(rid):
                raise Invalido(f"{name}: «{rid}» no es un Riot ID (Nombre#TAG).")
            if rid.lower() in ids:
                raise Invalido(f"La cuenta {rid} está dos veces.")
            ids.add(rid.lower())
            acc = {"riotId": rid}
            reg = str((a or {}).get("region") or "")
            if reg and reg != region:
                if reg not in REGIONES:
                    raise Invalido(f"{rid}: región no válida.")
                acc["region"] = reg
            label = str((a or {}).get("label") or "").strip()[:24]
            if label:
                acc["label"] = label
            accs.append(acc)
        if not accs:
            raise Invalido(f"{name} necesita al menos una cuenta.")
        out = {"name": name, "accounts": accs}
        links = p.get("links")
        if isinstance(links, list) and links:
            out["links"] = links[:5]
        players.append(out)
    if not players:
        raise Invalido("Tiene que haber al menos un jugador.")
    if len(players) > 30:
        raise Invalido("Como mucho 30 jugadores.")
    return {"title": title, "subtitle": subtitle, "defaultRegion": region, "players": players}


FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIPOS_RETO = ("race", "target", "handicap", "games")


def validar_retos(raw, nombres):
    if not isinstance(raw, list):
        raise Invalido("Lista de retos no válida.")
    out, ids = [], set()
    for c in raw:
        if not isinstance(c, dict):
            raise Invalido("Reto no válido.")
        title = str(c.get("title") or "").strip()[:60]
        if not title:
            raise Invalido("Cada reto necesita un título.")
        cid = re.sub(r"[^a-z0-9-]+", "-", str(c.get("id") or title).lower()).strip("-")[:60] or "reto"
        base, i = cid, 2
        while cid in ids:
            cid, i = f"{base}-{i}", i + 1
        ids.add(cid)
        typ = c.get("type")
        if typ not in TIPOS_RETO:
            raise Invalido(f"«{title}»: tipo de reto no válido.")
        fr, to = str(c.get("from") or ""), str(c.get("to") or "")
        if not FECHA.match(fr) or not FECHA.match(to) or fr > to:
            raise Invalido(f"«{title}»: fechas no válidas (la de inicio no puede ser después de la de fin).")
        r = {"id": cid, "title": title, "type": typ, "from": fr, "to": to, "desc": str(c.get("desc") or "").strip()[:300],
             "stake": str(c.get("stake") or "").strip()[:120]}
        pl = c.get("players", "all")
        if pl != "all":
            if not isinstance(pl, list) or not pl:
                raise Invalido(f"«{title}»: elige quién participa.")
            fuera = [x for x in pl if x not in nombres]
            if fuera:
                raise Invalido(f"«{title}»: {', '.join(map(str, fuera))} no está en la lista de jugadores.")
            pl = [str(x) for x in pl]
        r["players"] = pl
        if typ == "target":
            from .challenges import parse_rank
            t = re.sub(r"\s+", " ", str(c.get("target") or "").strip().upper())
            parts = t.split()
            if parse_rank(t) is None or (len(parts) > 1 and parts[1] not in ("I", "II", "III", "IV")):
                raise Invalido(f"«{title}»: rango objetivo no válido (p. ej. «Diamante IV»).")
            r["target"] = t
        if typ == "handicap":
            try:
                r["target"] = int(c.get("target") or 100)
                r["targets"] = {str(k): int(v) for k, v in (c.get("targets") or {}).items() if str(k) in nombres}
            except (TypeError, ValueError):
                raise Invalido(f"«{title}»: los objetivos de LP tienen que ser números.") from None
        if typ == "games":
            try:
                r["perWeek"] = int(c.get("perWeek") or 10)
            except (TypeError, ValueError):
                raise Invalido(f"«{title}»: partidas por semana no válidas.") from None
            if not 1 <= r["perWeek"] <= 200:
                raise Invalido(f"«{title}»: partidas por semana entre 1 y 200.")
        out.append(r)
    return out


HUECOS = {"name", "champ", "k", "d", "a", "min", "pos", "pct", "lead", "csmin", "vis", "w", "l", "hora", "nth", "n", "leadMin"}


def validar_textos(raw):
    if not isinstance(raw, dict):
        raise Invalido("Textos no válidos.")
    base = textos_archivo()
    out = {}
    for k, v in raw.items():
        if k not in base:
            continue
        t = str((v or {}).get("texto") if isinstance(v, dict) else v or "").strip()[:200]
        if not t:
            raise Invalido(f"El texto de «{k}» está vacío.")
        malos = set(re.findall(r"\{(\w*)\}", t)) - HUECOS
        if malos or re.search(r"\{[^}]*$|\{\w*[^\w}]", t):
            raise Invalido(f"«{k}»: hueco no válido ({', '.join('{' + m + '}' for m in malos) or 'llave sin cerrar'}).")
        out[k] = {"texto": t}
    return out


# ------------------------------------------------------------------ lectura (actualizador y web)

def leer(get_state):
    """Todo lo configurable, con lo guardado en /admin encima de los archivos y valores por defecto.
    `get_state(clave)` devuelve lo guardado (ya como objeto) o None."""
    jug = get_state(K_JUGADORES)
    if not jug:
        try:
            jug = jugadores_archivo()
        except (OSError, ValueError):
            jug = None
    retos = get_state(K_RETOS)
    if retos is None:
        retos = retos_archivo()
    return {"ajustes": completar(get_state(K_AJUSTES)), "jugadores": jug, "retos": retos,
            "textos": {**textos_archivo(), **(get_state(K_TEXTOS) or {})}}
