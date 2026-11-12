// Ranking: cabecera, partidas en curso, podio, controles y tabla con la ficha de cada jugador
import { useState } from 'react';
import { useContext } from 'react';
import { AppContext, useApp } from '../ctx';
import { PlayerDetail, type DetailUi } from '../components/PlayerDetail';
import { Avatar, ChampIcon, Crest, LiveMin, Medal, RoleIcon, Sparkline, StreakChip, WinBar } from '../components/ui';
import { applyPeriod, liveOf, PERIODS, SORTERS, tiltNow, type PeriodKey, type Player, type RowPlayer, type SortKey } from '../lib/model';
import { ariaFlag, fmt, fmtInt, queueName, rankName, signed, tierKey } from '../lib/util';
import type { LiveGame } from '../types';

export interface Meta { updated: string; games: string; wr: string }

function PodiumCard({ p }: { p: Player }) {
  const s = p.s;
  const r = p.rank;
  const l20 = s?.last20;
  return (
    <article className={`pod pod-${p.pos}`}>
      <div className="pod-top">
        <Medal pos={p.pos} />
        <Avatar p={p} size={44} />
        <div className="pod-id"><b>{p.name}</b><span>{`${p.main!.gameName}#${p.main!.tagLine}`}</span></div>
        <RoleIcon role={s?.mainRole} />
      </div>
      <div className="pod-mid">
        <Crest rank={r} size={76} />
        <div className="pod-elo">
          <span className={`pod-tier t-${tierKey(r)}`}>{rankName(r)}</span>
          <b className="pod-lp">{r ? fmtInt(r.lp) : '–'}<small>LP</small></b>
        </div>
      </div>
      <div className="pod-stats">
        <div><b>{`${p.wins}V ${p.losses}D`}</b><span>{`${p.wins + p.losses} partidas`}</span></div>
        <div><b>{r ? `${fmt(r.winrate, 0)}%` : '–'}</b><span>Winrate</span></div>
        <div><b>{l20 ? `${l20.wins}V ${l20.losses}D` : '–'}</b><span>{`Últimas ${l20?.games ?? 20}`}</span></div>
      </div>
      <div className="pod-bar"><i style={{ width: `${r ? r.winrate : 0}%` }} /></div>
    </article>
  );
}

function PosDeltaTag({ d, title }: { d: number | null | undefined; title: string }) {
  if (!d) return null;
  return <small className={d > 0 ? 'pos' : 'neg'} title={title}>{`${d > 0 ? '▲' : '▼'}${Math.abs(d)}`}</small>;
}

// Segunda línea bajo el nombre: partida en curso, aviso de tilt o su Riot ID
function WhoLine({ p, live }: { p: Player; live: LiveGame[] }) {
  const lv = liveOf(live, p.name);
  if (lv) {
    const mates = lv.g.p.filter((x) => x.n !== p.name);
    const withTxt = mates.length ? ` · ${mates.some((x) => x.tm != null && x.tm !== lv.me.tm) ? 'contra' : 'con'} ${mates.map((x) => x.n).join(', ')}` : '';
    return (
      <span className="who-live" title={`${queueName(lv.g.q) ?? 'Partida'} en curso${withTxt}`}>
        <i className="live-dot" />{lv.me.c ? <ChampIcon champ={lv.me.c} size={16} /> : null}
        <span>{`${queueName(lv.g.q) ?? 'En partida'} · `}<LiveMin start={lv.g.s} />{withTxt}</span>
      </span>
    );
  }
  return <span>{`${p.main!.gameName}#${p.main!.tagLine}`}{p.accounts.length > 1 ? ` · +${p.accounts.length - 1}` : ''}</span>;
}

function PeriodCell({ p, period }: { p: RowPlayer; period: PeriodKey }) {
  const P = PERIODS[period];
  const { lp: v, games, wins, losses } = p.per;
  if (!games) return <span className="today-none" title={`No ha jugado ${P.this}`}>–</span>;
  const n = <small className="today-n">{`${wins}V ${losses}D`}</small>;
  if (v == null) return <span className="today-wrap"><span className="muted">?</span>{n}</span>;
  if (v === 0) return <span className="today-wrap" title="Ha ganado y perdido los mismos LP"><b className="today-zero">0</b>{n}</span>;
  return <span className="today-wrap" title={`${signed(v)} LP ${P.this} · ${games} partidas`}><b className={v > 0 ? 'pos' : 'neg'}>{`${v > 0 ? '▲' : '▼'} ${Math.abs(v)}`}</b>{n}</span>;
}

function Row({ p, idx, sortKey, period, ui, open, toggle }: { p: RowPlayer; idx: number; sortKey: SortKey; period: PeriodKey; ui: DetailUi; open: boolean; toggle: () => void }) {
  const { live } = useApp();
  const s = p.s;
  const byElo = sortKey === 'rank';
  const byPeriod = sortKey === 'period';
  const shownPos = byElo ? p.pos : idx + 1;
  const delta = byElo ? <PosDeltaTag d={p.posDelta} title="Puestos respecto a esta mañana" />
    : byPeriod && p.per.games ? <PosDeltaTag d={p.perDelta} title={`Puestos respecto a ${PERIODS[period].prev}`} /> : null;
  const tilt = tiltNow(p);
  return (
    <div className={`row ${open ? 'open' : ''} ${byElo && shownPos <= 3 ? `top top${shownPos}` : ''} ${byPeriod && !p.per.games ? 'idle' : ''} ${liveOf(live, p.name) ? 'is-live' : ''}`} role="row">
      <button className="tr" {...ariaFlag('aria-expanded', open)} onClick={toggle}>
        <span className="c-pos">{byElo && shownPos <= 3 ? <Medal pos={shownPos} /> : <b className="num">{shownPos}</b>}{delta}</span>
        <span className="c-player">
          <Avatar p={p} size={38} />
          <span className="who">
            <b>{p.name}{tilt ? <span className="tilt-flag" title={tilt}> 🧊</span> : null}</b>
            <WhoLine p={p} live={live} />
          </span>
        </span>
        <span className="c-role"><RoleIcon role={s?.mainRole} /></span>
        <span className="c-elo"><Crest rank={p.rank} size={30} />
          <span className="elo-txt"><b className={`t-${tierKey(p.rank)}`}>{rankName(p.rank)}</b>{p.rank ? <small>{`${p.rank.lp} LP`}</small> : null}</span></span>
        <span className="c-wr"><WinBar w={p.wins} l={p.losses} /></span>
        <span className="c-trend"><Sparkline trend={s?.trend} /></span>
        <span className="c-streak"><StreakChip s={s} /></span>
        <span className="c-today"><PeriodCell p={p} period={period} /></span>
        <span className="c-kda"><b>{s ? fmt(s.kda, 2) : '–'}</b></span>
        <span className="c-chev" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open ? <PlayerDetail p={p} ui={ui} /> : null}
    </div>
  );
}

function LiveNow() {
  const { live, model } = useApp();
  const byName = new Map(model.map((p) => [p.name, p]));
  return (
    <>
      <div className="live-head"><i className="live-dot" /><b>Jugando ahora</b>
        <small className="muted">se comprueba cada minuto</small></div>
      <div className="live-games">{live.map((g, gi) => {
        const vs = new Set(g.p.map((x) => x.tm)).size > 1;
        const tag = vs ? <span className="lg-tag vs">¡Se enfrentan!</span>
          : g.p.length > 1 ? <span className="lg-tag duo">{g.p.length === 2 ? 'En dúo' : `${g.p.length} juntos`}</span> : null;
        return (
          <div key={gi} className={`live-game ${vs ? 'vs' : ''}`}>
            <div className="lg-top"><b>{queueName(g.q) ?? 'Partida'}</b><span className="muted">·</span><LiveMin start={g.s} />{tag}</div>
            <div className="lg-players">{g.p.map((x, xi) => {
              const p = byName.get(x.n);
              return (
                <div key={xi} className={`lg-p ${vs ? (x.tm === 100 ? 'blue' : 'red') : ''}`}>
                  {x.c ? <ChampIcon champ={x.c} size={36} /> : p ? <Avatar p={p} size={36} /> : null}
                  <div className="lg-who"><b>{x.n}</b><small>{x.c ?? (p ? rankName(p.rank) : '')}</small></div>
                </div>
              );
            })}</div>
          </div>
        );
      })}</div>
    </>
  );
}

const SORT_BTNS: [SortKey, string][] = [['rank', 'Elo'], ['period', 'LP hoy'], ['winrate', 'Winrate'], ['streak', 'Racha'], ['kda', 'KDA']];
const PERIOD_BTNS: [PeriodKey, string][] = [['day', 'Hoy'], ['week', 'Semana'], ['month', 'Mes']];

export function RankingSection({ meta, failed, onCompare }: { meta: Meta | null; failed: boolean; onCompare: () => void }) {
  const app = useContext(AppContext);
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<PeriodKey>('day');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [tab, setTabs] = useState<Map<string, string>>(() => new Map());
  const [accs, setAccs] = useState<Map<string, number>>(() => new Map());
  const [openMatches, setOpenMatches] = useState<Set<string>>(() => new Set());
  const [eloRange, setEloRanges] = useState<Map<string, number>>(() => new Map());
  const ui: DetailUi = {
    tab, acc: accs, openMatches, eloRange,
    setTab: (n, t) => setTabs((m) => new Map(m).set(n, t)),
    setAcc: (n, i) => setAccs((m) => new Map(m).set(n, i)),
    toggleMatch: (id) => setOpenMatches((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; }),
    setEloRange: (k, d) => setEloRanges((m) => new Map(m).set(k, d)),
  };
  const label = `LP ${PERIODS[period].short}`;
  const live = app?.live ?? [];
  const playing = live.reduce((n, g) => n + g.p.length, 0);

  let rows = null;
  let podium = null;
  if (app) {
    const model = applyPeriod(app.model, period);
    const q = query.trim().toLowerCase();
    const list = [...model].sort(SORTERS[sortKey])
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.accounts.some((a) => a.riotId.toLowerCase().includes(q)));
    rows = list.length ? list.map((p, i) => (
      <Row key={p.name} p={p} idx={i} sortKey={sortKey} period={period} ui={ui} open={expanded.has(p.name)}
        toggle={() => setExpanded((s) => { const x = new Set(s); if (x.has(p.name)) x.delete(p.name); else x.add(p.name); return x; })} />
    )) : <p className="empty">Ningún jugador coincide con la búsqueda.</p>;
    podium = [...app.model].sort((a, b) => b.score - a.score).slice(0, 3).map((p) => <PodiumCard key={p.name} p={p} />);
  } else if (failed) {
    rows = <p className="empty">Todavía no hay datos. Aparecerán tras la primera actualización automática.</p>;
  }

  return (
    <section id="ranking" className="section">
      <div className="rank-head">
        <h1 className="display">Ranking</h1>
        <div className="head-meta">
          <div className="meta-chip"><span>Última<br />novedad</span><b id="meta-updated">{meta?.updated ?? '–'}</b></div>
          <div className="meta-chip"><span>Partidas<br />del grupo</span><b id="meta-games">{meta?.games ?? '–'}</b></div>
          <div className="meta-chip"><span>Winrate<br />del grupo</span><b id="meta-wr">{meta?.wr ?? '–'}</b></div>
          <a className="meta-chip live-chip" id="meta-live" href="#live-now" hidden={!app || !playing}
            title={app ? (playing ? live.flatMap((g) => g.p.map((x) => x.n)).join(', ') : '') : undefined}><span>Jugando<br />ahora</span><b>{app ? playing : 0}</b></a>
        </div>
      </div>

      <div id="live-now" className="live-now" hidden={!app || !live.length}>{app && live.length ? <LiveNow /> : null}</div>

      <div id="podium" className="podium">{podium}</div>

      <div className="controls">
        <div className="pills" id="sort" role="tablist" aria-label="Ordenar por">
          {SORT_BTNS.map(([k, l]) => (
            <button key={k} data-sort={k} id={k === 'period' ? 'sort-period' : undefined} className={sortKey === k ? 'on' : undefined}
              onClick={() => setSortKey(k)}>{k === 'period' ? label : l}</button>
          ))}
        </div>
        <div className="controls-right">
          <div className="seg" id="period" role="group" aria-label="Periodo de la columna de LP">
            {PERIOD_BTNS.map(([k, l]) => (
              <button key={k} data-period={k} className={period === k ? 'on' : undefined} onClick={() => { setPeriod(k); setSortKey('period'); }}>{l}</button>
            ))}
          </div>
          <button className="ghost-btn" id="compare-btn" title="Comparar dos jugadores" onClick={onCompare}>⚖ Comparar</button>
          <label className="search">
            <input id="search" type="search" placeholder="Buscar jugador" autoComplete="off" onInput={(e) => setQuery(e.currentTarget.value)} />
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          </label>
        </div>
      </div>

      <div className="table" role="table" aria-label="Clasificación" data-sort={app ? sortKey : undefined}>
        <div className="thead" role="row">
          <span>#</span><span>Jugador</span><span className="c-role">Rol</span><span>Elo</span>
          <span className="c-wr">V / D</span><span className="c-trend">Últimas 20</span><span className="c-streak">Racha</span>
          <span className="c-today" id="th-period">{label}</span><span className="c-kda">KDA</span><span></span>
        </div>
        <div id="rows">{rows}</div>
      </div>
    </section>
  );
}
