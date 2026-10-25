#!/usr/bin/env node
// Actualiza data/data.json consultando la API de Riot.
//   RIOT_API_KEY=RGAPI-xxxx node scripts/update.mjs           pasada completa
//   RIOT_API_KEY=RGAPI-xxxx node scripts/update.mjs --quick   pasada rápida (solo quien ha jugado)
//   node scripts/update.mjs --demo                             datos inventados, sin clave
//
// Variables opcionales:
//   MATCH_COUNT       partidas recientes a pedir por cuenta (defecto 100, máx. 100)
//   MIN_INTERVAL_MS   espaciado entre peticiones (defecto 1250 ms)
//   BACKFILL_BUDGET   partidas antiguas a descargar por pasada completa
//   DISCORD_WEBHOOK   si está, se avisa en Discord de los hitos y del resumen semanal
//   RIOT_API_BASE     solo para pruebas con una API simulada

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Riot, RiotError, compactMatch, matchDetail, profileLinks, loadDataDragon, conductOf, MATCH_RECORD_VERSION } from './riot.mjs';
import { computeAccountStats, pickBestAccount, rankScore } from './stats.mjs';
import { computeDuos } from './duos.mjs';
import { detectEvents, eventEmbed, welcomeEmbed } from './events.mjs';
import { sendDiscord } from './discord.mjs';
import { computeWeek, weekEmbed, compactWeek } from './weekly.mjs';
import { computeChallenges, challengeStatus, challengeEvent, challengeEmbed } from './challenges.mjs';
import { updateFlexHistory, readFlexHistory, flexGroupStats, QUEUE_CLASH } from './flex.mjs';
import { weekStart, weekKey, madridParts } from './time.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'config', 'players.json');
const CHALLENGES = path.join(ROOT, 'config', 'challenges.json');
const DATA_DIR = path.join(ROOT, 'data');
const OUT = path.join(DATA_DIR, 'data.json');
const PUUIDS = path.join(DATA_DIR, 'puuids.json');
const HIST_DIR = path.join(DATA_DIR, 'history');
const LP_HIST = path.join(DATA_DIR, 'lp-history.json');
const MATCH_DIR = path.join(DATA_DIR, 'matches');           // detalle de partidas para el historial desplegable
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');     // registro de hitos
const WEEKS_FILE = path.join(DATA_DIR, 'weeks.json');       // archivo de semanas cerradas
const NOTIFY_STATE = path.join(DATA_DIR, 'notify-state.json'); // qué se ha enviado ya a Discord
const DETAIL_RECENT = 20;                                  // partidas recientes con detalle
const matchFile = (id) => path.join(MATCH_DIR, `${id}.json`);
// Ficheros locales que no se publican en la web (ver .gitignore)
const QUICK_STATE = path.join(ROOT, '.quick-state.json');  // cuentas "pendientes" tras un cambio de rango
const STATUS_FILE = path.join(ROOT, '.status.json');       // resultado de la pasada: viaja en el latido
const CHAMP_IDS = path.join(ROOT, '.champ-ids.json');      // id de campeón → nombre (para la partida en directo)
const DIRTY_MS = 12 * 60e3; // tras detectar una partida, seguir actualizando esa cuenta 12 min (Riot tarda en publicarla)
const LP_HIST_CAP = 3000;
const LP_HIST_PUBLISHED = 600;

const QUEUE_SOLO = 420;
const HISTORY_CAP = 3000;
const MATCH_COUNT = Math.min(100, Number(process.env.MATCH_COUNT || 100));
const RECENT_PUBLISHED = 20;
const SEQ_PUBLISHED = 300; // partidas para la curva de elo y el ranking por semanas/meses
const EVENTS_PUBLISHED = 40;
const EVENTS_CAP = 300;
const PENDING_MAX_AGE = 3 * 3600e3;  // avisos que no se pudieron enviar: se reintentan durante 3 h
const WEEKLY_FROM_MIN = 9 * 60 + 45; // el resumen se cierra y se envía el lunes a partir de las 9:45

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
};
const writeJson = (file, obj) => writeFile(file, JSON.stringify(obj, null, 2) + '\n');
const isKeyError = (err) => err instanceof RiotError && (err.status === 401 || err.status === 403);
const keyOf = (acc) => acc.riotId.toLowerCase();
const accKey = (a) => a?.key ?? a?.riotId?.toLowerCase();

function splitRiotId(riotId) {
  const i = riotId.lastIndexOf('#');
  if (i < 1 || i === riotId.length - 1) throw new Error(`Riot ID inválido: "${riotId}" (formato Nombre#TAG)`);
  return [riotId.slice(0, i).trim(), riotId.slice(i + 1).trim()];
}
const hashOf = (puuid) => createHash('sha1').update(puuid).digest('hex').slice(0, 12);
const histFile = (puuid) => path.join(HIST_DIR, `${hashOf(puuid)}.json`);
const flexFile = (puuid) => path.join(HIST_DIR, `${hashOf(puuid)}-flex.json`);

// Estado de esta pasada (lo lee la web a través del latido)
const status = { v: 1, at: 0, ok: false, full: false, err: null, msg: null, live: null, liveErr: null, accErr: [], calls: 0 };

async function ddragonVersion() {
  try {
    const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json', { signal: AbortSignal.timeout(20000) });
    return (await res.json())[0];
  } catch {
    return null;
  }
}

const rankOf = (e) => (e ? {
  tier: e.tier, division: e.rank, lp: e.leaguePoints, wins: e.wins, losses: e.losses,
  winrate: e.wins + e.losses ? Math.round((e.wins / (e.wins + e.losses)) * 1000) / 10 : 0,
  hotStreak: !!e.hotStreak,
} : null);
const sameRank = (r, e) => (!r && !e) || (r && e && r.tier === e.tier && r.division === e.rank && r.lp === e.leaguePoints && r.wins === e.wins && r.losses === e.losses);

async function updateAccount(riot, acc, region, cache, dd, budget, opts = {}) {
  const [cfgName, cfgTag] = splitRiotId(acc.riotId);
  const cacheKey = keyOf(acc);

  let puuid = cache[cacheKey]?.puuid;
  if (!puuid) {
    const a = await riot.accountByRiotId(region, cfgName, cfgTag);
    puuid = a.puuid;
    cache[cacheKey] = { puuid };
  }

  // Nombre actual: si alguien se cambia el Riot ID, la web lo sigue (se busca por su identificador interno)
  let gameName = opts.prev?.gameName ?? cfgName, tagLine = opts.prev?.tagLine ?? cfgTag;
  if (opts.full) {
    try {
      const a = await riot.accountByPuuid(region, puuid);
      if (a?.gameName && a?.tagLine) { gameName = a.gameName; tagLine = a.tagLine; }
    } catch (err) {
      if (isKeyError(err)) throw err;
      console.warn(`  ! nombre de ${acc.riotId}: ${err.message}`);
    }
  }

  const summoner = await riot.summonerByPuuid(region, puuid);
  const leagueAt = Date.now();
  const entries = await riot.leagueEntries(region, puuid);
  const solo = entries.find((e) => e.queueType === 'RANKED_SOLO_5x5');
  const flexEntry = entries.find((e) => e.queueType === 'RANKED_FLEX_SR');

  // Historial incremental (games = partidas válidas, skipped = remakes ya vistos)
  const hf = histFile(puuid);
  const stored = await readJson(hf, []);
  const history = Array.isArray(stored) ? stored : stored.games ?? [];
  const hadHistory = history.length > 0;
  const skipped = new Set(Array.isArray(stored) ? [] : stored.skipped ?? []);
  let seasonComplete = !Array.isArray(stored) && stored.seasonComplete === true;
  // Si hay partidas guardadas con un formato antiguo, volver a recorrer la temporada para actualizarlas
  if (history.some((g) => (g.v ?? 0) < MATCH_RECORD_VERSION)) seasonComplete = false;
  const seasonGames = solo ? solo.wins + solo.losses : 0;
  // Partidas nuevas o guardadas con un formato antiguo (les faltan objetos, runas, rival…)
  const byId = new Map(history.map((g) => [g.id, g]));
  const needs = (id) => !skipped.has(id) && (byId.get(id)?.v ?? 0) < MATCH_RECORD_VERSION;
  const ids = await riot.matchIds(region, puuid, { queue: QUEUE_SOLO, count: MATCH_COUNT });
  const recent = ids.filter(needs);
  const newIds = new Set(recent.filter((id) => !byId.has(id)));

  // Relleno de la temporada completa (poco a poco, con un presupuesto por ejecución).
  // Riot cuenta V+D de la temporada; bajamos IDs hasta cubrir ese número (+ margen por remakes).
  let older = [];
  if (!seasonComplete && seasonGames > ids.length && budget.left > 0) {
    const all = [...ids];
    const want = seasonGames + 20;
    for (let start = ids.length; start < want; start += 100) {
      const page = await riot.matchIds(region, puuid, { queue: QUEUE_SOLO, start, count: Math.min(100, want - start) });
      all.push(...page);
      if (page.length < Math.min(100, want - start)) break;
    }
    older = all.slice(ids.length).filter(needs);
    if (!older.length) seasonComplete = true;
  } else if (seasonGames <= ids.length) seasonComplete = true;
  const olderNow = older.slice(0, Math.max(0, budget.left));
  budget.left -= olderNow.length;
  if (older.length && older.length === olderNow.length) seasonComplete = true;
  console.log(`  ${acc.riotId}: ${recent.length} recientes, ${olderNow.length}/${older.length} de temporada por descargar`);

  for (const id of [...recent, ...olderNow]) {
    const isRecent = !olderNow.includes(id);
    try {
      const match = await riot.match(region, id);
      let timeline = null;
      const prev = byId.get(id);
      // Si ya teníamos el oro de esta partida (formato anterior), no hace falta volver a pedir el timeline
      if (isRecent && !prev?.gold) {
        try { timeline = await riot.timeline(region, id); } catch (err) {
          if (isKeyError(err)) throw err;
          console.warn(`  ! timeline ${id}: ${err.message}`);
        }
      }
      const rec = compactMatch(match, puuid, dd, timeline);
      if (rec && !timeline && prev?.gold) rec.gold = prev.gold;
      if (isRecent && rec) await writeJson(matchFile(id), matchDetail(match, dd));
      if (rec) {
        const i = history.findIndex((g) => g.id === id);
        if (i >= 0) history[i] = rec; else history.push(rec);
      } else skipped.add(id);
    } catch (err) {
      if (isKeyError(err)) throw err;
      console.warn(`  ! partida ${id}: ${err.message}`);
    }
  }
  history.sort((a, b) => b.t - a.t);
  history.length = Math.min(history.length, HISTORY_CAP);

  // Pings y rendiciones de las partidas guardadas antes de registrarlos: se completan poco a poco
  // (de la más reciente a la más antigua) con su propio presupuesto, sin volver a bajar el resto de datos
  const lacking = (seasonGames ? history.slice(0, seasonGames) : history).filter((g) => g.pg === undefined);
  // Reparto a partes iguales entre cuentas para que todos tengan datos cuanto antes
  for (const g of lacking.slice(0, Math.max(0, Math.min(budget.conduct ?? 0, budget.conductPer ?? Infinity)))) {
    budget.conduct--;
    try {
      const m = await riot.match(region, g.id);
      const me = m.info.participants.find((p) => p.puuid === puuid);
      if (me) Object.assign(g, conductOf(me));
    } catch (err) {
      if (isKeyError(err)) throw err;
      console.warn(`  ! pings ${g.id}: ${err.message}`);
    }
  }
  if (lacking.length) console.log(`  pings y rendiciones: faltan ${lacking.filter((g) => g.pg === undefined).length} partidas`);
  await writeJson(hf, { games: history, skipped: [...skipped].slice(-2000), seasonComplete });

  // Flex y Clash: en cada pasada completa y cuando cambia el rango de Flex
  if (opts.full || opts.flexChanged) await updateFlexHistory(riot, region, puuid, flexFile(puuid), dd, budget);

  // Detalle de los 10 jugadores: partidas recientes + las de los récords (mejor/peor partida, throws…)
  const seasonHist = seasonGames ? history.slice(0, seasonGames) : history;
  const stats = computeAccountStats(seasonHist);
  const detailIds = new Set(history.slice(0, DETAIL_RECENT).map((g) => g.id));
  if (stats) {
    for (const g of [stats.bestGame, stats.worstGame, ...Object.values(stats.gold ?? {}).filter((x) => x && typeof x === 'object'),
      ...Object.values(stats.gameRecords ?? {})]) {
      if (g?.id) detailIds.add(g.id);
    }
  }
  for (const id of detailIds) {
    if (existsSync(matchFile(id)) || budget.details <= 0) continue;
    try {
      budget.details--;
      await writeJson(matchFile(id), matchDetail(await riot.match(region, id), dd));
    } catch (err) {
      if (isKeyError(err)) throw err;
      console.warn(`  ! detalle ${id}: ${err.message}`);
    }
  }

  return {
    key: cacheKey,
    riotId: `${gameName}#${tagLine}`,
    gameName, tagLine,
    label: acc.label ?? null,
    region,
    level: summoner.summonerLevel,
    profileIconId: summoner.profileIconId,
    rank: rankOf(solo),
    flexRank: rankOf(flexEntry),
    // Solo la temporada actual: las N partidas más recientes, con N = victorias + derrotas según Riot
    // (los remakes no se guardan ni cuentan). Evita mezclar partidas de la temporada anterior.
    stats,
    _detailIds: detailIds,
    links: profileLinks(region, gameName, tagLine),
    updatedAt: new Date().toISOString(),
    _history: history,
    _newGames: hadHistory ? history.filter((g) => newIds.has(g.id)) : [],
    _leagueAt: leagueAt,
  };
}

// Asigna a cada partida el cambio de LP comparando las fotos del rango tomadas antes y después.
// hist = [[t, score, partidasTotales], ...]. Si entre dos fotos hubo varias partidas,
// todas reciben el cambio conjunto (n > 1) porque no se puede repartir con exactitud.
function assignLp(hist, games) {
  const asc = [...games].sort((a, b) => a.t - b.t);
  const out = new Map();
  const used = new Set();
  for (let i = 1; i < hist.length; i++) {
    const [tA, sA, gA] = hist[i - 1];
    const [tB, sB, gB] = hist[i];
    if (gA == null || gB == null) continue;
    const dg = gB - gA;
    if (dg <= 0) continue; // sin partidas (dodge, decay…) o reinicio de temporada
    const cands = asc.filter((g) => !used.has(g.id) && g.t > tA - 15 * 60e3 && g.t <= tB + 60e3);
    if (cands.length < dg) continue;
    for (const g of cands.slice(-dg)) {
      used.add(g.id);
      out.set(g.id, { d: sB - sA, n: dg });
    }
  }
  return out;
}

function lpAverages(games, lpMap) {
  const exact = games.map((g) => ({ g, lp: lpMap.get(g.id) })).filter((x) => x.lp && x.lp.n === 1);
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x.lp.d, 0) / xs.length) : null);
  const w = exact.filter((x) => x.g.win), l = exact.filter((x) => !x.g.win);
  return { win: avg(w), loss: avg(l), winN: w.length, lossN: l.length };
}

// Partida en curso de cada cuenta (Spectator-V5). Si Riot no deja usar esta API, se desactiva sin más.
async function checkLive(riot, accounts, champIds) {
  const games = new Map();
  for (const a of accounts) {
    let g;
    try {
      g = await riot.activeGame(a.region, a.puuid);
    } catch (err) {
      status.liveErr = err instanceof RiotError ? err.status || 'riot' : 'red';
      if (isKeyError(err)) return null;
      continue;
    }
    if (!g) continue;
    const me = g.participants?.find((p) => p.puuid === a.puuid);
    const e = games.get(g.gameId) ?? { id: g.gameId, q: g.gameQueueConfigId ?? null, s: g.gameStartTime || null, p: [] };
    e.p.push({ n: a.name, c: champIds[me?.championId] ?? null, tm: me?.teamId ?? null });
    games.set(g.gameId, e);
  }
  return [...games.values()];
}

async function main() {
  if (process.argv.includes('--demo')) {
    const { writeDemo } = await import('./demo.mjs');
    await writeDemo(CONFIG, OUT);
    console.log(`Datos demo escritos en ${path.relative(ROOT, OUT)}`);
    return;
  }

  const config = await readJson(CONFIG, null);
  if (!config?.players?.length) throw new Error('config/players.json vacío o ilegible');
  const challengeDefs = (await readJson(CHALLENGES, { challenges: [] })).challenges ?? [];

  await mkdir(HIST_DIR, { recursive: true });
  const riot = new Riot(process.env.RIOT_API_KEY, {
    minIntervalMs: Number(process.env.MIN_INTERVAL_MS || 1250),
  });
  const cache = await readJson(PUUIDS, {});
  const previous = existsSync(OUT) ? await readJson(OUT, null) : null;
  const prevAcc = new Map();
  for (const p of previous?.players ?? []) for (const a of p.accounts) prevAcc.set(accKey(a), a);
  let champIds = await readJson(CHAMP_IDS, {});
  const regionOf = (acc) => acc.region ?? config.defaultRegion ?? 'euw1';
  const liveAccounts = [];
  for (const pl of config.players) {
    for (const acc of pl.accounts) {
      const puuid = cache[keyOf(acc)]?.puuid;
      if (puuid) liveAccounts.push({ name: pl.name, region: regionOf(acc), puuid });
    }
  }

  // Pasada rápida (--quick): solo mira el rango de cada cuenta (1 petición) y actualiza a fondo
  // únicamente las que han cambiado o siguen "pendientes". Pensada para ejecutarse cada minuto.
  const QUICK = process.argv.includes('--quick') && previous && !previous.demo;
  status.full = !QUICK;
  const quickState = QUICK ? await readJson(QUICK_STATE, { dirty: {} }) : null;
  let toUpdate = null; // null = todas
  const flexChanged = new Set();
  if (QUICK) {
    toUpdate = new Set();
    const now0 = Date.now();
    for (const pl of config.players) {
      for (const acc of pl.accounts) {
        const key = keyOf(acc);
        const prev = prevAcc.get(key);
        const puuid = cache[key]?.puuid;
        if (!prev || !puuid || prev.error) { toUpdate.add(key); continue; }
        const entries = await riot.leagueEntries(regionOf(acc), puuid);
        const solo = entries.find((e) => e.queueType === 'RANKED_SOLO_5x5');
        const flex = entries.find((e) => e.queueType === 'RANKED_FLEX_SR');
        // flexRank === undefined: datos de antes de seguir Flex; se rellena en la pasada completa
        const flexDiff = prev.flexRank !== undefined && !sameRank(prev.flexRank, flex);
        if (flexDiff) flexChanged.add(key);
        if (!sameRank(prev.rank, solo) || flexDiff) quickState.dirty[key] = now0 + DIRTY_MS;
        if ((quickState.dirty[key] ?? 0) > now0) toUpdate.add(key);
        else delete quickState.dirty[key];
      }
    }
    status.live = await checkLive(riot, liveAccounts, champIds);
    await writeJson(QUICK_STATE, quickState);
    if (!toUpdate.size) {
      console.log(`Rápida: sin partidas nuevas (${riot.calls} peticiones).`);
      status.calls = riot.calls;
      return;
    }
    console.log(`Rápida: actualizando ${[...toUpdate].join(', ')}`);
  }

  const ddVersion = (await ddragonVersion()) ?? previous?.ddragonVersion ?? null;
  const dd = await loadDataDragon(ddVersion);
  if (Object.keys(dd.champs ?? {}).length) {
    champIds = dd.champs;
    await writeJson(CHAMP_IDS, champIds);
  }
  if (!QUICK) status.live = await checkLive(riot, liveAccounts, champIds);

  // Máximo de partidas antiguas a descargar por ejecución (el resto, en las siguientes)
  const budget = QUICK ? { left: 0, details: 15, flex: 10, conduct: 0 }
    : { left: Number(process.env.BACKFILL_BUDGET || 350), details: 80, flex: 60, conduct: Number(process.env.CONDUCT_BUDGET || 120) };
  budget.conductPer = Math.ceil(budget.conduct / Math.max(1, config.players.reduce((n, p) => n + p.accounts.length, 0)));
  await mkdir(MATCH_DIR, { recursive: true });
  const players = [];
  let failures = 0;
  for (const pl of config.players) {
    console.log(`> ${pl.name}`);
    const accounts = [];
    for (const acc of pl.accounts) {
      const region = regionOf(acc);
      const key = keyOf(acc);
      if (toUpdate && !toUpdate.has(key)) {
        accounts.push({ key, ...prevAcc.get(key) }); // sin cambios: se reutiliza tal cual
        continue;
      }
      try {
        accounts.push(await updateAccount(riot, acc, region, cache, dd, budget, { prev: prevAcc.get(key), full: !QUICK, flexChanged: flexChanged.has(key) }));
      } catch (err) {
        // Clave caducada: abortar sin tocar los datos publicados.
        if (isKeyError(err)) throw err;
        failures++;
        status.accErr.push(pl.name);
        console.error(`  ✗ ${acc.riotId}: ${err.message}`);
        const old = prevAcc.get(key);
        if (old) accounts.push({ key, ...old, error: err.message });
        else {
          const [gameName, tagLine] = splitRiotId(acc.riotId);
          accounts.push({
            key, riotId: acc.riotId, gameName, tagLine, label: acc.label ?? null, region,
            rank: null, stats: null, links: profileLinks(region, gameName, tagLine), error: err.message,
          });
        }
      }
    }
    const { index, score } = pickBestAccount(accounts);
    players.push({ name: pl.name, links: pl.links ?? [], bestAccount: index, score, accounts });
  }

  players.sort((a, b) => b.score - a.score);
  await writeJson(PUUIDS, cache);
  const now = Date.now();

  // Historial de LP: un punto [timestamp, score] cada vez que cambia el elo de una cuenta.
  // La web lo usa para "LP hoy", cambios de posición y mejores/peores días.
  const lpHist = await readJson(LP_HIST, {});
  const keepDetails = new Set();
  const peakBefore = new Map();
  const newGames = new Map();
  for (const p of players) {
    for (const a of p.accounts) {
      const key = accKey(a);
      const arr = lpHist[key] ?? [];
      if (arr.length) peakBefore.set(key, Math.max(...arr.map((x) => x[1])));
      const score = rankScore(a.rank);
      const total = a.rank ? a.rank.wins + a.rank.losses : null;
      const last = arr.at(-1);
      if (score >= 0 && a._history && (last?.[1] !== score || last?.[2] !== total)) arr.push([a._leagueAt ?? now, score, total]);
      lpHist[key] = arr.slice(-LP_HIST_CAP);
      a.lpHist = lpHist[key].slice(-LP_HIST_PUBLISHED).map(([t, s]) => [t, s]);
      if (a._history) {
        const lpMap = assignLp(lpHist[key], a._history);
        a.recent = a._history.slice(0, RECENT_PUBLISHED).map((g) => ({ ...g, lp: lpMap.get(g.id) ?? null }));
        // [fin, victoria, LP exacto si se conoce] para la curva de elo y los rankings por periodo
        a.seq = a._history.slice(0, SEQ_PUBLISHED).map((g) => {
          const lp = lpMap.get(g.id);
          return [g.t, g.win ? 1 : 0, lp && lp.n === 1 ? lp.d : null];
        });
        if (a.stats) a.stats.lp = lpAverages(a._history, lpMap);
      }
      if (a._newGames?.length) newGames.set(key, a._newGames);
      delete a._history;
      delete a._newGames;
      delete a._leagueAt;
      if (a._detailIds) for (const id of a._detailIds) keepDetails.add(id);
      delete a._detailIds;
    }
  }
  await writeJson(LP_HIST, lpHist);

  // Hitos (subidas, pentas, rachas, récords…) comparando con lo publicado antes
  const events = previous && !previous.demo ? detectEvents(previous.players, players, { now, newGames, peakBefore }) : [];

  // Historial de temporada de la cuenta principal de cada uno (dúos, semanas, retos)
  const mains = [];
  for (const p of players) {
    const a = p.accounts[p.bestAccount] ?? p.accounts[0];
    const key = accKey(a);
    const puuid = key && cache[key]?.puuid;
    if (!puuid) continue;
    const stored = await readJson(histFile(puuid), { games: [] });
    let games = Array.isArray(stored) ? stored : stored.games ?? [];
    if (a.rank) games = games.slice(0, a.rank.wins + a.rank.losses);
    mains.push({ name: p.name, key, puuid, a, games, points: lpHist[key] ?? [] });
  }

  // Dúos y enfrentamientos entre miembros del grupo (cuenta principal, temporada actual)
  const { duos, rivals } = computeDuos(mains.map((m) => ({ name: m.name, games: m.games, lpMap: assignLp(m.points, m.games), lpAvg: m.a.stats?.lp })));
  for (const x of [...duos, ...rivals]) for (const g of x.recent) keepDetails.add(g.id); // si ya está descargado, no borrarlo
  // Borrar detalles que ya no hacen falta (solo si todas las cuentas se actualizaron bien)
  if (!failures && !QUICK) {
    for (const f of await readdir(MATCH_DIR)) {
      if (f.endsWith('.json') && !keepDetails.has(f.slice(0, -5))) await unlink(path.join(MATCH_DIR, f));
    }
  }

  // Flex y Clash (desde el inicio de la temporada de SoloQ)
  const seasonStart = Math.min(...mains.map((m) => m.games.at(-1)?.t ?? Infinity));
  const flexEntries = [];
  for (const m of mains) {
    const games = (await readFlexHistory(flexFile(m.puuid))).filter((g) => g.t >= seasonStart || (g.q === QUEUE_CLASH && g.t >= seasonStart - 90 * 864e5));
    flexEntries.push({ name: m.name, flexRank: m.a.flexRank ?? null, games });
  }
  const flex = flexGroupStats(flexEntries);

  // Semana en curso y archivo de semanas cerradas
  const weekEntries = mains.map((m) => ({ name: m.name, games: m.games, points: m.points }));
  const thisWeek = weekStart(now);
  const weeksArchive = await readJson(WEEKS_FILE, { weeks: [] });
  const mp = madridParts(now);
  const canClose = mp.wd > 0 || mp.hh * 60 + mp.mm >= WEEKLY_FROM_MIN;
  let archiveChanged = false;
  if (!QUICK && canClose) {
    // Semanas cerradas que faltan en el archivo (desde que se registra el LP)
    const firstPoint = Math.min(...mains.map((m) => m.points[0]?.[0] ?? Infinity));
    const have = new Set(weeksArchive.weeks.map((w) => w.key));
    for (let w = weekStart(thisWeek - 1); Number.isFinite(firstPoint) && w + 7 * 864e5 > firstPoint; w = weekStart(w - 1)) {
      if (have.has(weekKey(w))) continue;
      weeksArchive.weeks.push(compactWeek(computeWeek(weekEntries, w, weekStart(w + 8 * 864e5))));
      archiveChanged = true;
      if (weeksArchive.weeks.length > 60) break;
    }
    if (archiveChanged) {
      weeksArchive.weeks.sort((a, b) => b.from - a.from);
      await writeJson(WEEKS_FILE, weeksArchive);
    }
  }
  const currentWeek = computeWeek(weekEntries, thisWeek, null);
  const weekWins = {};
  for (const w of weeksArchive.weeks) if (w.mvp) weekWins[w.mvp] = (weekWins[w.mvp] ?? 0) + 1;

  // Retos
  const challenges = computeChallenges(challengeDefs, { players: mains.map((m) => ({ name: m.name, points: m.points, games: m.games })) }, now);

  // Registro de hitos (más reciente primero)
  const log = await readJson(EVENTS_FILE, { events: [] });
  const known = new Set(log.events.map((e) => e.id));
  const challengeEvents = [];
  const state = await readJson(NOTIFY_STATE, { v: 1 });
  state.challenges ??= {};
  if (!QUICK) {
    for (const c of challenges) {
      const def = challengeDefs.find((d) => d.id === c.id);
      const st = challengeStatus(def, now);
      const s = state.challenges[c.id] ?? {};
      if (st === 'active' && !s.started) challengeEvents.push({ e: challengeEvent(c, 'start', now), mark: () => { s.started = now; state.challenges[c.id] = s; } });
      if (st === 'finished' && !s.ended) challengeEvents.push({ e: challengeEvent(c, 'end', now), mark: () => { s.started ??= now; s.ended = now; state.challenges[c.id] = s; } });
    }
  }
  const fresh = [...events, ...challengeEvents.map((x) => x.e)].filter((e) => !known.has(e.id));
  if (fresh.length) {
    log.events = [...fresh.slice().reverse(), ...log.events].slice(0, EVENTS_CAP);
    await writeJson(EVENTS_FILE, log);
  }

  const next = {
    generatedAt: new Date().toISOString(),
    ddragonVersion: ddVersion,
    title: config.title ?? 'SoloQ Crew',
    subtitle: config.subtitle ?? '',
    players,
    duos,
    rivals,
    events: log.events.slice(0, EVENTS_PUBLISHED),
    week: { current: currentWeek, last: weeksArchive.weeks[0] ?? null },
    weekWins,
    challenges,
    flex,
  };

  // Avisos a Discord (si hay webhook): hitos, retos y el resumen de los lunes
  await notifyDiscord({ state, events: events.filter((e) => !known.has(e.id)), challengeEvents, weeksArchive, ddVersion, now, quick: QUICK });

  status.calls = riot.calls;
  // Si nada ha cambiado (salvo las marcas de tiempo) no reescribimos el fichero:
  // así el workflow no llena el historial de git con commits vacíos.
  const strip = (o) => JSON.stringify(o, (k, v) => (k === 'generatedAt' || k === 'updatedAt' ? undefined : v));
  if (previous && !previous.demo && strip(previous) === strip(next)) {
    console.log(`Sin cambios (${riot.calls} peticiones, ${failures} cuentas con error).`);
    return;
  }
  await writeFile(OUT, `${JSON.stringify(next)}\n`); // compacto: la web lo descarga cada minuto
  console.log(`Listo: ${riot.calls} peticiones, ${failures} cuentas con error, ${events.length} hitos.`);
}

async function notifyDiscord({ state, events, challengeEvents, weeksArchive, ddVersion, now, quick }) {
  const hook = !!process.env.DISCORD_WEBHOOK;
  const items = []; // { embed, ok: () => void }
  const lastWeek = weeksArchive.weeks[0];

  // Primera vez: no reenviar semanas viejas
  if (lastWeek && !state.weeklySent) state.weeklySent = lastWeek.key;

  if (hook) {
    if (!state.welcomed) items.push({ embed: welcomeEmbed(), ok: () => { state.welcomed = now; } });
    // Reintentos de avisos que fallaron hace poco
    const pending = (state.pending ?? []).filter((p) => now - p.at < PENDING_MAX_AGE);
    state.pending = [];
    for (const p of pending) items.push({ embed: p.embed, id: p.id, at: p.at, ok: () => {} });
    for (const e of events) items.push({ embed: eventEmbed(e, { ddVersion }), id: e.id, at: now, ok: () => {} });
    for (const c of challengeEvents) items.push({ embed: challengeEmbed(c.e), ok: c.mark });
    if (!quick && lastWeek && state.weeklySent !== lastWeek.key && now - lastWeek.to < 2 * 864e5) {
      items.push({ embed: weekEmbed(lastWeek), ok: () => { state.weeklySent = lastWeek.key; } });
    }
  } else {
    // Sin webhook: los retos se marcan igualmente para no anunciar tarde los que ya pasaron
    for (const c of challengeEvents) c.mark();
  }

  for (let i = 0; i < items.length; i += 8) {
    const chunk = items.slice(i, i + 8);
    const res = await sendDiscord(chunk.map((x) => x.embed));
    if (res.ok) chunk.forEach((x) => x.ok());
    else {
      console.warn(`  ! Discord: ${res.error}`);
      status.discordErr = res.error?.slice(0, 120) ?? 'error';
      // Los hitos se reintentan en las siguientes pasadas; el resumen y los retos, también (no se marcan)
      state.pending = [...(state.pending ?? []), ...chunk.filter((x) => x.id).map((x) => ({ id: x.id, at: x.at ?? now, embed: x.embed }))];
    }
  }
  if (items.length) console.log(`  Discord: ${items.length} aviso(s)`);
  await writeJson(NOTIFY_STATE, state);
}

let exitCode = 0;
main()
  .then(() => { status.ok = true; })
  .catch((err) => {
    // Clave caducada/inválida: avisamos pero no marcamos el workflow como fallido,
    // para no recibir un email de error cada minuto. La web sigue con los últimos datos y lo indica.
    if (isKeyError(err)) {
      status.err = 'key';
      console.log(`::warning::${err.message}. Actualiza el secret RIOT_API_KEY.`);
      return;
    }
    status.err = err instanceof RiotError || err?.name === 'TimeoutError' || err?.cause ? 'riot' : 'error';
    status.msg = String(err?.message ?? err).replace(/by-puuid\/[\w-]+/g, 'by-puuid/…').slice(0, 140);
    console.error(err?.stack ?? err);
    exitCode = 1;
  })
  .finally(async () => {
    status.at = Date.now();
    try { await writeFile(STATUS_FILE, JSON.stringify(status)); } catch { /* sin estado */ }
    process.exit(exitCode);
  });
