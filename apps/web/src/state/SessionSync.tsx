/* Ligações entre a biblioteca (contexto React), os perfis e a sessão aberta:
 *  - LibrarySync: registra a biblioteca ativa para openFromLibrary e carrega os perfis de
 *    carro/pista dela (de novo quando a biblioteca muda ou alguém chama bump()). Também abre
 *    a sessão de exemplo quando a URL pede (?exemplo, ver wantsDemoFromUrl).
 *  - SessionSensorProvider: alimenta os chips dos sensores com sensorAvailability(ctx) da
 *    sessão aberta (verde/cinza/tracejado). Sem sessão: chips neutros (só o catálogo). */
import { useEffect, type ReactNode } from 'react';
import { useLibrary } from '../library/context';
import { SensorAvailabilityProvider } from '../components/SensorChips';
import { setSessionLibrary, useSessionStore } from './session';
import { useProfiles } from './profiles';

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

export function LibrarySync() {
  const { lib, version, user, loading } = useLibrary();
  /* servidor sem ninguém conectado: os perfis da equipe não aparecem (a API responderia 401);
   * entrar, sair ou trocar de conta carrega de novo */
  const signedOut = lib?.mode === 'remote' && !user;
  const uid = user?.id ?? null;
  useEffect(() => {
    setSessionLibrary(lib);
    if (loading) return;
    void useProfiles.getState().load(signedOut ? null : lib);
  }, [lib, version, uid, signedOut, loading]);
  useDemoFromUrl();
  return null;
}

export function SessionSensorProvider({ children }: { children: ReactNode }) {
  const availability = useSessionStore(s => s.availability);
  return <SensorAvailabilityProvider value={availability}>{children}</SensorAvailabilityProvider>;
}
