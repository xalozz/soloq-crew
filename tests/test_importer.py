"""Importador: todo data/ entra en SQLite sin perder nada y sale igual."""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from soloq.importer import _same, export_dir, import_dir, verify
from soloq.store import Store

DATA = Path(__file__).resolve().parent.parent / "data"


@unittest.skipUnless((DATA / "data.json").exists(), "faltan los datos reales en data/")
class Importador(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.store = Store(self.tmp / "s.db")

    def tearDown(self):
        self.store.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_importa_todo_y_cuadra(self):
        self.assertEqual(import_dir(DATA, self.store), [])
        counts, errs = verify(DATA, self.store)
        self.assertEqual(errs, [])
        for k, (esperado, hay) in counts.items():
            self.assertEqual(esperado, hay, k)
        self.assertGreater(counts["fotos_lp"][0], 0)
        self.assertGreater(counts["partidas_solo"][0], 0)

    def test_ida_y_vuelta(self):
        import_dir(DATA, self.store)
        out = self.tmp / "out"
        export_dir(self.store, out)
        orig = sorted(str(p.relative_to(DATA)) for p in DATA.rglob("*.json"))
        back = sorted(str(p.relative_to(out)) for p in out.rglob("*.json"))
        self.assertEqual(orig, back)
        for f in orig:
            errs = []
            _same(json.loads((DATA / f).read_text(encoding="utf-8")), json.loads((out / f).read_text(encoding="utf-8")), f, errs)
            self.assertEqual(errs, [], f)

    def test_reimportar_no_duplica(self):
        import_dir(DATA, self.store)
        c1 = self.store.counts()
        import_dir(DATA, self.store)
        self.assertEqual(c1, self.store.counts())

    def test_fotos_antiguas_sin_partidas(self):
        # [t, puntos] y [t, puntos, null] no son lo mismo para el actualizador: hay que conservar la diferencia
        self.store.write_lp_hist({"a#x": [[1, 100], [2, 110, None], [3, 120, 7]]})
        self.assertEqual(self.store.read_lp_hist(), {"a#x": [[1, 100], [2, 110, None], [3, 120, 7]]})

    def test_avisos(self):
        st = {"v": 1, "challenges": {"r": {"started": 5}}, "weeklySent": "2026-W45", "pending": [{"id": "x", "at": 3, "embed": {"title": "t"}}],
              "welcomed": 9}
        self.store.write_notify_state(st)
        self.assertEqual(self.store.read_notify_state(), st)
        self.store.write_notify_state({"v": 1})
        self.assertEqual(self.store.read_notify_state(), {"v": 1})


if __name__ == "__main__":
    unittest.main()
