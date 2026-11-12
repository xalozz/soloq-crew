// La semana: texto para WhatsApp e imagen para compartir
import type { Week, WeekPlayer } from '../types';
import { fmt, pct, plural, rangeLabel, signed, SITE_URL } from './util';

export const weekEnd = (w: Week): number => w.to ?? Math.min(Date.now(), w.from + 7 * 864e5);
export const weekSorted = (w: Week): WeekPlayer[] => [...w.players].sort((a, b) => (b.games ? 1 : 0) - (a.games ? 1 : 0) || (b.lp ?? -1e9) - (a.lp ?? -1e9) || b.games - a.games);

export function weekText(w: Week): string {
  const pl = new Map(w.players.map((x) => [x.name, x]));
  const act = weekSorted(w).filter((x) => x.games);
  const idle = w.players.filter((x) => !x.games).map((x) => x.name);
  const L = [
    `📊 *SoloQ Crew · semana ${rangeLabel(w.from, weekEnd(w))}*${w.to ? '' : ' (en curso)'}`,
    `${w.totals.games} partidas · ${Math.round(pct(w.totals.wins, w.totals.games))} % de victorias · ${fmt(w.totals.hours)} h`,
    '',
    ...act.map((x, i) => `${i + 1}. *${x.name}* ${x.lp == null ? '¿?' : signed(x.lp)} LP (${x.wins}V ${x.losses}D)`),
  ];
  if (idle.length) L.push(`_No jugaron: ${idle.join(', ')}_`);
  L.push('');
  if (w.mvp) L.push(`🏆 MVP: ${w.mvp}`);
  if (w.worst) L.push(`📉 Peor semana: ${w.worst} (${signed(pl.get(w.worst)?.lp)} LP)`);
  if (w.grinder) L.push(`🎮 Más viciado: ${w.grinder} (${pl.get(w.grinder)?.games} partidas)`);
  if (w.hot) L.push(`🔥 Mejor racha: ${w.hot.name} (${w.hot.n} seguidas)`);
  if (w.cold) L.push(`💀 Peor racha: ${w.cold.name} (${w.cold.n} seguidas)`);
  if (w.duo) L.push(`🤝 Dúo de la semana: ${w.duo.a} & ${w.duo.b} (${w.duo.wins}V ${w.duo.games - w.duo.wins}D)`);
  if (w.gotw) L.push(`⭐ Partida de la semana: ${w.gotw.name}, ${w.gotw.champ} ${w.gotw.k}/${w.gotw.d}/${w.gotw.a}`);
  for (const g of w.pentas ?? []) L.push(`🖐️ Pentakill de ${g.name} con ${g.champ}`);
  if (w.coward) L.push(`🏳️ El más cobarde: ${w.coward.name} (rendición en ${w.coward.n} de sus ${w.coward.of} derrotas)`);
  if (w.qKing) L.push(`❓ El rey del "?": ${w.qKing.name} (${fmt(w.qKing.avg, 1)} por partida)`);
  L.push('', `${SITE_URL}#semana`);
  return L.join('\n');
}

function roundRect(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, r: number) {
  x.beginPath();
  x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath();
}

// Imagen para compartir (1080 px de ancho, sin imágenes externas)
export async function weekImage(w: Week): Promise<Blob | null> {
  const rows = weekSorted(w);
  const hl: [string, string, string][] = [];
  const pl = new Map(w.players.map((x) => [x.name, x]));
  if (w.mvp) hl.push(['🏆 MVP', w.mvp, `${signed(pl.get(w.mvp)?.lp)} LP`]);
  if (w.grinder) hl.push(['🎮 Más viciado', w.grinder, `${pl.get(w.grinder)?.games} partidas`]);
  if (w.hot) hl.push(['🔥 Mejor racha', w.hot.name, `${w.hot.n} victorias`]);
  if (w.cold) hl.push(['💀 Peor racha', w.cold.name, `${w.cold.n} derrotas`]);
  if (w.duo) hl.push(['🤝 Dúo', `${w.duo.a} & ${w.duo.b}`, `${w.duo.wins}V ${w.duo.games - w.duo.wins}D`]);
  if (w.gotw) hl.push(['⭐ Partida', w.gotw.name, `${w.gotw.champ} ${w.gotw.k}/${w.gotw.d}/${w.gotw.a}`]);
  if (w.coward) hl.push(['🏳️ Más cobarde', w.coward.name, `${plural(w.coward.n, 'rendición', 'rendiciones')}`]);
  if (w.qKing) hl.push(['❓ Rey del "?"', w.qKing.name, `${fmt(w.qKing.avg, 1)} por partida`]);
  const W = 1080, RH = 78, H = 330 + rows.length * (RH + 10) + Math.ceil(hl.length / 2) * 130 + 120;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  try { await document.fonts?.ready; } catch { /* fuentes del sistema */ }
  const F = (wt: number, size: number, it = '') => `${it} ${wt} ${size}px Archivo, system-ui, sans-serif`;
  x.fillStyle = '#0a0a0b'; x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, -120, 40, W / 2, -120, 760);
  glow.addColorStop(0, 'rgba(214,255,61,.20)'); glow.addColorStop(1, 'rgba(214,255,61,0)');
  x.fillStyle = glow; x.fillRect(0, 0, W, H);
  x.fillStyle = '#d6ff3d'; roundRect(x, 60, 56, 70, 70, 18); x.fill();
  x.fillStyle = '#0a0a0b'; x.font = F(900, 32, 'italic'); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('SQ', 95, 92);
  x.textAlign = 'left'; x.fillStyle = '#f4f4f5'; x.font = F(900, 30); x.fillText('SOLOQ', 150, 92);
  x.fillStyle = '#d6ff3d'; x.fillText('CREW', 150 + x.measureText('SOLOQ ').width, 92);
  x.fillStyle = '#f4f4f5'; x.font = F(900, 86, 'italic'); x.textBaseline = 'alphabetic'; x.fillText('LA SEMANA', 56, 228);
  x.fillStyle = '#a9a9b2'; x.font = F(600, 30);
  x.fillText(`${rangeLabel(w.from, weekEnd(w))}${w.to ? '' : ' (en curso)'} · ${w.totals.games} partidas · ${Math.round(pct(w.totals.wins, w.totals.games))} % victorias`, 60, 282);
  let y = 320;
  rows.forEach((r, i) => {
    x.fillStyle = i === 0 && r.games ? 'rgba(214,255,61,.10)' : '#151517'; roundRect(x, 56, y, W - 112, RH, 16); x.fill();
    x.fillStyle = r.games ? '#d6ff3d' : '#55555d'; x.font = F(900, 34, 'italic'); x.textBaseline = 'middle';
    x.fillText(r.games ? String(i + 1) : '–', 84, y + RH / 2);
    x.fillStyle = r.games ? '#f4f4f5' : '#6a6a73'; x.font = F(800, 34); x.fillText(r.name, 140, y + RH / 2);
    x.textAlign = 'right';
    if (r.games) {
      x.fillStyle = r.lp != null && r.lp > 0 ? '#33d69a' : r.lp != null && r.lp < 0 ? '#f2657e' : '#cfcfd6'; x.font = F(900, 38);
      x.fillText(r.lp == null ? '¿?' : `${signed(r.lp)} LP`, W - 84, y + RH / 2 - 2);
      x.fillStyle = '#8e8e97'; x.font = F(600, 24); x.fillText(`${r.wins}V ${r.losses}D`, W - 300, y + RH / 2);
    } else { x.fillStyle = '#6a6a73'; x.font = F(600, 26); x.fillText('no jugó', W - 84, y + RH / 2); }
    x.textAlign = 'left';
    y += RH + 10;
  });
  y += 20;
  hl.forEach(([label, who, val], i) => {
    const col = i % 2, X = 56 + col * ((W - 112) / 2 + 8), Y = y + Math.floor(i / 2) * 130;
    x.fillStyle = '#151517'; roundRect(x, X, Y, (W - 112) / 2 - 8, 118, 16); x.fill();
    x.textBaseline = 'alphabetic';
    x.fillStyle = '#d6ff3d'; x.font = F(800, 24); x.fillText(label.toUpperCase(), X + 24, Y + 38);
    x.fillStyle = '#f4f4f5'; x.font = F(900, 30); x.fillText(who.length > 24 ? `${who.slice(0, 23)}…` : who, X + 24, Y + 76);
    x.fillStyle = '#a9a9b2'; x.font = F(600, 24); x.fillText(val, X + 24, Y + 106);
  });
  x.fillStyle = '#6a6a73'; x.font = F(600, 24); x.textAlign = 'center';
  x.fillText(SITE_URL.replace('https://', ''), W / 2, H - 40);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

export async function shareWeek(w: Week, setLabel: (l: string | null) => void): Promise<void> {
  setLabel('Generando…');
  try {
    const blob = await weekImage(w);
    if (!blob) return;
    const file = new File([blob], `soloq-crew-${w.key}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'SoloQ Crew · la semana' }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } finally { setLabel(null); }
}
