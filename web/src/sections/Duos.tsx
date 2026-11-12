// Dúos y cara a cara
import { useApp } from '../ctx';
import { Avatar, ChampIcon, WinBar } from '../components/ui';
import type { Player } from '../lib/model';
import type { Duo, DuoSide } from '../types';
import { fmt, fmtInt, shortDate, signed } from '../lib/util';

const DUO_MIN = 5; // partidas juntos para tener tarjeta propia

function DuoGame({ g, title, meRiotId, cls }: { g: { id: string; t: number; c: [string, string]; kda: [number, number, number][] }; title: string; meRiotId?: string; cls: string }) {
  const { openMatchModal } = useApp();
  const kdas = g.kda.map(([k, d, a]) => `${k}/${d}/${a}`);
  return (
    <button className={`dg ${cls}`} onClick={() => { openMatchModal(g.id, title, meRiotId); }}
      title={`${cls === 'w' ? 'Victoria' : 'Derrota'} · ${shortDate(g.t)}\n${g.c[0]} ${kdas[0]} · ${g.c[1]} ${kdas[1]}`}>
      <ChampIcon champ={g.c[0]} size={22} /><ChampIcon champ={g.c[1]} size={22} />
    </button>
  );
}

function DuoSideView({ sd, p, other }: { sd: DuoSide; p: Player | undefined; other: string }) {
  const lpCls = sd.lp > 0 ? 'pos' : sd.lp < 0 ? 'neg' : '';
  const lpTitle = sd.lpEst
    ? `${sd.lpEst} partidas sin LP registrado (anteriores al 30 sep o varias seguidas): estimadas con su media de LP por victoria y por derrota`
    : 'LP registrados partida a partida';
  return (
    <div className="duo-side">
      <div className="duo-who">{p ? <Avatar p={p} size={26} /> : null}<b>{sd.name}</b></div>
      <div className="kv"><span>LP juntos</span>
        <b className={lpCls} title={lpTitle}>{`${sd.lpEst ? '≈ ' : ''}${signed(sd.lp)} LP`}</b></div>
      <div className="kv"><span>{`Winrate sin ${other}`}</span>
        <b>{`${fmt(sd.wrWithout)}%`}<small className="muted">{` · ${fmtInt(sd.gamesWithout)} part.`}</small></b></div>
      <div className="kv"><span>KDA juntos</span>
        <b>{`${fmt(sd.kda.k)} / ${fmt(sd.kda.d)} / ${fmt(sd.kda.a)}`}<small className="muted">{` · ${fmt(sd.kda.ratio, 2)}`}</small></b></div>
      <div className="duo-champs">{sd.champs.map(([c, n], i) => <span key={i} className="duo-ch" title={`${c}: ${n} partidas`}><ChampIcon champ={c} size={26} /><small>{n}</small></span>)}</div>
    </div>
  );
}

function DuoCard({ d, byName }: { d: Duo; byName: Map<string, Player> }) {
  const { openCompare } = useApp();
  const [A, B] = d.sides;
  const pa = byName.get(d.a), pb = byName.get(d.b);
  const base = (A.wrWithout + B.wrWithout) / 2;
  const diff = d.wr - base;
  const tag = d.games < 10 ? null
    : diff >= 3 ? ['syn', `Sinergia +${fmt(diff)} pts`]
      : diff <= -3 ? ['anti', `Mejor por separado ${fmt(diff)} pts`]
        : ['neu', 'Ni suma ni resta'];
  const title = `${d.a} & ${d.b}`;
  return (
    <article className="duo panel">
      <div className="duo-head">
        <div className="duo-avs">{pa ? <Avatar p={pa} size={40} /> : null}{pb ? <Avatar p={pb} size={40} /> : null}</div>
        <div className="duo-title"><b>{title}</b>
          <span className="muted">{`${d.games} partidas · ${fmt(d.hours)} h juntos · desde el ${shortDate(d.first)}`}</span></div>
        {tag ? <span className={`duo-tag ${tag[0]}`} title={`Winrate juntos frente a la media de sus winrates por separado (${fmt(base)}%)`}>{tag[1]}</span> : null}
        <button className="duo-cmp" title={`Comparar a ${d.a} y ${d.b}`} onClick={() => openCompare(d.a, d.b)}>⚖</button>
      </div>
      <div className="duo-wr">
        <b className={d.wr >= 50 ? 'pos' : 'neg'}>{`${fmt(d.wr)}%`}</b>
        <div className="duo-bar"><WinBar w={d.wins} l={d.losses} /></div>
        <div className="duo-streaks">
          <span><small>Racha</small><span className={`chip ${d.streak.win ? 'chip-w' : 'chip-l'}`}>{`${d.streak.n}${d.streak.win ? 'V' : 'D'}`}</span></span>
          <span><small>Mejor</small><b className="pos">{`${d.bestWin}V`}</b></span>
          <span><small>Peor</small><b className="neg">{`${d.bestLoss}D`}</b></span>
        </div>
      </div>
      <div className="duo-sides"><DuoSideView sd={A} p={pa} other={d.b} /><DuoSideView sd={B} p={pb} other={d.a} /></div>
      <div className="duo-recent"><small className="lbl">Últimas juntos</small>
        <div className="dg-row">{d.recent.map((g, i) => <DuoGame key={i} g={g} title={title} meRiotId={pa?.main?.riotId} cls={g.win ? 'w' : 'l'} />)}</div></div>
    </article>
  );
}

function Avs({ a, b, byName }: { a: string; b: string; byName: Map<string, Player> }) {
  const pa = byName.get(a), pb = byName.get(b);
  return <div className="duo-avs sm">{pa ? <Avatar p={pa} size={24} /> : null}{pb ? <Avatar p={pb} size={24} /> : null}</div>;
}

export function Duos() {
  const { data, model } = useApp();
  const byName = new Map(model.map((p) => [p.name, p]));
  const duos = data.duos ?? [];
  const main = duos.filter((d) => d.games >= DUO_MIN);
  const minor = duos.filter((d) => d.games < DUO_MIN);
  const rivals = data.rivals ?? [];
  return (
    <>
      <div id="duos-main" className="duos">{main.length ? main.map((d, i) => <DuoCard key={i} d={d} byName={byName} />)
        : <p className="empty center">Todavía no hay dúos con suficientes partidas.</p>}</div>
      <div id="duos-minor" className="duos-minor">{minor.length ? <>
        <h3 className="aw-sub">Alguna vez juntos</h3>
        <div className="duo-mini-list">{minor.map((d, i) => (
          <div key={i} className="duo-mini">
            <Avs a={d.a} b={d.b} byName={byName} />
            <b>{`${d.a} & ${d.b}`}</b>
            <span className="muted">{`${d.games} part.`}</span>
            <span><span className="pos">{`${d.wins}V`}</span>{' '}<span className="neg">{`${d.losses}D`}</span></span>
            <div className="dg-row">{d.recent.map((g, j) => <DuoGame key={j} g={g} title={`${d.a} & ${d.b}`} meRiotId={byName.get(d.a)?.main?.riotId} cls={g.win ? 'w' : 'l'} />)}</div>
          </div>
        ))}</div>
      </> : null}</div>
      <div id="rivals" className="rivals">
        <h3 className="aw-sub">Cara a cara</h3>
        {rivals.length ? (
          <div className="duo-mini-list">{rivals.map((r, i) => (
            <div key={i} className="duo-mini">
              <Avs a={r.a} b={r.b} byName={byName} />
              <b>{`${r.a} vs ${r.b}`}</b>
              <span className="rv-score"><b className={r.aWins >= r.bWins ? 'pos' : 'neg'}>{r.aWins}</b>{' – '}<b className={r.bWins >= r.aWins ? 'pos' : 'neg'}>{r.bWins}</b></span>
              <div className="dg-row">{r.recent.map((g, j) => <DuoGame key={j} g={g} title={`${r.a} vs ${r.b}`} meRiotId={byName.get(r.a)?.main?.riotId} cls={g.aWin ? 'w' : 'l'} />)}</div>
            </div>
          ))}</div>
        ) : <p className="muted small center">Esta temporada nadie del grupo se ha cruzado como rival en SoloQ. Cuando pase, aparecerá aquí quién ganó.</p>}
      </div>
    </>
  );
}
