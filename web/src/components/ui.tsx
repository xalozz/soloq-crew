// Piezas visuales comunes (iconos, barras, chips…). Mismo HTML que la versión en JS plano.
import { useState, type MouseEvent, type ReactNode } from 'react';
import { useApp, useTick } from '../ctx';
import type { Player } from '../lib/model';
import { liveMinTxt } from '../lib/model';
import type { Loadout as LoadoutT, Rank, Stats } from '../types';
import { CDRAGON, fmt, px, rankName, ROLE_ES, ROLE_ICON, tierKey } from '../lib/util';

const box = (size: number) => ({ width: px(size), height: px(size) });

/** Imagen con alternativa si no carga (la alternativa se recuerda para esa dirección) */
function useBroken(src: string | null): [boolean, () => void] {
  const [bad, setBad] = useState<string | null>(null);
  return [src != null && bad === src, () => setBad(src)];
}

// Enlace externo que siempre abre en pestaña nueva (algunos navegadores integrados ignoran target=_blank)
export function ExtLink({ url, label, cls, title, stop }: { url: string; label: ReactNode; cls?: string; title?: string; stop?: boolean }) {
  const onClick = (e: MouseEvent) => {
    if (stop) e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault();
    window.open(url, '_blank', 'noopener');
  };
  return <a href={url} target="_blank" rel="noopener noreferrer" className={cls} title={title} onClick={onClick}>{label}</a>;
}

export function Avatar({ p, size = 40, cls = '' }: { p: Pick<Player, 'name' | 'main'>; size?: number; cls?: string }) {
  const { data } = useApp();
  const icon = p.main?.profileIconId;
  const src = icon && data.ddragonVersion ? `https://ddragon.leagueoflegends.com/cdn/${data.ddragonVersion}/img/profileicon/${icon}.png` : null;
  const [bad, broke] = useBroken(src);
  if (!src || bad) return <span className={`avatar ph ${cls}`} style={box(size)}>{(p.name || '?').slice(0, 1).toUpperCase()}</span>;
  return <img className={`avatar ${cls}`} width={size} height={size} alt="" loading="lazy" src={src} onError={broke} />;
}

export function ChampIcon({ champ, size = 26 }: { champ: string | null | undefined; size?: number }) {
  const { data } = useApp();
  const src = champ && data.ddragonVersion ? `https://ddragon.leagueoflegends.com/cdn/${data.ddragonVersion}/img/champion/${encodeURIComponent(champ)}.png` : null;
  const [bad, broke] = useBroken(src);
  if (!src || bad) return <span className="champ ph" style={box(size)} title={champ || ''} />;
  return <img className="champ" width={size} height={size} loading="lazy" alt={champ!} title={champ!} src={src} onError={broke} />;
}

export function Crest({ rank, size = 30 }: { rank: Rank | null | undefined; size?: number }) {
  const key = tierKey(rank);
  const src = key === 'unranked' ? null : `${CDRAGON}/rcp-fe-lol-shared-components/global/default/${key}.png`;
  const [bad, broke] = useBroken(src);
  if (!src || bad) return <span className="crest ph" style={box(size)} />;
  return <img className="crest" width={size} height={size} alt="" loading="lazy" src={src} onError={broke} />;
}

export function RoleIcon({ role }: { role: string | null | undefined }) {
  if (!role || !ROLE_ICON[role]) return <span className="muted">–</span>;
  return (
    <img className="role-ico" width={22} height={22} alt={ROLE_ES[role]} title={ROLE_ES[role]} loading="lazy"
      src={`${CDRAGON}/rcp-fe-lol-static-assets/global/default/svg/position-${ROLE_ICON[role]}.svg`} />
  );
}

export function Medal({ pos }: { pos: number }) {
  if (pos === 1) {
    return (
      <svg className="medal gold" viewBox="0 0 24 24" aria-label="Primero">
        <path d="M3 8l4.5 3.5L12 5l4.5 6.5L21 8l-2 10H5z" />
      </svg>
    );
  }
  return <span className={`medal-num m${pos}`}>{pos}</span>;
}

export function WinBar({ w, l }: { w: number; l: number }) {
  const n = w + l;
  if (!n) return <span className="muted">Sin partidas</span>;
  const wr = (w / n) * 100;
  return (
    <div className="wbar" title={`${w} victorias · ${l} derrotas`}>
      <div className="wbar-top">
        <b className={wr >= 50 ? 'pos' : 'neg'}>{`${fmt(wr)}%`}</b>
        <span className="w">{`${w}V`}</span><span className="l">{`${l}D`}</span>
      </div>
      <div className="wbar-track">
        <i className="seg-w" style={{ width: `${wr}%` }} />
        <i className="seg-l" style={{ width: `${100 - wr}%` }} />
      </div>
    </div>
  );
}

// Línea acumulada de victorias(+1)/derrotas(-1) de las últimas 20 partidas.
export function Sparkline({ trend, w = 96, hgt = 28 }: { trend: number[] | undefined; w?: number; hgt?: number }) {
  if (!trend?.length) return <span className="muted">–</span>;
  let acc = 0;
  const pts = [0, ...trend.map((x) => (acc += x ? 1 : -1))];
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = Math.max(1, max - min);
  const step = w / (pts.length - 1);
  const coords = pts.map((v, i) => `${(i * step).toFixed(1)},${(2 + (hgt - 4) * (1 - (v - min) / span)).toFixed(1)}`).join(' ');
  const wins = trend.filter(Boolean).length;
  const up = acc >= 0;
  const label = `Últimas ${trend.length}: ${wins}V ${trend.length - wins}D`;
  return (
    <svg className={`spark ${up ? 'up' : 'down'}`} viewBox={`0 0 ${w} ${hgt}`} width={w} height={hgt} role="img" aria-label={label}>
      <title>{label}</title>
      <polyline points={coords} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function StreakChip({ s }: { s: Stats | null | undefined }) {
  const c = s?.streak?.current;
  if (!c?.count) return <span className="muted">–</span>;
  const win = c.type === 'W';
  return <span className={`chip ${win ? 'chip-w' : 'chip-l'}`} title={win ? 'Victorias seguidas' : 'Derrotas seguidas'}>{`${c.count}${win ? 'V' : 'D'}`}</span>;
}

export function TierTag({ rank }: { rank: Rank | null | undefined }) {
  return <span className={`tier-tag t-${tierKey(rank)}`}>{rankName(rank)}</span>;
}

export function DdImg({ url, size, cls, title }: { url: string | null; size: number; cls?: string; title?: string }) {
  const { data } = useApp();
  const src = url && data.ddragonVersion ? url : null;
  const [bad, broke] = useBroken(src);
  if (!src || bad) return <span className={`ico ph ${cls || ''}`} style={box(size)} />;
  return <img className={`ico ${cls || ''}`} width={size} height={size} loading="lazy" alt={title || ''} title={title || ''} src={src} onError={broke} />;
}
const dd = (v: string | null | undefined) => `https://ddragon.leagueoflegends.com/cdn/${v}`;

export function SpellImg({ k, size = 18 }: { k: string | undefined; size?: number }) {
  const { data } = useApp();
  return k ? <DdImg url={`${dd(data.ddragonVersion)}/img/spell/${k}.png`} size={size} cls="spell" title={k.replace('Summoner', '')} /> : <DdImg url={null} size={size} cls="spell" />;
}
export function RuneImg({ path, size = 18, cls = 'rune' }: { path: string | null | undefined; size?: number; cls?: string }) {
  return path ? <DdImg url={`https://ddragon.leagueoflegends.com/cdn/img/${path}`} size={size} cls={cls} /> : <DdImg url={null} size={size} cls={cls} />;
}
export function ItemImg({ id, size = 26 }: { id: number; size?: number }) {
  const { data } = useApp();
  return id ? <DdImg url={`${dd(data.ddragonVersion)}/img/item/${id}.png`} size={size} cls="item" /> : <span className="ico item empty" style={box(size)} />;
}

export function LoadoutBlock({ l, size }: { l: LoadoutT | null | undefined; size: number }) {
  if (!l) return null;
  return (
    <div className="loadout">
      <span className="lo-champ"><ChampIcon champ={l.champ} size={size} /></span>
      <span className="lo-col"><SpellImg k={l.spells?.[0]} size={Math.round(size / 2.2)} /><SpellImg k={l.spells?.[1]} size={Math.round(size / 2.2)} /></span>
      <span className="lo-col"><RuneImg path={l.runes?.[0]} size={Math.round(size / 2.2)} cls="rune key" /><RuneImg path={l.runes?.[1]} size={Math.round(size / 3)} cls="rune sec" /></span>
    </div>
  );
}

export function LpBadge({ lp }: { lp: { d: number; n: number } | null | undefined }) {
  if (!lp) return <span className="m-lp muted" title="Partida anterior al registro de LP">— LP</span>;
  const txt = `${lp.d > 0 ? '+' : ''}${lp.d} LP`;
  if (lp.n > 1) return <span className={`m-lp ${lp.d >= 0 ? 'pos' : 'neg'}`} title={`Cambio conjunto de ${lp.n} partidas jugadas seguidas entre dos actualizaciones`}>{txt}<small>{`${lp.n} part.`}</small></span>;
  return <span className={`m-lp ${lp.d >= 0 ? 'pos' : 'neg'}`}>{txt}</span>;
}

/** Minutos de una partida en curso (avanzan solos cada 30 s) */
export function LiveMin({ start }: { start: number | null | undefined }) {
  useTick(30_000);
  return <span className="live-min" data-start={start || ''}>{liveMinTxt(start)}</span>;
}
