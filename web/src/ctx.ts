// Contexto común: datos, modelo, partidas en curso y las ventanas
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Data, LiveGame } from './types';
import type { Player } from './lib/model';

export interface ModalOpts { wide?: boolean; onClose?: () => void; head?: ReactNode }

export interface AppApi {
  data: Data;
  model: Player[];
  live: LiveGame[];
  /** Ventana genérica. Devuelve la función para cerrarla. */
  openModal: (title: string, content: ReactNode, opts?: ModalOpts) => () => void;
  /** Ventana con el detalle de una partida */
  openMatchModal: (id: string, title: string, meRiotId?: string) => () => void;
  openCompare: (aName?: string, bName?: string) => void;
}

export const AppContext = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const v = useContext(AppContext);
  if (!v) throw new Error('Sin contexto de la app');
  return v;
}

/** Vuelve a pintar cada `ms` (minutos de las partidas en curso, "hace x min"…) */
export function useTick(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}
