"""Importa el historial de data/ (los JSON que genera el actualizador de Node) a SQLite, y al revés.

  python -m soloq.importer importar <carpeta data/> [--db ruta]     carga todo y lo comprueba
  python -m soloq.importer exportar <carpeta destino> [--db ruta]   vuelve a escribir los JSON

La comprobación no se fía de contar filas: vuelve a generar cada JSON desde la base de datos y lo
compara con el original elemento a elemento (mismos campos, mismos valores y mismo tipo de número).
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

from . import config
from .store import Store


def hash_of(puuid):
    return hashlib.sha1(puuid.encode()).hexdigest()[:12]


def _load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


DATA_TABLES = ("cuenta", "historial", "partida", "descartada", "foto_lp", "orden_lp", "detalle", "semana", "evento",
               "reto_aviso", "aviso_pendiente")


def import_dir(data_dir, store, extra=None, replace=False):
    """Carga data/ en la base de datos. extra: {'rapida': ruta .quick-state.json, …} opcional.
    replace: borra antes lo que hubiera (todo en una transacción: quien lee no ve nunca medias tintas)."""
    d = Path(data_dir)
    puuids = _load(d / "puuids.json") if (d / "puuids.json").exists() else {}
    by_hash = {hash_of(v["puuid"]): v["puuid"] for v in puuids.values() if v.get("puuid")}
    unknown = []
    with store.tx():
        if replace:
            for t in DATA_TABLES:
                store.db.execute(f"DELETE FROM {t}")
            store.db.execute("DELETE FROM estado WHERE clave IN ('avisos', 'publicado')")
        store.write_puuids(puuids)
        for f in sorted((d / "history").glob("*.json")) if (d / "history").exists() else []:
            name = f.stem
            flex = name.endswith("-flex")
            h = name[:-5] if flex else name
            puuid = by_hash.get(h)
            if not puuid:
                # Historial de una cuenta que ya no está en puuids.json: se guarda igual, con su hash, para no perderlo
                puuid = f"hash:{h}"
                unknown.append(f.name)
            obj = _load(f)
            if isinstance(obj, list):
                obj = {"games": obj, "skipped": []}
            (store.write_flex if flex else store.write_history)(puuid, obj)
        if (d / "lp-history.json").exists():
            store.write_lp_hist(_load(d / "lp-history.json"))
        for f in sorted((d / "matches").glob("*.json")) if (d / "matches").exists() else []:
            store.write_detail(f.stem, _load(f))
        if (d / "weeks.json").exists():
            store.write_weeks(_load(d / "weeks.json"))
        if (d / "events.json").exists():
            store.write_events(_load(d / "events.json"))
        if (d / "notify-state.json").exists():
            store.write_notify_state(_load(d / "notify-state.json"))
        if (d / "data.json").exists():
            store.write_published((d / "data.json").read_text(encoding="utf-8").rstrip("\n"))
        for key, path in (extra or {}).items():
            if path and Path(path).exists():
                store.set_state(key, _load(path))
    return unknown


def export_dir(store, out_dir):
    """Escribe los JSON con el mismo formato que el actualizador de Node."""
    o = Path(out_dir)
    (o / "history").mkdir(parents=True, exist_ok=True)
    (o / "matches").mkdir(parents=True, exist_ok=True)

    def w(p, obj):
        Path(p).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    puuids = store.read_puuids()
    w(o / "puuids.json", puuids)
    for puuid, cola, sc in store.db.execute("SELECT puuid, cola, season_complete FROM historial ORDER BY puuid, cola"):
        h = puuid[5:] if puuid.startswith("hash:") else hash_of(puuid)
        obj = store.read_flex(puuid) if cola == "flex" else store.read_history(puuid)
        w(o / "history" / f"{h}{'-flex' if cola == 'flex' else ''}.json", obj)
    w(o / "lp-history.json", store.read_lp_hist())
    for mid in store.list_details():
        (o / "matches" / f"{mid}.json").write_text(store.read_detail_raw(mid) + "\n", encoding="utf-8")
    w(o / "weeks.json", store.read_weeks())
    w(o / "events.json", store.read_events())
    w(o / "notify-state.json", store.read_notify_state())
    pub = store.get_state_raw("publicado")
    if pub:
        (o / "data.json").write_text(pub + "\n", encoding="utf-8")


def _same(a, b, path, errs):
    """Igualdad estricta: además del valor, el tipo (1 frente a 1.0, False frente a 0) y el orden de las listas."""
    if type(a) is not type(b):
        errs.append(f"{path}: tipo {type(a).__name__} ≠ {type(b).__name__}")
        return
    if isinstance(a, dict):
        if set(a) != set(b):
            errs.append(f"{path}: claves {sorted(set(a) ^ set(b))}")
        for k in a.keys() & b.keys():
            _same(a[k], b[k], f"{path}.{k}", errs)
    elif isinstance(a, list):
        if len(a) != len(b):
            errs.append(f"{path}: {len(a)} ≠ {len(b)} elementos")
        for i, (x, y) in enumerate(zip(a, b)):
            _same(x, y, f"{path}[{i}]", errs)
    elif a != b:
        errs.append(f"{path}: {a!r} ≠ {b!r}")


def verify(data_dir, store):
    """Compara cada JSON original con el que sale de la base de datos. Devuelve (recuento, errores)."""
    d = Path(data_dir)
    errs = []
    puuids = _load(d / "puuids.json") if (d / "puuids.json").exists() else {}
    by_hash = {hash_of(v["puuid"]): v["puuid"] for v in puuids.values() if v.get("puuid")}
    _same(puuids, store.read_puuids(), "puuids.json", errs)
    expected = {"partidas_solo": 0, "partidas_flex": 0, "descartadas": 0, "historiales_solo": 0, "historiales_flex": 0}
    for f in sorted((d / "history").glob("*.json")):
        flex = f.stem.endswith("-flex")
        h = f.stem[:-5] if flex else f.stem
        puuid = by_hash.get(h, f"hash:{h}")
        orig = _load(f)
        if isinstance(orig, list):
            orig = {"games": orig, "skipped": []}
        got = store.read_flex(puuid) if flex else store.read_history(puuid)
        _same(orig, got, f"history/{f.name}", errs)
        expected["historiales_flex" if flex else "historiales_solo"] += 1
        expected["partidas_flex" if flex else "partidas_solo"] += len(orig.get("games") or [])
        expected["descartadas"] += len(orig.get("skipped") or [])
    lp = _load(d / "lp-history.json")
    _same(lp, store.read_lp_hist(), "lp-history.json", errs)
    expected["fotos_lp"] = sum(len(v) for v in lp.values())
    files = sorted((d / "matches").glob("*.json"))
    expected["detalles"] = len(files)
    for f in files:
        raw = store.read_detail_raw(f.stem)
        if raw is None:
            errs.append(f"matches/{f.name}: falta")
        else:
            _same(_load(f), json.loads(raw), f"matches/{f.name}", errs)
    for name, key, reader in (("weeks.json", "semanas", store.read_weeks), ("events.json", "eventos", store.read_events),
                              ("notify-state.json", None, store.read_notify_state)):
        orig = _load(d / name)
        _same(orig, reader(), name, errs)
        if key:
            expected[key] = len(orig[name.split(".")[0]])
    ns = _load(d / "notify-state.json")
    expected["retos_avisados"] = len(ns.get("challenges") or {})
    expected["avisos_pendientes"] = len(ns.get("pending") or [])
    expected["cuentas"] = len(puuids)
    pub = store.get_state_raw("publicado")
    if (d / "data.json").read_text(encoding="utf-8").rstrip("\n") != pub:
        errs.append("data.json: el texto publicado no coincide")
    counts = store.counts()
    for k, v in expected.items():
        if counts.get(k) != v:
            errs.append(f"recuento {k}: JSON {v} ≠ SQLite {counts.get(k)}")
    return {k: (expected[k], counts[k]) for k in expected}, errs


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m soloq.importer")
    ap.add_argument("accion", choices=["importar", "exportar", "comprobar"])
    ap.add_argument("carpeta")
    ap.add_argument("--db", default=str(config.DB_PATH))
    ap.add_argument("--quick-state", help=".quick-state.json del actualizador de Node (opcional)")
    ap.add_argument("--reemplazar", action="store_true", help="borrar antes lo que haya en la base de datos")
    ap.add_argument("--espejo", action="store_true",
                    help="copia de lo que publica la GitHub Action (mientras convive): reemplaza, deja latido y solo habla si falla")
    a = ap.parse_args(argv)
    Path(a.db).parent.mkdir(parents=True, exist_ok=True)
    store = Store(a.db)
    if a.accion == "exportar":
        export_dir(store, a.carpeta)
        print(f"Exportado a {a.carpeta}")
        return 0
    if a.accion == "importar":
        unknown = import_dir(a.carpeta, store, {"rapida": a.quick_state}, replace=a.reemplazar or a.espejo)
        if unknown:
            print(f"Aviso: historiales sin cuenta en puuids.json (guardados por su hash): {', '.join(unknown)}")
    counts, errs = verify(a.carpeta, store)
    if a.espejo and not errs:
        import time
        now = int(time.time() * 1000)
        store.set_state("pasada", {"v": 1, "at": now, "ok": True, "full": False, "err": None, "msg": None, "live": None,
                                   "liveErr": None, "accErr": [], "calls": 0, "espejo": True})
        store.set_state("latido", {"beat": now})
        return 0
    print(f"{'tabla':<20}{'JSON':>8}{'SQLite':>8}")
    for k, (e, g) in counts.items():
        print(f"{k:<20}{e:>8}{g:>8}{'' if e == g else '  ✗'}")
    if errs:
        print(f"\n✗ {len(errs)} diferencias:")
        for e in errs[:50]:
            print("  ", e)
        return 1
    print("\n✓ Todo el historial está en SQLite y coincide con los JSON elemento a elemento.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
