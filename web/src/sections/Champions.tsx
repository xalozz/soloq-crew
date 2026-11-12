// Campeones del grupo: dueños, pool y némesis
import { useState } from 'react';
import { useApp } from '../ctx';
import { Avatar, ChampIcon } from '../components/ui';
import type { Player } from '../lib/model';
import type { ChampStat } from '../types';
import { adjWr, fmt, pct } from '../lib/util';

const NEM_N = 5;
interface Vs { champ: string; n: number; w: number; adj: number }
const vsTxt = (x: { w: number; n: number }) => `${x.w}V ${x.n - x.w}D · ${fmt(pct(x.w, x.n), 0)} %`;

function NemCol({ cls, title, list }: { cls: string; title: string; list: Vs[] }) {
  return (
    <div className={`nem-col ${cls}`}>
      <small className="nem-h">{title}</small>
      {list.map((x, i) => (
        <div key={x.champ} className="nem-c" title={cls === 'bad' && i === 0 ? 'Buen candidato a ban' : `${x.champ}: ${vsTxt(x)}`}>
          <ChampIcon champ={x.champ} size={i === 0 ? 34 : 26} />
          <div><b>{x.champ}</b><span>{vsTxt(x)}</span></div>
        </div>
      ))}
    </div>
  );
}

export function Champions() {
  const { model } = useApp();
  const [showAll, setShowAll] = useState(false);
  const rows = model.filter((p) => p.s?.champs?.length);
  if (!rows.length) return <p className="empty">Sin datos todavía.</p>;

  // Dueño de cada campeón: el que mejor lo juega (winrate ajustado, mín. 5 partidas)
  interface Entry { key: string; total: number; players: { p: Player; c: ChampStat }[] }
  const byChamp = new Map<string, Entry>();
  for (const p of rows) {
    for (const c of p.s!.champs!) {
      const e = byChamp.get(c.key) ?? { key: c.key, total: 0, players: [] };
      e.total += c.games;
      e.players.push({ p, c });
      byChamp.set(c.key, e);
    }
  }
  const owned = [...byChamp.values()].map((e) => {
    const cands = e.players.filter((x) => x.c.games >= 5);
    const owner = cands.length ? cands.reduce((m, x) => (adjWr(x.c.wins, x.c.games, 3) > adjWr(m.c.wins, m.c.games, 3) ? x : m)) : null;
    return { ...e, owner };
  }).filter((e) => e.owner).sort((a, b) => b.total - a.total);
  const shown = showAll ? owned : owned.slice(0, 24);

  // Pool de cada uno
  const pool = rows.map((p) => {
    const cs = p.s!.champs!;
    const total = cs.reduce((s, c) => s + c.games, 0);
    const top3 = cs.slice(0, 3).reduce((s, c) => s + c.games, 0);
    return { p, n: cs.length, used: cs.filter((c) => c.games >= 5).length, top3: total ? (top3 / total) * 100 : 0, top: cs[0], total };
  }).sort((a, b) => b.top3 - a.top3);

  // Némesis: rival directo de línea contra el que peor (y mejor) le va
  const vsList = (p: Player): Vs[] => Object.entries(p.s!.vs ?? {}).map(([champ, [n, w]]) => ({ champ, n, w, adj: adjWr(w, n, 3) }));
  const nem = rows.map((p) => {
    const l = vsList(p).filter((x) => x.n >= 4).sort((a, b) => a.adj - b.adj || b.n - a.n);
    const worst = l.slice(0, NEM_N);
    const best = l.slice(worst.length).reverse().slice(0, NEM_N);
    return { p, worst, best };
  });
  const groupVs = new Map<string, { champ: string; n: number; w: number }>();
  for (const p of rows) {
    for (const x of vsList(p)) {
      const e = groupVs.get(x.champ) ?? { champ: x.champ, n: 0, w: 0 };
      e.n += x.n; e.w += x.w;
      groupVs.set(x.champ, e);
    }
  }
  const gWorst = [...groupVs.values()].filter((e) => e.n >= 10).sort((a, b) => adjWr(a.w, a.n, 5) - adjWr(b.w, b.n, 5)).slice(0, 8);

  return (
    <>
      <h3 className="aw-sub">El dueño de cada campeón</h3>
      <p className="muted small">Quién lo juega mejor del grupo (winrate ajustado, mínimo 5 partidas) · pasa el ratón para ver al resto</p>
      <div className="owns">{shown.map((e) => {
        const o = e.owner!;
        const others = e.players.filter((x) => x !== o).sort((a, b) => b.c.games - a.c.games)
          .map((x) => `${x.p.name}: ${fmt(x.c.winrate, 0)} % en ${x.c.games}`).join('\n');
        return (
          <div key={e.key} className="own" title={`${e.key} · ${e.total} partidas en el grupo\n${o.p.name}: ${fmt(o.c.winrate, 0)} % en ${o.c.games}${others ? `\n${others}` : ''}`}>
            <div className="own-ic"><ChampIcon champ={e.key} size={52} /><span className="own-av"><Avatar p={o.p} size={22} /></span></div>
            <b>{e.key}</b>
            <small><span className={o.c.winrate >= 50 ? 'pos' : 'neg'}>{`${fmt(o.c.winrate, 0)} %`}</span>{` · ${o.c.games}p · ${o.p.name}`}</small>
          </div>
        );
      })}</div>
      {owned.length > 24 ? <div className="center"><button className="ghost-btn" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Ver menos ↑' : `Ver los ${owned.length} →`}</button></div> : null}
      <h3 className="aw-sub">El pool de cada uno</h3>
      <div className="pool">{pool.map((x) => (
        <div key={x.p.name} className="pool-row">
          <Avatar p={x.p} size={28} /><b className="pool-name">{x.p.name}</b>
          <span className="pool-n" title="Campeones distintos esta temporada (con 5 o más partidas)"><b>{x.n}</b>{` campeones · ${x.used} con 5+ partidas`}</span>
          <div className="pool-bar" title={`El ${fmt(x.top3, 0)} % de sus partidas son con sus 3 más jugados`}>
            <i style={{ width: `${x.top3}%` }} /><span>{`${fmt(x.top3, 0)} % con su top 3`}</span></div>
          {x.top ? <span className="pool-top"><ChampIcon champ={x.top.key} size={26} /><small>{`${x.top.games}p`}</small></span> : null}
        </div>
      ))}</div>
      <h3 className="aw-sub">Némesis y presas</h3>
      <p className="muted small">Contra el rival directo de línea · mínimo 4 partidas · los 5 que más te ganan y los 5 a los que más ganas</p>
      <div className="nems">{nem.map(({ p, worst, best }) => (
        <div key={p.name} className="nem">
          <div className="nem-who"><Avatar p={p} size={28} /><b>{p.name}</b></div>
          {worst.length ? (
            <div className="nem-pair">
              <NemCol cls="bad" title="Némesis · te ganan" list={worst} />
              {best.length ? <NemCol cls="good" title="Presas · les ganas" list={best} /> : null}
            </div>
          ) : <span className="muted small">Pocos datos</span>}
        </div>
      ))}</div>
      {gWorst.length ? <h3 className="aw-sub">Los que más os ganan</h3> : null}
      {gWorst.length ? (
        <div className="gnem">{gWorst.map((e) => (
          <div key={e.champ} className="gnem-c" title={`Contra ${e.champ} en vuestra línea: ${e.w}V ${e.n - e.w}D`}>
            <ChampIcon champ={e.champ} size={40} /><b>{e.champ}</b><span className={pct(e.w, e.n) < 50 ? 'neg' : 'pos'}>{`${fmt(pct(e.w, e.n), 0)} %`}</span><small className="muted">{`${e.n} partidas`}</small>
          </div>
        ))}</div>
      ) : null}
    </>
  );
}
