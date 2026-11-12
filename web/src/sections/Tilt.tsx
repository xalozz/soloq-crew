// Tilt y horarios
import type { ReactNode } from 'react';
import { useApp } from '../ctx';
import { vars } from '../components/PlayerDetail';
import { shrink, tiltRule, type Player } from '../lib/model';
import type { WN } from '../types';
import { ariaFlag, fmt, fmtInt, pct } from '../lib/util';

const DOW_ES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const BANDS = ['0–4 h', '4–8 h', '8–12 h', '12–16 h', '16–20 h', '20–24 h'];
const SESSION_L = ['1ª', '2ª', '3ª', '4ª', '5ª', '6ª+'];
const PREV_L = ['3+ V', '2 V', '1 V', '1ª', '1 D', '2 D', '3 D', '4+ D'];
const HOURS_L = ['< 1 h', '1–2 h', '2–3 h', '3 h +'];
type TiltKey = 'hour' | 'dow' | 'grid' | 'session' | 'prev' | 'hoursIn';

function tiltData(model: Player[], name: string) {
  const rows = model.filter((p) => p.s?.tilt);
  const pick = name === 'Grupo' ? rows : rows.filter((p) => p.name === name);
  if (!pick.length) return null;
  const sum = (key: TiltKey): WN[] => pick[0].s!.tilt![key].map((_, i) => pick.reduce<WN>((acc, p) => {
    const c = p.s!.tilt![key][i] ?? [0, 0];
    return [acc[0] + c[0], acc[1] + c[1]];
  }, [0, 0]));
  const t = { hour: sum('hour'), dow: sum('dow'), grid: sum('grid'), session: sum('session'), prev: sum('prev'), hoursIn: sum('hoursIn') };
  const w = t.dow.reduce((s, c) => s + c[0], 0), n = t.dow.reduce((s, c) => s + c[1], 0);
  return { t, p0: n ? w / n : 0.5, n, sessions: pick.reduce((s, p) => s + (p.s!.tilt!.sessions ?? 0), 0) };
}

const wrColor = (d: number) => {
  const a = Math.min(0.85, Math.abs(d) * 6);
  return d >= 0 ? `rgba(51, 214, 154, ${a})` : `rgba(242, 101, 126, ${a})`;
};

function WrBars({ title, sub, cells, labels, p0 }: { title: string; sub: string | null; cells: WN[]; labels: string[]; p0: number }) {
  return (
    <div className="tl-card"><h4 className="tl-title">{title}</h4>{sub ? <p className="tl-sub">{sub}</p> : null}
      <div className="wrbars" style={vars({ '--cols': `${cells.length}` })}>{cells.map(([w, n], i) => {
        const raw = n ? w / n : null;
        const d = n ? shrink(w, n, p0) - p0 : 0;
        const hgt = raw == null ? 0 : Math.max(3, Math.min(100, ((raw - 0.25) / 0.5) * 100));
        return (
          <div key={i} className={`wb ${n < 10 ? 'low' : ''}`} title={n ? `${labels[i]}: ${w}V ${n - w}D (${fmt(raw! * 100, 1)} %)` : `${labels[i]}: sin partidas`}>
            <span className={`wb-v ${d > 0.015 ? 'pos' : d < -0.015 ? 'neg' : ''}`}>{raw == null ? '–' : `${Math.round(raw * 100)}%`}</span>
            <div className="wb-track"><i className="wb-50" /><i className="wb-bar" style={{ height: `${hgt}%`, background: n < 10 ? '#3a3a41' : d >= 0 ? 'var(--win)' : 'var(--loss)', opacity: `${n < 10 ? 1 : 0.45 + Math.min(0.55, Math.abs(d) * 6)}` }} /></div>
            <span className="wb-l">{labels[i]}</span>
            <span className="wb-n">{`${n}`}</span>
          </div>
        );
      })}</div>
    </div>
  );
}

export function TiltWho({ who, setWho }: { who: string; setWho: (n: string) => void }) {
  const { model } = useApp();
  const rows = model.filter((p) => p.s?.tilt);
  if (!rows.length) return null;
  const cur = who !== 'Grupo' && !rows.some((p) => p.name === who) ? 'Grupo' : who;
  return <>{['Grupo', ...rows.map((p) => p.name)].map((n) => (
    <button key={n} className={`ge-chip ${n === cur ? 'on' : ''}`} style={vars({ '--c': 'var(--accent)' })} {...ariaFlag('aria-pressed', n === cur)} onClick={() => setWho(n)}><i />{n === 'Grupo' ? 'Todo el grupo' : n}</button>
  ))}</>;
}

export function TiltBox({ who }: { who: string }) {
  const { model } = useApp();
  const rows = model.filter((p) => p.s?.tilt);
  if (!rows.length) return <p className="empty">Todavía no hay partidas suficientes.</p>;
  const tiltWho = who !== 'Grupo' && !rows.some((p) => p.name === who) ? 'Grupo' : who;
  const D = tiltData(model, tiltWho)!;
  const { t, p0 } = D;

  // Mejor y peor momento (día × franja con al menos 15 partidas)
  const cells = t.grid.map(([w, n], i) => ({ i, w, n, adj: n ? shrink(w, n, p0) : p0 })).filter((c) => c.n >= 15);
  const bestC = cells.length ? cells.reduce((m, c) => (c.adj > m.adj ? c : m)) : null;
  const worstC = cells.length ? cells.reduce((m, c) => (c.adj < m.adj ? c : m)) : null;
  const cellName = (c: { i: number }) => `${DOW_ES[Math.floor(c.i / 6)].toLowerCase()} de ${BANDS[c.i % 6].replace(' h', '')} h`;
  const player = model.find((p) => p.name === tiltWho);
  const rule = tiltWho === 'Grupo' ? tiltRule({ prev: t.prev }, p0 * 100) : tiltRule(player?.s?.tilt, player?.s?.winrate);
  const [fw, fn] = t.session[0];
  const afterW = [t.prev[0], t.prev[1]].reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]);
  const tips: [string, string][] = [];
  if (rule) tips.push(['🧊', `Tras ${rule.k} derrota${rule.k > 1 ? 's' : ''} seguida${rule.k > 1 ? 's' : ''} ${tiltWho === 'Grupo' ? 'ganáis' : 'ganas'} el ${fmt(rule.wr, 0)} % (${rule.n} partidas). ${tiltWho === 'Grupo' ? 'Ese es vuestro punto para parar.' : 'Ese es tu punto para parar.'}`]);
  else tips.push(['😌', 'No se ve un bajón claro después de perder: las derrotas seguidas no afectan más de lo normal.']);
  if (afterW[1] >= 20 && shrink(afterW[0], afterW[1], p0) >= p0 + 0.03) tips.push(['🔥', `Con 2 o más victorias seguidas, el winrate sube al ${fmt(pct(afterW[0], afterW[1]), 0)} %: si vas en racha, sigue.`]);
  if (fn >= 20) tips.push(['☕', `En la primera partida de cada sesión: ${fmt(pct(fw, fn), 0)} % (${fn} sesiones).`]);
  if (bestC) tips.push(['📈', `Mejor momento: ${cellName(bestC)} (${fmt(pct(bestC.w, bestC.n), 0)} % en ${bestC.n} partidas).`]);
  if (worstC && worstC !== bestC) tips.push(['📉', `Peor momento: ${cellName(worstC)} (${fmt(pct(worstC.w, worstC.n), 0)} % en ${worstC.n} partidas).`]);

  const heatCells: ReactNode[] = [<span key="corner" />, ...BANDS.map((b) => <span key={`h${b}`} className="heat-h">{b}</span>)];
  DOW_ES.forEach((d, di) => {
    heatCells.push(<span key={`d${di}`} className="heat-d">{d.slice(0, 3)}</span>);
    BANDS.forEach((b, bi) => {
      const [w, n] = t.grid[di * 6 + bi];
      const d0 = n ? shrink(w, n, p0) - p0 : 0;
      heatCells.push(
        <span key={`c${di}-${bi}`} className={`heat-c ${n < 10 ? 'low' : ''}`} style={n >= 10 ? { background: wrColor(d0) } : undefined}
          title={n ? `${d} ${b}: ${w}V ${n - w}D (${fmt(pct(w, n), 1)} %)` : `${d} ${b}: sin partidas`}>
          {n ? <b>{`${Math.round(pct(w, n))}%`}</b> : '·'}{n ? <small>{n}</small> : null}
        </span>,
      );
    });
  });

  return (
    <>
      <div className="tl-card tl-rules">
        <h4 className="tl-title">{tiltWho === 'Grupo' ? 'Lo que dicen vuestros datos' : `Lo que dicen los datos de ${tiltWho}`}</h4>
        <p className="tl-sub">{`${fmtInt(D.n)} partidas en ${fmtInt(D.sessions)} sesiones · winrate medio ${fmt(p0 * 100, 1)} %`}</p>
        <ul className="tl-tips">{tips.map(([i, txt], k) => <li key={k}><span aria-hidden="true">{i}</span><span>{txt}</span></li>)}</ul>
      </div>
      <div className="tl-card tl-heat">
        <h4 className="tl-title">Winrate por día y hora</h4>
        <p className="tl-sub">Hora de inicio de la partida (Madrid) · verde: mejor que la media, rojo: peor · las casillas con pocas partidas salen apagadas</p>
        <div className="heat">{heatCells}</div>
      </div>
      <WrBars title="Según cómo venías" sub="Resultado de la partida anterior en la misma sesión (V: victorias seguidas, D: derrotas seguidas)" cells={t.prev} labels={PREV_L} p0={p0} />
      <WrBars title="Según la partida de la sesión" sub="Primera, segunda, tercera… partida desde que empezaste a jugar" cells={t.session} labels={SESSION_L} p0={p0} />
      <WrBars title="Según las horas seguidas jugando" sub="Tiempo desde el inicio de la sesión" cells={t.hoursIn} labels={HOURS_L} p0={p0} />
      <WrBars title="Por día de la semana" sub={null} cells={t.dow} labels={DOW_ES.map((d) => d.slice(0, 3))} p0={p0} />
    </>
  );
}
