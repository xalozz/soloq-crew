"""Consola de cuentas (copiado de luz y estado). En el VPS, como el usuario del servicio:

    python -m soloq.admin usuarios
    python -m soloq.admin invitar [--admin] [--nota "Pepe"]
    python -m soloq.admin restablecer <usuario>
    python -m soloq.admin migrar <usuario> <hash> <totp>     # la entrada antigua de un solo usuario → cuenta admin

`migrar` solo actúa si todavía no hay ninguna cuenta: crea un administrador con la contraseña (hash scrypt) y el
secreto TOTP de antes, así se sigue entrando con lo mismo (y el mismo código de la app), ahora con usuario.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import accounts, cuentas_api, server  # noqa: F401  (server fija la ruta de la base y el nombre de la app)


def _link(token: str) -> str:
    base = cuentas_api.CONF["public_url"] or f"https://{cuentas_api.CONF['app']}.xalozz.es"
    return f"{base}/cuenta#t={token}"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m soloq.admin")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("usuarios")
    inv = sub.add_parser("invitar")
    inv.add_argument("--admin", action="store_true")
    inv.add_argument("--nota", default="")
    rst = sub.add_parser("restablecer")
    rst.add_argument("usuario")
    mig = sub.add_parser("migrar")
    mig.add_argument("usuario")
    mig.add_argument("hash", type=Path)
    mig.add_argument("totp", type=Path)
    args = p.parse_args(argv)

    con = accounts.connect()
    try:
        if args.cmd == "usuarios":
            for u in accounts.list_users(con):
                flags = ",".join(f for f, on in (("admin", u["is_admin"]), ("desactivado", u["disabled"])) if on)
                print(f"{u['id']:>3}  {u['username']:<20} {flags:<18} última entrada {u['last_login'] or 'nunca'}")
        elif args.cmd == "invitar":
            token, expires = accounts.create_invite(con, "alta", created_by=None, is_admin=args.admin, note=args.nota)
            accounts.log(con, "invitación creada", detail=f"desde la consola{' (admin)' if args.admin else ''}")
            con.commit()
            print(f"{_link(token)}\ncaduca {expires}")
        elif args.cmd == "restablecer":
            user = accounts.get_user_by_name(con, args.usuario)
            if user is None:
                print("Ese usuario no existe.", file=sys.stderr)
                return 1
            token, expires = accounts.create_invite(con, "reset", created_by=None, user_id=user["id"])
            accounts.log(con, "enlace para restablecer el acceso", user_id=user["id"], detail="desde la consola")
            con.commit()
            print(f"{_link(token)}\ncaduca {expires}")
        elif args.cmd == "migrar":
            if accounts.list_users(con):
                print("Ya hay cuentas: no se migra nada.")
                return 0
            pw_hash = args.hash.read_text().strip()
            secret = args.totp.read_text().strip()
            if pw_hash.count("$") not in (2, 5):
                print("El hash no tiene el formato esperado.", file=sys.stderr)
                return 1
            uid = accounts.create_user(con, args.usuario, None, pw_hash=pw_hash, totp_secret=secret, is_admin=True)
            accounts.log(con, "cuenta migrada", user_id=uid,
                         detail="desde la entrada antigua de un solo usuario (misma contraseña y mismo código)")
            con.commit()
            print(f"Cuenta «{args.usuario}» creada como administrador.")
    except accounts.AccountError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
