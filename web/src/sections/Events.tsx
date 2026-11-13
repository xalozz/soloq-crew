// Novedades y aviso de lo último
import { useMemo, useState } from 'react';
import { useApp } from '../ctx';
import { Avatar } from '../components/ui';
import type { Player } from '../lib/model';
import type { GameEvent } from '../types';
import { ago, dayKey, prettyDay, TZ } from '../lib/util';

export function evParts(e: GameEvent): [string, string] {
  const i = (e.text ?? '').indexOf(' ');
  return i > 0 ? [e.text!.slice(0, i), e.text!.slice(i + 1)] : ['•', e.text ?? ''];
}
function evSub(e: GameEvent): string {
  switch (e.type) {
    case 'up': case 'down': return `viene de ${e.from}${e.lp != null ? ` · ${e.lp} LP` : ''}${e.peak ? ' · su mejor elo registrado' : ''}`;
    case 'penta': case 'quadra': case 'record': case 'roast': return `${e.champ} · ${e.k}/${e.d}/${e.a} · ${e.win ? 'victoria' : 'derrota'}`;
    case 'challengeStart': case 'challengeEnd': return (e.desc ?? '').split('\n')[0];
    default: return '';
  }
}
const evTime = (t: number) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

function EventItem({ e, byName }: { e: GameEvent; byName: Map<string, Player> }) {
  const { openMatchModal } = useApp();
  const [ico, txt] = evParts(e);
  const p = byName.get(e.name);
  const open = e.gameId ? () => { openMatchModal(e.gameId!, txt, p?.main?.riotId); } : undefined;
  const body = (
    <>
      <span className="ev-ico" aria-hidden="true">{ico}</span>
      <div className="ev-main"><b>{txt}</b>{e.roast ? <span className="ev-burn">{e.roast}</span> : null}<small>{[evTime(e.t), evSub(e)].filter(Boolean).join(' · ')}</small></div>
      {open ? <span className="ev-go">Ver →</span> : p ? <Avatar p={p} size={28} /> : null}
    </>
  );
  return open
    ? <button className={`ev ev-${e.type}`} onClick={open} title="Ver la partida">{body}</button>
    : <div className={`ev ev-${e.type}`}>{body}</div>;
}

export function Events() {
  const { data, model } = useApp();
  // Solo los últimos 30 días, dentro de una caja con su propio scroll
  const list = useMemo(() => (data.events ?? []).filter((e) => Date.now() - e.t < 30 * 864e5), [data]);
  if (!list.length) return <p className="empty">Sin novedades en los últimos 30 días. Aquí saldrán las subidas y bajadas, los pentas, las rachas y los récords en cuanto pasen.</p>;
  const byName = new Map(model.map((p) => [p.name, p]));
  const today = dayKey(Date.now()), yest = dayKey(Date.now() - 864e5);
  const groups = new Map<string, GameEvent[]>();
  for (const e of list) {
    const k = dayKey(e.t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  return (
    <>
      <div className="feed-head"><b>{`${list.length} novedad${list.length === 1 ? '' : 'es'}`}</b><span className="muted">últimos 30 días</span></div>
      <div className="feed-scroll">{[...groups].map(([k, evs]) => (
        <div key={k} className="ev-day">
          <h4 className="ev-date">{k === today ? 'Hoy' : k === yest ? 'Ayer' : prettyDay(k)}</h4>
          {evs.map((e, i) => <EventItem key={i} e={e} byName={byName} />)}
        </div>
      ))}</div>
    </>
  );
}

// Aviso arriba con lo de las últimas 12 h (se puede cerrar; no vuelve a salir en este navegador)
export function Banner({ data }: { data: { events?: GameEvent[] } | null }) {
  const fresh = useMemo(() => {
    if (!data) return null;
    let seen = 0;
    try { seen = Number(localStorage.getItem('sq-banner-seen')) || 0; } catch { /* sin almacenamiento */ }
    return (data.events ?? []).filter((e) => Date.now() - e.t < 12 * 3600e3 && e.t > seen);
  }, [data]);
  // Como antes: al cerrarlo (o si no hay nada nuevo) se oculta, pero conserva lo último que enseñó
  const [last, setLast] = useState<GameEvent[] | null>(null);
  const [closedFor, setClosedFor] = useState<unknown>(null);
  if (fresh?.length && fresh !== last) setLast(fresh);
  const shown = fresh?.length ? fresh : last;
  const close = () => {
    try { localStorage.setItem('sq-banner-seen', String(shown![0].t)); } catch { /* nada */ }
    setClosedFor(data);
  };
  const hidden = !fresh?.length || closedFor === data;
  let content = null;
  if (shown?.length) {
    const [ico, txt] = evParts(shown[0]);
    content = (
      <>
        <span className="bn-ico" aria-hidden="true">{ico}</span>
        <a href="#novedades" className="bn-txt"><b>{txt}</b>
          <small>{` · ${ago(shown[0].t)}${shown.length > 1 ? ` · y ${shown.length - 1} más` : ''}`}</small></a>
        <button className="bn-x" aria-label="Cerrar aviso" onClick={close}>×</button>
      </>
    );
  }
  return <div id="banner" className="banner" hidden={hidden}>{content}</div>;
}
