// Cabecera: menú, menú "Más", estado del actualizador y botón de recargar
import { useEffect, useRef, useState } from 'react';

export interface LiveState { cls: string; text: string; title: string; href: string }
export const LIVE_INITIAL: LiveState = {
  cls: '', text: '…', title: 'Estado del actualizador automático', href: 'https://github.com/xalozz/soloq-crew/actions/workflows/update.yml',
};

const LINKS: [string, string][] = [['#ranking', 'Ranking'], ['#novedades', 'Novedades'], ['#semana', 'Semana'], ['#retos', 'Retos'],
  ['#evolucion', 'Evolución'], ['#duos', 'Dúos'], ['#estadisticas', 'Estadísticas'], ['#records', 'Récords']];
const MORE: [string, string][] = [['#best5', 'Best 5'], ['#flex', 'Flex y Clash'], ['#tilt', 'Tilt y horarios'], ['#campeones', 'Campeones'], ['#dias', 'Mejores días']];
const MORE_IDS = new Set(MORE.map(([h]) => h));

export function desktopOn(): boolean {
  try { return localStorage.getItem('sq-desktop') === '1'; } catch { return false; }
}
// Chrome con "Sitio de escritorio" activado se presenta como un ordenador (sin "Android" ni "Mobile") aunque sea
// un móvil táctil. En ese modo Chrome ignora el tamaño que pide la web, así que este botón no puede quitarlo.
export function chromeDesktopForced(): boolean {
  return navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 600
    && !/Android|Mobile|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function Header({ live, updated, refreshTitle, spin, onRefresh, onCompare, onInstall, onDesktop }: {
  live: LiveState; updated: string; refreshTitle: string; spin: boolean;
  onRefresh: () => void; onCompare: () => void; onInstall: () => void; onDesktop: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  // Vista de ordenador: solo tiene sentido en pantallas pequeñas (o si ya está activada)
  const [desk] = useState(() => {
    const on = desktopOn();
    return {
      hidden: !on && !chromeDesktopForced() && Math.min(screen.width, screen.height) > 820 && screen.width > 1024,
      text: on || chromeDesktopForced() ? '📱 Volver a la vista de móvil' : '🖥️ Vista de ordenador',
    };
  });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (menu.current && !menu.current.hidden && !menu.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);

  // Enlace activo del menú según la sección visible (las del menú "Más" marcan el botón "Más")
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) setActive(`#${en.target.id}`);
    }, { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('main section[id]').forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  const act = (fn?: () => void) => () => { fn?.(); setOpen(false); };
  return (
    <header className="nav-wrap">
      <nav className="nav">
        <a className="brand" href="#ranking" aria-label="Inicio">
          <span className="brand-mark">SQ</span>
          <span className="brand-text">SOLOQ <em>CREW</em></span>
        </a>
        <div className="nav-links">{LINKS.map(([h, l]) => (
          <a key={h} href={h} className={(active ?? '#ranking') === h ? 'active' : undefined}>{l}</a>
        ))}</div>
        <div className="nav-more">
          <button id="more-btn" className={`more-btn${active && MORE_IDS.has(active) ? ' active' : ''}`} aria-haspopup="true" aria-expanded={open ? 'true' : 'false'}
            onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>Más <span aria-hidden="true">▾</span></button>
          <div id="more-menu" className="more-menu" hidden={!open} ref={menu}>
            {MORE.map(([h, l]) => <a key={h} href={h} onClick={act()}>{l}</a>)}
            <button data-action="compare" onClick={act(onCompare)}>⚖ Comparar jugadores</button>
            <button data-action="desktop" id="desktop-btn" hidden={desk.hidden} onClick={act(onDesktop)}>{desk.text}</button>
            <button data-action="install" onClick={act(onInstall)}>📲 Instalar la app</button>
          </div>
        </div>
        <a id="live" className={live.cls ? `live ${live.cls}` : 'live'} href={live.href} target="_blank" rel="noopener" title={live.title}><i /><span>{live.text}</span></a>
        <button id="refresh" className={spin ? 'nav-updated spin' : 'nav-updated'} title={refreshTitle} onClick={onRefresh}>
          <span className="rf-ico" aria-hidden="true">↻</span>{' '}<span id="updated">{updated}</span></button>
      </nav>
    </header>
  );
}
