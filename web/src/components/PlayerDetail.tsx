// Ficha de jugador: historial, stats y elo, campeones
import type { CSSProperties, ReactNode } from 'react';
import { useApp } from '../ctx';
import type { Player } from '../lib/model';
import type { Account, ChampStat, KeyStat } from '../types';
import { ariaFlag, fmt, fmtInt, goldK, LINK_LABELS, nextDivision, pct100, rankName, rankScore, ROLE_COLOR, ROLE_ES, ROLES, scoreLabel, tierKey } from '../lib/util';
import { EloChart } from './EloChart';
import { MatchRow } from './Match';
import { ChampIcon, Crest, ExtLink, RoleIcon, StreakChip, WinBar } from './ui';

/** Estado de las fichas que se conserva al plegar y desplegar (como los Map globales de antes) */
export interface DetailUi {
  tab: Map<string, string>;
  acc: Map<string, number>;
  openMatches: Set<string>;
  eloRange: Map<string, number>;
  setTab: (name: string, t: string) => void;
  setAcc: (name: string, i: number) => void;
  toggleMatch: (id: string) => void;
  setEloRange: (key: string, d: number) => void;
}

/** Variables CSS en línea (--tc, --rc…) */
export const vars = (o: Record<string, string>): CSSProperties => o as CSSProperties;

function TabHistorial({ acc, ui }: { acc: Account; ui: DetailUi }) {
  const games = acc.recent ?? [];
  if (!games.length) return <p className="empty">Sin partidas de SoloQ registradas todavía.</p>;
  return <div className="matches">{games.map((g) => <MatchRow key={g.id} g={g} acc={acc} open={ui.openMatches.has(g.id)} onToggle={() => ui.toggleMatch(g.id)} />)}</div>;
}

const Kv = ({ label, value, cls }: { label: string; value: ReactNode; cls?: string }) => (
  <div className="kv"><span>{label}</span><b className={cls || ''}>{value ?? '–'}</b></div>
);
const Group = ({ title, children }: { title: string; children: ReactNode }) => <div className="sg"><h5>{title}</h5>{children}</div>;

function TabStats({ acc, ui }: { acc: Account; ui: DetailUi }) {
  const s = acc.stats, r = acc.rank;
  const next = nextDivision(r);
  const peak = acc.lpHist?.length ? Math.max(...acc.lpHist.map((x) => x[1])) : rankScore(r);
  const lp = s?.lp;
  const season = r ? r.wins + r.losses : null;
  const wr = r && season ? (r.wins / season) * 100 : null;
  const signCls = (v: number | null | undefined) => (v == null ? '' : v >= 0 ? 'pos' : 'neg');
  const chart = <EloChart acc={acc} days={ui.eloRange.get(acc.riotId) ?? 30} setDays={(d) => ui.setEloRange(acc.riotId, d)} />;

  // Franja superior: rango · winrate · progreso de división
  const head = (
    <div className="sx-head" style={vars({ '--tc': `var(--t-${tierKey(r)})` })}>
      <div className="sxh-rank"><Crest rank={r} size={46} />
        <div><b className={`t-${tierKey(r)}`}>{rankName(r)}</b><span>{r ? `${r.lp} LP` : 'Sin clasificar'}</span></div></div>
      {r ? (
        <div className="sxh-col">
          <div className="sxh-top"><span>Winrate</span><b className={wr! >= 50 ? 'pos' : 'neg'}>{`${fmt(wr, 1)}%`}</b>
            <small><span className="pos">{`${r.wins}V`}</span>{' '}<span className="neg">{`${r.losses}D`}</span></small></div>
          <div className="thin split"><i className="w" style={{ width: `${wr}%` }} /><i className="l" style={{ width: `${100 - wr!}%` }} /></div>
        </div>
      ) : null}
      {next ? (
        <div className="sxh-col">
          <div className="sxh-top"><span>{`Hacia ${next}`}</span><b>{`${r!.lp}`}</b><small>/ 100 LP</small></div>
          <div className="thin"><i className="acc" style={{ width: `${Math.min(100, r!.lp)}%` }} /></div>
        </div>
      ) : r ? <div className="sxh-col"><div className="sxh-top"><span>Liga</span><b>{`${r.lp} LP`}</b></div></div> : null}
    </div>
  );

  if (!s) return <div className="sx">{head}<p className="empty">Sin partidas de SoloQ registradas todavía.</p><h4 className="sx-h">Evolución de elo</h4>{chart}</div>;

  // KDA destacado
  const kdaBox = (
    <div className="sx-kda2">
      <span className="lbl">KDA</span>
      <b className="big">{fmt(s.kda, 2)}</b>
      <div className="kda-line"><span className="pos">{fmt(s.avgK)}</span>{' / '}<span className="neg">{fmt(s.avgD)}</span>{' / '}<span className="blue">{fmt(s.avgA)}</span>
        <small> por partida</small></div>
      {s.totals ? <div className="kda-tot">{`${fmtInt(s.totals.k)} / ${fmtInt(s.totals.d)} / ${fmtInt(s.totals.a)} en total`}</div> : null}
      <div className="kda-games"><b>{fmtInt(s.games)}</b>{` partidas analizadas${season && season > s.games ? ` de ${fmtInt(season)}` : ''}`}</div>
    </div>
  );

  const c = s.conduct;
  const groups = (
    <div className="sgrid">
      <Group title="Combate">
        <Kv label="KP media" value={s.avgKp != null ? `${s.avgKp}%` : null} />
        <Kv label="Récord de kills" value={s.maxKills} />
        <Kv label="First bloods" value={s.firstBloods} />
        <Kv label="Pentakills" value={s.pentas} />
      </Group>
      <Group title="Farmeo y visión">
        <Kv label="CS / min" value={fmt(s.csPerMin)} />
        <Kv label="Daño / min" value={s.dmgPerMin != null ? fmtInt(s.dmgPerMin) : null} />
        <Kv label="% daño equipo" value={s.dmgShare != null ? `${fmt(s.dmgShare)}%` : null} />
        <Kv label="Visión / partida" value={fmt(s.avgVision ?? null)} />
      </Group>
      <Group title="Oro">
        <Kv label="Oro @15 vs rival" value={s.gold ? goldK(s.gold.avgGd15) : null} cls={signCls(s.gold?.avgGd15)} />
        <Kv label="Mayor ventaja" value={s.gold?.biggestLead ? goldK(s.gold.biggestLead.val) : null} cls="pos" />
        <Kv label="Mayor throw" value={s.gold?.biggestThrow ? goldK(s.gold.biggestThrow.val, false) : null} cls="neg" />
        <Kv label="Partidas lanzadas" value={s.gold ? `${s.gold.throws}` : null} />
      </Group>
      <Group title="Rachas y LP">
        <Kv label="Racha actual" value={<StreakChip s={s} />} />
        <Kv label="1ª partida del día" value={s.firstOfDay ? <span title={`${s.firstOfDay.wins}V en ${s.firstOfDay.games} días · resto de partidas: ${fmt(s.firstOfDay.restWinrate, 1)}%`}>{`${fmt(s.firstOfDay.winrate, 0)}% WR`}</span> : null}
          cls={s.firstOfDay ? (s.firstOfDay.winrate >= 50 ? 'pos' : 'neg') : ''} />
        <Kv label="Mejor / peor" value={<span><span className="pos">{`${s.streak.bestWin}V`}</span>{' · '}<span className="neg">{`${s.streak.worstLoss}D`}</span></span>} />
        <Kv label="LP por victoria" value={lp?.win != null ? `+${lp.win}` : null} cls="pos" />
        <Kv label="LP por derrota" value={lp?.loss != null ? `${lp.loss}` : null} cls="neg" />
      </Group>
      {c ? (
        <Group title="Pings y rendiciones">
          <Kv label="Pings / partida" value={fmt(c.pings, 0)} />
          <Kv label={'"?" / partida'} value={<span title={`Récord: ${c.maxQ?.val ?? 0} en una partida`}>{fmt(c.q, 1)}</span>} />
          <Kv label="Rendiciones" value={<span title={`${c.ffLosses} de ${c.losses} derrotas · ${c.ffEarly} antes del minuto 20`}>{`${fmt(c.ffPct, 0)}%`}</span>} />
          <Kv label="Rival rendido" value={<span title={`${c.ffWins} de ${c.wins} victorias acabaron con el rival rindiéndose`}>{`${fmt(c.ffWinPct, 0)}%`}</span>} />
          {c.games < s.games * 0.97 ? <small className="muted">{`Con ${c.games} de ${s.games} partidas`}</small> : null}
        </Group>
      ) : null}
    </div>
  );

  return (
    <div className="sx">
      {head}
      <div className="sx-body">{kdaBox}{groups}</div>
      <p className="sx-line">
        {'Duración media '}<b>{`${fmt(s.avgDurationMin)} min`}</b>{' · Más larga '}<b>{`${fmt(s.maxDurationMin ?? null)} min`}</b>
        {' · Pico registrado '}<b className={`t-${tierKey(r)}`}>{peak >= 0 ? scoreLabel(peak) : '–'}</b>
      </p>
      <h4 className="sx-h">Evolución de elo</h4>
      {chart}
    </div>
  );
}

function RoleShareBlock({ acc }: { acc: Account }) {
  const br = acc.stats?.byRole;
  if (!br) return null;
  const counts = ROLES.map((r) => br[r]?.games ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const shares = pct100(counts);
  const main = shares.indexOf(Math.max(...shares));
  const season = acc.rank ? acc.rank.wins + acc.rank.losses : null;
  return (
    <div className="rs">
      <div className="rs-head"><b>Roles</b>
        <span className="muted">{`${total} partidas analizadas${season ? ` de ${season} en la temporada` : ''}`}</span></div>
      <div className="rs-bar" role="img" aria-label={ROLES.map((r, i) => `${ROLE_ES[r]} ${shares[i]}%`).join(', ')}>
        {ROLES.map((r, i) => (counts[i] ? <i key={r} style={{ flex: `${counts[i]}`, background: ROLE_COLOR[r] }} title={`${ROLE_ES[r]}: ${shares[i]}% · ${counts[i]} partidas`} /> : null))}
      </div>
      <div className="rs-tiles">{ROLES.map((r, i) => {
        const x = br[r];
        return (
          <div key={r} className={`rs-tile ${i === main ? 'main' : ''} ${counts[i] ? '' : 'zero'}`} style={vars({ '--rc': ROLE_COLOR[r] })} title={x ? `${x.wins}V ${x.games - x.wins}D · KDA ${fmt(x.kda, 2)}` : ''}>
            <RoleIcon role={r} />
            <b className="rs-share">{`${shares[i]}%`}</b>
            <span className="rs-n">{`${counts[i]} partidas`}</span>
            {x ? <span className={`rs-wr ${x.winrate >= 50 ? 'pos' : 'neg'}`}>{`${fmt(x.winrate, 0)}% WR`}</span> : <span className="rs-wr muted">–</span>}
          </div>
        );
      })}</div>
    </div>
  );
}

function BwTile({ label, g, kind }: { label: string; g: KeyStat | null | undefined; kind: 'champ' | 'role' }) {
  return (
    <div className="bw-tile">
      <span className="lbl">{label}</span>
      {g ? (
        <div className="bw-main">{kind === 'champ' ? <ChampIcon champ={g.key} size={34} /> : <RoleIcon role={g.key} />}
          <div><b>{kind === 'role' ? ROLE_ES[g.key] ?? g.key : g.key}</b><span>{`${fmt(g.winrate)}% · ${g.games} partidas · KDA ${fmt(g.kda, 2)}`}</span></div></div>
      ) : <span className="muted">Pocos datos (mín. 3 partidas)</span>}
    </div>
  );
}

function TabCampeones({ acc }: { acc: Account }) {
  const s = acc.stats;
  if (!s) return <p className="empty">Sin partidas registradas.</p>;
  const champs = s.champs ?? s.topChamps ?? [];
  return (
    <div className="cx">
      <RoleShareBlock acc={acc} />
      <div className="bw-grid">
        <BwTile label="Mejor campeón" g={s.bestChamp} kind="champ" /><BwTile label="Peor campeón" g={s.worstChamp} kind="champ" />
        <BwTile label="Mejor rol" g={s.bestRole} kind="role" /><BwTile label="Peor rol" g={s.worstRole} kind="role" />
      </div>
      <div className="ctable">
        <div className="ct-head"><span>Campeón</span><span>Partidas</span><span>Winrate</span><span>KDA</span><span className="c-cs">CS/min</span></div>
        {champs.map((c, i) => (
          <div key={i} className="ct-row">
            <span className="ct-name"><ChampIcon champ={c.key} size={30} /><b>{c.key}</b></span>
            <span>{c.games}</span>
            <span><WinBar w={c.wins} l={c.games - c.wins} /></span>
            <span className={c.kda >= 3 ? 'pos' : ''}>{fmt(c.kda, 2)}</span>
            <span className="c-cs">{(c as ChampStat).csPerMin != null ? fmt((c as ChampStat).csPerMin) : '–'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlayerDetail({ p, ui }: { p: Player; ui: DetailUi }) {
  const { openCompare } = useApp();
  const tab = ui.tab.get(p.name) ?? 'hist';
  const ai = ui.acc.get(p.name) ?? (p.bestAccount >= 0 ? p.bestAccount : 0);
  const acc = p.accounts[ai] ?? p.main!;
  const tabs: [string, string][] = [['hist', 'Historial'], ['stats', 'Stats & Elo'], ['champs', 'Campeones']];
  return (
    <div className="detail">
      <div className="dbar">
        <div className="dtabs" role="tablist">{tabs.map(([k, label]) => (
          <button key={k} className={k === tab ? 'on' : ''} role="tab" {...ariaFlag('aria-selected', k === tab)} onClick={() => ui.setTab(p.name, k)}>{label}</button>
        ))}</div>
        {p.accounts.length > 1 ? (
          <div className="dacc">{p.accounts.map((a, i) => (
            <button key={i} className={i === ai ? 'on' : ''} onClick={() => ui.setAcc(p.name, i)}>{a.gameName}</button>
          ))}</div>
        ) : null}
        <div className="dlinks">
          <button className="dl-btn" onClick={() => openCompare(p.name)}>⚖ Comparar</button>
          {Object.entries(acc.links || {}).filter(([k]) => k !== 'opgg').map(([k, url]) => <ExtLink key={k} url={url!} label={`${LINK_LABELS[k] ?? k} ↗`} />)}
          {acc.links?.opgg ? <ExtLink url={acc.links.opgg} label="Ver en OP.GG ↗" cls="main" /> : null}
        </div>
      </div>
      {acc.error ? <p className="err">{`No se pudo actualizar esta cuenta: ${acc.error}`}</p> : null}
      {tab === 'hist' ? <TabHistorial acc={acc} ui={ui} /> : tab === 'stats' ? <TabStats acc={acc} ui={ui} /> : <TabCampeones acc={acc} />}
    </div>
  );
}
