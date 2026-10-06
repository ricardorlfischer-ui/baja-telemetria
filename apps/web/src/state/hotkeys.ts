/* Atalhos globais do play (docs/ARQUITETURA.md 4.2), iguais aos do app antigo:
 *   espaço = play/pausa · ← → = uma amostra (Shift = 1 s) · Home/End = começo/fim do trecho
 * Só valem nas páginas com a barra de reprodução (rotas com `player`): nas outras o espaço,
 * Home e End rolam a página como sempre, em vez de mexer num play que nem aparece.
 * Ignorados em campos de texto, seletores e diálogos (o card de explicação aberto, por ex.). */
import { useEffect } from 'react';
import { routeByPath } from '../routes';
import { useSessionStore } from './session';

const IGNORE = 'input,select,textarea,dialog,[contenteditable=""],[contenteditable="true"],[role="dialog"],[role="slider"]:not(.bt-scrub),[role="combobox"],[role="listbox"],[role="menu"]';

/** Caminho da rota do HashRouter (#/canais?x=1 → /canais). */
export const hashPath = (hash: string): string => {
  const p = hash.replace(/^#/, '').split('?')[0].replace(/\/+$/, '');
  return p ? (p.startsWith('/') ? p : '/' + p) : '/';
};

/** A página aberta tem a barra de reprodução? */
const onPlayerPage = (): boolean => !!routeByPath(hashPath(window.location.hash))?.player;

/** Liga os atalhos globais (use uma vez, no AppLayout). */
export function useSessionHotkeys(): void {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as Element | null;
      /* tecla já usada por um elemento da página (ex.: espaço numa linha da lista de canais,
       * que mostra/oculta o canal): não vira play/pausa também */
      if (e.defaultPrevented) return;
      if ((el && el.closest && el.closest(IGNORE)) || e.ctrlKey || e.metaKey || e.altKey) return;
      const st = useSessionStore.getState();
      const S = st.S;
      if (!S || st.status !== 'ready' || !onPlayerPage()) return;
      const dt = S.t.length > 1 ? S.t[1] - S.t[0] : 0.04;
      /* trecho do play: volta selecionada ou sessão inteira (playBounds do antigo) */
      const l = st.selLap >= 0 && st.ctx ? st.ctx.laps[st.selLap] : undefined;
      const a = l ? l.t0 : S.t[0], b = l ? l.t1 : S.t[S.t.length - 1];
      if (e.code === 'Space') { e.preventDefault(); st.togglePlay(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); st.seek(st.cursor + (e.shiftKey ? 1 : dt)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); st.seek(st.cursor - (e.shiftKey ? 1 : dt)); }
      else if (e.key === 'Home') { e.preventDefault(); st.seek(a); }
      else if (e.key === 'End') { e.preventDefault(); st.seek(b); }
    };
    /* espaço num botão focado não deve "clicar" de novo depois do play/pausa */
    const up = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.code === 'Space' && el && el.tagName === 'BUTTON' && !el.closest(IGNORE) && useSessionStore.getState().S && onPlayerPage()) e.preventDefault();
    };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); };
  }, []);
}
