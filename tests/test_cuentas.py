"""Cuentas de punta a punta: alta, entrada con y sin verificación en dos pasos (opcional), activarla y desactivarla,
códigos que no se reutilizan, restablecer el acceso, sesiones deslizantes, permisos de administración y la migración
desde la entrada antigua. Copiado de luz y estado."""

import os
import tempfile
import time
import unittest
from pathlib import Path

os.environ.setdefault("SOLOQ_SEGURO", "0")

from fastapi.testclient import TestClient  # noqa: E402

from soloq import accounts, admin, cuentas_api, server  # noqa: E402

H = {"X-Panel": "1"}
CLAVE = "una-clave-larga"


def codigo(secret, delta=0):
    return accounts.totp(secret, int(time.time() // 30) + delta)


class Cuentas(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        accounts.DB_PATH = Path(self.tmp.name) / "cuentas.db"
        cuentas_api.CONF.update(secure=False, cookie="sesion_prueba")
        cuentas_api.reiniciar()
        self.host = "localhost"

    def cliente(self):
        return TestClient(server.app, base_url=f"http://{self.host}")

    def invitar(self, *, admin=False, kind="alta", user_id=None):
        con = accounts.connect()
        token, _ = accounts.create_invite(con, kind, created_by=None, is_admin=admin, user_id=user_id)
        con.commit()
        con.close()
        return token

    def alta(self, nombre, *, admin=False):
        c = self.cliente()
        token = self.invitar(admin=admin)
        info = c.get(f"/api/invite/{token}").json()
        self.assertEqual(info["kind"], "alta")
        self.assertNotIn("totp_secret", info)
        r = c.post(f"/api/invite/{token}", headers=H, json={"username": nombre, "password": CLAVE})
        self.assertEqual(r.status_code, 200, r.text)
        return c

    def activar(self, c, delta=0):
        nuevo = c.get("/api/2fa/nuevo").json()
        self.assertTrue(nuevo["totp_qr"].startswith("data:image/svg+xml"))
        secreto = nuevo["totp_secret"]
        r = c.post("/api/2fa", headers=H, json={"activar": True, "clave": CLAVE, "totp_secret": secreto, "codigo": "000000"})
        self.assertEqual(r.status_code, 400, "el primer código tiene que valer")
        r = c.post("/api/2fa", headers=H,
                   json={"activar": True, "clave": CLAVE, "totp_secret": secreto, "codigo": codigo(secreto, delta)})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(c.get("/api/me").json()["totp"])
        return secreto

    def test_alta_sin_verificacion_y_entrar_con_contrasena(self):
        c = self.alta("pepe")
        self.assertFalse(c.get("/api/me").json()["totp"], "desactivada por defecto")
        otro = self.cliente()
        r = otro.post("/api/entrar", json={"usuario": "pepe", "clave": CLAVE}, headers=H)
        self.assertEqual(r.json(), {"ok": True})
        self.assertEqual(otro.get("/api/me").status_code, 200)
        self.assertEqual(self.cliente().post("/api/entrar", json={"usuario": "pepe", "clave": "mala"}, headers=H).status_code, 401)

    def test_entrar_con_verificacion_pide_el_codigo(self):
        c = self.alta("pepe")
        secreto = self.activar(c)
        otro = self.cliente()
        r = otro.post("/api/entrar", json={"usuario": "pepe", "clave": CLAVE}, headers=H)
        self.assertEqual((r.status_code, r.json()), (200, {"codigo": True}))
        self.assertEqual(otro.get("/api/me").status_code, 401, "sin código no hay sesión")
        r = otro.post("/api/entrar", json={"usuario": "pepe", "clave": "mala", "codigo": codigo(secreto, 1)}, headers=H)
        self.assertEqual(r.status_code, 401, "la contraseña mala no pide código")
        datos = {"usuario": "pepe", "clave": CLAVE, "codigo": codigo(secreto, 1)}
        self.assertEqual(otro.post("/api/entrar", json=datos, headers=H).json(), {"ok": True})
        self.assertEqual(otro.get("/").status_code, 200)
        tercero = self.cliente()
        self.assertEqual(tercero.post("/api/entrar", json=datos, headers=H).status_code, 401, "mismo código dos veces")

    def test_activar_y_desactivar_cierra_las_demas_sesiones(self):
        c = self.alta("pepe")
        otro = self.cliente()
        otro.post("/api/entrar", json={"usuario": "pepe", "clave": CLAVE}, headers=H)
        self.assertEqual(otro.get("/api/me").status_code, 200)
        secreto = self.activar(c)
        self.assertEqual(c.get("/api/me").status_code, 200, "la sesión desde la que se activa sigue")
        self.assertEqual(otro.get("/api/me").status_code, 401, "las demás se cierran")
        r = c.post("/api/2fa", headers=H, json={"activar": False, "clave": CLAVE, "codigo": "000000"})
        self.assertEqual(r.status_code, 400, "para desactivarla hace falta un código válido")
        r = c.post("/api/2fa", headers=H, json={"activar": False, "clave": CLAVE, "codigo": codigo(secreto, 1)})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(c.get("/api/me").json()["totp"])

    def test_bloqueo_por_intentos(self):
        self.alta("pepe")
        c = self.cliente()
        for _ in range(5):
            c.post("/api/entrar", json={"usuario": "pepe", "clave": "mala", "codigo": "123456"}, headers=H)
        self.assertEqual(c.post("/api/entrar", json={"usuario": "pepe", "clave": "x", "codigo": "1"}, headers=H).status_code, 429)

    def test_restablecer_pone_clave_nueva_y_quita_la_verificacion(self):
        admin_c = self.alta("jefe", admin=True)
        user_c = self.alta("pepe")
        viejo = self.activar(user_c)
        uid = user_c.get("/api/me").json()["id"]
        link = admin_c.post(f"/api/admin/users/{uid}/reset", headers=H).json()["link"]
        token = link.split("#t=")[1]
        anon = self.cliente()
        info = anon.get(f"/api/invite/{token}").json()
        self.assertEqual((info["kind"], info["username"]), ("reset", "pepe"))
        r = anon.post(f"/api/invite/{token}", headers=H, json={"password": "otra-clave-larga"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(user_c.get("/api/me").status_code, 401, "cierra sus otras sesiones")
        self.assertFalse(anon.get("/api/me").json()["totp"], "el móvil perdido ya no hace falta")
        c = self.cliente()
        r = c.post("/api/entrar", json={"usuario": "pepe", "clave": "otra-clave-larga", "codigo": codigo(viejo, 1)}, headers=H)
        self.assertEqual(r.json(), {"ok": True})

    def test_cambiar_clave(self):
        c = self.alta("pepe")
        otro = self.cliente()
        r = otro.post("/api/entrar", json={"usuario": "pepe", "clave": CLAVE}, headers=H)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(c.post("/api/clave", json={"actual": "mala", "nueva": "nueva-clave-1"}, headers=H).status_code, 400)
        self.assertEqual(c.post("/api/clave", json={"actual": CLAVE, "nueva": "nueva-clave-1"}, headers=H).status_code, 200)
        self.assertEqual(c.get("/api/me").status_code, 200, "la sesión desde la que se cambia sigue abierta")
        self.assertEqual(otro.get("/api/me").status_code, 401, "las demás sesiones de la cuenta se cierran")

    def _sesiones(self, sql, *args):
        con = accounts.connect()
        con.execute(sql, args)
        con.commit()
        con.close()

    def test_sesion_deslizante_de_30_dias(self):
        from datetime import datetime, timedelta
        c = self.alta("pepe")
        cookie = c.cookies.get("sesion_prueba")
        self.assertTrue(cookie)
        # Lleva 20 días abierta y le quedan 10: al usarla se renueva a 30 días desde hoy y se reenvía la cookie.
        hace = (datetime.now() - timedelta(days=20)).isoformat(timespec="seconds")
        queda = (datetime.now() + timedelta(days=10)).isoformat(timespec="seconds")
        self._sesiones("UPDATE sessions SET last_seen=?, created_at=?, expires_at=?", hace, hace, queda)
        r = c.get("/api/me")
        self.assertEqual(r.status_code, 200)
        self.assertIn("max-age=2592000", r.headers.get("set-cookie", "").lower())
        self.assertIn("samesite=lax", r.headers["set-cookie"].lower())
        self.assertIn("httponly", r.headers["set-cookie"].lower())
        con = accounts.connect()
        fin = datetime.fromisoformat(con.execute("SELECT expires_at FROM sessions").fetchone()[0])
        con.close()
        self.assertGreater(fin, datetime.now() + timedelta(days=29))
        # Usarla otra vez enseguida no reescribe nada (como mucho una vez cada 5 min).
        self.assertNotIn("set-cookie", c.get("/api/me").headers)
        # 30 días sin entrar: caduca y hay que volver a entrar con contraseña y código.
        self._sesiones("UPDATE sessions SET expires_at=?", (datetime.now() - timedelta(seconds=1)).isoformat(timespec="seconds"))
        self.assertEqual(c.get("/api/me").status_code, 401)

    def test_administracion(self):
        admin_c = self.alta("jefe", admin=True)
        user_c = self.alta("pepe")
        uid = user_c.get("/api/me").json()["id"]
        for ruta in ("/api/admin/overview", "/api/admin/sessions", "/api/admin/events", f"/api/admin/users/{uid}"):
            self.assertEqual(user_c.get(ruta).status_code, 403, ruta)
        self.assertEqual(user_c.get("/admin", follow_redirects=False).status_code, 303)
        self.assertEqual(self.cliente().get("/api/admin/overview").status_code, 401)
        self.assertEqual(admin_c.get("/admin").status_code, 200)

        ov = admin_c.get("/api/admin/overview").json()
        self.assertEqual([u["username"] for u in ov["users"]], ["jefe", "pepe"])
        self.assertFalse(any(u["totp"] for u in ov["users"]))
        self.assertNotIn("totp_secret", str(ov))
        self.assertEqual(ov["security"]["sessions"], 2)

        detalle = admin_c.get(f"/api/admin/users/{uid}").json()
        self.assertNotIn("totp_secret", str(detalle))
        sid = detalle["sessions"][0]["id"]
        self.assertEqual(admin_c.delete(f"/api/admin/sessions/{sid}", headers=H).status_code, 200)
        self.assertEqual(user_c.get("/api/me").status_code, 401)

        link = admin_c.post("/api/admin/invites", json={"note": "Luis"}, headers=H).json()["link"]
        self.assertIn("/cuenta#t=", link)
        jefe = admin_c.get("/api/me").json()["id"]
        self.assertEqual(admin_c.patch(f"/api/admin/users/{jefe}", json={"is_admin": False}, headers=H).status_code, 400)
        self.assertEqual(admin_c.patch(f"/api/admin/users/{uid}", json={"disabled": True}, headers=H).status_code, 200)
        self.assertEqual(admin_c.request("DELETE", f"/api/admin/users/{uid}", json={"confirm": "pepe"}, headers=H).status_code, 200)
        kinds = [e["kind"] for e in admin_c.get("/api/admin/events?cat=admin").json()["events"]]
        self.assertEqual(kinds[:3], ["usuario borrado", "usuario desactivado", "invitación creada"])

    def test_migrar_entrada_antigua(self):
        sal = os.urandom(16)
        import hashlib
        h = hashlib.scrypt(b"la-de-siempre", salt=sal, n=2 ** 14, r=8, p=1, dklen=32)
        hash_file = Path(self.tmp.name) / "clave.scrypt"
        totp_file = Path(self.tmp.name) / "totp"
        hash_file.write_text(f"scrypt${sal.hex()}${h.hex()}\n")
        secreto = accounts.new_totp_secret()
        totp_file.write_text(secreto + "\n")
        self.assertEqual(admin.main(["migrar", "alvaro", str(hash_file), str(totp_file)]), 0)
        self.assertEqual(admin.main(["migrar", "otro", str(hash_file), str(totp_file)]), 0)   # ya hay cuentas: nada
        c = self.cliente()
        r = c.post("/api/entrar", json={"usuario": "alvaro", "clave": "la-de-siempre", "codigo": codigo(secreto)}, headers=H)
        self.assertEqual(r.status_code, 200, "misma contraseña y mismo código que antes")
        me = c.get("/api/me").json()
        self.assertTrue(me["is_admin"])
        con = accounts.connect()
        self.assertEqual(len(accounts.list_users(con)), 1)
        con.close()


if __name__ == "__main__":
    unittest.main()
