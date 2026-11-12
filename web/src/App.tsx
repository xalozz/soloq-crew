// La web entera: carga y recarga de datos, latido del actualizador, enlaces directos y secciones
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppContext, useTick, type AppApi } from './ctx';
import { Compare } from './components/Compare';
import { chromeDesktopForced, desktopOn, Header, LIVE_INITIAL, type LiveState } from './components/Header';
import { Best5Info, DesktopInfo, InstallInfo } from './components/Infos';
import { clearDetailCache, MatchDetail } from './components/Match';
import { useModals } from './components/Modal';
import { buildModel } from './lib/model';
import { fmt, fmtInt, ON_PAGES, timeAgo } from './lib/util';
import { Best5, type Best5Mode } from './sections/Best5';
import { Challenges } from './sections/Challenges';
import { Champions } from './sections/Champions';
import { Duos } from './sections/Duos';
import { Banner, Events, evParts } from './sections/Events';
import { Flex } from './sections/Flex';
import { GroupEloSection } from './sections/GroupElo';
import { RankingSection, type Meta } from './sections/Ranking';
import { Awards, DaysList, GameRecords, RecordsGrid } from './sections/Records';
import { Stats } from './sections/Stats';
import { TiltBox, TiltWho } from './sections/Tilt';
import { WeekSection } from './sections/Week';
import type { Data, Latido, LiveGame, PassStatus } from './types';

// Instalar la app: el aviso del navegador se guarda para el botón del menú "Más"
interface InstallPrompt extends Event { prompt: () => void; userChoice: Promise<unknown> }
let installEvt: InstallPrompt | null = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e as InstallPrompt; });

// Cada sección nueva va aparte: si una falla, el resto de la web se sigue viendo
class Safe extends Component<{ children: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch(err: unknown) { console.error(err); }
  render() { return this.state.err ? null : this.props.children; }
}

const REFRESH_TITLE = 'Recargar los datos más recientes (se actualizan solos cada minuto)';

export function App() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<PassStatus | null>(null);   // resultado de la última pasada (viaja en el latido)
  const [live, setLive] = useState<LiveGame[]>([]);                // partidas en curso de los del grupo
  const [liveState, setLiveState] = useState<LiveState>(LIVE_INITIAL);
  const [spin, setSpin] = useState(false);
  const [best5Mode, setBest5Mode] = useState<Best5Mode>('perf');
  const [daysMode, setDaysMode] = useState<'up' | 'down'>('up');
  const [tiltWho, setTiltWho] = useState('Grupo');
  const [modals, openModal] = useModals();
  useTick(60_000); // "hace x min" de la cabecera
  const model = useMemo(() => (data ? buildModel(data) : []), [data]);
  const dataRef = useRef<Data | null>(null);
  dataRef.current = data;
  const liveRef = useRef<LiveGame[]>([]);
  const ownServer = useRef(false);   // se sabe en el primer latido: hay api/latido (servidor en Python)
  const refreshing = useRef(false);

  const openMatchModal = useCallback((id: string, title: string, meRiotId?: string) => openModal(title, <MatchDetail id={id} meRiotId={meRiotId} />, { wide: true }), [openModal]);
  const openCompare = useCallback((aName?: string, bName?: string) => {
    if (!model.length) return;
    openModal('Comparar jugadores', <Compare aName={aName} bName={bName} />, { wide: true, head: <b>⚖ Comparar jugadores</b> });
  }, [model, openModal]);
  const api: AppApi | null = useMemo(() => (data ? { data, model, live, openModal, openMatchModal, openCompare } : null),
    [data, model, live, openModal, openMatchModal, openCompare]);

  // Recarga de datos: automática cada minuto y con el botón ↻ (mantiene lo que tengas desplegado)
  const refreshData = useCallback(async (manual = false) => {
    if (refreshing.current || (document.hidden && !manual)) return;
    refreshing.current = true;
    setSpin(true);
    try {
      const res = await fetch(`data/data.json?t=${Date.now()}`);
      if (res.ok) {
        const fresh = (await res.json()) as Data;
        if (!dataRef.current || fresh.generatedAt !== dataRef.current.generatedAt) {
          clearDetailCache();
          setData(fresh);
        }
      }
    } catch { /* sin conexión: se reintenta en el siguiente minuto */ }
    setTimeout(() => setSpin(false), 400);
    refreshing.current = false;
  }, []);

  // Estado del actualizador automático: api/latido en el servidor propio; si no, la rama "heartbeat" de GitHub.
  // El latido lleva el resultado de la pasada: si Riot respondió, si la clave vale y quién está jugando.
  const checkLive = useCallback(async () => {
    if (document.hidden) return;
    const set = (cls: string, text: string, title: string) => setLiveState((s) => ({ ...s, cls, text, title }));
    try {
      let beat: number | null | undefined, st: PassStatus | null = null;
      const own = ON_PAGES ? null : await fetch(`api/latido?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
      ownServer.current = !!own?.ok && (own.headers.get('content-type') ?? '').includes('json');
      if (ownServer.current && own) {
        setLiveState((s) => ({ ...s, href: 'api/latido' }));
        const j = (await own.json()) as Latido;
        beat = j.beat;
        st = j.status ?? null;
      } else {
        const r = await fetch('https://api.github.com/repos/xalozz/soloq-crew/commits/heartbeat', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        // Respuesta de la API de GitHub: solo se leen la fecha y el mensaje del commit
        const j = (await r.json()) as { commit: { committer: { date: string }; message?: string } };
        beat = new Date(j.commit.committer.date).getTime();
        const msg = j.commit.message ?? '';
        const i = msg.indexOf('\n\n');
        if (i >= 0) { try { st = JSON.parse(msg.slice(i + 2).trim()) as PassStatus; } catch { st = null; } }
      }
      if (!beat) throw new Error('sin latido');
      setStatus({ ...(st ?? {}), beat });
      const mins = Math.round((Date.now() - beat) / 60000);
      const fresh = mins <= 4;
      const nextLive = fresh && Array.isArray(st?.live) ? st!.live! : [];
      if (JSON.stringify(nextLive) !== JSON.stringify(liveRef.current)) { liveRef.current = nextLive; setLive(nextLive); }
      const checked = st?.at ? Math.round((Date.now() - st.at) / 60000) : mins;
      const agoMin = (m: number) => (m <= 0 ? 'hace menos de 1 min' : `hace ${m} min`);
      const d = dataRef.current;
      if (!fresh) set('off', 'Parado', `Sin latido desde hace ${mins} min. Se relanza solo; si dura mucho, avisa`);
      else if (st?.err === 'key') set('off', 'Clave caducada', `Riot rechaza la clave de la API: los datos no se actualizan hasta renovarla (${ownServer.current ? 'clave de Riot en el servidor' : 'secreto RIOT_API_KEY en GitHub'})`);
      else if (st?.err) set('warn', 'Riot no responde', `La última comprobación falló${st.msg ? ` (${st.msg})` : ''}. Se reintenta cada minuto`);
      else if (st?.at && checked > 10) set('warn', 'Con retraso', `La última comprobación correcta fue ${agoMin(checked)}`);
      else {
        set('on', 'En directo', `Comprobado ${agoMin(checked)} · última novedad ${d ? timeAgo(d.generatedAt) : '–'}`
          + `${st?.accErr?.length ? ` · sin actualizar: ${st.accErr.join(', ')}` : ''}`);
      }
    } catch {
      set('unk', 'Estado ?', `No se ha podido comprobar el estado${ownServer.current ? '' : ' (pulsa para verlo en GitHub)'}`);
    }
  }, []);

  // #partida/<id> abre una partida (enlaces de Discord) · #vs/<a>/<b> abre el comparador
  const handleHash = useCallback(() => {
    const d = dataRef.current;
    if (!d) return;
    let hash = location.hash;
    try { hash = decodeURIComponent(hash); } catch { /* tal cual */ }
    let m: RegExpMatchArray | null;
    if ((m = hash.match(/^#partida\/(.+)$/))) {
      const id = m[1];
      const e = (d.events ?? []).find((x) => x.gameId === id);
      const p = e ? model.find((q) => q.name === e.name) : model.find((q) => (q.main?.recent ?? []).some((g) => g.id === id));
      openMatchModal(id, e ? evParts(e)[1] : 'Partida', p?.main?.riotId);
    } else if ((m = hash.match(/^#vs\/([^/]+)\/(.+)$/))) {
      if (!document.querySelector('.cmp')) openCompare(m[1], m[2]);
    }
  }, [model, openMatchModal, openCompare]);
  const hashRef = useRef(handleHash);
  hashRef.current = handleHash;

  useEffect(() => {
    const onHash = () => hashRef.current();
    const onVis = () => { if (!document.hidden) { void refreshData(false); void checkLive(); } };
    window.addEventListener('hashchange', onHash);
    document.addEventListener('visibilitychange', onVis);
    const t1 = setInterval(() => { void checkLive(); }, 2 * 60_000);
    const t2 = setInterval(() => { void refreshData(false); }, 60_000);
    (async () => {
      try {
        const res = await fetch(`data/data.json?t=${Date.now()}`);
        if (!res.ok) throw new Error(String(res.status));
        setData((await res.json()) as Data);
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(t1); clearInterval(t2);
    };
  }, [refreshData, checkLive]);

  // Tras la primera carga: estado del actualizador y enlace directo
  const started = useRef(false);
  useEffect(() => {
    if (!data) return;
    document.title = data.title || 'SoloQ Crew';
    if (started.current) return;
    started.current = true;
    void checkLive();
    handleHash();
    // Enlace a una sección (#semana…): la sección no existe hasta pintar, así que el navegador no ha podido ir;
    // se va ahora, ya con todo pintado (antes se quedaba a media altura porque el contenido llegaba después)
    const sec = /^#[\w-]+$/.test(location.hash) ? document.getElementById(location.hash.slice(1)) : null;
    if (sec?.tagName === 'SECTION') requestAnimationFrame(() => sec.scrollIntoView({ behavior: 'instant' }));
  }, [data, checkLive, handleHash]);

  const installApp = () => {
    if (installEvt) {
      installEvt.prompt();
      installEvt.userChoice.finally(() => { installEvt = null; });
      return;
    }
    openModal('Instalar la app', <InstallInfo />);
  };
  // Como "Sitio de escritorio" de Chrome, pero dentro de la web: funciona también con la app instalada
  const toggleDesktop = () => {
    if (chromeDesktopForced()) {
      try { localStorage.removeItem('sq-desktop'); } catch { /* nada */ }
      openModal('Vista de móvil', <DesktopInfo />);
      return;
    }
    const on = !desktopOn();
    try {
      if (on) localStorage.setItem('sq-desktop', '1'); else localStorage.removeItem('sq-desktop');
      location.reload();
    } catch {
      // Sin almacenamiento: se aplica solo a esta visita
      document.querySelector('meta[name=viewport]')!.setAttribute('content', on ? `width=1280, initial-scale=${Math.min(1, screen.width / 1280).toFixed(3)}` : 'width=device-width, initial-scale=1, viewport-fit=cover');
    }
  };

  let meta: Meta | null = null;
  let updated = '';
  let refreshTitle = REFRESH_TITLE;
  if (data) {
    const ago = timeAgo(data.generatedAt);
    const checked = status?.at && !status.err ? timeAgo(new Date(status.at).toISOString()) : null;
    updated = checked ? `Comprobado ${checked}` : `Actualizado ${ago}`;
    refreshTitle = `Última novedad en los datos: ${ago}${checked ? ` · comprobado ${checked}` : ''} · se recarga sola cada minuto`;
    const games = model.reduce((n, p) => n + p.totalGames, 0);
    const wins = model.reduce((n, p) => n + p.accounts.reduce((m, a) => m + (a.rank?.wins ?? 0), 0), 0);
    meta = { updated: ago.replace('hace ', ''), games: fmtInt(games), wr: games ? `${fmt((wins / games) * 100)}%` : '–' };
  }
  const on = !!api;

  return (
    <AppContext.Provider value={api}>
      <div className="bg-glow" aria-hidden="true" />
      <Header live={liveState} updated={updated} refreshTitle={refreshTitle} spin={spin}
        onRefresh={() => { void refreshData(true); void checkLive(); }} onCompare={() => openCompare()} onInstall={installApp} onDesktop={toggleDesktop} />

      <main className="wrap">
        <Safe><Banner data={data} /></Safe>

        <RankingSection meta={meta} failed={failed} onCompare={() => openCompare()} />

        <section id="novedades" className="section">
          <h2 className="display display-md center">Novedades</h2>
          <p className="center muted sub">Subidas y bajadas, pentakills, rachas y récords del grupo, en cuanto pasan · también llegan a #soloq en Discord</p>
          <div id="events" className="panel feed">{on ? <Safe><Events /></Safe> : null}</div>
        </section>

        <section id="semana" className="section">
          <h2 className="display display-md center">La semana</h2>
          <p className="center muted sub">De lunes a domingo · el resumen de la semana pasada se publica en Discord cada lunes</p>
          <Safe><WeekSection /></Safe>
        </section>

        <section id="retos" className="section">
          <h2 className="display display-md center">Retos</h2>
          <p className="center muted sub">Piques con fecha de fin · con los LP registrados en la web</p>
          <div id="challenges" className="challenges">{on ? <Safe><Challenges /></Safe> : null}</div>
        </section>

        <section id="best5" className="section">
          <h2 className="display display-md center">{'Best 5 '}<button className="info-btn" id="best5-info" aria-label="Cómo se calcula el Best 5" title="Cómo se calcula"
            onClick={() => openModal('Cómo se calcula el Best 5', <Best5Info />)}>i</button></h2>
          <p className="center muted sub">El mejor quinteto posible, sin repetir jugador · solo roles que cada uno juega habitualmente (mín. 10 partidas y 20 % de las suyas)</p>
          <div className="toggle b5-toggle" id="best5-toggle">
            <button data-mode="perf" className={best5Mode === 'perf' ? 'on' : undefined} title="Winrate en el rol, ajustado según el número de partidas" onClick={() => setBest5Mode('perf')}>Por rendimiento</button>
            <button data-mode="elo" className={best5Mode === 'elo' ? 'on' : undefined} title="El de más rango entre los que juegan ese rol" onClick={() => setBest5Mode('elo')}>Por elo</button>
          </div>
          <div id="best5-grid" className="best5">{on ? <Best5 mode={best5Mode} /> : null}</div>
        </section>

        <section id="evolucion" className="section">
          <h2 className="display display-md center">Evolución</h2>
          <p className="center muted sub">El elo de todos a lo largo del tiempo · pulsa un nombre para mostrarlo u ocultarlo · pasa el ratón por una línea para resaltarla</p>
          <GroupEloSection />
        </section>

        <section id="duos" className="section">
          <h2 className="display display-md center">Dúos</h2>
          <p className="center muted sub">Partidas de SoloQ de esta temporada en las que os habéis tocado juntos (o enfrentados) · pulsa una partida para verla</p>
          {on ? <Duos /> : <><div id="duos-main" className="duos" /><div id="duos-minor" className="duos-minor" /><div id="rivals" className="rivals" /></>}
        </section>

        <section id="flex" className="section">
          <h2 className="display display-md center">Flex y Clash</h2>
          <p className="center muted sub">Rango de Flex de cada uno y las partidas de Flex o Clash que habéis jugado juntos esta temporada</p>
          <div id="flex-box" className="flexbox">{on ? <Safe><Flex /></Safe> : null}</div>
        </section>

        <section id="estadisticas" className="section">
          <h2 className="display display-md center">Estadísticas</h2>
          <p className="center muted sub">Medias por partida sobre las partidas de SoloQ de esta temporada (cuenta principal de cada uno)</p>
          <div id="stats" className="panel stats-grid">{on ? <Stats /> : null}</div>
        </section>

        <section id="tilt" className="section">
          <h2 className="display display-md center">Tilt y horarios</h2>
          <p className="center muted sub">Cuándo ganáis y cuándo conviene parar · toda la temporada de SoloQ · una sesión son partidas con menos de 40 min entre ellas</p>
          <div id="tilt-who" className="ge-legend tilt-who">{on ? <Safe><TiltWho who={tiltWho} setWho={setTiltWho} /></Safe> : null}</div>
          <div id="tilt-box" className="tilt">{on ? <Safe><TiltBox who={tiltWho} /></Safe> : null}</div>
        </section>

        <section id="campeones" className="section">
          <h2 className="display display-md center">Campeones</h2>
          <p className="center muted sub">Quién juega mejor cada campeón, el pool de cada uno y contra quién sufrís en la línea</p>
          <div id="champs-box" className="champs">{on ? <Safe><Champions /></Safe> : null}</div>
        </section>

        <section id="dias" className="section">
          <div className="panel days">
            <h3 className="card-title">Mejores días</h3>
            <p className="card-sub">Quién más elo ganó (o perdió) en un solo día, y qué día fue</p>
            <div className="toggle" id="days-toggle">
              <button data-mode="up" className={daysMode === 'up' ? 'on' : undefined} onClick={() => setDaysMode('up')}>Subidones</button>
              <button data-mode="down" className={daysMode === 'down' ? 'on' : undefined} onClick={() => setDaysMode('down')}>Bajones</button>
            </div>
            <div id="days-list">{on ? <DaysList mode={daysMode} /> : null}</div>
            <p className="muted small center">Diferencia de LP entre el cierre de un día y el del anterior (hora de Madrid).</p>
          </div>
        </section>

        <section id="records" className="section">
          <h2 className="display display-md center">Récords</h2>
          <p className="center muted sub">Curiosidades del grupo en la temporada de SoloQ (cuenta principal de cada uno) · pulsa para ver la partida o la clasificación</p>
          <h3 className="aw-sub">De la temporada</h3>
          <div id="awards" className="awards">{on ? <Awards /> : null}</div>
          <h3 className="aw-sub">De una sola partida</h3>
          <div id="game-records" className="grec">{on ? <GameRecords /> : null}</div>
          <h3 className="aw-sub">Rachas, oro y más</h3>
          <div id="records-grid" className="records">{on ? <RecordsGrid /> : null}</div>
        </section>
      </main>

      <footer className="wrap footer">
        SoloQ Crew · proyecto sin ánimo de lucro de un grupo de amigos. No está respaldado por Riot Games ni refleja sus opiniones.
        League of Legends y Riot Games son marcas registradas de Riot Games, Inc.
      </footer>
      {modals}
    </AppContext.Provider>
  );
}
