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
import { Riot, RiotError, compactMatch, profileLinks } from './riot.mjs';
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
const HISTORY_CAP = 500;
const MATCH_COUNT = Math.min(100, Number(process.env.MATCH_COUNT || 40));

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

async function updateAccount(riot, acc, region, cache, prevSnapshot) {
  const [gameName, tagLine] = splitRiotId(acc.riotId);
  const cacheKey = acc.riotId.toLowerCase();

  let puuid = cache[cacheKey]?.puuid;
  if (!puuid) {
    const a = await riot.accountByRiotId(region, gameName, tagLine);
    puuid = a.puuid;
    cache[cacheKey] = { puuid };
  }

  const summoner = await riot.summonerByPuuid(region, puuid);
  const entries = await riot.leagueEntries(region, puuid);
  const solo = entries.find((e) => e.queueType === 'RANKED_SOLO_5x5');

  // Historial incremental (games = partidas válidas, skipped = remakes ya vistos)
  const hf = histFile(puuid);
  const stored = await readJson(hf, []);
  const history = Array.isArray(stored) ? stored : stored.games ?? [];
  const skipped = new Set(Array.isArray(stored) ? [] : stored.skipped ?? []);
  const known = new Set([...history.map((g) => g.id), ...skipped]);
  const ids = await riot.matchIds(region, puuid, { queue: QUEUE_SOLO, count: MATCH_COUNT });
  const fresh = ids.filter((id) => !known.has(id));
  console.log(`  ${acc.riotId}: ${fresh.length} partidas nuevas`);
  for (const id of fresh) {
    try {
      const rec = compactMatch(await riot.match(region, id), puuid);
      if (rec) history.push(rec);
      else skipped.add(id);
    } catch (err) {
      if (err instanceof RiotError && (err.status === 401 || err.status === 403)) throw err;
      console.warn(`  ! partida ${id}: ${err.message}`);
    }
  }
  history.sort((a, b) => b.t - a.t);
  history.length = Math.min(history.length, HISTORY_CAP);
  await writeJson(hf, { games: history, skipped: [...skipped].slice(-200) });

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
  };
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

  const players = [];
  let failures = 0;
  for (const pl of config.players) {
    console.log(`> ${pl.name}`);
    const accounts = [];
    for (const acc of pl.accounts) {
      const region = acc.region ?? config.defaultRegion ?? 'euw1';
      try {
        accounts.push(await updateAccount(riot, acc, region, cache, prevAcc.get(acc.riotId.toLowerCase())));
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
      if (score >= 0 && !a.error && arr.at(-1)?.[1] !== score) arr.push([now, score]);
      lpHist[key] = arr.slice(-LP_HIST_CAP);
      a.lpHist = lpHist[key].slice(-LP_HIST_PUBLISHED);
    }
  }
  await writeJson(LP_HIST, lpHist);

  const next = {
    generatedAt: new Date().toISOString(),
    ddragonVersion: (await ddragonVersion()) ?? previous?.ddragonVersion ?? null,
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
