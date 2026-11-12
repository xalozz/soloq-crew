// Partidas: fila del historial y detalle de los 10 jugadores
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useApp } from '../ctx';
import type { Account, MatchDetail as MatchDetailT, RecentGame } from '../types';
import { ago, ariaFlag, dateTime, fmt, goldK, mmss } from '../lib/util';
import { ChampIcon, ExtLink, ItemImg, LoadoutBlock, LpBadge, RoleIcon } from './ui';

const detailCache = new Map<string, MatchDetailT | null>(); // id → datos | null (no disponible)
export const clearDetailCache = (): void => detailCache.clear();

const REGION_LOG: Record<string, string> = { EUW1: 'euw', EUN1: 'eune', NA1: 'na', KR: 'kr', BR1: 'br', LA1: 'lan', LA2: 'las', OC1: 'oce', TR1: 'tr', RU: 'ru', JP1: 'jp' };
const logUrl = (id: string) => { const [r, n] = id.split('_'); return `https://www.leagueofgraphs.com/match/${REGION_LOG[r] ?? 'euw'}/${n}`; };

async function loadDetail(id: string): Promise<MatchDetailT | null> {
  if (detailCache.has(id)) return detailCache.get(id) ?? null;
  try {
    const r = await fetch(`data/matches/${encodeURIComponent(id)}.json?t=${Math.floor(Date.now() / 6e5)}`);
    const d = r.ok ? ((await r.json()) as MatchDetailT) : null;
    detailCache.set(id, d);
    return d;
  } catch { return null; }
}

// Nombre de jugador enlazado a su perfil de OP.GG (pestaña nueva)
function OpggName({ rid, matchId }: { rid: string; matchId: string }) {
  const i = (rid || '').lastIndexOf('#');
  if (i < 1) return <b title={rid}>{rid}</b>;
  const region = REGION_LOG[(matchId || '').split('_')[0]] ?? 'euw';
  const url = `https://op.gg/lol/summoners/${region}/${encodeURIComponent(rid.slice(0, i))}-${encodeURIComponent(rid.slice(i + 1))}`;
  return <b><ExtLink url={url} label={rid} cls="md-link" title={`Ver ${rid} en OP.GG`} stop /></b>;
}

export function MatchDetail({ id, meRiotId }: { id: string; meRiotId?: string }) {
  const { data } = useApp();
  // undefined: cargando · null: no disponible
  const [d, setD] = useState<MatchDetailT | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    loadDetail(id).then((x) => { if (alive) setD(x); });
    return () => { alive = false; };
  }, [id]);
  if (d === undefined) return <div className="md"><p className="md-loading">Cargando partida…</p></div>;
  if (!d) {
    return (
      <div className="md">
        <p className="empty">Detalle no disponible: solo se guardan las últimas 20 partidas de cada uno y las de los récords.</p>
        <div className="md-foot"><ExtLink url={logUrl(id)} label="Ver en LeagueOfGraphs ↗" /></div>
      </div>
    );
  }
  const friends = new Set((data?.players ?? []).flatMap((p) => p.accounts.map((a) => a.riotId.toLowerCase())));
  const me = (meRiotId || '').toLowerCase();
  return (
    <div className="md">
      <div className="md-teams">{d.teams.map((t, ti) => (
        <div key={ti} className={`md-team ${t.teamId === 100 ? 'side-blue' : 'side-red'}`}>
          <div className="md-head">
            <b className="md-side">{t.teamId === 100 ? 'Lado azul' : 'Lado rojo'}</b>
            <span className={t.win ? 'pos' : 'neg'}>{t.win ? 'Victoria' : 'Derrota'}</span>
            <span className="muted">{`${t.kills} kills · ${goldK(t.gold, false)} oro`}</span>
            {t.bans?.length ? <span className="md-bans"><small>Bans</small>{t.bans.map((c, i) => <ChampIcon key={i} champ={c} size={18} />)}</span> : null}
          </div>
          {t.players.map((p, pi) => {
            const rid = (p.rid || '').toLowerCase();
            const kda = (p.k + p.a) / Math.max(1, p.d);
            return (
              <div key={pi} className={`md-p ${rid === me ? 'me' : friends.has(rid) ? 'friend' : ''}`}>
                <div className="md-lo"><LoadoutBlock l={p} size={32} />{p.lvl ? <span className="md-lvl">{p.lvl}</span> : null}</div>
                <div className="md-name"><OpggName rid={p.rid} matchId={id} /><span><span>{p.k}</span>{' / '}<span className="neg">{p.d}</span>{' / '}<span>{p.a}</span>
                  <small>{` · ${p.d ? fmt(kda, 1) : 'Perfect'} KDA`}</small></span></div>
                <div className="md-num"><b>{p.cs}</b><small>CS</small></div>
                <div className="md-num"><b>{goldK(p.dmg, false)}</b><small>daño</small></div>
                <div className="m-items md-items">{(p.items ?? []).map((it, i) => <ItemImg key={i} id={it} size={i === 6 ? 20 : 22} />)}</div>
              </div>
            );
          })}
        </div>
      ))}</div>
      <div className="md-foot"><span className="muted">{`${mmss(d.dur)} · ${dateTime(d.t)}`}</span>
        <ExtLink url={logUrl(id)} label="Ver en LeagueOfGraphs ↗" /></div>
    </div>
  );
}

export function MatchRow({ g, acc, open, onToggle }: { g: RecentGame; acc: Account; open: boolean; onToggle: () => void }) {
  const kda = (g.k + g.a) / Math.max(1, g.d);
  const perfect = g.d === 0;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } };
  return (
    <div className={`mwrap ${g.win ? 'win' : 'loss'} ${open ? 'open' : ''}`}>
      <div className={`match ${g.win ? 'win' : 'loss'} ${open ? 'open' : ''}`} role="button" tabIndex={0} {...ariaFlag('aria-expanded', open)}
        onClick={onToggle} onKeyDown={onKey}>
        <div className="m-res"><b>{g.win ? 'Victoria' : 'Derrota'}</b><span>{`${mmss(g.dur)} · ${ago(g.t)}`}</span></div>
        <span className="m-role"><RoleIcon role={g.role} /></span>
        <div className="m-me">{g.spells ? <LoadoutBlock l={g} size={40} /> : <ChampIcon champ={g.champ} size={40} />}</div>
        {g.opp ? <div className="m-vs"><small>vs</small><LoadoutBlock l={g.opp} size={30} /></div> : <div className="m-vs" />}
        <div className="m-kda">
          <b><span>{g.k}</span>{' / '}<span className="neg">{g.d}</span>{' / '}<span>{g.a}</span></b>
          <span>{[perfect ? 'Perfect' : `${fmt(kda, 1)} KDA`, g.kp != null ? `${g.kp}% KP` : null, `${g.cs} CS`].filter(Boolean).join(' · ')}</span>
          {g.gold ? (
            <span className="m-gold" title={`Ventaja máx. del equipo ${goldK(g.gold.maxLead)} · desventaja máx. ${goldK(g.gold.maxDef)}`}>
              {g.gold.gd15 != null ? <span className={g.gold.gd15 >= 0 ? 'pos' : 'neg'}>{`${goldK(g.gold.gd15)} oro @15`}</span> : null}
              {!g.win && g.gold.maxLead >= 3000 ? <span className="throw-tag">{`THROW ${goldK(g.gold.maxLead)}`}</span> : null}
              {g.win && g.gold.maxDef <= -3000 ? <span className="comeback-tag">{`REMONTADA ${goldK(g.gold.maxDef)}`}</span> : null}
            </span>
          ) : null}
        </div>
        <div className="m-items">{(g.items ?? []).map((id, i) => <ItemImg key={i} id={id} size={i === 6 ? 24 : 26} />)}</div>
        <LpBadge lp={g.lp} />
        <span className="m-chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </div>
      {open ? <MatchDetail id={g.id} meRiotId={acc?.riotId} /> : null}
    </div>
  );
}
