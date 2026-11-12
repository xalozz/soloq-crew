// Mejores días, premios de la temporada, récords de una partida y rachas/oro
import { useState } from 'react';
import { useApp } from '../ctx';
import { Avatar, ChampIcon } from '../components/ui';
import type { Player } from '../lib/model';
import type { GameRecordKey, GoldRecordKey, ValGame } from '../types';
import { ago, dailyDeltas, fmt, fmtInt, goldK, mmss, prettyDay, scoreLabel, signed } from '../lib/util';

// ---------------------------------------------------------------- días
export function DaysList({ mode }: { mode: 'up' | 'down' }) {
  const { model } = useApp();
  const all: { p: Player; day: string; delta: number; end: number }[] = [];
  for (const p of model) for (const d of dailyDeltas(p.main?.lpHist)) if (d.delta) all.push({ p, ...d });
  const list = (mode === 'up'
    ? all.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta)
    : all.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta)).slice(0, 8);
  if (!list.length) return <p className="empty">Todavía no hay días completos registrados. El LP se guarda en cada actualización, así que esta tabla se irá llenando a partir de mañana.</p>;
  return <>{list.map((d, i) => (
    <div key={i} className="day-row">
      <span className="lb-pos">{i + 1}</span><Avatar p={d.p} size={32} />
      <div className="who"><b>{d.p.name}</b><span>{`${prettyDay(d.day)} · ${scoreLabel(d.end)}`}</span></div>
      <b className={`day-val ${d.delta > 0 ? 'pos' : 'neg'}`}>{`${signed(d.delta)}`}</b>
    </div>
  ))}</>;
}

// ---------------------------------------------------------------- récords
export function RecordsGrid() {
  const { model, openMatchModal } = useApp();
  const rows = model.filter((p) => p.s);
  const pick = (items: Player[], val: (x: Player) => number, dir = 1) => (items.length ? items.reduce((m, x) => (dir * (val(x) - val(m)) > 0 ? x : m)) : null);
  const W = rows.filter((r) => r.s!.streak.current.type === 'W' && r.s!.streak.current.count);
  const L = rows.filter((r) => r.s!.streak.current.type === 'L' && r.s!.streak.current.count);
  const elig = rows.filter((r) => r.rank && r.wins + r.losses >= 30);

  type Def = [string, Player | null, (r: Player) => string, string, ((r: Player) => string)?, ((r: Player) => string)?];
  const defs: Def[] = [
    ['Racha de victorias activa', pick(W, (r) => r.s!.streak.current.count), (r) => `${r.s!.streak.current.count} seguidas`, 'good'],
    ['Racha de derrotas activa', pick(L, (r) => r.s!.streak.current.count), (r) => `${r.s!.streak.current.count} seguidas`, 'bad'],
    ['Mejor winrate de temporada', pick(elig, (r) => r.rank!.winrate), (r) => `${fmt(r.rank!.winrate)}%`, 'good'],
    ['Peor winrate de temporada', pick(elig, (r) => r.rank!.winrate, -1), (r) => `${fmt(r.rank!.winrate)}%`, 'bad'],
    ['Mejor partida', pick(rows, (r) => r.s!.bestGame.kda), (r) => `${r.s!.bestGame.champ} ${r.s!.bestGame.k}/${r.s!.bestGame.d}/${r.s!.bestGame.a}`, 'good', (r) => r.s!.bestGame.champ, (r) => r.s!.bestGame.id],
    ['Peor partida', pick(rows, (r) => r.s!.worstGame.kda, -1), (r) => `${r.s!.worstGame.champ} ${r.s!.worstGame.k}/${r.s!.worstGame.d}/${r.s!.worstGame.a}`, 'bad', (r) => r.s!.worstGame.champ, (r) => r.s!.worstGame.id],
  ];
  const goldRec = (key: GoldRecordKey, dir = 1) => {
    const c = rows.filter((r) => r.s!.gold?.[key]).map((r) => ({ p: r, g: r.s!.gold![key]! }));
    return c.length ? c.reduce((m, x) => (dir * (x.g.val - m.g.val) > 0 ? x : m)) : null;
  };
  const goldCard = (title: string, x: { p: Player; g: ValGame } | null, tone: string, note: (g: ValGame) => string) => (x ? (
    <div key={title} className={`rec rec-${tone} rec-gold clickable`} role="button" tabIndex={0} title="Ver la partida"
      onClick={() => { openMatchModal(x.g.id, `${title} · ${x.p.name}`, x.p.main?.riotId); }}>
      <span className="rec-t">{title}</span>
      <div className="rec-main"><ChampIcon champ={x.g.champ} size={34} /><b className="rec-v">{`${goldK(x.g.val)} de oro`}</b></div>
      <span className="rec-w">{x.p.name}<span className="muted">{` · ${x.g.champ} ${x.g.k}/${x.g.d}/${x.g.a} · ${note(x.g)} · ${ago(x.g.t)}`}</span></span>
    </div>
  ) : null);
  const goldCards = [
    goldCard('Mayor throw', goldRec('biggestThrow'), 'bad', (g) => `iba ganando en el min ${g.min} y perdió`),
    goldCard('Mayor remontada', goldRec('biggestComeback', -1), 'good', () => 'iba perdiendo y ganó'),
    goldCard('Mayor ventaja de oro', goldRec('biggestLead'), 'neutral', (g) => (g.win ? 'victoria' : 'derrota')),
    goldCard('Mejor oro @15 vs rival', goldRec('best15'), 'good', (g) => (g.win ? 'victoria' : 'derrota')),
    goldCard('Peor oro @15 vs rival', goldRec('worst15', -1), 'bad', (g) => (g.win ? 'victoria' : 'derrota')),
  ];
  const cards = defs.filter((d) => d[1]).map(([title, p, fmtFn, tone, champFn, idFn]) => {
    const r = p!;
    const mid = idFn ? idFn(r) : null;
    const kids = (
      <>
        <span className="rec-t">{title}</span>
        <div className="rec-main">{champFn ? <ChampIcon champ={champFn(r)} size={34} /> : <Avatar p={r} size={34} />}<b className="rec-v">{fmtFn(r)}</b></div>
        <span className="rec-w">{r.name}</span>
      </>
    );
    return mid
      ? <div key={title} className={`rec rec-${tone} clickable`} role="button" tabIndex={0} title="Ver la partida" onClick={() => { openMatchModal(mid, `${title} · ${r.name}`, r.main?.riotId); }}>{kids}</div>
      : <div key={title} className={`rec rec-${tone}`}>{kids}</div>;
  });
  return <>{goldCards}{cards}</>;
}

// ---------------------------------------------------------------- premios
interface AwardDef {
  key: string; icon: string; title: string; desc: string; bad?: boolean;
  val: (p: Player) => number | null | undefined;
  fmt: (v: number, p: Player) => string;
  extra?: (p: Player) => string;
  note?: (rows: Player[]) => string | null;
}
// Mientras se completan los pings y rendiciones de partidas antiguas, se avisa de cuántas hay
function conductNote(rows: Player[]): string | null {
  const have = rows.reduce((n, p) => n + (p.s?.conduct?.games ?? 0), 0);
  const all = rows.reduce((n, p) => n + (p.s?.games ?? 0), 0);
  return all && have < all * 0.97 ? `Descargando datos de partidas antiguas: de momento, ${fmtInt(have)} de ${fmtInt(all)} partidas` : null;
}
const cd = (p: Player) => p.s!.conduct!;
const AWARDS: AwardDef[] = [
  { key: 'grind', icon: '⚔', title: 'El grindeador', desc: 'Más partidas ganadas en la temporada.', val: (p) => p.rank?.wins, fmt: (v) => `${v} victorias` },
  { key: 'onetrick', icon: '♛', title: 'One trick king', desc: 'Más victorias con un mismo campeón.', val: (p) => p.s?.awards?.oneTrick?.wins,
    fmt: (v) => `${v} victorias`, extra: (p) => p.s!.awards!.oneTrick!.champ },
  { key: 'mainchar', icon: '★', title: 'Main character', desc: 'Mejor winrate con un mismo campeón (mínimo 30 partidas con él).', val: (p) => p.s?.awards?.mainChar?.winrate,
    fmt: (v) => `${fmt(v, 1)}%`, extra: (p) => `${p.s!.awards!.mainChar!.champ} · ${p.s!.awards!.mainChar!.games} part.` },
  { key: 'autofill', icon: '⇄', title: 'Mejor autofill', desc: 'Mejor winrate fuera de su línea principal (top y mid cuentan como la misma), mínimo 20 partidas fuera de ella.',
    val: (p) => ((p.s?.awards?.autofill?.games ?? 0) >= 20 ? p.s!.awards!.autofill!.winrate : null), fmt: (v) => `${fmt(v, 1)}%`, extra: (p) => `${p.s!.awards!.autofill!.games} part. fuera de línea` },
  { key: 'streak', icon: '⚡', title: 'Sin frenos', desc: 'La racha de victorias seguidas más larga.', val: (p) => p.s?.streak?.bestWin, fmt: (v) => `${v} seguidas` },
  { key: 'penta', icon: '✋', title: 'Pentakill hunter', desc: 'Más pentakills.', val: (p) => p.s?.awards?.pentas, fmt: (v) => `${v} penta${v === 1 ? '' : 's'}` },
  { key: 'quadra', icon: '✦', title: 'Cuadra killer', desc: 'Más cuádruples asesinatos.', val: (p) => p.s?.awards?.quadras, fmt: (v) => `${v} cuadra${v === 1 ? '' : 's'}`,
    note: (rows) => (rows.some((p) => (p.s?.awards?.quadraGames ?? 0) < (p.s?.games ?? 0)) ? 'Aún descargando datos de cuádruples de partidas antiguas' : null) },
  { key: 'pool', icon: '◎', title: 'Maestro del champion pool', desc: 'Ha ganado con más campeones diferentes.', val: (p) => p.s?.awards?.champPool, fmt: (v) => `${v} campeones` },
  { key: 'consistency', icon: '◆', title: 'Consistency king', desc: 'La racha más larga de partidas seguidas con KDA de 5 o más.', val: (p) => p.s?.awards?.kdaStreak, fmt: (v) => `${v} seguidas` },
  { key: 'kda', icon: '✚', title: 'KDA player', desc: 'Mejor KDA medio por partida (mínimo 50 partidas).', val: (p) => ((p.s?.games ?? 0) >= 50 ? p.s?.awards?.avgKda : null), fmt: (v) => `${fmt(v, 2)} KDA` },
  { key: 'sheriff', icon: '✪', title: 'El sheriff', desc: 'Más primeras sangres (first bloods).', val: (p) => p.s?.awards?.firstBloods, fmt: (v) => `${v} first bloods` },
  { key: 'pochi', icon: '☠', title: 'Pochiqueue', desc: 'La racha de derrotas seguidas más larga.', val: (p) => p.s?.streak?.worstLoss, fmt: (v) => `${v} seguidas`, bad: true },
  { key: 'coward', icon: '⚐', title: 'Premio al más cobarde', desc: 'Más derrotas acabadas en rendición de su equipo, en % (mínimo 20 derrotas con datos).',
    val: (p) => ((p.s?.conduct?.losses ?? 0) >= 20 ? cd(p).ffPct : null), fmt: (v) => `${fmt(v, 0)} % rendidas`, bad: true,
    extra: (p) => `${cd(p).ffLosses} de ${cd(p).losses} derrotas · ${cd(p).ffEarly} antes del 20`, note: conductNote },
  { key: 'brave', icon: '⚑', title: 'Nunca se rinde', desc: 'Menos derrotas acabadas en rendición de su equipo, en % (mínimo 20 derrotas con datos).',
    val: (p) => ((p.s?.conduct?.losses ?? 0) >= 20 ? 100 - cd(p).ffPct : null), fmt: (v) => `${fmt(100 - v, 0)} % rendidas`,
    extra: (p) => `${cd(p).ffLosses} de ${cd(p).losses} derrotas` },
  { key: 'qking', icon: '?', title: 'El rey del "?"', desc: 'Más pings de "?" por partida (el de "enemigo desaparecido", el favorito para meter presión a los suyos).',
    val: (p) => ((p.s?.conduct?.games ?? 0) >= 20 ? cd(p).q : null), fmt: (v) => `${fmt(v, 1)} por partida`, bad: true,
    extra: (p) => `récord: ${cd(p).maxQ?.val ?? 0} en una partida`, note: conductNote },
  { key: 'spam', icon: '!', title: 'El pesado de los pings', desc: 'Más pings por partida, de cualquier tipo.',
    val: (p) => ((p.s?.conduct?.games ?? 0) >= 20 ? cd(p).pings : null), fmt: (v) => `${fmt(v, 0)} por partida`,
    extra: (p) => `"todos adentro": ${fmt(cd(p).allIn, 1)} · "atrás": ${fmt(cd(p).back, 1)}` },
];

export function Awards() {
  const { model } = useApp();
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const rows = model.filter((p) => p.s);
  return <>{AWARDS.map((a) => {
    const ranked = rows.map((p) => ({ p, v: a.val(p) })).filter((x): x is { p: Player; v: number } => x.v != null && x.v > 0).sort((x, y) => y.v - x.v);
    const lead = ranked[0];
    const isOpen = open.has(a.key);
    const note = a.note?.(rows);
    return (
      <article key={a.key} className={`aw ${a.bad ? 'bad' : ''}`}>
        <div className="aw-top"><span className="aw-ico" aria-hidden="true">{a.icon}</span>
          {lead ? <span className="aw-badge">{a.fmt(lead.v, lead.p)}</span> : null}</div>
        <h4 className="aw-title">{a.title}</h4>
        <p className="aw-desc">{a.desc}</p>
        {note ? <p className="aw-note">{note}</p> : null}
        <div className="aw-foot">
          {lead ? <div className="aw-lead"><Avatar p={lead.p} size={28} /><div><small>En cabeza</small><b>{lead.p.name}</b>
            {a.extra ? <span className="aw-extra">{a.extra(lead.p)}</span> : null}</div></div> : <span className="muted small">Nadie todavía</span>}
          {ranked.length > 1 ? (
            <button className="aw-more" onClick={() => setOpen((s) => { const x = new Set(s); if (x.has(a.key)) x.delete(a.key); else x.add(a.key); return x; })}>
              {isOpen ? 'Ocultar ↑' : 'Ver clasificación →'}</button>
          ) : null}
        </div>
        {isOpen ? <ol className="aw-list">{ranked.map((x, i) => (
          <li key={x.p.name}>
            <span className="lb-pos">{i + 1}</span><Avatar p={x.p} size={22} /><span className="lb-name">{x.p.name}</span>
            {a.extra ? <span className="aw-extra">{a.extra(x.p)}</span> : <span />}<b>{a.fmt(x.v, x.p)}</b>
          </li>
        ))}</ol> : null}
      </article>
    );
  })}</>;
}

const GAME_RECORDS: [GameRecordKey, string, string, (v: number) => string][] = [
  ['kills', '⚔', 'Más kills', (v) => `${v} kills`],
  ['assists', '✚', 'Más asistencias', (v) => `${v} asist.`],
  ['damage', '✦', 'Más daño a campeones', (v) => goldK(v, false)],
  ['vision', '◉', 'Más visión', (v) => `${v} visión`],
  ['longestWin', '⌛', 'Victoria más larga', (v) => mmss(v)],
  ['kda', '◆', 'Mejor KDA', (v) => `${fmt(v, 1)} KDA`],
  ['kp', '◎', 'Mayor participación', (v) => `${v}% KP`],
  ['towers', '♜', 'Más daño a torres', (v) => goldK(v, false)],
  ['gold', '¤', 'Más oro', (v) => goldK(v, false)],
  ['csMin', '⚘', 'Mejor CS/min', (v) => `${fmt(v, 1)} CS/min`],
  ['q', '?', 'Más "?" en una partida', (v) => `${v} pings "?"`],
];

export function GameRecords() {
  const { model, openMatchModal } = useApp();
  const rows = model.filter((p) => p.s);
  return <>{GAME_RECORDS.map(([key, icon, title, f]) => {
    const c = rows.filter((p) => p.s!.gameRecords?.[key]).map((p) => ({ p, g: p.s!.gameRecords![key]! }));
    if (!c.length) return null;
    const x = c.reduce((m, y) => (y.g.val > m.g.val ? y : m));
    const open = () => { openMatchModal(x.g.id, `${title} · ${x.p.name}`, x.p.main?.riotId); };
    return (
      <div key={key} className="gr" role="button" tabIndex={0} title="Ver la partida" onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); }}>
        <span className="aw-ico sm" aria-hidden="true">{icon}</span>
        <div className="gr-main"><b className="gr-title">{title}</b>
          <span className="gr-who"><Avatar p={x.p} size={18} />{x.p.name}<span className="muted">{` · ${x.g.champ} ${x.g.k}/${x.g.d}/${x.g.a}`}</span></span></div>
        <div className="gr-side"><span className="aw-badge sm">{f(x.g.val)}</span><small className="gr-ver">Ver →</small></div>
      </div>
    );
  })}</>;
}
