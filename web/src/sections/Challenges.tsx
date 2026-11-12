// Retos
import { useApp } from '../ctx';
import { Avatar } from '../components/ui';
import type { Player } from '../lib/model';
import type { Challenge } from '../types';
import { rangeLabel } from '../lib/util';

const CH_TYPE: Record<string, string> = { race: 'Carrera de LP', target: 'Llegar a un rango', handicap: 'Con hándicap', games: 'Constancia' };
const daysTxt = (ms: number) => { const d = Math.ceil(ms / 864e5); return d <= 1 ? 'mañana' : `en ${d} días`; };
function challengeState(c: Challenge): { cls: 'soon' | 'on' | 'done'; label: string } {
  const now = Date.now();
  if (now < c.from) return { cls: 'soon', label: `Empieza ${daysTxt(c.from - now)}` };
  if (now < c.to) {
    const d = Math.ceil((c.to - now) / 864e5);
    return { cls: 'on', label: d <= 1 ? 'Último día' : `En juego · quedan ${d} días` };
  }
  return { cls: 'done', label: 'Terminado' };
}

function ChallengeCard({ c, byName }: { c: Challenge; byName: Map<string, Player> }) {
  const st = challengeState(c);
  const finished = st.cls === 'done';
  const maxAbs = Math.max(1, ...c.standings.map((s) => Math.abs(s.value ?? 0)));
  const goal = c.type === 'target' && c.target ? `Meta: ${c.target}` : c.type === 'games' ? `Mínimo ${c.perWeek} partidas por semana` : c.type === 'handicap' ? 'Cada uno con su objetivo de LP' : 'Gana quien más LP sume';
  const rows = c.standings.map((s, i) => {
    let bar;
    const value = s.value ?? 0;
    if (c.type === 'race') {
      const w = (Math.abs(s.value as number) / maxAbs) * 50;
      bar = <div className="ch-div"><i className={value >= 0 ? 'up' : 'down'} style={value >= 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }} /></div>;
    } else if (c.type === 'games') {
      bar = (
        <div className="ch-weeks">{(s.weeks ?? []).map((n, wi) => (
          <i key={wi} className={n >= (c.perWeek ?? 0) ? 'ok' : wi === s.weeks!.length - 1 && !finished ? 'cur' : 'ko'} title={`Semana ${wi + 1}: ${n} partidas`}>{n}</i>
        ))}</div>
      );
    } else {
      bar = <div className="ch-prog"><i className={s.done ? 'done' : ''} style={{ width: `${Math.min(100, value * 100)}%` }} /></div>;
    }
    const winner = finished && c.winners?.includes(s.name);
    const p = byName.get(s.name);
    return (
      <div key={i} className={`ch-row ${winner ? 'win' : ''}`}>
        <span className="lb-pos">{winner ? '🏆' : i + 1}</span>
        <span className="ch-name">{p ? <Avatar p={p} size={26} /> : null}<b>{s.name}</b></span>
        {bar}
        <b className={`ch-val ${c.type === 'race' ? (value > 0 ? 'pos' : value < 0 ? 'neg' : '') : s.done ? 'pos' : ''}`}>{s.label}</b>
      </div>
    );
  });
  return (
    <article className={`ch panel ch-${st.cls}`}>
      <div className="ch-head">
        <div><span className="ch-type">{CH_TYPE[c.type] ?? c.type}</span><h3 className="ch-title">{c.title}</h3>
          <span className="muted small">{`${rangeLabel(c.from, c.to)} · ${goal}`}</span></div>
        <span className={`ch-state ${st.cls}`}>{st.label}</span>
      </div>
      {c.desc ? <p className="ch-desc">{c.desc}</p> : null}
      {c.stake ? <p className="ch-stake">{'🎲 En juego: '}<b>{c.stake}</b></p> : null}
      {finished && c.winners?.length ? <p className="ch-winner">{`🏆 ${c.winners.join(' y ')} gana${c.winners.length > 1 ? 'n' : ''} el reto`}</p> : null}
      {st.cls === 'soon' ? (
        <div className="ch-soon">
          <span className="muted small">Participan:</span>
          <div className="ch-parts">{c.standings.map((s, i) => {
            const p = byName.get(s.name);
            return <span key={i} className="ch-part">{p ? <Avatar p={p} size={22} /> : null}{s.name}</span>;
          })}</div>
          <span className="muted small">Cuando empiece, aquí saldrá la clasificación en directo.</span>
        </div>
      ) : <div className="ch-rows">{rows}</div>}
    </article>
  );
}

export function Challenges() {
  const { data, model } = useApp();
  const list = data.challenges ?? [];
  const byName = new Map(model.map((p) => [p.name, p]));
  const help = (
    <div className="ch-help">
      <b>¿Queréis montar un reto? </b>{'Decidle a xALOzZ cuál y se añade: '}
      <span>carrera de LP entre dos fechas, llegar a un rango antes de un día, hándicap (cada uno con su objetivo) o constancia (mínimo de partidas por semana)</span>
      {', con lo que haya en juego.'}
    </div>
  );
  if (!list.length) return <><p className="empty">No hay retos todavía.</p>{help}</>;
  const order = { on: 0, soon: 1, done: 2 };
  const sorted = [...list].sort((a, b) => order[challengeState(a).cls] - order[challengeState(b).cls] || b.to - a.to);
  return <>{sorted.map((c) => <ChallengeCard key={c.id} c={c} byName={byName} />)}{help}</>;
}
