// Flex y Clash
import { useApp } from '../ctx';
import { Avatar, ChampIcon, Crest, WinBar } from '../components/ui';
import type { FlexGame } from '../types';
import { adjWr, mmss, queueName, rankName, rankScore, shortDate, tierKey } from '../lib/util';

export function Flex() {
  const { data, model, openMatchModal } = useApp();
  const f = data.flex;
  const byName = new Map(model.map((p) => [p.name, p]));
  if (!f || (!f.players?.length && !f.lineups?.length && !f.clash?.length)) {
    return <p className="empty">Todavía no hay partidas de Flex ni de Clash esta temporada. En cuanto juguéis, aparecerán aquí vuestro rango de Flex y las alineaciones que más ganan.</p>;
  }
  const ranks = [...(f.players ?? [])].sort((a, b) => rankScore(b.rank) - rankScore(a.rank) || b.games - a.games);
  const lineups = [...(f.lineups ?? [])].sort((a, b) => b.n - a.n || b.wr - a.wr);
  const best = lineups.filter((l) => l.n >= 5).reduce<(typeof lineups)[number] | null>((m, l) => (!m || adjWr(l.w, l.n, 3) > adjWr(m.w, m.n, 3) ? l : m), null);
  const gameRow = (g: FlexGame, i: number) => (
    <button key={i} className={`fx-game ${g.win ? 'win' : 'loss'}`}
      onClick={() => { openMatchModal(g.id, `${queueName(g.q) ?? 'Partida'} · ${g.members.map((m) => m.name).join(', ')}`, byName.get(g.members[0]?.name)?.main?.riotId); }}>
      <b className={g.win ? 'pos' : 'neg'}>{g.win ? 'Victoria' : 'Derrota'}</b>
      <span className="muted">{`${shortDate(g.t)} · ${mmss(g.dur ?? 0)}`}</span>
      <span className="fx-members">{g.members.map((m, j) => <span key={j} className="fx-m" title={`${m.name} · ${m.champ} ${m.k}/${m.d}/${m.a}`}><ChampIcon champ={m.champ} size={26} /><small>{m.name}</small></span>)}</span>
    </button>
  );
  return (
    <>
      {ranks.length ? (
        <div className="fx-ranks">{ranks.map((x) => {
          const p = byName.get(x.name);
          return (
            <div key={x.name} className="fx-rank">
              {p ? <Avatar p={p} size={34} /> : null}
              <div className="fx-who"><b>{x.name}</b><small className="muted">{`${x.games} partida${x.games === 1 ? '' : 's'} de Flex${x.clash ? ` · ${x.clash} de Clash` : ''}`}</small></div>
              <Crest rank={x.rank} size={34} />
              <div className="fx-elo"><b className={`t-${tierKey(x.rank)}`}>{rankName(x.rank)}</b>
                {x.rank ? <small>{`${x.rank.lp} LP · ${x.rank.wins}V ${x.rank.losses}D`}</small> : <small className="muted">sin clasificar</small>}</div>
            </div>
          );
        })}</div>
      ) : null}
      <h3 className="aw-sub">Alineaciones</h3>
      {lineups.length ? (
        <div className="fx-lineups">{lineups.map((l, i) => (
          <div key={i} className={`fx-line ${l === best ? 'best' : ''}`}>
            <span className="duo-avs sm">{l.names.map((n) => { const p = byName.get(n); return p ? <Avatar key={n} p={p} size={26} /> : null; })}</span>
            <div className="fx-line-names"><b>{l.names.join(' · ')}</b>
              <small className="muted">{[l.flex ? `${l.flex} de Flex` : null, l.clash ? `${l.clash} de Clash` : null, `última: ${shortDate(l.last)}`].filter(Boolean).join(' · ')}</small></div>
            {l === best ? <span className="duo-tag syn">La que más gana</span> : <span />}
            <div className="fx-line-wr"><WinBar w={l.w} l={l.n - l.w} /></div>
          </div>
        ))}</div>
      ) : <p className="empty">Aún no habéis jugado Flex o Clash juntos.</p>}
      {f.recent?.length ? <h3 className="aw-sub">Últimas partidas de Flex en grupo</h3> : null}
      {f.recent?.length ? <div className="fx-games">{f.recent.slice(0, 10).map(gameRow)}</div> : null}
      {f.clash?.length ? <h3 className="aw-sub">Clash</h3> : null}
      {f.clash?.length ? <div className="fx-games">{f.clash.slice(0, 15).map(gameRow)}</div> : null}
    </>
  );
}
