// Comparador 1 vs 1 (#vs/<a>/<b>)
import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../ctx';
import { playerPts, type EloPtN } from '../lib/elo';
import { byRank, type Player } from '../lib/model';
import { dayKey, DIVS, fmt, fmtInt, goldK, pct100, plural, prettyDay, rankName, ROLE_COLOR, ROLE_ES, ROLES, TIER_ES, TIERS, tierKey } from '../lib/util';
import { copyText, TempButton } from '../sections/Week';
import { useWidth } from './EloChart';
import { Avatar, ChampIcon, Crest, RoleIcon } from './ui';

type CmpStat = [string, (p: Player) => number | null | undefined, (v: number) => ReactNode, ('low' | 'none')?];
const CMP_STATS: CmpStat[] = [
  ['Winrate', (p) => p.rank?.winrate, (v) => `${fmt(v, 1)}%`],
  ['KDA', (p) => p.s?.kda, (v) => fmt(v, 2)],
  ['Kills / partida', (p) => p.s?.avgK, (v) => fmt(v, 1)],
  ['Muertes / partida', (p) => p.s?.avgD, (v) => fmt(v, 1), 'low'],
  ['Asistencias / partida', (p) => p.s?.avgA, (v) => fmt(v, 1)],
  ['Participación en kills', (p) => p.s?.avgKp, (v) => `${v}%`],
  ['CS / min', (p) => p.s?.csPerMin, (v) => fmt(v, 1)],
  ['Daño / min', (p) => p.s?.dmgPerMin, (v) => fmtInt(v)],
  ['% del daño del equipo', (p) => p.s?.dmgShare, (v) => `${fmt(v, 1)}%`],
  ['Visión / min', (p) => p.s?.visPerMin, (v) => fmt(v, 2)],
  ['Oro @15 vs rival', (p) => p.s?.gold?.avgGd15, (v) => goldK(v)],
  ['First bloods', (p) => p.s?.firstBloods, (v) => v],
  ['Pentakills', (p) => p.s?.pentas, (v) => v],
  ['LP por victoria', (p) => p.s?.lp?.win, (v) => `+${v}`],
  ['LP por derrota', (p) => p.s?.lp?.loss, (v) => `${v}`],
  ['1ª partida del día', (p) => (p.s?.firstOfDay && p.s.firstOfDay.games >= 10 ? p.s.firstOfDay.winrate : null), (v) => `${fmt(v, 0)}%`],
  ['Mejor racha', (p) => p.s?.streak?.bestWin, (v) => `${v}V`],
  ['Peor racha', (p) => p.s?.streak?.worstLoss, (v) => `${v}D`, 'low'],
  ['Pings "?" / partida', (p) => p.s?.conduct?.q, (v) => fmt(v, 1), 'low'],
  ['Derrotas rendidas', (p) => (p.s?.conduct && p.s.conduct.losses >= 10 ? p.s.conduct.ffPct : null), (v) => `${fmt(v, 0)}%`, 'low'],
  ['Partidas de la temporada', (p) => p.wins + p.losses, (v) => fmtInt(v), 'none'],
];
const CMP_COLORS = ['#3987e5', '#d95926'];

function PairEloChart({ A, B }: { A: Player; B: Player }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  let content: ReactNode = null;
  if (width != null) {
    const series = [A, B].map((p, i) => ({ p, pts: playerPts(p), color: CMP_COLORS[i] }));
    const W = Math.max(300, width), H = 220, L = 58, R = 12, T = 12, Bm = 24;
    const now = Date.now(), t0 = now - 30 * 864e5;
    const vis = series.map((s) => {
      const before = s.pts.filter((q) => q[0] <= t0).at(-1);
      return { ...s, pts: [...(before ? [[t0, before[1], before[2]] as EloPtN] : []), ...s.pts.filter((q) => q[0] > t0)] };
    }).filter((s) => s.pts.length);
    if (!vis.length) content = <p className="empty">Sin datos de elo.</p>;
    else {
      let lo = Math.min(...vis.flatMap((s) => s.pts.map((q) => q[1]))), hi = Math.max(...vis.flatMap((s) => s.pts.map((q) => q[1])));
      lo = Math.max(0, Math.floor((lo - 20) / 100) * 100); hi = Math.ceil((hi + 20) / 100) * 100;
      const x = (t: number) => L + ((t - t0) / (now - t0)) * (W - L - R);
      const y = (v: number) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - Bm);
      const els: ReactNode[] = [];
      const step = hi - lo > 900 ? 400 : hi - lo > 300 ? 200 : 100;
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
        els.push(<line key={`g${v}`} x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />);
        els.push(<text key={`a${v}`} x={L - 6} y={y(v) + 4} className="axis" textAnchor="end">{v >= 2800 ? `M ${v - 2800}` : `${TIER_ES[TIERS[Math.floor(v / 400)]].slice(0, 3)} ${DIVS[Math.floor((v % 400) / 100)]}`}</text>);
      }
      for (let k = 0; k < 4; k++) {
        const t = t0 + ((now - t0) * k) / 3;
        els.push(<text key={`d${k}`} x={x(t)} y={H - 6} className="axis" textAnchor={k === 0 ? 'start' : k === 3 ? 'end' : 'middle'}>{prettyDay(dayKey(t))}</text>);
      }
      vis.forEach((s, i) => {
        const d = s.pts.map((q, j) => `${j ? 'L' : 'M'}${x(q[0]).toFixed(1)},${y(q[1]).toFixed(1)}`).join('');
        els.push(<path key={`p${i}`} d={d} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" />);
        const last = s.pts[s.pts.length - 1];
        els.push(<circle key={`c${i}`} cx={x(last[0])} cy={y(last[1])} r={4} fill={s.color} />);
      });
      content = <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Elo de los dos en los últimos 30 días">{els}</svg>;
    }
  }
  return <div className="chart cmp-chart" ref={ref}>{content}</div>;
}

function CompareView({ A, B }: { A: Player; B: Player }) {
  const { data } = useApp();
  let sa = 0, sb = 0;
  const rows = CMP_STATS.map(([label, get, f, mode]) => {
    const a = get(A), b = get(B);
    if (a == null && b == null) return null;
    let win = 0;
    if (mode !== 'none' && a != null && b != null && a !== b) win = (mode === 'low' ? a < b : a > b) ? -1 : 1;
    if (win < 0) sa++; else if (win > 0) sb++;
    // Barras: el que gana, entera; el otro, en proporción (a media si hay valores negativos)
    const share = (x: number | null | undefined, y: number | null | undefined) => (x == null || (!x && !y) ? 0 : Math.abs(x) / Math.max(Math.abs(x), Math.abs(y ?? 0)));
    let wa = share(a, b), wb = share(b, a);
    if (win) {
      const lo = Math.min(a!, b!), hi = Math.max(a!, b!);
      const loser = lo < 0 || hi <= 0 ? 0.5 : lo / hi;
      wa = win < 0 ? 1 : loser;
      wb = win > 0 ? 1 : loser;
    }
    return (
      <div key={label} className="cmp-row">
        <b className={`cmp-v ${win < 0 ? 'win' : ''}`}>{a == null ? '–' : f(a)}</b>
        <div className="cmp-bar l"><i style={{ width: `${wa * 100}%`, background: CMP_COLORS[0], opacity: `${win < 0 ? 1 : 0.45}` }} /></div>
        <span className="cmp-l">{label}</span>
        <div className="cmp-bar r"><i style={{ width: `${wb * 100}%`, background: CMP_COLORS[1], opacity: `${win > 0 ? 1 : 0.45}` }} /></div>
        <b className={`cmp-v ${win > 0 ? 'win' : ''}`}>{b == null ? '–' : f(b)}</b>
      </div>
    );
  });
  const diff = A.score >= 0 && B.score >= 0 ? A.score - B.score : null;
  const lead = diff == null ? '' : diff === 0 ? 'Empatados en elo' : `${diff > 0 ? A.name : B.name} va ${Math.abs(diff)} LP por encima`;
  const side = (p: Player, i: number) => (
    <div className={`cmp-side s${i}`}><Avatar p={p} size={54} cls="big" /><b>{p.name}</b>
      <span className="cmp-rank"><Crest rank={p.rank} size={26} /><span className={`t-${tierKey(p.rank)}`}>{rankName(p.rank)}</span>{p.rank ? <small>{` ${p.rank.lp} LP`}</small> : null}</span>
      <span className="cmp-score">{`${i ? sb : sa}`}</span></div>
  );
  // Roles
  const roleBar = (p: Player) => {
    const br = p.s?.byRole ?? {};
    const counts = ROLES.map((r) => br[r]?.games ?? 0);
    const shares = pct100(counts);
    return (
      <div className="cmp-roles"><b>{p.name}</b>
        <div className="rs-bar">{ROLES.map((r, i) => (counts[i] ? <i key={r} style={{ flex: `${counts[i]}`, background: ROLE_COLOR[r] }} title={`${ROLE_ES[r]}: ${shares[i]}%`} /> : null))}</div>
        <div className="cmp-role-l">{ROLES.map((r, i) => (shares[i] >= 8 ? <span key={r}><RoleIcon role={r} />{`${shares[i]}%`}</span> : null))}</div>
      </div>
    );
  };
  // Campeones en común
  const ca = new Map((A.s?.champs ?? []).map((c) => [c.key, c])), cb = new Map((B.s?.champs ?? []).map((c) => [c.key, c]));
  const common = [...ca.keys()].filter((k) => cb.has(k) && ca.get(k)!.games >= 3 && cb.get(k)!.games >= 3)
    .sort((x, y) => ca.get(y)!.games + cb.get(y)!.games - ca.get(x)!.games - cb.get(x)!.games).slice(0, 8);
  // Juntos y en contra
  const duo = (data.duos ?? []).find((d) => (d.a === A.name && d.b === B.name) || (d.a === B.name && d.b === A.name));
  const riv = (data.rivals ?? []).find((d) => (d.a === A.name && d.b === B.name) || (d.a === B.name && d.b === A.name));
  const rivTxt = riv ? (riv.a === A.name ? `${riv.aWins}–${riv.bWins}` : `${riv.bWins}–${riv.aWins}`) : null;
  return (
    <>
      <div className="cmp-top">{side(A, 0)}<div className="cmp-mid"><b className="cmp-vs">VS</b><small>{lead}</small>
        <small className="muted">{`${sa} a ${sb} en estadísticas`}</small></div>{side(B, 1)}</div>
      <div className="cmp-h2h">
        {duo ? <span>{'🤝 Juntos: '}<b>{`${plural(duo.games, 'partida')} · ${duo.wins}V ${duo.losses}D (${fmt(duo.wr, 0)} %)`}</b></span> : <span className="muted">🤝 No han jugado juntos esta temporada</span>}
        {rivTxt ? <span>{'⚔️ Cara a cara: '}<b>{rivTxt}</b></span> : null}
      </div>
      <div className="cmp-rows">{rows}</div>
      <h4 className="sx-h">Elo en los últimos 30 días</h4>
      <div className="cmp-legend">{[A, B].map((p, i) => <span key={i}><i style={{ background: CMP_COLORS[i] }} />{p.name}</span>)}</div>
      <PairEloChart key={`${A.name}|${B.name}`} A={A} B={B} />
      <h4 className="sx-h">Roles</h4>
      <div className="cmp-roles-wrap">{roleBar(A)}{roleBar(B)}</div>
      {common.length ? <h4 className="sx-h">Campeones que juegan los dos</h4> : null}
      {common.length ? (
        <div className="cmp-champs">{common.map((k) => {
          const a = ca.get(k)!, b = cb.get(k)!;
          return (
            <div key={k} className="cmp-ch">
              <span className={a.winrate >= b.winrate ? 'pos' : ''}>{`${fmt(a.winrate, 0)}%`}<small>{` (${a.games})`}</small></span>
              <ChampIcon champ={k} size={34} />
              <span className={b.winrate > a.winrate ? 'pos' : ''}>{`${fmt(b.winrate, 0)}%`}<small>{` (${b.games})`}</small></span>
            </div>
          );
        })}</div>
      ) : null}
    </>
  );
}

export function Compare({ aName, bName }: { aName?: string; bName?: string }) {
  const { model, openModal } = useApp();
  const players = [...model].sort(byRank);
  const [pair, setPair] = useState<[string, string]>(() => {
    const A = model.find((p) => p.name === aName) ?? players[0];
    const B = model.find((p) => p.name === bName && p !== A) ?? players.find((p) => p !== A)!;
    return [A.name, B.name];
  });
  const A = model.find((p) => p.name === pair[0]) ?? players[0];
  const B = model.find((p) => p.name === pair[1]) ?? players.find((p) => p !== A)!;
  useEffect(() => {
    history.replaceState(null, '', `#vs/${encodeURIComponent(A.name)}/${encodeURIComponent(B.name)}`);
  }, [A.name, B.name]);
  const sel = (cur: Player, onChange: (p: Player) => void) => (
    <select className="cmp-sel" value={cur.name} onChange={(e) => onChange(model.find((p) => p.name === e.target.value)!)}>
      {players.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
    </select>
  );
  return (
    <div className="cmp-wrap">
      <div className="cmp-bar-top">
        {sel(A, (p) => setPair(p === B ? [p.name, A.name] : [p.name, B.name]))}
        <button className="cmp-swap" title="Intercambiar" onClick={() => setPair([B.name, A.name])}>⇄</button>
        {sel(B, (p) => setPair(p === A ? [B.name, p.name] : [A.name, p.name]))}
        <TempButton cls="ghost-btn" label="🔗 Copiar enlace" run={(set) => { void copyText(location.href, set, openModal, '¡Enlace copiado!'); }} />
      </div>
      <div className="cmp"><CompareView A={A} B={B} /></div>
    </div>
  );
}
