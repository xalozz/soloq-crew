// Tipos de lo que publica el actualizador: data/data.json, data/weeks.json, data/matches/<id>.json y el latido.
// Sacados de los ficheros reales; lo opcional es lo que puede faltar en cuentas sin partidas o en datos antiguos.

export type Tier =
  | 'IRON' | 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'EMERALD' | 'DIAMOND' | 'MASTER' | 'GRANDMASTER' | 'CHALLENGER';
export type Role = 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY';

export interface Rank {
  tier: Tier;
  division: string;
  lp: number;
  wins: number;
  losses: number;
  winrate: number;
  hotStreak?: boolean;
}

/** Resumen de una partida (récords, mejor/peor partida, oro…) */
export interface GameRef {
  id: string;
  t: number;
  dur?: number;
  champ: string;
  role?: string;
  k: number;
  d: number;
  a: number;
  win: boolean;
  kda: number;
}
export interface ValGame extends GameRef { val: number; min?: number }

export interface ChampStat { key: string; games: number; wins: number; winrate: number; kda: number; csPerMin?: number }
export interface KeyStat { key: string; games: number; wins: number; winrate: number; kda: number }
export interface RoleStat { games: number; wins: number; winrate: number; kda: number; gd15?: number | null; champs?: ChampStat[] }

/** [victorias, partidas] */
export type WN = [number, number];

export interface Tilt {
  hour: WN[];
  dow: WN[];
  grid: WN[];
  session: WN[];
  prev: WN[];
  hoursIn: WN[];
  sessions?: number;
}

export interface Conduct {
  games: number;
  pings: number;
  q: number;
  allIn: number;
  back: number;
  bait?: number;
  danger?: number;
  omw?: number;
  maxQ?: ValGame | null;
  losses: number;
  ffLosses: number;
  ffPct: number;
  ffEarly: number;
  ffAvgMin?: number;
  wins: number;
  ffWins: number;
  ffWinPct: number;
}

export interface GoldStats {
  games: number;
  avgGd15: number | null;
  avgTgd15?: number | null;
  throws: number;
  comebacks?: number;
  biggestThrow?: ValGame | null;
  biggestComeback?: ValGame | null;
  biggestLead?: ValGame | null;
  best15?: ValGame | null;
  worst15?: ValGame | null;
}
export type GoldRecordKey = 'biggestThrow' | 'biggestComeback' | 'biggestLead' | 'best15' | 'worst15';

export interface Awards {
  oneTrick?: { champ: string; wins: number; games: number } | null;
  mainChar?: { champ: string; winrate: number; games: number } | null;
  autofill?: { lane: string; games: number; wins: number; winrate: number } | null;
  champPool?: number;
  kdaStreak?: number;
  avgKda?: number;
  pentas?: number;
  quadras?: number;
  quadraGames?: number;
  firstBloods?: number;
}

export type GameRecordKey = 'kills' | 'assists' | 'damage' | 'vision' | 'longestWin' | 'kda' | 'kp' | 'towers' | 'gold' | 'csMin' | 'q';

export interface Stats {
  games: number;
  wins: number;
  losses: number;
  winrate: number;
  avgK: number;
  avgD: number;
  avgA: number;
  kda: number;
  csPerMin: number;
  visPerMin: number;
  dmgShare: number | null;
  avgDurationMin: number;
  streak: { current: { type: 'W' | 'L' | null; count: number }; bestWin: number; worstLoss: number };
  firstOfDay?: { games: number; wins: number; winrate: number; restWinrate: number } | null;
  form?: string[];
  trend?: number[];
  mainRole?: Role | null;
  last10?: { games: number; wins: number; losses: number; winrate: number };
  last20?: { games: number; wins: number; losses: number; winrate: number } | null;
  topChamps?: KeyStat[];
  bestChamp?: KeyStat | null;
  worstChamp?: KeyStat | null;
  bestRole?: KeyStat | null;
  worstRole?: KeyStat | null;
  bestGame: GameRef;
  worstGame: GameRef;
  firstGameAt?: number;
  lastGameAt?: number;
  totals?: { k: number; d: number; a: number };
  dmgPerMin?: number | null;
  avgVision?: number | null;
  pentas?: number;
  firstBloods?: number;
  maxKills?: number;
  maxDurationMin?: number | null;
  avgKp?: number | null;
  champs?: ChampStat[];
  roles?: KeyStat[];
  gold?: GoldStats | null;
  byRole?: Partial<Record<Role, RoleStat>>;
  awards?: Awards;
  gameRecords?: Partial<Record<GameRecordKey, ValGame>>;
  tilt?: Tilt;
  /** campeón rival de línea → [partidas, victorias] */
  vs?: Record<string, [number, number]>;
  conduct?: Conduct | null;
  lp?: { win: number | null; loss: number | null; winN?: number; lossN?: number } | null;
}

/** Campeón, hechizos y runas de una partida (el jugador o su rival) */
export interface Loadout {
  champ: string;
  spells?: string[];
  runes?: (string | null)[];
}

export interface RecentGame extends Loadout {
  v?: number;
  id: string;
  t: number;
  dur: number;
  win: boolean;
  role?: string;
  lvl?: number;
  k: number;
  d: number;
  a: number;
  kp?: number | null;
  cs: number;
  vis?: number;
  dmg?: number;
  items?: number[];
  opp?: Loadout | null;
  gold?: { maxLead: number; maxLeadMin?: number; maxDef: number; tgd15?: number | null; gd15?: number | null } | null;
  lp?: { d: number; n: number } | null;
  [extra: string]: unknown;
}

/** [momento, 1 victoria / 0 derrota, LP de la partida o null] */
export type SeqGame = [number, number, (number | null)?];
/** [momento, puntuación de elo] */
export type LpPoint = [number, number];

export interface Account {
  key: string;
  riotId: string;
  gameName: string;
  tagLine: string;
  label?: string | null;
  region?: string;
  level?: number;
  profileIconId?: number;
  rank: Rank | null;
  flexRank?: Rank | null;
  stats: Stats | null;
  links?: Partial<Record<string, string>>;
  updatedAt?: string;
  error?: string;
  lpHist?: LpPoint[];
  recent?: RecentGame[];
  seq?: SeqGame[];
}

export interface PlayerRaw {
  name: string;
  links?: unknown[];
  bestAccount: number;
  score?: number;
  accounts: Account[];
}

export interface DuoGame {
  id: string;
  t: number;
  win: boolean;
  c: [string, string];
  kda: [number, number, number][];
  lp?: (number | null)[];
}
export interface DuoSide {
  name: string;
  lp: number;
  lpEst: number;
  kda: { k: number; d: number; a: number; ratio: number };
  wrWithout: number;
  gamesWithout: number;
  champs: [string, number][];
}
export interface Duo {
  a: string;
  b: string;
  games: number;
  wins: number;
  losses: number;
  wr: number;
  streak: { win: boolean; n: number };
  bestWin: number;
  bestLoss: number;
  first: number;
  last: number;
  hours: number;
  sides: [DuoSide, DuoSide];
  recent: DuoGame[];
}
export interface RivalGame { id: string; t: number; aWin: boolean; c: [string, string]; kda: [number, number, number][] }
export interface Rival { a: string; b: string; aWins: number; bWins: number; recent: RivalGame[] }

export interface GameEvent {
  name: string;
  key?: string;
  type: string;
  t: number;
  id?: string;
  text?: string;
  gameId?: string;
  from?: string;
  to?: string;
  lp?: number;
  peak?: boolean;
  champ?: string;
  k?: number;
  d?: number;
  a?: number;
  win?: boolean;
  desc?: string;
  [extra: string]: unknown;
}

export interface WeekPlayer {
  name: string;
  games: number;
  wins: number;
  losses: number;
  hours: number;
  lp: number | null;
  start: number | null;
  end: number | null;
  bestW?: number;
  worstL?: number;
  k: number;
  d: number;
  a: number;
  best?: GameRef | null;
}
export interface Week {
  key: string;
  from: number;
  to: number | null;
  totals: { games: number; wins: number; hours: number };
  players: WeekPlayer[];
  mvp?: string | null;
  worst?: string | null;
  grinder?: string | null;
  hot?: { name: string; n: number } | null;
  cold?: { name: string; n: number } | null;
  duo?: { a: string; b: string; games: number; wins: number } | null;
  gotw?: (GameRef & { name: string }) | null;
  pentas?: (GameRef & { name: string })[];
  coward?: { name: string; n: number; of: number } | null;
  qKing?: { name: string; avg: number; total: number } | null;
}

export interface Standing {
  name: string;
  value?: number | null;
  label: string;
  done?: boolean;
  weeks?: number[];
  [extra: string]: unknown;
}
export interface Challenge {
  id: string;
  title: string;
  type: string;
  desc?: string;
  stake?: string;
  from: number;
  to: number;
  target?: string | null;
  perWeek?: number | null;
  standings: Standing[];
  winners?: string[] | null;
}

export interface FlexGame {
  id: string;
  t: number;
  q: number;
  dur?: number;
  win: boolean;
  members: { name: string; champ: string; role?: string; k: number; d: number; a: number }[];
}
export interface Flex {
  players?: { name: string; rank: Rank | null; games: number; wins?: number; winrate?: number; clash?: number }[];
  lineups?: { names: string[]; n: number; w: number; last: number; flex?: number; clash?: number; wr: number }[];
  recent?: FlexGame[];
  clash?: FlexGame[];
}

export interface Data {
  generatedAt: string;
  ddragonVersion?: string | null;
  title?: string;
  subtitle?: string;
  players: PlayerRaw[];
  duos?: Duo[];
  rivals?: Rival[];
  events?: GameEvent[];
  week?: { current?: Week | null; last?: Week | null } | null;
  weekWins?: Record<string, number>;
  challenges?: Challenge[];
  flex?: Flex | null;
}

export interface WeeksFile { weeks?: Week[] }

export interface MatchPlayer extends Loadout {
  rid: string;
  pos?: string;
  lvl?: number;
  k: number;
  d: number;
  a: number;
  cs: number;
  dmg: number;
  gold?: number;
  items?: number[];
}
export interface MatchTeam { teamId: number; win: boolean; kills: number; gold: number; bans?: string[]; players: MatchPlayer[] }
export interface MatchDetail { id: string; t: number; dur: number; teams: MatchTeam[] }

/** Partida en curso de los del grupo (viaja en el latido) */
export interface LiveGame {
  id?: number | string;
  q?: number | null;
  s?: number | null;
  p: { n: string; c?: string | null; tm?: number | null }[];
}
/** Resultado de la última pasada del actualizador */
export interface PassStatus {
  v?: number;
  at?: number;
  ok?: boolean;
  full?: boolean;
  err?: string | null;
  msg?: string | null;
  live?: LiveGame[] | null;
  liveErr?: unknown;
  accErr?: string[];
  calls?: number;
  beat?: number;
}
/** api/latido del servidor propio */
export interface Latido { beat: number | null; status: PassStatus | null }
