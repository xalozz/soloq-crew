// Estadísticas: líderes de cada media, KDA y roles
import { useApp } from '../ctx';
import { Avatar, RoleIcon, TierTag } from '../components/ui';
import { vars } from '../components/PlayerDetail';
import { byRank, type Player } from '../lib/model';
import type { Stats as StatsT } from '../types';
import { fmt, goldK, pct100, ROLE_ES, ROLES, tierKey } from '../lib/util';

interface StatDef { title: string; sub: string; get: (s: StatsT) => number | null | undefined; d?: number; suffix?: string; fmt?: (v: number) => string; games?: (s: StatsT) => number }
const STAT_CARDS: StatDef[] = [
  { title: 'Kills', sub: 'Más asesinatos por partida', get: (s) => s.avgK, d: 1 },
  { title: 'Muertes', sub: 'Más veces eliminado por partida', get: (s) => s.avgD, d: 1 },
  { title: 'Asistencias', sub: 'Más asistencias por partida', get: (s) => s.avgA, d: 1 },
  { title: 'CS/min', sub: 'Farmeo por minuto', get: (s) => s.csPerMin, d: 1 },
  { title: 'Visión', sub: 'Puntuación de visión por minuto', get: (s) => s.visPerMin, d: 2 },
  { title: '% daño', sub: 'Parte del daño a campeones de su equipo', get: (s) => s.dmgShare, d: 1, suffix: '%' },
  { title: 'Oro @15', sub: 'Diferencia media de oro con su rival de línea al minuto 15', get: (s) => s.gold?.avgGd15, fmt: (v) => goldK(v), games: (s) => s.gold!.games },
  { title: '1ª del día', sub: 'Winrate en la primera partida de cada día', get: (s) => (s.firstOfDay && s.firstOfDay.games >= 10 ? s.firstOfDay.winrate : null), d: 1, suffix: '%', games: (s) => s.firstOfDay!.games },
  { title: 'Throws', sub: 'Partidas perdidas tras ir +3k de oro por equipo', get: (s) => s.gold?.throws, d: 0, games: (s) => s.gold!.games },
];

function StatCard({ def, players }: { def: StatDef; players: Player[] }) {
  const list = players.filter((p) => p.s && def.get(p.s) != null)
    .map((p) => ({ p, v: def.get(p.s!)! }))
    .sort((a, b) => b.v - a.v);
  if (!list.length) return null;
  const [first, ...rest] = list;
  const val = (v: number) => (def.fmt ? def.fmt(v) : `${fmt(v, def.d)}${def.suffix ?? ''}`);
  const games = (p: Player) => (def.games ? def.games(p.s!) : p.s!.games);
  return (
    <article className="scard">
      <h3 className="card-title">{def.title}</h3>
      <p className="card-sub">{def.sub}</p>
      <div className="leader">
        <span className="leader-pos">1</span>
        <div className="leader-who"><Avatar p={first.p} size={76} cls="big" /><b>{first.p.name}</b><TierTag rank={first.p.rank} /></div>
        <div className="leader-val"><b>{val(first.v)}</b><span>{`${games(first.p)} partidas`}</span></div>
      </div>
      <ol className="lb" start={2}>{rest.map((x, i) => (
        <li key={x.p.name} className={`lb-row t-border-${tierKey(x.p.rank)}`}>
          <span className="lb-pos">{i + 2}</span><Avatar p={x.p} size={26} /><span className="lb-name">{x.p.name}</span>
          <b className="lb-val">{val(x.v)}</b><span className="lb-games">{`${games(x.p)} partidas`}</span>
        </li>
      ))}</ol>
    </article>
  );
}

function KdaCard({ players }: { players: Player[] }) {
  const list = players.filter((p) => p.s).sort((a, b) => b.s!.kda - a.s!.kda).slice(0, 4);
  if (!list.length) return null;
  return (
    <article className="scard wide">
      <h3 className="card-title">KDA</h3>
      <p className="card-sub">Kills + asistencias / muertes</p>
      <div className="kda-row">{list.map((p, i) => (
        <div key={p.name} className="kda-item">
          <span className="leader-pos">{i + 1}</span>
          <div className="leader-who"><Avatar p={p} size={64} cls="big" /><b>{p.name}</b><TierTag rank={p.rank} /></div>
          <div className="leader-val"><b>{fmt(p.s!.kda, 2)}</b><span>{`${p.s!.games} partidas`}</span></div>
        </div>
      ))}</div>
    </article>
  );
}

function RolesCard({ players }: { players: Player[] }) {
  const rows = [...players].filter((p) => p.s?.byRole).sort(byRank);
  if (!rows.length) return null;
  return (
    <article className="scard wide">
      <h3 className="card-title">Roles</h3>
      <p className="card-sub">% de partidas en cada rol (suma 100 %) y winrate en ese rol</p>
      <div className="rtable-wrap"><table className="rtable">
        <thead><tr><th>Jugador</th>
          {ROLES.map((r) => <th key={r}><span className="rth"><RoleIcon role={r} />{ROLE_ES[r]}</span></th>)}
          <th title="Partidas analizadas / partidas de SoloQ de la temporada según Riot">Partidas</th></tr></thead>
        <tbody>{rows.map((p) => {
          const br = p.s!.byRole!;
          const counts = ROLES.map((r) => br[r]?.games ?? 0);
          const shares = pct100(counts);
          const total = counts.reduce((a, b) => a + b, 0);
          const main = shares.indexOf(Math.max(...shares));
          return (
            <tr key={p.name}>
              <td className="rt-player"><Avatar p={p} size={26} /><b>{p.name}</b></td>
              {ROLES.map((r, i) => {
                const x = br[r];
                if (!x?.games) return <td key={r} className="rt-cell zero"><span className="rt-share">0%</span></td>;
                return (
                  <td key={r} className={`rt-cell ${i === main ? 'main' : ''}`} style={vars({ '--share': `${shares[i]}%` })} title={`${ROLE_ES[r]}: ${x.games} partidas · ${x.wins}V ${x.games - x.wins}D · KDA ${fmt(x.kda, 2)}`}>
                    <span className="rt-share">{`${shares[i]}%`}</span>
                    <span className={`rt-wr ${x.winrate >= 50 ? 'pos' : 'neg'}`}>{`${fmt(x.winrate, 0)}% WR`}</span>
                    <span className="rt-n">{`${x.games} part.`}</span>
                  </td>
                );
              })}
              <td className="rt-total" title="Analizadas / temporada"><b>{total}</b>{p.wins + p.losses > total ? <small>{` / ${p.wins + p.losses}`}</small> : null}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <p className="muted small center">Partidas de SoloQ de esta temporada de la cuenta principal. Resaltado: su rol principal. En "Partidas", analizadas / total de la temporada: cuando no coinciden es porque Riot ya no devuelve las partidas más antiguas de esa cuenta, así que los porcentajes salen de las que sí da.</p>
    </article>
  );
}

export function Stats() {
  const { model } = useApp();
  return (
    <>
      {STAT_CARDS.map((d) => <StatCard key={d.title} def={d} players={model} />)}
      <KdaCard players={model} />
      <RolesCard players={model} />
    </>
  );
}
