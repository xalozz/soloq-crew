// Best 5: el mejor quinteto sin repetir jugador
import { useApp } from '../ctx';
import { Avatar, ChampIcon, RoleIcon, TierTag } from '../components/ui';
import type { Player } from '../lib/model';
import type { ChampStat, Role, RoleStat } from '../types';
import { adjWr, fmt, goldK, ROLE_ES, ROLES } from '../lib/util';

export type Best5Mode = 'perf' | 'elo';
const MIN_ROLE_GAMES = 10;
const MIN_CHAMP_GAMES = 3;

function bestChamp(champs: ChampStat[] | undefined): ChampStat | null {
  const ok = (champs ?? []).filter((c) => c.games >= MIN_CHAMP_GAMES);
  if (!ok.length) return (champs ?? [])[0] ?? null;
  return ok.reduce((m, c) => (adjWr(c.wins, c.games, 2) > adjWr(m.wins, m.games, 2) ? c : m));
}

interface Slot { role: Role; p: Player | null; r: RoleStat | null; champ: ChampStat | null; groupChamp: { q: Player; c: ChampStat } | null }

function computeBest5(players: Player[], mode: Best5Mode): Slot[] {
  const cand = players.filter((p) => p.s?.byRole);
  const score = (p: Player, role: Role) => {
    const r = p.s!.byRole![role];
    const total = Object.values(p.s!.byRole!).reduce((n, x) => n + x.games, 0);
    if (!r || r.games < MIN_ROLE_GAMES || r.games < total * 0.2) return null; // solo roles que juega de verdad
    return mode === 'elo' ? Math.max(0, p.score) : adjWr(r.wins, r.games, 10);
  };
  // Búsqueda exhaustiva (7 jugadores × 5 roles = pocas combinaciones): maximiza la suma de puntuaciones
  let best: { total: number; pick: (Player | null)[] } = { total: -1, pick: [] };
  const walk = (i: number, used: Set<string>, pick: (Player | null)[], total: number) => {
    if (i === ROLES.length) {
      const filled = pick.filter(Boolean).length;
      const key = filled * 1000 + total;
      if (key > best.total) best = { total: key, pick: [...pick] };
      return;
    }
    for (const p of cand) {
      if (used.has(p.name)) continue;
      const sc = score(p, ROLES[i]);
      if (sc == null) continue;
      used.add(p.name); pick.push(p);
      walk(i + 1, used, pick, total + sc);
      used.delete(p.name); pick.pop();
    }
    pick.push(null); walk(i + 1, used, pick, total); pick.pop();
  };
  walk(0, new Set(), [], 0);
  return ROLES.map((role, i) => {
    const p = best.pick[i] ?? null;
    // Mejor campeón del grupo en el rol, jugase quien lo jugase
    const pool: { q: Player; c: ChampStat }[] = [];
    for (const q of cand) for (const c of q.s!.byRole![role]?.champs ?? []) if (c.games >= 10) pool.push({ q, c });
    const groupChamp = pool.length ? pool.reduce((m, x) => (adjWr(x.c.wins, x.c.games, 2) > adjWr(m.c.wins, m.c.games, 2) ? x : m)) : null;
    return { role, p, r: p ? p.s!.byRole![role]! : null, champ: p ? bestChamp(p.s!.byRole![role]!.champs) : null, groupChamp };
  });
}

export function Best5({ mode }: { mode: Best5Mode }) {
  const { model } = useApp();
  const slots = computeBest5(model, mode);
  return (
    <>{slots.map(({ role, p, r, champ, groupChamp }) => (
      <article key={role} className={`b5 ${p ? '' : 'empty'}`}>
        <div className="b5-role"><RoleIcon role={role} /><b>{ROLE_ES[role]}</b></div>
        {p && r ? (
          <div className="b5-body">
            <div className="b5-champ"><ChampIcon champ={champ?.key} size={76} /><span className="b5-champ-name">{champ?.key ?? ''}</span></div>
            <div className="b5-player"><Avatar p={p} size={30} /><div><b>{p.name}</b><TierTag rank={p.rank} /></div></div>
            <div className="b5-stats">
              <div><b className={r.winrate >= 50 ? 'pos' : 'neg'}>{`${fmt(r.winrate, 0)}%`}</b><span>winrate</span></div>
              <div><b>{r.games}</b><span>partidas</span></div>
              <div><b>{fmt(r.kda, 2)}</b><span>KDA</span></div>
              <div><b className={(r.gd15 ?? 0) >= 0 ? 'pos' : 'neg'}>{r.gd15 != null ? goldK(r.gd15) : '–'}</b><span>oro @15</span></div>
            </div>
            {champ ? <p className="b5-note">{`Con ${champ.key}: ${fmt(champ.winrate, 0)}% en ${champ.games} partidas`}</p> : null}
          </div>
        ) : <p className="empty">{`Nadie juega habitualmente este rol (mín. ${MIN_ROLE_GAMES} partidas y 20 % de las suyas)`}</p>}
        {groupChamp ? (
          <div className="b5-foot">
            <span className="lbl">{`Pick con mejor winrate en ${ROLE_ES[role].toLowerCase()} (de cualquiera, mín. 10)`}</span>
            <div><ChampIcon champ={groupChamp.c.key} size={22} /><b>{groupChamp.c.key}</b>
              <span className="muted">{` · ${groupChamp.q.name} · ${fmt(groupChamp.c.winrate, 0)}% (${groupChamp.c.games})`}</span></div>
          </div>
        ) : null}
      </article>
    ))}</>
  );
}
