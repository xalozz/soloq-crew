#!/usr/bin/env node
// Actualiza data/data.json consultando la API de Riot.
//   RIOT_API_KEY=RGAPI-xxxx node scripts/update.mjs
//   node scripts/update.mjs --demo        (datos inventados, sin clave)
//
// Variables opcionales:
//   MATCH_COUNT   partidas recientes a pedir por cuenta (defecto 40, máx. 100)
//   MIN_INTERVAL_MS  espaciado entre peticiones (defecto 1250 ms)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Riot, RiotError, compactMatch, profileLinks, loadDataDragon, MATCH_RECORD_VERSION } from './riot.mjs';
import { computeAccountStats, pickBestAccount, rankScore } from './stats.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'config', 'players.json');
const DATA_DIR = path.join(ROOT, 'data');
const OUT = path.join(DATA_DIR, 'data.json');
const PUUIDS = path.join(DATA_DIR, 'puuids.json');
const HIST_DIR = path.join(DATA_DIR, 'history');
const LP_HIST = path.join(DATA_DIR, 'lp-history.json');
const LP_HIST_CAP = 3000;
const LP_HIST_PUBLISHED = 600;

const QUEUE_SOLO = 420;
const HISTORY_CAP = 3000;
const MATCH_COUNT = Math.min(100, Number(process.env.MATCH_COUNT || 100));
const RECENT_PUBLISHED = 20;
const SEQ_PUBLISHED = 100; // partidas para reconstruir la curva de elo

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
};
const writeJson = (file, obj) => writeFile(file, JSON.stringify(obj, null, 2) + '\n');

function splitRiotId(riotId) {
  const i = riotId.lastIndexOf('#');
  if (i < 1 || i === riotId.length - 1) throw new Error(`Riot ID inválido: "${riotId}" (formato Nombre#TAG)`);
  return [riotId.slice(0, i).trim(), riotId.slice(i + 1).trim()];
}
const histFile = (puuid) =>
  path.join(HIST_DIR, `${createHash('sha1').update(puuid).digest('hex').slice(0, 12)}.json`);

async function ddragonVersion() {
  try {
    const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    return (await res.json())[0];
  } catch {
    return null;
  }
}

async function updateAccount(riot, acc, region, cache, dd, budget) {
  const [gameName, tagLine] = splitRiotId(acc.riotId);
  const cacheKey = acc.riotId.toLowerCase();

  let puuid = cache[cacheKey]?.puuid;
  if (!puuid) {
    const a = await riot.accountByRiotId(region, gameName, tagLine);
    puuid = a.puuid;
    cache[cacheKey] = { puuid };
  }

  const summoner = await riot.summonerByPuuid(region, puuid);
  const leagueAt = Date.now();
  const entries = await riot.leagueEntries(region, puuid);
  const solo = entries.find((e) => e.queueType === 'RANKED_SOLO_5x5');

  // Historial incremental (games = partidas válidas, skipped = remakes ya vistos)
  const hf = histFile(puuid);
  const stored = await readJson(hf, []);
  const history = Array.isArray(stored) ? stored : stored.games ?? [];
  const skipped = new Set(Array.isArray(stored) ? [] : stored.skipped ?? []);
  let seasonComplete = !Array.isArray(stored) && stored.seasonComplete === true;
  const seasonGames = solo ? solo.wins + solo.losses : 0;
  // Partidas nuevas o guardadas con un formato antiguo (les faltan objetos, runas, rival…)
  const byId = new Map(history.map((g) => [g.id, g]));
  const needs = (id) => !skipped.has(id) && (byId.get(id)?.v ?? 0) < MATCH_RECORD_VERSION;
  const ids = await riot.matchIds(region, puuid, { queue: QUEUE_SOLO, count: MATCH_COUNT });
  const recent = ids.filter(needs);

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
      if (isRecent) {
        try { timeline = await riot.timeline(region, id); } catch (err) {
          if (err instanceof RiotError && (err.status === 401 || err.status === 403)) throw err;
          console.warn(`  ! timeline ${id}: ${err.message}`);
        }
      }
      const rec = compactMatch(match, puuid, dd, timeline);
      if (rec) {
        const i = history.findIndex((g) => g.id === id);
        if (i >= 0) history[i] = rec; else history.push(rec);
      } else skipped.add(id);
    } catch (err) {
      if (err instanceof RiotError && (err.status === 401 || err.status === 403)) throw err;
      console.warn(`  ! partida ${id}: ${err.message}`);
    }
  }
  history.sort((a, b) => b.t - a.t);
  history.length = Math.min(history.length, HISTORY_CAP);
  await writeJson(hf, { games: history, skipped: [...skipped].slice(-2000), seasonComplete });

  const games = solo ? solo.wins + solo.losses : 0;
  return {
    riotId: acc.riotId,
    gameName, tagLine,
    label: acc.label ?? null,
    region,
    level: summoner.summonerLevel,
    profileIconId: summoner.profileIconId,
    rank: solo
      ? {
          tier: solo.tier, division: solo.rank, lp: solo.leaguePoints,
          wins: solo.wins, losses: solo.losses,
          winrate: games ? Math.round((solo.wins / games) * 1000) / 10 : 0,
          hotStreak: !!solo.hotStreak,
        }
      : null,
    stats: computeAccountStats(history),
    links: profileLinks(region, gameName, tagLine),
    updatedAt: new Date().toISOString(),
    _history: history,
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

async function main() {
  if (process.argv.includes('--demo')) {
    const { writeDemo } = await import('./demo.mjs');
    await writeDemo(CONFIG, OUT);
    console.log(`Datos demo escritos en ${path.relative(ROOT, OUT)}`);
    return;
  }

  const config = await readJson(CONFIG, null);
  if (!config?.players?.length) throw new Error('config/players.json vacío o ilegible');

  await mkdir(HIST_DIR, { recursive: true });
  const riot = new Riot(process.env.RIOT_API_KEY, {
    minIntervalMs: Number(process.env.MIN_INTERVAL_MS || 1250),
  });
  const cache = await readJson(PUUIDS, {});
  const previous = existsSync(OUT) ? await readJson(OUT, null) : null;
  const prevAcc = new Map();
  for (const p of previous?.players ?? []) for (const a of p.accounts) prevAcc.set(a.riotId.toLowerCase(), a);

  const ddVersion = (await ddragonVersion()) ?? previous?.ddragonVersion ?? null;
  const dd = await loadDataDragon(ddVersion);
  // Máximo de partidas antiguas a descargar por ejecución (el resto, en las siguientes)
  const budget = { left: Number(process.env.BACKFILL_BUDGET || 350) };
  const players = [];
  let failures = 0;
  for (const pl of config.players) {
    console.log(`> ${pl.name}`);
    const accounts = [];
    for (const acc of pl.accounts) {
      const region = acc.region ?? config.defaultRegion ?? 'euw1';
      try {
        accounts.push(await updateAccount(riot, acc, region, cache, dd, budget));
      } catch (err) {
        // Clave caducada: abortar sin tocar los datos publicados.
        if (err instanceof RiotError && (err.status === 401 || err.status === 403)) throw err;
        failures++;
        console.error(`  ✗ ${acc.riotId}: ${err.message}`);
        const old = prevAcc.get(acc.riotId.toLowerCase());
        if (old) accounts.push({ ...old, error: err.message });
        else {
          const [gameName, tagLine] = splitRiotId(acc.riotId);
          accounts.push({
            riotId: acc.riotId, gameName, tagLine, label: acc.label ?? null, region,
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

  // Historial de LP: un punto [timestamp, score] cada vez que cambia el elo de una cuenta.
  // La web lo usa para "LP hoy", cambios de posición y mejores/peores días.
  const lpHist = await readJson(LP_HIST, {});
  const now = Date.now();
  for (const p of players) {
    for (const a of p.accounts) {
      const key = a.riotId.toLowerCase();
      const arr = lpHist[key] ?? [];
      const score = rankScore(a.rank);
      const total = a.rank ? a.rank.wins + a.rank.losses : null;
      const last = arr.at(-1);
      if (score >= 0 && a._history && (last?.[1] !== score || last?.[2] !== total)) arr.push([a._leagueAt ?? now, score, total]);
      lpHist[key] = arr.slice(-LP_HIST_CAP);
      a.lpHist = lpHist[key].slice(-LP_HIST_PUBLISHED).map(([t, s]) => [t, s]);
      if (a._history) {
        const lpMap = assignLp(lpHist[key], a._history);
        a.recent = a._history.slice(0, RECENT_PUBLISHED).map((g) => ({ ...g, lp: lpMap.get(g.id) ?? null }));
        // [fin, victoria, LP exacto si se conoce] para reconstruir la curva de elo hacia atrás
        a.seq = a._history.slice(0, SEQ_PUBLISHED).map((g) => {
          const lp = lpMap.get(g.id);
          return [g.t, g.win ? 1 : 0, lp && lp.n === 1 ? lp.d : null];
        });
        if (a.stats) a.stats.lp = lpAverages(a._history, lpMap);
      }
      delete a._history;
      delete a._leagueAt;
    }
  }
  await writeJson(LP_HIST, lpHist);

  const next = {
    generatedAt: new Date().toISOString(),
    ddragonVersion: ddVersion,
    title: config.title ?? 'SoloQ Crew',
    subtitle: config.subtitle ?? '',
    players,
  };

  // Si nada ha cambiado (salvo las marcas de tiempo) no reescribimos el fichero:
  // así el workflow no llena el historial de git con commits vacíos.
  const strip = (o) => JSON.stringify(o, (k, v) => (k === 'generatedAt' || k === 'updatedAt' ? undefined : v));
  if (previous && !previous.demo && strip(previous) === strip(next)) {
    console.log(`Sin cambios (${riot.calls} peticiones, ${failures} cuentas con error).`);
    return;
  }
  await writeJson(OUT, next);
  console.log(`Listo: ${riot.calls} peticiones, ${failures} cuentas con error.`);
}

main().catch((err) => {
  // Clave caducada/inválida: avisamos pero no marcamos el workflow como fallido,
  // para no recibir un email de error cada 30 minutos. La web sigue con los últimos datos.
  if (err instanceof RiotError && (err.status === 401 || err.status === 403)) {
    console.log(`::warning::${err.message}. Actualiza el secret RIOT_API_KEY.`);
    process.exit(0);
  }
  console.error(err.message);
  process.exit(1);
});
