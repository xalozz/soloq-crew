// Ventanas (detalle de partida, explicaciones, comparador…): <dialog> nativo abierto con showModal().
// El navegador se encarga del fondo inerte, del foco (lo encierra y lo devuelve al botón que la abrió), de Esc y
// del gesto de volver; closedby="any" añade cerrar tocando fuera. Se añaden al final de <body> como antes.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ModalOpts } from '../ctx';

interface ModalItem extends ModalOpts { key: number; title: string; content: ReactNode }

// ---------------------------------------------------------------- cierre animado donde falta soporte
// Chrome/Edge animan la salida solo con CSS (overlay + display con allow-discrete). Firefox y Safari no: ahí se
// marca data-closing para que corra la transición mientras sigue en la capa superior y después se cierra.
let displayTransition: boolean | undefined;
function canTransitionDisplay(): boolean {
  if (displayTransition !== undefined) return displayTransition;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) return (displayTransition = false);
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  void getComputedStyle(probe).display;
  probe.style.display = 'none';
  displayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return displayTransition;
}
const nativeExit = () => !!window.CSS?.supports?.('overlay', 'auto') && canTransitionDisplay();

const settle = async (el: Element) => {
  const anims = el.getAnimations({ subtree: true });
  if (anims.length) await Promise.race([Promise.allSettled(anims.map((a) => a.finished)), new Promise((r) => setTimeout(r, 1000))]);
};

async function closeAnimated(d: HTMLDialogElement): Promise<void> {
  if (!d.open || d.hasAttribute('data-closing')) return;
  if (!nativeExit()) {
    d.setAttribute('data-closing', '');
    await new Promise(requestAnimationFrame);
    await settle(d);
    if (!d.hasAttribute('data-closing')) return;
    d.removeAttribute('data-closing');
  }
  d.close();
}

const outside = (e: PointerEvent, d: HTMLDialogElement) => {
  const r = d.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
};

function Modal({ m, register, onClosed }: {
  m: ModalItem; register: (d: HTMLDialogElement | null) => void; onClosed: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;

  useEffect(() => {
    const d = ref.current!;
    register(d);
    if (!d.open) {
      d.showModal();
      // Foco inicial: el control principal si el contenido lo marca (data-autofocus); si no, el primero (la ×)
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    const onClose = () => closedRef.current();
    // Esc (y tocar fuera en Firefox) pasan por aquí: donde la salida no se anima sola, se anima a mano
    const onCancel = (e: Event) => { if (!nativeExit()) { e.preventDefault(); void closeAnimated(d); } };
    d.addEventListener('close', onClose);
    d.addEventListener('cancel', onCancel);
    // Safari no tiene closedby: se cierra si se pulsa y se suelta fuera del recuadro (no al acabar una selección fuera)
    let pressedOutside = false;
    const onDown = (e: PointerEvent) => { pressedOutside = e.target === d && outside(e, d); };
    const onUp = (e: PointerEvent) => { if (pressedOutside && outside(e, d)) void closeAnimated(d); };
    const fallback = !('closedBy' in HTMLDialogElement.prototype);
    if (fallback) { d.addEventListener('pointerdown', onDown); d.addEventListener('pointerup', onUp); }
    return () => {
      register(null);
      d.removeEventListener('close', onClose);
      d.removeEventListener('cancel', onCancel);
      if (fallback) { d.removeEventListener('pointerdown', onDown); d.removeEventListener('pointerup', onUp); }
    };
  }, [register]);

  return (
    <dialog ref={ref} className={`modal modal-box ${m.wide ? '' : 'narrow'}`} closedby="any" aria-labelledby={titleId}>
      <div className="modal-head">
        {m.head ? <span id={titleId} className="modal-title">{m.head}</span> : <b id={titleId}>{m.title}</b>}
        <button className="modal-x" onClick={() => { void closeAnimated(ref.current!); }} aria-label="Cerrar">×</button>
      </div>
      {m.content}
    </dialog>
  );
}

export function useModals(): [ReactNode, (title: string, content: ReactNode, opts?: ModalOpts) => () => void] {
  const [items, setItems] = useState<ModalItem[]>([]);
  const seq = useRef(0);
  const dialogs = useRef(new Map<number, HTMLDialogElement>());
  const done = useRef(new Set<number>());
  const registers = useRef(new Map<number, (d: HTMLDialogElement | null) => void>());

  // Se cerró (×, Esc, tocar fuera o desde el código): se limpia la dirección y se quita cuando acaba la animación
  const closed = useCallback((key: number, opts: ModalOpts) => {
    if (done.current.has(key)) return;
    done.current.add(key);
    // Si se abrió desde un enlace (#partida/… o #vs/…), al cerrar se limpia la dirección
    if (/^#(partida|vs)\//.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    opts.onClose?.();
    const d = dialogs.current.get(key);
    void (async () => {
      if (d) { await new Promise(requestAnimationFrame); await settle(d); }
      setItems((xs) => xs.filter((x) => x.key !== key));
      done.current.delete(key);
      registers.current.delete(key);
    })();
  }, []);

  const open = useCallback((title: string, content: ReactNode, opts: ModalOpts = {}) => {
    const key = ++seq.current;
    registers.current.set(key, (d) => { if (d) dialogs.current.set(key, d); else dialogs.current.delete(key); });
    setItems((xs) => [...xs, { ...opts, key, title, content }]);
    return () => {
      const d = dialogs.current.get(key);
      if (d) void closeAnimated(d); else closed(key, opts);
    };
  }, [closed]);

  const nodes = items.map((m) => createPortal(
    <Modal m={m} register={registers.current.get(m.key)!} onClosed={() => closed(m.key, m)} />,
    document.body,
    String(m.key),
  ));
  return [nodes, open];
}
