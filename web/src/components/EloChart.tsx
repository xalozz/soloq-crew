// Evolución de elo de una cuenta (ficha del jugador): curva suave con el color de cada liga
import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from 'react';
import type { Account } from '../types';
import { ELO_RANGES, eloDelta, eloPoints, eloSeries, nextGradId, smoothPath, TIER_HEX, tierHex, type EloPt, type EloSeries } from '../lib/elo';
import { CDRAGON, dateTime, dayKey, DIVS, prettyDay, scoreLabel, shortDate, TIERS } from '../lib/util';

/** Mide el ancho de la caja después de pintar (como el requestAnimationFrame de antes) */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number | null] {
  const ref = useRef<T>(null);
  const [w, setW] = useState<number | null>(null);
  useLayoutEffect(() => {
    const cw = ref.current?.clientWidth ?? 0;
    if (cw !== w) setW(cw);
  });
  return [ref, w];
}

export function EloChart({ acc, days, setDays }: { acc: Account; days: number; setDays: (d: number) => void }) {
  const ser = eloSeries(acc);
  const all = eloPoints(ser);
  if (all.length < 2) {
    return <div className="chart echart"><p className="empty">Todavía no hay partidas suficientes para dibujar la evolución.</p></div>;
  }
  const deltaChip = (d: number, label: string) => {
    const x = eloDelta(all, d);
    if (x == null) return null;
    return <span className="e-delta"><small>{label}</small><b className={x > 0 ? 'pos' : x < 0 ? 'neg' : ''}>{`${x > 0 ? '▲' : x < 0 ? '▼' : ''} ${Math.abs(x)} LP`}</b></span>;
  };
  const peak = all.reduce((m, p) => (p[1] > m[1] ? p : m));
  const from = days ? Date.now() - days * 864e5 : -Infinity;
  let pts = all.filter((p) => p[0] >= from);
  const prev = all.filter((p) => p[0] < from).at(-1);
  if (prev) pts = [[from, prev[1], prev[2]], ...pts];
  if (pts.length < 2) pts = [[from, all[all.length - 1][1], false], [Date.now(), all[all.length - 1][1], false]];
  return (
    <div className="chart echart">
      <div className="echart-top">{deltaChip(30, 'Últimos 30 días')}{deltaChip(7, 'Últimos 7 días')}
        <div className="toggle e-range">{ELO_RANGES.map(([d, l]) => (
          <button key={d} data-days={d} className={d === days ? 'on' : undefined} onClick={() => setDays(d)}>{l}</button>
        ))}</div>
      </div>
      <EloBody key={days} pts={pts} ser={ser} />
      <div className="echart-foot">
        <span><small>Pico</small><b style={{ color: tierHex(peak[1]) }}>{scoreLabel(peak[1])}</b>
          <small className="muted">{` · ${shortDate(peak[0])}${peak[2] ? ' (estimado)' : ''}`}</small></span>
        <span><small>Ahora</small><b style={{ color: tierHex(all[all.length - 1][1]) }}>{scoreLabel(all[all.length - 1][1])}</b></span>
      </div>
    </div>
  );
}

function EloBody({ pts, ser }: { pts: EloPt[]; ser: EloSeries }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  return <div className="echart-body" ref={ref}>{width != null ? <EloDraw pts={pts} ser={ser} width={width} /> : null}</div>;
}

function EloDraw({ pts, ser: { W, L, measured }, width }: { pts: EloPt[]; ser: EloSeries; width: number }) {
  // Punto señalado: índice y si se ve (al salir se esconde pero conserva lo último, como antes)
  const [hov, setHov] = useState<{ i: number; on: boolean } | null>(null);
  const Wd = Math.max(300, width), H = 250, Lm = 40, R = 12, T = 16, B = 24;
  const n = pts.length;
  let lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
  const pad = Math.max(20, (hi - lo) * 0.12);
  lo = Math.max(0, lo - pad); hi = hi + pad;
  const x = (i: number) => Lm + (i / Math.max(1, n - 1)) * (Wd - Lm - R);
  const y = (v: number) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const id = useMemo(nextGradId, [pts, width]);

  const els: ReactNode[] = [];
  // Degradado vertical: cada tramo de la curva toma el color de su liga
  const stops: ReactNode[] = [];
  const top = y(hi), bot = y(lo);
  const at = (v: number) => Math.min(1, Math.max(0, (y(v) - top) / Math.max(1, bot - top)));
  for (let t = Math.min(7, Math.floor(hi / 400)); t >= Math.max(0, Math.floor(lo / 400)); t--) {
    const upper = t === 7 ? hi : (t + 1) * 400, lower = t * 400;
    stops.push(<stop key={`${t}a`} offset={at(Math.min(hi, upper))} stopColor={TIER_HEX[t]} />);
    stops.push(<stop key={`${t}b`} offset={at(Math.max(lo, lower))} stopColor={TIER_HEX[t]} />);
  }
  els.push(
    <defs key="defs">
      <linearGradient id={`${id}l`} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={top} y2={bot}>{stops}</linearGradient>
      <linearGradient id={`${id}f`} x1={0} x2={0} y1={0} y2={1}>
        <stop offset={0} stopColor="#fff" stopOpacity={0.22} /><stop offset={1} stopColor="#fff" stopOpacity={0} />
      </linearGradient>
      <mask id={`${id}m`}><rect x={0} y={0} width={Wd} height={H} fill={`url(#${id}f)`} /></mask>
    </defs>,
  );

  // Líneas de división (discontinuas) y de liga con su emblema
  const span = hi - lo;
  const step = span > 1200 ? 400 : 100;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const tierLine = v % 400 === 0 && v <= 2800;
    els.push(<line key={`g${v}`} x1={Lm} x2={Wd - R} y1={y(v)} y2={y(v)} className={tierLine ? 'grid tier' : 'grid div'} />);
    if (v > 2800) {
      els.push(<text key={`a${v}`} x={Lm - 6} y={y(v) + 4} className="axis" textAnchor="end">{`${v - 2800}`}</text>);
    } else if (tierLine || step === 100) {
      const t = Math.floor(v / 400);
      if (tierLine) {
        els.push(<image key={`i${v}`} href={`${CDRAGON}/rcp-fe-lol-shared-components/global/default/${TIERS[t].toLowerCase()}.png`} x={Lm - 34} y={y(v) - 13} width={26} height={26} />);
      } else {
        els.push(<text key={`a${v}`} x={Lm - 8} y={y(v) + 4} className="axis" textAnchor="end">{DIVS[Math.floor((v % 400) / 100)]}</text>);
      }
    }
  }
  // Fechas
  const nTicks = Math.max(2, Math.min(6, Math.floor((Wd - Lm) / 110)));
  const seen = new Set<string>();
  for (let k = 0; k < nTicks; k++) {
    const i = Math.round(((n - 1) * k) / (nTicks - 1));
    const key = dayKey(pts[i][0]);
    if (seen.has(key)) continue;
    seen.add(key);
    els.push(<text key={`d${k}`} x={x(i)} y={H - 6} className="axis" textAnchor={k === 0 ? 'start' : k === nTicks - 1 ? 'end' : 'middle'}>{prettyDay(key)}</text>);
  }

  const P: [number, number][] = pts.map((p, i) => [x(i), y(p[1])]);
  const curve = smoothPath(P);
  const lastP = P[P.length - 1];
  els.push(<path key="area" d={`${curve}L${lastP[0].toFixed(1)},${bot}L${P[0][0].toFixed(1)},${bot}Z`} fill={`url(#${id}l)`} mask={`url(#${id}m)`} />);
  // Tramo estimado algo apagado y discontinuo; tramo registrado sólido
  const lastEst = pts.map((p) => p[2]).lastIndexOf(true);
  const stroke = { stroke: `url(#${id}l)` };
  if (lastEst >= 0) {
    const e = Math.min(n - 1, lastEst + 1);
    els.push(<path key="est" d={smoothPath(P.slice(0, e + 1))} className="eline est" style={stroke} />);
    if (e < n - 1) els.push(<path key="real" d={smoothPath(P.slice(e))} className="eline" style={stroke} />);
  } else els.push(<path key="real" d={curve} className="eline" style={stroke} />);
  els.push(<circle key="end" cx={lastP[0]} cy={lastP[1]} r={3.5} fill={tierHex(pts[n - 1][1])} />);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const pxv = ((e.clientX - r.left) / r.width) * Wd;
    setHov({ i: Math.max(0, Math.min(n - 1, Math.round(((pxv - Lm) / (Wd - Lm - R)) * (n - 1)))), on: true });
  };
  const hp = hov ? pts[Math.min(hov.i, n - 1)] : null;
  const hi_ = hov ? Math.min(hov.i, n - 1) : 0;
  return (
    <>
      <svg viewBox={`0 0 ${Wd} ${H}`} width={Wd} height={H} role="img" aria-label="Evolución del elo"
        onPointerMove={onMove} onPointerLeave={() => setHov((h) => (h ? { ...h, on: false } : h))}>
        {els}
        <line className="ecross" y1={T} y2={H - B} x1={hov?.on ? x(hi_) : -20} x2={hov?.on ? x(hi_) : -20} />
        <circle r={5} className="edot" cx={hov?.on ? x(hi_) : -20} cy={hp ? y(hp[1]) : -20} style={hp ? { fill: tierHex(hp[1]) } : undefined} />
      </svg>
      <div className="etip" hidden={!hov?.on} style={hp ? { left: `${(x(hi_) / Wd) * 100}%`, top: `${(y(hp[1]) / H) * 100}%` } : undefined}>
        {hp ? <>
          <b style={{ color: tierHex(hp[1]) }}>{`${hp[2] ? '≈ ' : ''}${scoreLabel(hp[1])}`}</b>
          <span>{dateTime(hp[0])}</span>
          {hp[2] ? <small>estimado</small> : null}
        </> : null}
      </div>
      <div className="elegend">
        {lastEst >= 0 ? <span><i className="lg est" />{`Estimado (≈ +${W} / −${L} LP por partida${measured ? ', medidos' : ''})`}</span> : null}
        <span><i className="lg" />LP registrado</span>
        <span className="lg-note">{`${n} puntos · uno por partida`}</span>
      </div>
    </>
  );
}
