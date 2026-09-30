// Cliente mínimo de la API de Riot con espaciado entre peticiones y reintentos.

const PLATFORM_TO_ACCOUNT_REGION = {
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas', oc1: 'americas',
  kr: 'asia', jp1: 'asia',
  ph2: 'asia', sg2: 'asia', th2: 'asia', tw2: 'asia', vn2: 'asia',
};
const PLATFORM_TO_MATCH_REGION = {
  ...PLATFORM_TO_ACCOUNT_REGION,
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RiotError extends Error {
  constructor(status, url, body) {
    super(`Riot API ${status} en ${url}${body ? ` — ${body}` : ''}`);
    this.status = status;
  }
}

export class Riot {
  // minIntervalMs: 1250 respeta 100 peticiones / 2 min (límite de claves dev/personal).
  constructor(apiKey, { minIntervalMs = 1250 } = {}) {
    if (!apiKey) throw new Error('Falta RIOT_API_KEY');
    this.apiKey = apiKey;
    this.minIntervalMs = minIntervalMs;
    this.lastCall = 0;
    this.calls = 0;
  }

  async get(host, path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `https://${host}.api.riotgames.com${path}${qs ? `?${qs}` : ''}`;

    for (let attempt = 0; attempt < 5; attempt++) {
      const wait = this.lastCall + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
      this.calls++;

      let res;
      try {
        res = await fetch(url, { headers: { 'X-Riot-Token': this.apiKey } });
      } catch (err) {
        if (attempt === 4) throw err;
        await sleep(2000 * (attempt + 1));
        continue;
      }

      if (res.ok) return res.json();
      if (res.status === 429) {
        const retry = Number(res.headers.get('retry-after') || 10);
        console.warn(`  429 rate limit, esperando ${retry}s…`);
        await sleep((retry + 1) * 1000);
        continue;
      }
      if (res.status >= 500) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new RiotError(res.status, path, 'clave inválida o caducada (¿dev key de 24h?)');
      }
      throw new RiotError(res.status, path, (await res.text()).slice(0, 200));
    }
    throw new RiotError(0, path, 'demasiados reintentos');
  }

  accountByRiotId(platform, gameName, tagLine) {
    const host = PLATFORM_TO_ACCOUNT_REGION[platform];
    return this.get(host, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);
  }
  accountByPuuid(platform, puuid) {
    const host = PLATFORM_TO_ACCOUNT_REGION[platform];
    return this.get(host, `/riot/account/v1/accounts/by-puuid/${puuid}`);
  }
  summonerByPuuid(platform, puuid) {
    return this.get(platform, `/lol/summoner/v4/summoners/by-puuid/${puuid}`);
  }
  leagueEntries(platform, puuid) {
    return this.get(platform, `/lol/league/v4/entries/by-puuid/${puuid}`);
  }
  matchIds(platform, puuid, params) {
    return this.get(PLATFORM_TO_MATCH_REGION[platform], `/lol/match/v5/matches/by-puuid/${puuid}/ids`, params);
  }
  match(platform, id) {
    return this.get(PLATFORM_TO_MATCH_REGION[platform], `/lol/match/v5/matches/${id}`);
  }
  timeline(platform, id) {
    return this.get(PLATFORM_TO_MATCH_REGION[platform], `/lol/match/v5/matches/${id}/timeline`);
  }
}

// Enlaces a webs de estadísticas.
const OPGG_REGION = {
  euw1: 'euw', eun1: 'eune', na1: 'na', kr: 'kr', br1: 'br', la1: 'lan', la2: 'las',
  oc1: 'oce', tr1: 'tr', ru: 'ru', jp1: 'jp',
};
const LOG_REGION = {
  euw1: 'euw', eun1: 'eune', na1: 'na', kr: 'kr', br1: 'br', la1: 'lan', la2: 'las',
  oc1: 'oce', tr1: 'tr', ru: 'ru', jp1: 'jp',
};

export function profileLinks(platform, gameName, tagLine) {
  const slug = `${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
  return {
    opgg: `https://www.op.gg/summoners/${OPGG_REGION[platform] ?? 'euw'}/${slug}`,
    ugg: `https://u.gg/lol/profile/${platform}/${slug}/overview`,
    dpm: `https://dpm.lol/${slug}`,
    log: `https://www.leagueofgraphs.com/summoner/${LOG_REGION[platform] ?? 'euw'}/${slug}`,
  };
}

// Convierte una partida de la API en el registro compacto que guardamos.
// `dd` = diccionarios de Data Dragon ({ spells: {id→clave}, runes: {id→ruta icono} }).
export const MATCH_RECORD_VERSION = 3;

function loadout(p, dd) {
  const styles = p.perks?.styles ?? [];
  const keystone = styles[0]?.selections?.[0]?.perk;
  const secondary = styles[1]?.style;
  return {
    champ: p.championName,
    spells: [p.summoner1Id, p.summoner2Id].map((id) => dd?.spells?.[id] ?? null),
    runes: [dd?.runes?.[keystone] ?? null, dd?.runes?.[secondary] ?? null],
  };
}

export function compactMatch(match, puuid, dd, timeline) {
  const info = match.info;
  const me = info.participants.find((p) => p.puuid === puuid);
  if (!me) return null;
  if (me.gameEndedInEarlySurrender || info.gameDuration < 300) return null; // remake

  const team = info.participants.filter((p) => p.teamId === me.teamId);
  const opp = me.teamPosition
    ? info.participants.find((p) => p.teamId !== me.teamId && p.teamPosition === me.teamPosition)
    : null;
  const teamKills = team.reduce((s, p) => s + (p.kills || 0), 0);
  return {
    v: MATCH_RECORD_VERSION,
    id: match.metadata.matchId,
    t: info.gameEndTimestamp ?? (info.gameStartTimestamp + info.gameDuration * 1000),
    dur: info.gameDuration,
    win: !!me.win,
    champ: me.championName,
    role: me.teamPosition || null,
    lvl: me.champLevel,
    k: me.kills, d: me.deaths, a: me.assists,
    kp: teamKills ? Math.round(((me.kills + me.assists) / teamKills) * 100) : 0,
    cs: (me.totalMinionsKilled || 0) + (me.neutralMinionsKilled || 0),
    vis: me.visionScore || 0,
    dmg: me.totalDamageDealtToChampions || 0,
    teamDmg: team.reduce((s, p) => s + (p.totalDamageDealtToChampions || 0), 0),
    penta: me.pentaKills || 0,
    fb: !!me.firstBloodKill,
    items: [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5, me.item6].map((x) => x || 0),
    ...(({ spells, runes }) => ({ spells, runes }))(loadout(me, dd)),
    opp: opp ? loadout(opp, dd) : null,
    gold: timeline ? goldFromTimeline(info, timeline, me, opp) : null,
  };
}

// Diferencias de oro a partir del timeline (un fotograma por minuto).
//  maxLead: mayor ventaja de oro de su equipo en algún momento
//  maxDef:  mayor desventaja (negativo)
//  tgd15:   diferencia de oro del equipo en el minuto 15
//  gd15:    su oro menos el de su rival de línea en el minuto 15
function goldFromTimeline(info, timeline, me, opp) {
  const frames = timeline?.info?.frames;
  if (!frames?.length) return null;
  const teamOf = new Map(info.participants.map((p) => [p.participantId, p.teamId]));
  let maxLead = 0, maxDef = 0, tgd15 = null, gd15 = null, maxLeadMin = 0;
  frames.forEach((f, minute) => {
    let diff = 0;
    for (const [pid, pf] of Object.entries(f.participantFrames ?? {})) {
      diff += (teamOf.get(Number(pid)) === me.teamId ? 1 : -1) * (pf.totalGold || 0);
    }
    if (diff > maxLead) { maxLead = diff; maxLeadMin = minute; }
    if (diff < maxDef) maxDef = diff;
    if (minute === 15) {
      tgd15 = diff;
      const mine = f.participantFrames?.[me.participantId]?.totalGold;
      const theirs = opp ? f.participantFrames?.[opp.participantId]?.totalGold : null;
      if (mine != null && theirs != null) gd15 = mine - theirs;
    }
  });
  return { maxLead, maxLeadMin, maxDef, tgd15, gd15 };
}

// Diccionarios de Data Dragon para hechizos y runas (una vez por ejecución).
export async function loadDataDragon(version) {
  if (!version) return { spells: {}, runes: {} };
  const base = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US`;
  const spells = {}, runes = {};
  try {
    const s = await (await fetch(`${base}/summoner.json`)).json();
    for (const sp of Object.values(s.data)) spells[sp.key] = sp.id;
  } catch { /* sin iconos de hechizos */ }
  try {
    const r = await (await fetch(`${base}/runesReforged.json`)).json();
    for (const style of r) {
      runes[style.id] = style.icon;
      for (const slot of style.slots) for (const rune of slot.runes) runes[rune.id] = rune.icon;
    }
  } catch { /* sin iconos de runas */ }
  return { spells, runes };
}
