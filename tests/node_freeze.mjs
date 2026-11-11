// Precarga para las pruebas de paridad: congela el reloj (FAKE_NOW) y manda Data Dragon al servidor simulado.
const T = Number(process.env.FAKE_NOW);
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(T); else super(...a); }
  static now() { return T; }
}
globalThis.Date = FakeDate;
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => realFetch(String(url).replace('https://ddragon.leagueoflegends.com', `${process.env.FAKE_BASE}/ddragon`), opts);
