// Ventanas (detalle de partida, explicaciones, comparador…): se añaden al final de <body> como antes
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ModalOpts } from '../ctx';

interface ModalItem extends ModalOpts { key: number; title: string; content: ReactNode }

export function useModals(): [ReactNode, (title: string, content: ReactNode, opts?: ModalOpts) => () => void] {
  const [items, setItems] = useState<ModalItem[]>([]);
  const seq = useRef(0);
  const closers = useRef(new Map<number, () => void>());

  const open = useCallback((title: string, content: ReactNode, opts: ModalOpts = {}) => {
    const key = ++seq.current;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      closers.current.delete(key);
      setItems((xs) => xs.filter((x) => x.key !== key));
      document.body.classList.remove('modal-open');
      // Si se abrió desde un enlace (#partida/… o #vs/…), al cerrar se limpia la dirección
      if (/^#(partida|vs)\//.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
      opts.onClose?.();
    };
    closers.current.set(key, close);
    document.body.classList.add('modal-open');
    setItems((xs) => [...xs, { ...opts, key, title, content }]);
    return close;
  }, []);

  // Escape cierra todas (cada ventana escuchaba su propia tecla)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') for (const c of [...closers.current.values()]) c(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const nodes = items.map((m) => {
    const close = () => closers.current.get(m.key)?.();
    return createPortal(
      <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div className={`modal-box ${m.wide ? '' : 'narrow'}`} role="dialog" aria-modal="true" aria-label={m.title}>
          <div className="modal-head">{m.head ?? <b>{m.title}</b>}<button className="modal-x" onClick={close} aria-label="Cerrar">×</button></div>
          {m.content}
        </div>
      </div>,
      document.body,
      String(m.key),
    );
  });
  return [nodes, open];
}
