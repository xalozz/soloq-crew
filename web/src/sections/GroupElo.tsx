// Evolución del elo de todo el grupo
import { useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { AppContext } from '../ctx';
import { vars } from '../components/PlayerDetail';
import { playerPts, type EloPtN } from '../lib/elo';
import type { Player } from '../lib/model';
import type { Data } from '../types';
import { ariaFlag, dayKey, DIVS, prettyDay, scoreLabel, shortDate, TIER_ES, TIERS } from '../lib/util';

const GE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767', '#7fb7ff'];
const RANGES: [number, string][] = [[14, '2 semanas'], [30, '1 mes'], [0, 'Todo']];

interface Series { name: string; color: string; pts: EloPtN[] }

function geSeries(data: Data, players: Player[]): Series[] {
  // Color fijo por jugador (orden de la configuración), no por posición en el ranking
  return data.players.map((p0, i) => {
    const p = players.find((x) => x.name === p0.name);
    if (!p?.main) return null;
    return { name: p.name, color: GE_COLORS[i % GE_COLORS.length], pts: playerPts(p) };
  }).filter((s): s is Series => !!s && s.pts.length >= 2);
}

export function GroupEloSection() {
  const app = useContext(AppContext);
  const [days, setDays] = useState(30);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [hover, setHover] = useState<string | null>(null);
  // Cada "redibujo" de antes (datos, tamaño, leyenda, rango) empieza de cero: sin tooltip. El resaltado se
  // conserva: antes se borraba, pero el navegador lo volvía a poner si el ratón seguía encima del nombre o la línea
  const [ver, setVer] = useState(0);
  const [width, setWidth] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const redraw = () => setVer((v) => v + 1);
  const data = app?.data;

  useLayoutEffect(() => {
    if (!data) return;
    setWidth(box.current?.clientWidth ?? 0);
    redraw();
  }, [data]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => { clearTimeout(t); t = setTimeout(() => { if (box.current) { setWidth(box.current.clientWidth); redraw(); } }, 150); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); clearTimeout(t); };
  }, []);

  const all = app ? geSeries(app.data, app.model) : [];
  const hoverOn = (name: string | null) => { if (hover === name && name !== null) return; setHover(name); };

  return (
    <div className="panel ge">
      <div className="ge-bar">
        <div className="toggle ge-range" id="ge-range">{RANGES.map(([d, l]) => (
          <button key={d} data-days={d} className={d === days ? 'on' : undefined} onClick={() => { if (!app) return; setDays(d); redraw(); }}>{l}</button>
        ))}</div>
        <div className="ge-actions">
          <button id="ge-all" onClick={() => { setHidden(new Set()); redraw(); }}>Todos</button>
          <button id="ge-none" onClick={() => { if (app) setHidden(new Set(app.data.players.map((p) => p.name))); redraw(); }}>Ninguno</button>
        </div>
      </div>
      <div id="ge-legend" className="ge-legend" onMouseLeave={() => hoverOn(null)}>
        {app && width != null ? all.map((s) => (
          <button key={s.name} className={`ge-chip ${hidden.has(s.name) ? 'off' : ''}`} style={vars({ '--c': s.color })} {...ariaFlag('aria-pressed', !hidden.has(s.name))}
            onClick={() => { setHidden((h) => { const x = new Set(h); if (x.has(s.name)) x.delete(s.name); else x.add(s.name); return x; }); redraw(); }}
            onMouseEnter={() => hoverOn(s.name)} onMouseLeave={() => hoverOn(null)}><i />{s.name}</button>
        )) : null}
      </div>
      <div id="ge-chart" className="ge-chart" ref={box} onMouseLeave={() => hoverOn(null)}>
        {app && width != null ? <GeChart key={ver} all={all} hidden={hidden} days={days} width={width} hover={hover} setHover={hoverOn} /> : null}
      </div>
      <p className="muted small center">Línea continua: LP registrado · discontinua: estimado con sus victorias y derrotas (ver "Evolución de elo" en la ficha de cada uno)</p>
    </div>
  );
}

function GeChart({ all, hidden, days, width, hover, setHover }: { all: Series[]; hidden: Set<string>; days: number; width: number; hover: string | null; setHover: (n: string | null) => void }) {
  const [cross, setCross] = useState(-10);
  const [tip, setTip] = useState<{ px: number; on: boolean } | null>(null);
  const now = Date.now();
  const t0 = days ? now - days * 864e5 : Math.min(...all.map((s) => s.pts[0][0]));
  const vis = all.filter((s) => !hidden.has(s.name)).map((s) => {
    // Recortar al rango, empezando en el valor que tenía en t0
    const before = s.pts.filter((p) => p[0] <= t0).at(-1);
    const inside = s.pts.filter((p) => p[0] > t0);
    const pts: EloPtN[] = before ? [[t0, before[1], before[2]], ...inside] : inside;
    return { ...s, pts };
  }).filter((s) => s.pts.length >= 1);
  const W = Math.max(320, width), H = W < 600 ? 300 : 380, L = 62, R = W < 600 ? 12 : 120, T = 14, B = 28;
  if (!vis.length) return <p className="empty">Selecciona al menos un jugador.</p>;
  let lo = Math.min(...vis.flatMap((s) => s.pts.map((p) => p[1]))), hi = Math.max(...vis.flatMap((s) => s.pts.map((p) => p[1])));
  lo = Math.max(0, Math.floor((lo - 20) / 100) * 100); hi = Math.ceil((hi + 20) / 100) * 100;
  const x = (t: number) => L + ((t - t0) / Math.max(1, now - t0)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const els: ReactNode[] = [];
  const span = hi - lo;
  const step = span > 2400 ? 800 : span > 900 ? 400 : span > 300 ? 200 : 100;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    els.push(<line key={`g${v}`} x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />);
    const lab = v >= 2800 ? `M ${v - 2800}` : `${TIER_ES[TIERS[Math.floor(v / 400)]].slice(0, 3)} ${DIVS[Math.floor((v % 400) / 100)]}`;
    els.push(<text key={`a${v}`} x={L - 8} y={y(v) + 4} className="axis" textAnchor="end">{lab}</text>);
  }
  const nT = Math.max(2, Math.min(7, Math.floor((W - L - R) / 100)));
  for (let k = 0; k < nT; k++) {
    const t = t0 + ((now - t0) * k) / (nT - 1);
    els.push(<text key={`d${k}`} x={x(t)} y={H - 8} className="axis" textAnchor={k === 0 ? 'start' : k === nT - 1 ? 'end' : 'middle'}>{prettyDay(dayKey(t))}</text>);
  }
  // Etiquetas al final de cada línea sin solaparse (separación mínima de 15 px)
  const labelY = new Map<string, number>();
  const labs = vis.map((s) => ({ n: s.name, y: y(s.pts[s.pts.length - 1][1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 15) labs[i].y = labs[i - 1].y + 15;
  const over = labs.length ? labs[labs.length - 1].y - (H - B) : 0;
  if (over > 0) for (const l of labs) l.y -= over;
  for (const l of labs) labelY.set(l.n, l.y);
  const path = (pts: EloPtN[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  // Contenido de cada línea; la resaltada se repite encima (sin la zona de ratón) para que no la tape nada
  const lineKids = (s: (typeof vis)[number], hit: boolean) => {
    // Tramo estimado (discontinuo) y registrado (continuo)
    const firstReal = s.pts.findIndex((p) => !p[2]);
    const estPts = firstReal === -1 ? s.pts : s.pts.slice(0, firstReal + 1);
    const realPts = firstReal === -1 ? [] : s.pts.slice(firstReal);
    const last = s.pts[s.pts.length - 1];
    return (
      <>
        {estPts.length > 1 ? <path d={path(estPts)} className="est" /> : null}
        {realPts.length > 1 ? <path d={path(realPts)} /> : null}
        {hit ? <path d={path(s.pts)} className="hit" /> : null}
        <circle cx={x(last[0])} cy={y(last[1])} r={4} className="end" />
        {R > 40 ? <text x={x(last[0]) + 8} y={(labelY.get(s.name) ?? y(last[1])) + 4} className="ge-lab">{s.name}</text> : null}
      </>
    );
  };
  for (const s of vis) {
    els.push(
      <g key={`l${s.name}`} className={`ge-line ${hover === s.name ? 'hot' : ''} ${hover && hover !== s.name ? 'dim' : ''}`} data-name={s.name} style={vars({ '--c': s.color })}
        onPointerEnter={() => setHover(s.name)} onPointerLeave={() => setHover(null)}>{lineKids(s, true)}</g>,
    );
  }
  const top = hover ? vis.find((s) => s.name === hover) : undefined;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const pxv = ((e.clientX - r.left) / r.width) * W;
    if (pxv < L || pxv > W - R) { setTip((tp) => (tp ? { ...tp, on: false } : tp)); setCross(-10); return; }
    setCross(pxv);
    setTip({ px: pxv, on: true });
  };
  let tipKids: ReactNode = null;
  let tipStyle;
  if (tip) {
    const t = t0 + ((tip.px - L) / (W - L - R)) * (now - t0);
    const rows = vis.map((s) => { const p = s.pts.filter((q) => q[0] <= t).at(-1); return p ? { s, v: p[1], est: p[2] } : null; })
      .filter((r): r is NonNullable<typeof r> => !!r).sort((a, b) => b.v - a.v);
    tipKids = (
      <>
        <b>{shortDate(t)}</b>
        {rows.map((row) => (
          <span key={row.s.name} className={`ge-tr ${hover && hover !== row.s.name ? 'dim' : ''}`} data-name={row.s.name}>
            <i style={{ background: row.s.color }} />{row.s.name}<em>{`${row.est ? '≈ ' : ''}${scoreLabel(row.v)}`}</em></span>
        ))}
      </>
    );
    tipStyle = { left: `${Math.min(80, Math.max(20, (tip.px / W) * 100))}%`, top: '8%' };
  }
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Evolución del elo de todos los jugadores"
        onPointerMove={onMove} onPointerLeave={() => { setTip((tp) => (tp ? { ...tp, on: false } : tp)); setCross(-10); }}>
        {els}
        <line className="ecross" y1={T} y2={H - B} x1={cross} x2={cross} />
        {top ? <g className="ge-line ge-top hot" data-name={top.name} style={vars({ '--c': top.color, pointerEvents: 'none' })}>{lineKids(top, false)}</g> : null}
      </svg>
      <div className="etip ge-tip" hidden={!tip?.on} style={tipStyle}>{tipKids}</div>
    </>
  );
}
