"""Bucle del actualizador (lo que hacía la GitHub Action): una pasada rápida por minuto y una completa
cada FULL_EVERY ciclos. Cada pasada va en un proceso aparte con tiempo máximo, como el `timeout` de la
Action, para que una pasada colgada no pare el bucle. Tras cada pasada deja el latido en la base de datos
(lo lee la web en /api/latido).

  python -m soloq.bucle

Variables: CYCLE_SECONDS (60), FULL_EVERY (15), FULL_TIMEOUT (900), QUICK_TIMEOUT (240).
"""

import logging
import os
import signal
import subprocess
import sys
import time

from . import config
from .store import Store

log = logging.getLogger("soloq")


def _int(name, default):
    try:
        return int(os.environ.get(name) or default)
    except ValueError:
        return default


def main():
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    cycle = _int("CYCLE_SECONDS", 60)
    full_every = _int("FULL_EVERY", 15)
    timeouts = {True: _int("QUICK_TIMEOUT", 240), False: _int("FULL_TIMEOUT", 900)}
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    store = Store(config.DB_PATH)
    stop = []
    signal.signal(signal.SIGTERM, lambda *_: stop.append(1))
    i = 0
    while not stop:
        t0 = time.monotonic()
        quick = i % full_every != 0
        args = [sys.executable, "-m", "soloq.update"] + (["--quick"] if quick else [])
        try:
            r = subprocess.run(args, timeout=timeouts[quick])
            if r.returncode:
                log.warning("La pasada %s ha fallado (código %s)", "rápida" if quick else "completa", r.returncode)
        except subprocess.TimeoutExpired:
            log.warning("La pasada %s se ha colgado; se reintenta más tarde", "rápida" if quick else "completa")
        try:
            store.set_state("latido", {"beat": int(time.time() * 1000)})
        except Exception as err:  # la base de datos ocupada no debe parar el bucle
            log.warning("No se pudo guardar el latido: %s", err)
        i += 1
        left = cycle - (time.monotonic() - t0)
        while left > 0 and not stop:
            time.sleep(min(left, 1))
            left -= 1
    store.close()


if __name__ == "__main__":
    main()
