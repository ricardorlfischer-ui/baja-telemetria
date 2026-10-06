/* Ligações entre a biblioteca (contexto React), os perfis e a sessão aberta:
 *  - LibrarySync: registra a biblioteca ativa para openFromLibrary e carrega os perfis de
 *    carro/pista dela (de novo quando a biblioteca muda ou alguém chama bump()). Também abre
 *    a sessão de exemplo quando a URL pede (?exemplo, ver wantsDemoFromUrl) e, sem isso,
 *    reabre a última sessão da biblioteca (state/reopen.ts) depois de carregar os perfis.
 *  - SessionSensorProvider: alimenta os chips dos sensores com sensorAvailability(ctx) da
 *    sessão aberta (verde/cinza/tracejado). Sem sessão: chips neutros (só o catálogo). */
import { useEffect, type ReactNode } from 'react';
import { useLibrary } from '../library/context';
import { SensorAvailabilityProvider } from '../components/SensorChips';
import { setSessionLibrary, useSessionStore } from './session';
import { useProfiles } from './profiles';
import { getPrefs } from './prefs';
import { planReopen, reopenLastSession } from './reopen';
import type { Library } from '../library/types';

/** A URL pede a sessão de exemplo? `?exemplo` (ou `?exemplo=1`) antes do # ou na rota
 *  (`#/canais?exemplo=1`). `exemplo=0`/`false` não pede. Para apresentar aos juízes e para
 *  as capturas de tela: o link já abre a página com os dados de exemplo carregados. */
export function wantsDemoFromUrl(loc: { search: string; hash: string }): boolean {
  const asks = (q: string) => {
    const v = new URLSearchParams(q).get('exemplo');
    return v !== null && v !== '0' && v.toLowerCase() !== 'false';
  };
  const i = loc.hash.indexOf('?');
  return asks(loc.search) || (i >= 0 && asks(loc.hash.slice(i + 1)));
}

/* uma vez por carga da página (o StrictMode roda os efeitos duas vezes em desenvolvimento) */
let demoFromUrlChecked = false;

/** Abre o exemplo ao carregar o app se a URL pedir e nada estiver aberto. */
function useDemoFromUrl(): void {
  useEffect(() => {
    if (demoFromUrlChecked || typeof window === 'undefined') return;
    demoFromUrlChecked = true;
    if (!wantsDemoFromUrl(window.location)) return;
    const st = useSessionStore.getState();
    if (st.status === 'empty') void st.openDemo();
  }, []);
}

/* também uma vez por carga da página */
let reopenChecked = false;

/** Reabre a última sessão da biblioteca, se for a hora (ver planReopen). */
function maybeReopen(lib: Library | null, libLoading: boolean, signedIn: boolean): void {
  if (reopenChecked || typeof window === 'undefined') return;
  const st = useSessionStore.getState();
  const prefs = getPrefs();
  const plan = planReopen({
    reopenLast: prefs.reopenLast, last: prefs.lastSession, lib, libLoading, signedIn,
    sessionStatus: st.status, wantsDemo: wantsDemoFromUrl(window.location),
  });
  if (plan.action === 'wait') return;
  reopenChecked = true;
  if (plan.action !== 'open' || !lib) return;
  void reopenLastSession(lib, plan.id, {
    isEmpty: () => useSessionStore.getState().status === 'empty',
    openFromLibrary: (meta, l, opts) => useSessionStore.getState().openFromLibrary(meta, l, opts),
  });
}

export function LibrarySync() {
  const { lib, version, user, loading } = useLibrary();
  /* servidor sem ninguém conectado: os perfis da equipe não aparecem (a API responderia 401);
   * entrar, sair ou trocar de conta carrega de novo */
  const signedOut = lib?.mode === 'remote' && !user;
  const uid = user?.id ?? null;
  useEffect(() => {
    setSessionLibrary(lib);
    if (loading) return;
    let alive = true;
    /* reabre depois dos perfis: openFromLibrary ativa o carro/pista da sessão se existirem */
    void useProfiles.getState().load(signedOut ? null : lib)
      .then(() => { if (alive) maybeReopen(lib, loading, !signedOut); });
    return () => { alive = false; };
  }, [lib, version, uid, signedOut, loading]);
  useDemoFromUrl();
  return null;
}

export function SessionSensorProvider({ children }: { children: ReactNode }) {
  const availability = useSessionStore(s => s.availability);
  return <SensorAvailabilityProvider value={availability}>{children}</SensorAvailabilityProvider>;
}
