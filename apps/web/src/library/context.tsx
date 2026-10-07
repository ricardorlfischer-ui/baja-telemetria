/* Contexto da biblioteca ativa: useLibrary() dá a biblioteca (local ou remota), o usuário
 * conectado (remoto), as informações do servidor e ações para trocar/atualizar.
 *
 * Modo "este computador" (`pc`, servidor com LOCAL_MODE na mesma origem, ARQUITETURA 5.4):
 * a biblioteca é a do servidor (mode 'remote'), mas sem contas: o usuário é o de
 * /api/info (info.user), já "logado" desde a detecção, sem token, sem tela de login e sem
 * "você saiu" (logout e setUser(null) não fazem nada). `dataDir` = pasta dos logs no disco.
 * O servidor roda escondido no PC e pode parar com o app aberto (parar-telemetria, fechou,
 * PC dormiu): um pedido que não chega a ele liga `offline` (o app mostra "o servidor parou");
 * enquanto isso pergunta /api/info a cada 3 s e, quando ele volta, desliga `offline` e recarrega
 * as listas (`bump`). Com a janela visível confere também a cada 15 s, para avisar mesmo com o
 * app parado numa página. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { notifications } from '@mantine/notifications';
import { detectLibrary } from './detect';
import { RemoteLibrary } from './remote';
import { LocalLibrary } from './local';
import type { Library, ServerInfo, User } from './types';

export interface LibraryState {
  /** null enquanto detecta */
  lib: Library | null;
  mode: 'local' | 'remote' | null;
  loading: boolean;
  info: ServerInfo | null;
  /** servidor salvo nas preferências, mas sem resposta; no modo este computador: o servidor
   *  do PC parou de responder (volta a false sozinho quando ele volta) */
  offline: boolean;
  /** usuário conectado (só remoto) */
  user: User | null;
  /** cliente remoto (para login/equipe), null no modo local */
  remote: RemoteLibrary | null;
  /** modo "este computador": servidor deste PC (LOCAL_MODE), sem contas */
  pc: boolean;
  /** pasta dos dados no disco (só no modo este computador) */
  dataDir: string | null;
  setUser: (u: User | null) => void;
  /** detecta de novo (depois de mudar o servidor nas preferências) */
  redetect: () => Promise<void>;
  /** este computador: pergunta agora se o servidor do PC voltou (botão "Tentar agora") */
  recheck: () => void;
  /** sai da conta (remoto) */
  logout: () => void;
  /** incrementa quando a lista de sessões/perfis mudou (para recarregar listas) */
  version: number;
  bump: () => void;
}

const Ctx = createContext<LibraryState | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [lib, setLib] = useState<Library | null>(null);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [offline, setOffline] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  /* o servidor recusou o token (venceu, senha trocada, usuário desativado): volta ao login e
   * diz o motivo — sem isso a pessoa só via "entrar" de repente, sem saber por quê */
  const lostAuth = useCallback((message: string) => {
    setUser(null);
    notifications.show({
      id: 'baja-auth-lost', color: 'yellow', autoClose: 10_000,
      title: 'Você saiu do servidor da equipe', message,
    });
  }, []);

  const redetect = useCallback(async () => {
    setLoading(true);
    try {
      const d = await detectLibrary();
      const pc = d.lib instanceof RemoteLibrary && d.lib.localMode;
      if (d.lib instanceof RemoteLibrary && !pc) d.lib.onUnauthorized = lostAuth;
      setLib(d.lib); setInfo(d.info); setOffline(!!d.offline);
      setUser(null);
      if (pc) {
        /* este computador: o usuário vem no /api/info; sem ele (servidor de outra versão), /auth/me */
        let u = d.info?.user ?? null;
        if (!u) { try { u = await (d.lib as RemoteLibrary).me(); } catch { /* fica o genérico */ } }
        setUser(u ?? { id: 'local', name: 'Este computador', email: '', role: 'admin' });
      } else if (d.lib instanceof RemoteLibrary && d.info && d.lib.loggedIn) {
        try { setUser(await d.lib.me()); } catch { /* token vencido: fica deslogado */ }
      }
    } catch {
      setLib(new LocalLibrary()); setInfo(null); setOffline(false);
    } finally {
      setLoading(false);
    }
  }, [lostAuth]);

  useEffect(() => { void redetect(); }, [redetect]);

  /* 401 do servidor: limpa o usuário e avisa (no modo este computador não há 401 de conta) */
  useEffect(() => {
    if (lib instanceof RemoteLibrary && !lib.localMode) lib.onUnauthorized = lostAuth;
  }, [lib, lostAuth]);

  /* este computador: o servidor do PC parou? (ver o comentário do topo) */
  const recheckRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!(lib instanceof RemoteLibrary) || !lib.localMode) return;
    const r = lib;
    let alive = true;
    let lost = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /* force: pergunta mesmo com a janela escondida (algo acabou de falhar, ou "Tentar agora") */
    const schedule = (ms: number, force = false) => { clearTimeout(timer); timer = setTimeout(() => { void check(force); }, ms); };
    const check = async (force: boolean) => {
      if (!alive) return;
      /* janela escondida e servidor no ar: não pergunta (volta a perguntar ao aparecer) */
      if (force || lost || typeof document === 'undefined' || !document.hidden) {
        try { await r.info(); } catch { /* onConnection já marcou */ }
      }
      if (alive) schedule(lost ? 3000 : 15_000);
    };
    const onConnection = (ok: boolean) => {
      if (!alive || ok === !lost) return;   // nada mudou
      lost = !ok;
      setOffline(lost);
      if (lost) { schedule(3000); return; }
      /* voltou: listas e perfis de novo (podem ter mudado com o servidor parado) */
      setVersion(v => v + 1);
      void r.info().then(i => { if (alive && i?.localMode) setInfo(i); }).catch(() => {});
      notifications.show({
        id: 'baja-pc-back', color: 'green', autoClose: 5000,
        title: 'O servidor da telemetria voltou', message: 'Tudo o que está na pasta de dados aparece de novo.',
      });
    };
    r.onConnection = onConnection;
    const onVisible = () => { if (!document.hidden) schedule(0); };
    document.addEventListener('visibilitychange', onVisible);
    recheckRef.current = () => schedule(0, true);
    schedule(15_000);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      if (r.onConnection === onConnection) r.onConnection = null;
      recheckRef.current = () => {};
    };
  }, [lib]);
  const recheck = useCallback(() => recheckRef.current(), []);

  const pc = lib instanceof RemoteLibrary && lib.localMode;
  const value = useMemo<LibraryState>(() => ({
    lib,
    mode: lib ? lib.mode : null,
    loading,
    info,
    offline,
    user,
    remote: lib instanceof RemoteLibrary ? lib : null,
    pc,
    dataDir: pc ? info?.dataDir ?? null : null,
    /* este computador: o usuário não sai */
    setUser: (u: User | null) => { if (!pc || u) setUser(u); },
    redetect,
    recheck,
    logout: () => { if (pc) return; if (lib instanceof RemoteLibrary) lib.logout(); setUser(null); },
    version,
    bump: () => setVersion(v => v + 1),
  }), [lib, pc, loading, info, offline, user, redetect, recheck, version]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Igual a useLibrary, mas null fora do LibraryProvider (peças que também aparecem sozinhas). */
export function useLibraryMaybe(): LibraryState | null {
  return useContext(Ctx);
}

export function useLibrary(): LibraryState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLibrary fora do LibraryProvider');
  return v;
}
