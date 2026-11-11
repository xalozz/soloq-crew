"""Almacén SQLite: todo lo que antes eran los JSON de data/ (y los ficheros locales del actualizador).

Tablas
  cuenta          clave de la cuenta (riotId en minúsculas) → puuid                       (puuids.json)
  historial       por puuid y cola ('solo' | 'flex'): seasonComplete                      (history/<hash>[-flex].json)
  partida         partidas compactas de cada historial, en su orden (pos)                 (… .games)
  descartada      remakes ya vistos, en su orden                                          (… .skipped)
  foto_lp         fotos del rango de cada cuenta: [t, puntuación, partidas]               (lp-history.json)
  detalle         detalle de los 10 jugadores de una partida                              (matches/<id>.json)
  semana          semanas cerradas, en su orden                                           (weeks.json)
  evento          registro de hitos, más reciente primero                                 (events.json)
  reto_aviso      cuándo se anunció el inicio / fin de cada reto                          (notify-state.json .challenges)
  aviso_pendiente avisos de Discord que fallaron y se reintentan                          (notify-state.json .pending)
  estado          resto de estado en JSON: 'avisos' (v, weeklySent, welcomed…), 'rapida' (.quick-state.json),
                  'campeones' (.champ-ids.json), 'pasada' (.status.json), 'publicado' (data.json tal cual se sirve)

Las partidas, semanas y eventos se guardan como el JSON original de cada elemento: leer y volver a
escribir no cambia nada (ni campos que falten ni el tipo de los números).
"""

import json
import sqlite3
from contextlib import contextmanager

from .js import dumps

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT);
CREATE TABLE IF NOT EXISTS cuenta (clave TEXT PRIMARY KEY, puuid TEXT NOT NULL, pos INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS historial (
  puuid TEXT NOT NULL, cola TEXT NOT NULL CHECK (cola IN ('solo', 'flex')),
  season_complete INTEGER,            -- NULL = el JSON no lo tenía
  PRIMARY KEY (puuid, cola));
CREATE TABLE IF NOT EXISTS partida (
  puuid TEXT NOT NULL, cola TEXT NOT NULL, pos INTEGER NOT NULL,
  id TEXT NOT NULL, t INTEGER, v INTEGER, datos TEXT NOT NULL,
  PRIMARY KEY (puuid, cola, pos));
CREATE INDEX IF NOT EXISTS partida_id ON partida (id);
CREATE TABLE IF NOT EXISTS descartada (
  puuid TEXT NOT NULL, cola TEXT NOT NULL, pos INTEGER NOT NULL, id TEXT NOT NULL,
  PRIMARY KEY (puuid, cola, pos));
CREATE TABLE IF NOT EXISTS foto_lp (
  clave TEXT NOT NULL, pos INTEGER NOT NULL, t INTEGER NOT NULL, puntos INTEGER NOT NULL,
  partidas INTEGER, con_partidas INTEGER NOT NULL,   -- con_partidas = 0: foto antigua [t, puntos] sin el tercer valor
  PRIMARY KEY (clave, pos));
CREATE TABLE IF NOT EXISTS orden_lp (clave TEXT PRIMARY KEY, pos INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS detalle (id TEXT PRIMARY KEY, datos TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS semana (pos INTEGER PRIMARY KEY, clave TEXT NOT NULL, desde INTEGER, datos TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evento (pos INTEGER PRIMARY KEY, id TEXT NOT NULL, t INTEGER, datos TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reto_aviso (pos INTEGER NOT NULL, id TEXT PRIMARY KEY, datos TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS aviso_pendiente (pos INTEGER PRIMARY KEY, id TEXT, at INTEGER, embed TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS estado (clave TEXT PRIMARY KEY, datos TEXT NOT NULL);
"""


def _j(o):
    return dumps(o)


class Store:
    def __init__(self, path):
        self.path = str(path)
        self.db = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.execute("PRAGMA busy_timeout=30000")
        self.db.executescript(SCHEMA)
        self.db.execute("INSERT OR IGNORE INTO meta VALUES ('version', ?)", (str(SCHEMA_VERSION),))
        self._tx = 0

    def close(self):
        self.db.close()

    @contextmanager
    def tx(self):
        if self._tx:
            self._tx += 1
            try:
                yield
            finally:
                self._tx -= 1
            return
        self.db.execute("BEGIN IMMEDIATE")
        self._tx = 1
        try:
            yield
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        finally:
            self._tx = 0

    # ------------------------------------------------------------ estado genérico
    def get_state(self, key, fallback=None):
        r = self.db.execute("SELECT datos FROM estado WHERE clave = ?", (key,)).fetchone()
        return json.loads(r[0]) if r else fallback

    def get_state_raw(self, key):
        r = self.db.execute("SELECT datos FROM estado WHERE clave = ?", (key,)).fetchone()
        return r[0] if r else None

    def set_state(self, key, obj):
        self.set_state_raw(key, _j(obj))

    def set_state_raw(self, key, text):
        self.db.execute("INSERT INTO estado VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET datos = excluded.datos", (key, text))

    # ------------------------------------------------------------ cuentas (puuids.json)
    def read_puuids(self):
        return {k: {"puuid": p} for k, p in self.db.execute("SELECT clave, puuid FROM cuenta ORDER BY pos")}

    def write_puuids(self, cache):
        with self.tx():
            self.db.execute("DELETE FROM cuenta")
            for i, (k, v) in enumerate(cache.items()):
                if v and v.get("puuid"):
                    self.db.execute("INSERT INTO cuenta VALUES (?, ?, ?)", (k, v["puuid"], i))

    # ------------------------------------------------------------ historiales
    def _read_hist(self, puuid, cola):
        h = self.db.execute("SELECT season_complete FROM historial WHERE puuid = ? AND cola = ?", (puuid, cola)).fetchone()
        if not h:
            return None
        games = [json.loads(r[0]) for r in self.db.execute(
            "SELECT datos FROM partida WHERE puuid = ? AND cola = ? ORDER BY pos", (puuid, cola))]
        skipped = [r[0] for r in self.db.execute(
            "SELECT id FROM descartada WHERE puuid = ? AND cola = ? ORDER BY pos", (puuid, cola))]
        out = {"games": games, "skipped": skipped}
        if h[0] is not None:
            out["seasonComplete"] = bool(h[0])
        return out

    def _write_hist(self, puuid, cola, obj):
        sc = obj.get("seasonComplete")
        with self.tx():
            self.db.execute("DELETE FROM partida WHERE puuid = ? AND cola = ?", (puuid, cola))
            self.db.execute("DELETE FROM descartada WHERE puuid = ? AND cola = ?", (puuid, cola))
            self.db.execute("INSERT INTO historial VALUES (?, ?, ?) ON CONFLICT(puuid, cola) DO UPDATE SET season_complete = excluded.season_complete",
                            (puuid, cola, None if sc is None else int(bool(sc))))
            self.db.executemany("INSERT INTO partida VALUES (?, ?, ?, ?, ?, ?, ?)", [
                (puuid, cola, i, g["id"], g.get("t"), g.get("v"), _j(g)) for i, g in enumerate(obj.get("games") or [])])
            self.db.executemany("INSERT INTO descartada VALUES (?, ?, ?, ?)", [
                (puuid, cola, i, s) for i, s in enumerate(obj.get("skipped") or [])])

    def read_history(self, puuid):
        """{games, skipped, seasonComplete} o [] si no hay (como readJson(hf, []))."""
        h = self._read_hist(puuid, "solo")
        return h if h is not None else []

    def write_history(self, puuid, obj):
        self._write_hist(puuid, "solo", obj)

    def read_flex(self, puuid):
        h = self._read_hist(puuid, "flex")
        return h if h is not None else {"games": [], "skipped": []}

    def write_flex(self, puuid, obj):
        self._write_hist(puuid, "flex", obj)

    # ------------------------------------------------------------ fotos de LP
    def read_lp_hist(self):
        out = {}
        for k, in self.db.execute("SELECT clave FROM orden_lp ORDER BY pos"):
            out[k] = []
        for k, t, s, n, con in self.db.execute("SELECT clave, t, puntos, partidas, con_partidas FROM foto_lp ORDER BY clave, pos"):
            out.setdefault(k, []).append([t, s, n] if con else [t, s])
        return out

    def write_lp_hist(self, hist):
        with self.tx():
            self.db.execute("DELETE FROM foto_lp")
            self.db.execute("DELETE FROM orden_lp")
            for o, (k, arr) in enumerate(hist.items()):
                self.db.execute("INSERT INTO orden_lp VALUES (?, ?)", (k, o))
                self.db.executemany("INSERT INTO foto_lp VALUES (?, ?, ?, ?, ?, ?)", [
                    (k, i, p[0], p[1], p[2] if len(p) > 2 else None, 1 if len(p) > 2 else 0) for i, p in enumerate(arr)])

    # ------------------------------------------------------------ detalle de partidas
    def detail_exists(self, mid):
        return self.db.execute("SELECT 1 FROM detalle WHERE id = ?", (mid,)).fetchone() is not None

    def write_detail(self, mid, obj):
        self.db.execute("INSERT INTO detalle VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET datos = excluded.datos", (mid, _j(obj)))

    def read_detail_raw(self, mid):
        r = self.db.execute("SELECT datos FROM detalle WHERE id = ?", (mid,)).fetchone()
        return r[0] if r else None

    def list_details(self):
        return [r[0] for r in self.db.execute("SELECT id FROM detalle ORDER BY id")]

    def delete_details(self, ids):
        with self.tx():
            self.db.executemany("DELETE FROM detalle WHERE id = ?", [(i,) for i in ids])

    # ------------------------------------------------------------ semanas y eventos
    def read_weeks(self):
        return {"weeks": [json.loads(r[0]) for r in self.db.execute("SELECT datos FROM semana ORDER BY pos")]}

    def write_weeks(self, archive):
        with self.tx():
            self.db.execute("DELETE FROM semana")
            self.db.executemany("INSERT INTO semana VALUES (?, ?, ?, ?)", [
                (i, w.get("key"), w.get("from"), _j(w)) for i, w in enumerate(archive.get("weeks") or [])])

    def read_events(self):
        return {"events": [json.loads(r[0]) for r in self.db.execute("SELECT datos FROM evento ORDER BY pos")]}

    def write_events(self, log):
        with self.tx():
            self.db.execute("DELETE FROM evento")
            self.db.executemany("INSERT INTO evento VALUES (?, ?, ?, ?)", [
                (i, e.get("id"), e.get("t"), _j(e)) for i, e in enumerate(log.get("events") or [])])

    # ------------------------------------------------------------ avisos (notify-state.json)
    def read_notify_state(self):
        st = self.get_state("avisos")
        if st is None:
            return {"v": 1}
        rows = list(self.db.execute("SELECT id, datos FROM reto_aviso ORDER BY pos"))
        if rows or st.pop("_retos", False):
            st["challenges"] = {i: json.loads(d) for i, d in rows}
        pend = list(self.db.execute("SELECT id, at, embed FROM aviso_pendiente ORDER BY pos"))
        if pend or st.pop("_pendientes", False):
            st["pending"] = [{"id": i, "at": at, "embed": json.loads(e)} for i, at, e in pend]
        st.pop("_retos", None)
        st.pop("_pendientes", None)
        return st

    def write_notify_state(self, state):
        rest = {k: v for k, v in state.items() if k not in ("challenges", "pending")}
        if "challenges" in state:
            rest["_retos"] = True
        if "pending" in state:
            rest["_pendientes"] = True
        with self.tx():
            self.db.execute("DELETE FROM reto_aviso")
            self.db.executemany("INSERT INTO reto_aviso VALUES (?, ?, ?)", [
                (i, cid, _j(v)) for i, (cid, v) in enumerate((state.get("challenges") or {}).items())])
            self.db.execute("DELETE FROM aviso_pendiente")
            self.db.executemany("INSERT INTO aviso_pendiente VALUES (?, ?, ?, ?)", [
                (i, p.get("id"), p.get("at"), _j(p.get("embed"))) for i, p in enumerate(state.get("pending") or [])])
            self.set_state("avisos", rest)

    # ------------------------------------------------------------ lo publicado
    def read_published(self):
        raw = self.get_state_raw("publicado")
        return json.loads(raw) if raw else None

    def write_published(self, text):
        self.set_state_raw("publicado", text)

    # ------------------------------------------------------------ recuento (para comprobar la importación)
    def counts(self):
        q = lambda sql, *a: self.db.execute(sql, a).fetchone()[0]
        return {
            "cuentas": q("SELECT COUNT(*) FROM cuenta"),
            "historiales_solo": q("SELECT COUNT(*) FROM historial WHERE cola = 'solo'"),
            "historiales_flex": q("SELECT COUNT(*) FROM historial WHERE cola = 'flex'"),
            "partidas_solo": q("SELECT COUNT(*) FROM partida WHERE cola = 'solo'"),
            "partidas_flex": q("SELECT COUNT(*) FROM partida WHERE cola = 'flex'"),
            "descartadas": q("SELECT COUNT(*) FROM descartada"),
            "fotos_lp": q("SELECT COUNT(*) FROM foto_lp"),
            "detalles": q("SELECT COUNT(*) FROM detalle"),
            "semanas": q("SELECT COUNT(*) FROM semana"),
            "eventos": q("SELECT COUNT(*) FROM evento"),
            "retos_avisados": q("SELECT COUNT(*) FROM reto_aviso"),
            "avisos_pendientes": q("SELECT COUNT(*) FROM aviso_pendiente"),
        }
