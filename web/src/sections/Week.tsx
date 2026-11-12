// La semana: esta, la pasada y el historial
import { useContext, useEffect, useState, type ReactNode } from 'react';
import { AppContext, useApp, type AppApi } from '../ctx';
import { Avatar, WinBar } from '../components/ui';
import type { Player } from '../lib/model';
import { shareWeek, weekEnd, weekSorted, weekText } from '../lib/week';
import type { Week as WeekT } from '../types';
import { fmt, pct, plural, rangeLabel, scoreLabel, signed, weekKeyOf } from '../lib/util';

export async function copyText(text: string, setLabel: (l: string | null) => void, openModal: AppApi['openModal'], done = '¡Copiado!'): Promise<void> {
  try { await navigator.clipboard.writeText(text); setLabel(done); } catch {
    // Sin permiso de portapapeles: se muestra para copiarlo a mano
    openModal('Copiar', <textarea className="copy-area" readOnly rows={14} defaultValue={text} />);
    return;
  }
  setTimeout(() => setLabel(null), 1600);
}

/** Botón cuyo texto cambia un momento ("¡Copiado!", "Generando…") */
export function TempButton({ label, cls, title, run }: { label: string; cls: string; title?: string; run: (set: (l: string | null) => void) => void }) {
  const [tmp, setTmp] = useState<string | null>(null);
  return <button className={cls} title={title} onClick={() => run(setTmp)}>{tmp ?? label}</button>;
}

function Hl({ ico, label, name, value, extra, onClick, byName }: { ico: string; label: string; name: string | null | undefined; value: string; extra?: string; onClick?: () => void; byName: Map<string, Player> }) {
  const p = name ? byName.get(name) : undefined;
  const kids = (
    <>
      <span className="wk-lbl"><span aria-hidden="true">{ico}</span>{` ${label}`}</span>
      <div className="wk-who">{name && p ? <Avatar p={p} size={26} /> : null}<b>{name ?? '–'}</b></div>
      <span className="wk-val">{value}{extra ? <small>{` · ${extra}`}</small> : null}</span>
    </>
  );
  return onClick ? <button className="wk-hl click" onClick={onClick}>{kids}</button> : <div className="wk-hl ">{kids}</div>;
}

function weekHighlights(w: WeekT, byName: Map<string, Player>, openMatchModal: AppApi['openMatchModal']): ReactNode[] {
  const P = (n: string) => byName.get(n);
  const pl = new Map(w.players.map((x) => [x.name, x]));
  const out: ReactNode[] = [];
  const c = (k: string, ico: string, label: string, name: string | null | undefined, value: string, extra?: string, onClick?: () => void) =>
    out.push(<Hl key={k} ico={ico} label={label} name={name} value={value} extra={extra} onClick={onClick} byName={byName} />);
  if (w.mvp) { const x = pl.get(w.mvp)!; c('mvp', '🏆', 'MVP', w.mvp, `${signed(x.lp)} LP`, `${x.wins}V ${x.losses}D`); }
  if (w.worst) { const x = pl.get(w.worst)!; c('worst', '📉', 'Peor semana', w.worst, `${signed(x.lp)} LP`, `${x.wins}V ${x.losses}D`); }
  if (w.grinder) { const x = pl.get(w.grinder)!; c('grinder', '🎮', 'Más viciado', w.grinder, `${x.games} partidas`, `${fmt(x.hours)} h`); }
  if (w.hot) c('hot', '🔥', 'Mejor racha', w.hot.name, `${w.hot.n} victorias seguidas`);
  if (w.cold) c('cold', '💀', 'Peor racha', w.cold.name, `${w.cold.n} derrotas seguidas`);
  if (w.duo) {
    const a = P(w.duo.a), b = P(w.duo.b);
    out.push(
      <div key="duo" className="wk-hl"><span className="wk-lbl">🤝 Dúo de la semana</span>
        <div className="wk-who"><span className="duo-avs sm">{a ? <Avatar p={a} size={24} /> : null}{b ? <Avatar p={b} size={24} /> : null}</span><b>{`${w.duo.a} & ${w.duo.b}`}</b></div>
        <span className="wk-val">{`${w.duo.games} partidas`}<small>{` · ${w.duo.wins}V ${w.duo.games - w.duo.wins}D`}</small></span></div>,
    );
  }
  const g = w.gotw;
  if (g) c('gotw', '⭐', 'Partida de la semana', g.name, `${g.champ} ${g.k}/${g.d}/${g.a}`, 'ver →', () => { openMatchModal(g.id, `Partida de la semana · ${g.name}`, P(g.name)?.main?.riotId); });
  (w.pentas ?? []).forEach((x, i) => c(`penta${i}`, '🖐️', 'Pentakill', x.name, `${x.champ} ${x.k}/${x.d}/${x.a}`, 'ver →', () => { openMatchModal(x.id, `Pentakill · ${x.name}`, P(x.name)?.main?.riotId); }));
  if (w.coward) c('coward', '🏳️', 'El más cobarde', w.coward.name, `${plural(w.coward.n, 'rendición', 'rendiciones')}`, `en ${w.coward.of} derrotas`);
  if (w.qKing) c('qking', '❓', 'El rey del "?"', w.qKing.name, `${fmt(w.qKing.avg, 1)} por partida`, `${w.qKing.total} en total`);
  return out;
}

function WeekTable({ w, byName }: { w: WeekT; byName: Map<string, Player> }) {
  return (
    <div className="wk-table">
      <div className="wk-row wk-th"><span>#</span><span>Jugador</span><span>LP</span><span className="wk-wl">V / D</span>
        <span className="wk-h">Horas</span><span className="wk-k">KDA</span></div>
      {weekSorted(w).map((x, i) => {
        const p = byName.get(x.name);
        const idle = !x.games;
        return (
          <div key={x.name} className={`wk-row ${idle ? 'idle' : ''}`}>
            <span className="lb-pos">{idle ? '–' : i + 1}</span>
            <span className="wk-name">{p ? <Avatar p={p} size={28} /> : null}<b>{x.name}</b></span>
            <b className={`wk-lp ${x.lp != null && x.lp > 0 ? 'pos' : x.lp != null && x.lp < 0 ? 'neg' : 'muted'}`} title={x.start != null && x.end != null ? `${scoreLabel(x.start)} → ${scoreLabel(x.end)}` : ''}>
              {idle ? 'no jugó' : x.lp == null ? '¿?' : `${signed(x.lp)} LP`}</b>
            <span className="wk-wl">{idle ? null : <WinBar w={x.wins} l={x.losses} />}</span>
            <span className="wk-h">{idle ? '' : `${fmt(x.hours)} h`}</span>
            <span className="wk-k">{idle ? '' : fmt((x.k + x.a) / Math.max(1, x.d), 2)}</span>
          </div>
        );
      })}
    </div>
  );
}

function WeekView({ w, byName }: { w: WeekT; byName: Map<string, Player> }) {
  const { openModal, openMatchModal } = useApp();
  const stale = !w.to && w.key !== weekKeyOf(Date.now());
  if (stale) return <p className="empty">Esta semana todavía no ha jugado nadie.</p>;
  return (
    <>
      <div className="wk-head">
        <div><b className="wk-range">{rangeLabel(w.from, weekEnd(w))}</b>{w.to ? null : <span className="chip chip-w wk-live">en curso</span>}
          <span className="muted">{` · ${w.totals.games} partidas · ${Math.round(pct(w.totals.wins, w.totals.games))} % de victorias · ${fmt(w.totals.hours)} h jugadas`}</span></div>
        <div className="wk-actions">
          <TempButton cls="ghost-btn" label="📋 Copiar resumen" run={(set) => { void copyText(weekText(w), set, openModal); }} />
          <TempButton cls="ghost-btn" label="🖼️ Compartir imagen" run={(set) => { void shareWeek(w, set); }} />
        </div>
      </div>
      {w.totals.games ? <div className="wk-hls">{weekHighlights(w, byName, openMatchModal)}</div> : null}
      <WeekTable w={w} byName={byName} />
      <p className="muted small center">LP: diferencia entre el elo registrado al empezar y al acabar la semana (pasa el ratón para verlo). "¿?": sin registro de LP.</p>
    </>
  );
}

function WeekArchive({ weeks, byName, open }: { weeks: WeekT[]; byName: Map<string, Player>; open: (key: string) => void }) {
  const { data } = useApp();
  if (!weeks.length) return <p className="empty">Todavía no hay semanas cerradas.</p>;
  const wins = Object.entries(data.weekWins ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <>
      {wins.length ? (
        <div className="wk-wins"><span className="lbl">Semanas ganadas (MVP)</span>
          {wins.map(([n, c]) => {
            const p = byName.get(n);
            return <span key={n} className="wk-win">{p ? <Avatar p={p} size={24} /> : null}<b>{n}</b><span className="chip chip-w">{`×${c}`}</span></span>;
          })}</div>
      ) : null}
      <div className="wk-arch">{weeks.map((w) => {
        const top = weekSorted(w).filter((x) => x.games).slice(0, 3);
        const mvp = w.mvp ? byName.get(w.mvp) : undefined;
        return (
          <button key={w.key} className="wk-card" onClick={() => open(w.key)}>
            <div className="wk-card-top"><b>{rangeLabel(w.from, w.to!)}</b><small className="muted">{`${w.totals.games} partidas`}</small></div>
            {w.mvp ? <div className="wk-card-mvp">{mvp ? <Avatar p={mvp} size={30} /> : null}<div><small>🏆 MVP</small><b>{w.mvp}</b></div></div>
              : <div className="muted small">Sin MVP</div>}
            <ol className="wk-card-top3">{top.map((x) => (
              <li key={x.name}><span>{x.name}</span><b className={x.lp != null && x.lp > 0 ? 'pos' : x.lp != null && x.lp < 0 ? 'neg' : ''}>{x.lp == null ? '¿?' : signed(x.lp)}</b></li>
            ))}</ol>
          </button>
        );
      })}</div>
    </>
  );
}

const TABS: [string, string][] = [['current', 'Esta semana'], ['last', 'Semana pasada'], ['archive', 'Historial']];

export function WeekSection() {
  const app = useContext(AppContext);
  const data = app?.data ?? null;
  const [tab, setTab] = useState('current');
  // Archivo de semanas (data/weeks.json): se carga al abrir "Historial" y se vuelve a pedir si cambian los datos
  const [weeks, setWeeks] = useState<{ for: unknown; list: WeekT[] } | null>(null);
  const need = !!data && (tab === 'archive' || tab.startsWith('w:'));
  const have = weeks?.for === data ? weeks.list : null;
  useEffect(() => {
    if (!need || have) return;
    let alive = true;
    (async () => {
      let list: WeekT[];
      try {
        const r = await fetch(`data/weeks.json?t=${Math.floor(Date.now() / 6e5)}`);
        list = r.ok ? ((await r.json()) as { weeks?: WeekT[] }).weeks ?? [] : [];
      } catch { list = []; }
      if (alive) setWeeks({ for: data, list });
    })();
    return () => { alive = false; };
  }, [need, have, data]);

  if (!app || !data) {
    return (
      <>
        <div className="toggle" id="week-tabs">{TABS.map(([k, l]) => <button key={k} data-week={k} className={k === 'current' ? 'on' : undefined}>{l}</button>)}</div>
        <div id="week" className="week" />
      </>
    );
  }
  const byName = new Map(app.model.map((p) => [p.name, p]));
  const shownTab = tab.startsWith('w:') ? 'archive' : tab;
  let body: ReactNode = null;
  if (tab === 'archive') {
    body = have ? <WeekArchive weeks={have} byName={byName} open={(k) => setTab(`w:${k}`)} /> : null;
  } else if (!(tab.startsWith('w:') && !have)) {
    let w = tab === 'current' ? data.week?.current : tab === 'last' ? data.week?.last : null;
    if (tab.startsWith('w:')) w = (have ?? []).find((x) => x.key === tab.slice(2)) ?? null;
    body = !w ? <p className="empty">Todavía no hay datos de esta semana.</p> : (
      <>
        {tab.startsWith('w:') ? <button className="ghost-btn wk-back" onClick={() => setTab('archive')}>← Volver al historial</button> : null}
        <WeekView key={w.key} w={w} byName={byName} />
      </>
    );
  }
  return (
    <>
      <div className="toggle" id="week-tabs">{TABS.map(([k, l]) => (
        <button key={k} data-week={k} className={shownTab === k ? 'on' : undefined} onClick={() => setTab(k)}>{l}</button>
      ))}</div>
      <div id="week" className="week">{body}</div>
    </>
  );
}
