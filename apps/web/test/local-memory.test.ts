// @vitest-environment jsdom
/* Memória local dos logs para o uso pelo endereço fixo (GitHub Pages, sem servidor):
 *  - hospedagem estática (VITE_STATIC=1) não pergunta /api/info na mesma origem;
 *  - reabrir a última sessão ao carregar o app (com/sem ?exemplo, id que não existe mais,
 *    opção desligada, outra biblioteca, servidor sem login);
 *  - "Guardar na biblioteca" a sessão aberta sem salvar: a sessão passa a ser da biblioteca
 *    sem reabrir o log; log repetido liga à que existe; sem espaço = mensagem clara.
 * Sem IndexedDB no jsdom: bibliotecas de mentira (só o que cada caso usa). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectLibrary } from '../src/library/detect';
import { LocalDuplicateError, LocalNotFoundError } from '../src/library/local';
import { ApiError, RemoteLibrary } from '../src/library/remote';
import {
  LocalQuotaError, QUOTA_MESSAGE, _resetPersistAsk, ensurePersisted, fmtBytes, isQuotaError, requestPersist, storageErrorMessage,
  storageStatus,
} from '../src/library/storage';
import type { Library, SessionMeta } from '../src/library/types';
import { DEFAULT_PREFS, usePrefs } from '../src/state/prefs';
import { libKeyOf, planReopen, reopenLastSession, type ReopenInput } from '../src/state/reopen';
import { useSessionStore } from '../src/state/session';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/core/test/fixtures');
const LOG_NAME = 'ft_log3_shocks_compact.csv';
const LOG = readFileSync(path.join(FIX, LOG_NAME), 'utf8');
const st = () => useSessionStore.getState();
const prefs = () => usePrefs.getState();

const metaOf = (id: string, name = 'ft_log3_shocks_compact'): SessionMeta => ({
  id, name, fileName: LOG_NAME, kind: 'FT', size: LOG.length, createdAt: '2026-10-06T12:00:00.000Z', tags: [],
});

/** Biblioteca de mentira: só os métodos usados nos testes (os outros falham alto). */
function fakeLib(mode: 'local' | 'remote', impl: Partial<Library> = {}): Library {
  const no = () => { throw new Error('não usado no teste'); };
  const base = {
    mode, listSessions: no, getSession: no, getSessionText: no, addSession: no, updateSession: no, deleteSession: no,
    listCars: async () => [], saveCar: no, deleteCar: no, listTracks: async () => [], saveTrack: no, deleteTrack: no,
  } as unknown as Library;
  return Object.assign(base, mode === 'remote' ? { baseUrl: 'https://srv.exemplo' } : {}, impl);
}

beforeEach(() => {
  usePrefs.getState().set({ ...DEFAULT_PREFS });
  st().close();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

/* ---------------------------------------------------------------- 1. hospedagem estática */
describe('detectLibrary na hospedagem estática (GitHub Pages)', () => {
  it('VITE_STATIC=1: biblioteca local sem perguntar /api/info na mesma origem', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('não devia chamar')));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubEnv('VITE_STATIC', '1');
    const d = await detectLibrary();
    expect(d.lib.mode).toBe('local');
    expect(d.info).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sem VITE_STATIC: pergunta /api/info na mesma origem e cai no local se não responder', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new TypeError('falhou')));
    vi.stubGlobal('fetch', fetchSpy);
    const d = await detectLibrary({ staticHost: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toBe('/api/info');
    expect(d.lib.mode).toBe('local');
  });

  it('estática, mas com servidor salvo em Preferências: usa o servidor', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ name: 'Baja', version: '1', needsSetup: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
    usePrefs.getState().set({ serverUrl: 'https://telemetria.equipe.br' });
    const d = await detectLibrary({ staticHost: true });
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toBe('https://telemetria.equipe.br/api/info');
    expect(d.lib).toBeInstanceOf(RemoteLibrary);
    expect(d.info?.name).toBe('Baja');
  });
});

/* ---------------------------------------------------------------- 2. reabrir: decisão */
describe('planReopen: reabrir a última sessão ao carregar o app', () => {
  const local = fakeLib('local');
  const remote = fakeLib('remote');
  const base: ReopenInput = {
    reopenLast: true, last: { id: 's1', lib: 'local' }, lib: local, libLoading: false, signedIn: false,
    sessionStatus: 'empty', wantsDemo: false,
  };

  it('nada aberto, biblioteca local pronta: reabre', () => {
    expect(planReopen(base)).toEqual({ action: 'open', id: 's1' });
  });
  it('?exemplo na URL: o exemplo ganha', () => {
    expect(planReopen({ ...base, wantsDemo: true })).toEqual({ action: 'skip' });
  });
  it('opção desligada em Preferências ou nenhuma sessão lembrada: não reabre', () => {
    expect(planReopen({ ...base, reopenLast: false })).toEqual({ action: 'skip' });
    expect(planReopen({ ...base, last: null })).toEqual({ action: 'skip' });
  });
  it('algo já aberto (ou abrindo): não troca', () => {
    expect(planReopen({ ...base, sessionStatus: 'loading' })).toEqual({ action: 'skip' });
    expect(planReopen({ ...base, sessionStatus: 'ready' })).toEqual({ action: 'skip' });
  });
  it('biblioteca ainda detectando: espera', () => {
    expect(planReopen({ ...base, libLoading: true })).toEqual({ action: 'wait' });
    expect(planReopen({ ...base, lib: null })).toEqual({ action: 'wait' });
  });
  it('id de outra biblioteca (local × servidor): não reabre', () => {
    expect(planReopen({ ...base, lib: remote, signedIn: true })).toEqual({ action: 'skip' });
  });
  it('servidor: só depois do login', () => {
    const last = { id: 'r9', lib: libKeyOf(remote) };
    expect(last.lib).toBe('remote:https://srv.exemplo');
    expect(planReopen({ ...base, last, lib: remote, signedIn: false })).toEqual({ action: 'wait' });
    expect(planReopen({ ...base, last, lib: remote, signedIn: true })).toEqual({ action: 'open', id: 'r9' });
  });
});

describe('reopenLastSession', () => {
  const deps = (empty = true) => ({ isEmpty: () => empty, openFromLibrary: vi.fn(async () => true) });

  it('sessão existe: abre em silêncio', async () => {
    const lib = fakeLib('local', { getSession: async (id: string) => metaOf(id) });
    const d = deps();
    expect(await reopenLastSession(lib, 's1', d)).toBe('opened');
    expect(d.openFromLibrary).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), lib, { silent: true });
  });

  it('sessão apagada (local ou 404 do servidor): esquece o id', async () => {
    usePrefs.getState().set({ lastSession: { id: 's1', lib: 'local' } });
    const lib = fakeLib('local', { getSession: async () => { throw new LocalNotFoundError(); } });
    const d = deps();
    expect(await reopenLastSession(lib, 's1', d)).toBe('missing');
    expect(prefs().lastSession).toBeNull();
    expect(d.openFromLibrary).not.toHaveBeenCalled();

    usePrefs.getState().set({ lastSession: { id: 'r1', lib: 'remote:https://srv.exemplo' } });
    const rem = fakeLib('remote', { getSession: async () => { throw new ApiError('Não encontrado', 404); } });
    expect(await reopenLastSession(rem, 'r1', deps())).toBe('missing');
    expect(prefs().lastSession).toBeNull();
  });

  it('servidor fora do ar: mantém o id para a próxima vez', async () => {
    usePrefs.getState().set({ lastSession: { id: 'r1', lib: 'remote:https://srv.exemplo' } });
    const rem = fakeLib('remote', { getSession: async () => { throw new ApiError('sem internet', 0); } });
    expect(await reopenLastSession(rem, 'r1', deps())).toBe('failed');
    expect(prefs().lastSession).toEqual({ id: 'r1', lib: 'remote:https://srv.exemplo' });
  });

  it('a pessoa abriu outra coisa enquanto esperava: não troca', async () => {
    const lib = fakeLib('local', { getSession: async (id: string) => metaOf(id) });
    const d = deps(false);
    expect(await reopenLastSession(lib, 's1', d)).toBe('skipped');
    expect(d.openFromLibrary).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------- 3. lembrar / esquecer pelo store */
describe('store da sessão: lembrar e esquecer a última sessão', () => {
  it('abrir da biblioteca lembra; fechar esquece', async () => {
    const lib = fakeLib('local', { getSessionText: async () => LOG });
    expect(await st().openFromLibrary(metaOf('s7'), lib)).toBe(true);
    expect(prefs().lastSession).toEqual({ id: 's7', lib: 'local' });
    expect(st().unsavedText).toBeNull();
    st().close();
    expect(prefs().lastSession).toBeNull();
  });

  it('fechar o exemplo (aberto pelo link ?exemplo=1) ou um log sem salvar não esquece a sessão lembrada', async () => {
    const lib = fakeLib('local', { getSessionText: async () => LOG });
    expect(await st().openFromLibrary(metaOf('s7'), lib)).toBe(true);
    expect(await st().openDemo()).toBe(true);
    st().close();
    expect(prefs().lastSession).toEqual({ id: 's7', lib: 'local' });
    expect(await st().openText(LOG, LOG_NAME)).toBe(true);
    st().close();
    expect(prefs().lastSession).toEqual({ id: 's7', lib: 'local' });
  });

  it('reabrir em silêncio que falha: volta a "nenhuma sessão", sem erro na tela', async () => {
    const lib = fakeLib('local', { getSessionText: async () => { throw new LocalNotFoundError('O arquivo desta sessão não está na biblioteca local'); } });
    expect(await st().openFromLibrary(metaOf('s8'), lib, { silent: true })).toBe(false);
    expect(st().status).toBe('empty');
    expect(st().error).toBeNull();
  });
});

/* ---------------------------------------------------------------- 4. guardar a sessão aberta */
describe('Guardar na biblioteca a sessão aberta sem salvar', () => {
  it('troca a origem para a biblioteca sem reabrir o log', async () => {
    expect(await st().openText(LOG, LOG_NAME)).toBe(true);
    expect(st().source?.type).toBe('text');
    expect(st().unsavedText).toBe(LOG);
    const S = st().S, ctx = st().ctx;
    const addSession = vi.fn(async (_input: unknown, meta?: Record<string, unknown>) => ({ ...metaOf('novo'), ...(meta?.summary ? { summary: meta.summary } : {}) }) as SessionMeta);
    const lib = fakeLib('local', { addSession: addSession as Library['addSession'] });

    const r = await st().saveToLibrary(lib);
    expect(r?.duplicate).toBe(false);
    expect(addSession).toHaveBeenCalledTimes(1);
    const [input, meta] = addSession.mock.calls[0] as [{ name: string; text: string }, Record<string, unknown>];
    expect(input).toEqual({ name: LOG_NAME, text: LOG });
    expect(meta.kind).toBe('FT');
    expect(meta.summary).toBeTruthy();        /* modo local: resumo calculado aqui */
    expect(st().source).toMatchObject({ type: 'library', libraryId: 'novo', name: 'ft_log3_shocks_compact' });
    expect(st().source?.meta?.id).toBe('novo');
    expect(st().unsavedText).toBeNull();
    expect(st().S).toBe(S);                   /* não reabriu nem recalculou */
    expect(st().ctx).toBe(ctx);
    expect(prefs().lastSession).toEqual({ id: 'novo', lib: 'local' });
    /* já é da biblioteca: nada a guardar */
    expect(await st().saveToLibrary(lib)).toBeNull();
  });

  it('log repetido: liga a sessão aberta à que já existe', async () => {
    expect(await st().openText(LOG, LOG_NAME)).toBe(true);
    const lib = fakeLib('local', {
      addSession: async () => { throw new LocalDuplicateError('Este log já está na biblioteca', 'velha'); },
      getSession: async (id: string) => metaOf(id, 'Treino de sábado'),
    });
    const r = await st().saveToLibrary(lib);
    expect(r).toMatchObject({ duplicate: true, meta: { id: 'velha' } });
    expect(st().source).toMatchObject({ type: 'library', libraryId: 'velha', name: 'Treino de sábado' });
    expect(prefs().lastSession).toEqual({ id: 'velha', lib: 'local' });
  });

  it('sem espaço no navegador: erro com mensagem clara e a sessão continua aberta para tentar de novo', async () => {
    expect(await st().openText(LOG, LOG_NAME)).toBe(true);
    const lib = fakeLib('local', { addSession: async () => { throw new DOMException('quota', 'QuotaExceededError'); } });
    let err: unknown = null;
    try { await st().saveToLibrary(lib); } catch (e) { err = e; }
    expect(isQuotaError(err)).toBe(true);
    expect(storageErrorMessage(err)).toBe(QUOTA_MESSAGE);
    expect(QUOTA_MESSAGE).toMatch(/espaço/);
    expect(QUOTA_MESSAGE).toMatch(/[Aa]pague sessões antigas/);
    expect(QUOTA_MESSAGE).toMatch(/backup/);
    expect(st().source?.type).toBe('text');
    expect(st().unsavedText).toBe(LOG);
    expect(prefs().lastSession).toBeNull();
  });

  it('dois botões "Guardar" clicados juntos (menu + aviso da Visão geral): guarda uma vez só', async () => {
    expect(await st().openText(LOG, LOG_NAME)).toBe(true);
    const addSession = vi.fn(async () => { await new Promise(r => setTimeout(r, 20)); return metaOf('uma'); });
    const lib = fakeLib('local', { addSession: addSession as Library['addSession'] });
    const p1 = st().saveToLibrary(lib);
    expect(st().savingToLibrary).toBe(true);         /* todos os botões mostram "guardando" */
    const p2 = st().saveToLibrary(lib);
    const [a, b] = await Promise.all([p1, p2]);
    expect(addSession).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(st().savingToLibrary).toBe(false);
    expect(st().source?.libraryId).toBe('uma');
  });

  it('fechar enquanto guarda: a sessão fica na biblioteca, mas não é lembrada', async () => {
    expect(await st().openText(LOG, LOG_NAME)).toBe(true);
    const lib = fakeLib('local', { addSession: (async () => { await new Promise(r => setTimeout(r, 20)); return metaOf('z'); }) as Library['addSession'] });
    const p = st().saveToLibrary(lib);
    st().close();
    expect((await p)?.meta.id).toBe('z');
    expect(prefs().lastSession).toBeNull();
    expect(st().source).toBeNull();
    expect(st().savingToLibrary).toBe(false);
  });

  it('outro log aberto enquanto o anterior guarda: os botões são do log novo e o guardar dele não espera', async () => {
    expect(await st().openText(LOG, LOG_NAME)).toBe(true);
    let n = 0;
    const addSession = vi.fn(async () => { await new Promise(r => setTimeout(r, 20)); return metaOf('n' + ++n); });
    const lib = fakeLib('local', { addSession: addSession as Library['addSession'] });
    const p1 = st().saveToLibrary(lib);
    expect(await st().openText(LOG, 'outro.csv')).toBe(true);
    expect(st().savingToLibrary).toBe(false);
    const p2 = st().saveToLibrary(lib);
    expect(st().savingToLibrary).toBe(true);
    await p1;
    expect(st().savingToLibrary).toBe(true);           /* o fim do 1º não apaga o "guardando" do 2º */
    await p2;
    expect(st().savingToLibrary).toBe(false);
    expect(addSession).toHaveBeenCalledTimes(2);
    expect(st().source?.libraryId).toBe('n2');
    expect(prefs().lastSession).toEqual({ id: 'n2', lib: 'local' });
  });

  it('o exemplo não vai para a biblioteca', async () => {
    expect(await st().openDemo()).toBe(true);
    expect(st().unsavedText).toBeNull();
    expect(await st().saveToLibrary(fakeLib('local'))).toBeNull();
  });
});

describe('espaço e proteção (navigator.storage)', () => {
  it('textos de tamanho: a unidade sai do valor arredondado', () => {
    expect([0, 1023, 1024, 1048575, 1048576, 27_000_000, 1073741823, 1073741824, 300e9].map(fmtBytes)).toEqual([
      '0 B', '1023 B', '1 kB', '1.0 MB', '1.0 MB', '25.7 MB', '1.0 GB', '1.0 GB', '279.4 GB',
    ]);
  });

  it('navegador sem navigator.storage (Safari antigo, http sem TLS): sem erro, "não informa"', async () => {
    vi.stubGlobal('navigator', {});
    expect(await storageStatus()).toEqual({ supported: false, persisted: null, usage: null, quota: null });
    expect(await requestPersist()).toBeNull();
  });

  it('persisted/estimate que falham e persist negado', async () => {
    vi.stubGlobal('navigator', { storage: {
      persisted: async () => { throw new Error('x'); },
      estimate: async () => { throw new Error('y'); },
      persist: async () => false,
    } });
    expect(await storageStatus()).toEqual({ supported: true, persisted: null, usage: null, quota: null });
    expect(await requestPersist()).toBe(false);
  });

  it('pede a proteção sozinho no máximo uma vez por carga da página', async () => {
    const persist = vi.fn(async () => false);
    vi.stubGlobal('navigator', { storage: { persisted: async () => false, persist } });
    _resetPersistAsk();
    await ensurePersisted();
    expect(await ensurePersisted()).toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
  });
});

describe('erros de falta de espaço', () => {
  it('reconhece os nomes e códigos dos navegadores', () => {
    expect(isQuotaError(new DOMException('x', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError(new LocalQuotaError())).toBe(true);
    expect(isQuotaError(new Error('outra coisa'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(storageErrorMessage(new Error('outra coisa'))).toBe('outra coisa');
    expect(new LocalQuotaError().message).toBe(QUOTA_MESSAGE);
  });
});
