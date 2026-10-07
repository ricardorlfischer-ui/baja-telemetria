// @vitest-environment jsdom
/* Modo "este computador" (servidor com LOCAL_MODE na mesma origem, docs/ARQUITETURA.md 5.4;
 * o atalho da área de trabalho, docs/NO-MEU-PC.md):
 *  - detecção: /api/info com localMode → biblioteca do servidor na mesma origem, sem token,
 *    com o usuário de info.user já "logado" (ganha até de um servidor salvo em Preferências);
 *  - nada de login: sem Authorization, 401 não derruba nada, #/login volta para #/;
 *  - Equipe e Preferências condicionais (pasta dos logs, sem proteção do armazenamento do
 *    navegador), selo "Este computador", aviso da página Sessões;
 *  - reabrir a última sessão ao abrir o app (abrir o atalho e continuar de onde parou).
 * Servidor de mentira: fetch trocado por um roteador com as rotas que o app usa. */
import './dom-shim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { detectLibrary } from '../src/library/detect';
import { RemoteLibrary, getToken, setToken } from '../src/library/remote';
import { LibraryProvider, useLibrary } from '../src/library/context';
import type { SessionMeta, User } from '../src/library/types';
import { DEFAULT_PREFS, usePrefs } from '../src/state/prefs';
import { useSessionStore } from '../src/state/session';
import { LibrarySync } from '../src/state/SessionSync';
import { LibraryBadge } from '../src/layout/HeaderParts';
import { PcServerLost } from '../src/layout/PcServerLost';
import { NavMenu } from '../src/layout/NavMenu';
import LoginPage from '../src/pages/LoginPage';
import EquipePage from '../src/pages/EquipePage';
import PreferenciasPage from '../src/pages/PreferenciasPage';
import SessoesPage from '../src/pages/SessoesPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/core/test/fixtures');
const LOG_NAME = 'ft_log3_shocks_compact.csv';
const LOG = readFileSync(path.join(FIX, LOG_NAME), 'utf8');

const DATA_DIR = 'C:\\Users\\piloto\\baja-telemetria\\data';
const PC_USER: User = { id: 'u-local', name: 'Piloto', email: 'local@este.computador', role: 'admin' };
const PC_INFO = { name: 'Telemetria Baja', version: '0.1.0', needsSetup: false, localMode: true, dataDir: DATA_DIR, user: PC_USER };
const TEAM_INFO = { name: 'Telemetria Baja', version: '0.1.0', needsSetup: false };
const META: SessionMeta = {
  id: 's-1', name: 'Log 3 — teste de suspensão', fileName: LOG_NAME, kind: 'FT', size: LOG.length,
  createdAt: '2026-10-05T19:44:00.000Z', date: '2026-10-05T16:44', tags: [], uploadedBy: 'Piloto', uploadedById: 'u-local',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Call { url: string; method: string; auth: string | undefined }

/** Servidor deste computador de mentira (ou o da equipe, com `info`). Guarda os pedidos. */
function fakeServer(info: object = PC_INFO, sessions: SessionMeta[] = [META]) {
  const calls: Call[] = [];
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    calls.push({ url, method, auth });
    const p = url.replace(/^https?:\/\/[^/]+/, '');
    if (p === '/api/info') return json(200, info);
    if (/^\/api\/(auth\/(login|setup|register|password)|users|invites)/.test(p)) {
      return json(404, { error: 'No modo local não há contas: o app usa o usuário deste computador.' });
    }
    if (p === '/api/auth/me') return json(200, { user: PC_USER });
    if (p === '/api/cars' || p === '/api/tracks') return json(200, []);
    if (p.startsWith('/api/sessions?') || p === '/api/sessions') return json(200, sessions);
    const m = /^\/api\/sessions\/([^/]+)(\/file|\/comments)?$/.exec(p);
    if (m) {
      const s = sessions.find(x => x.id === decodeURIComponent(m[1]));
      if (!s) return json(404, { error: 'Sessão não encontrada' });
      if (m[2] === '/file') return new Response(LOG, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      if (m[2] === '/comments') return json(200, []);
      return json(200, s);
    }
    return json(404, { error: 'rota desconhecida no teste: ' + p });
  });
  vi.stubGlobal('fetch', f);
  return { calls, fetch: f };
}

const flush = async (n = 8) => {
  for (let k = 0; k < n; k++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};
async function until(cond: () => boolean, ms = 4000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('tempo esgotado esperando a condição');
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
  }
}

let root: Root, host: HTMLDivElement;
let lib: ReturnType<typeof useLibrary> | null = null;
function Grab() { lib = useLibrary(); return null; }
function Where() { const l = useLocation(); return <i data-testid="where">{l.pathname}</i>; }

function mount(ui: ReactNode, at = '/') {
  return act(async () => {
    root.render(
      <MantineProvider defaultColorScheme="dark">
        <LibraryProvider>
          <Grab />
          <MemoryRouter initialEntries={[at]}>
            <Where />
            {ui}
          </MemoryRouter>
        </LibraryProvider>
      </MantineProvider>,
    );
  });
}
const text = () => host.textContent ?? '';
const where = () => host.querySelector('[data-testid="where"]')?.textContent;

beforeEach(() => {
  usePrefs.getState().set({ ...DEFAULT_PREFS });
  useSessionStore.getState().close();
  setToken(null);
  lib = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setToken(null);
});

/* ---------------------------------------------------------------- 1. detecção */
describe('detecção do modo este computador', () => {
  it('/api/info com localMode: biblioteca do servidor na mesma origem, sem token', async () => {
    fakeServer();
    const d = await detectLibrary({ staticHost: false });
    expect(d.lib).toBeInstanceOf(RemoteLibrary);
    const r = d.lib as RemoteLibrary;
    expect(r.baseUrl).toBe('');
    expect(r.localMode).toBe(true);
    expect(r.loggedIn).toBe(true);
    expect(d.info?.dataDir).toBe(DATA_DIR);
  });

  it('ganha de um servidor salvo em Preferências (o app foi aberto pelo servidor deste PC)', async () => {
    const { calls } = fakeServer();
    usePrefs.getState().set({ serverUrl: 'https://telemetria.equipe.br' });
    const d = await detectLibrary({ staticHost: false });
    expect(calls.map(c => c.url)).toContain('/api/info');
    expect((d.lib as RemoteLibrary).baseUrl).toBe('');
    expect((d.lib as RemoteLibrary).localMode).toBe(true);
    expect(d.offline).toBeFalsy();
  });

  it('servidor da equipe na mesma origem (sem localMode): continua o modo servidor, com login', async () => {
    fakeServer(TEAM_INFO);
    const d = await detectLibrary({ staticHost: false });
    expect((d.lib as RemoteLibrary).localMode).toBe(false);
    expect((d.lib as RemoteLibrary).loggedIn).toBe(false);
  });

  it('sem Authorization nos pedidos e 401 não derruba nada (nem chama onUnauthorized)', async () => {
    setToken('token-velho-do-modo-equipe');
    const lost: string[] = [];
    const r = new RemoteLibrary('');
    r.localMode = true;
    r.onUnauthorized = m => { lost.push(m); };
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
      return json(401, { error: 'qualquer' });
    });
    vi.stubGlobal('fetch', f);
    await expect(r.listSessions()).rejects.toMatchObject({ status: 401 });
    expect(lost).toEqual([]);
    expect(getToken()).toBe('token-velho-do-modo-equipe');
    r.logout();
    expect(getToken()).toBe('token-velho-do-modo-equipe');
  });

  it('LibraryProvider: usuário de info.user já conectado, pc e a pasta dos dados', async () => {
    const { calls } = fakeServer();
    await mount(null);
    await until(() => !!lib && !lib.loading);
    expect(lib!.pc).toBe(true);
    expect(lib!.mode).toBe('remote');
    expect(lib!.user).toEqual(PC_USER);
    expect(lib!.dataDir).toBe(DATA_DIR);
    /* sair e "perder a conta" não existem neste modo */
    act(() => { lib!.logout(); lib!.setUser(null); });
    expect(lib!.user).toEqual(PC_USER);
    expect(calls.every(c => c.auth === undefined)).toBe(true);
  });
});

/* ---------------------------------------------------------------- servidor do PC parou */
describe('o servidor deste computador parou com o app aberto', () => {
  it('pedido sem resposta: mensagem do atalho, aviso fixo e selo "Servidor parado"; quando volta, some e recarrega as listas', async () => {
    const srv = fakeServer();
    let down = false;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (down) throw new TypeError('Failed to fetch');
      return srv.fetch(input, init);
    }));
    await mount(<><LibraryBadge /><PcServerLost /></>);
    await until(() => !!lib?.pc && !lib.loading);
    expect(text()).toContain('Este computador');
    expect(text()).not.toContain('O servidor da telemetria parou');

    down = true;
    await expect(lib!.lib!.listSessions()).rejects.toThrow(/atalho da telemetria/);
    await until(() => text().includes('O servidor da telemetria parou'));
    expect(lib!.offline).toBe(true);
    expect(text()).toContain('Servidor parado');
    expect(text()).toContain(DATA_DIR);
    expect(text()).toContain('Tentar agora');

    const v = lib!.version;
    down = false;
    act(() => { lib!.recheck(); });
    await until(() => !lib!.offline);
    expect(text()).not.toContain('O servidor da telemetria parou');
    expect(text()).toContain('Este computador');
    expect(lib!.version).toBeGreaterThan(v);
  });

  it('Sessões: com o servidor parado, enviar logs explica o atalho (não "servidor da equipe")', async () => {
    const srv = fakeServer();
    let down = false;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (down) throw new TypeError('Failed to fetch');
      return srv.fetch(input, init);
    }));
    await mount(<SessoesPage />);
    await until(() => !!lib?.pc && !lib.loading && text().includes(META.name));
    down = true;
    await expect(lib!.lib!.listCars()).rejects.toThrow();
    await until(() => !!lib?.offline);
    await flush();
    expect(text()).toContain('clique de novo no atalho da telemetria para enviar logs');
    expect(text()).not.toContain('servidor da equipe');
  });
});

/* ---------------------------------------------------------------- 2. interface sem login */
describe('interface no modo este computador', () => {
  it('selo "Este computador" com a pasta na dica; nada de "entrar"', async () => {
    fakeServer();
    await mount(<LibraryBadge />);
    await until(() => text().includes('Este computador'));
    expect(text()).not.toMatch(/entrar|Servidor ·/i);
  });

  it('#/login volta para #/', async () => {
    fakeServer();
    await mount(<Routes><Route path="/login" element={<LoginPage />} /><Route path="/" element={<b>inicio</b>} /></Routes>, '/login');
    await until(() => where() === '/');
    expect(text()).toContain('inicio');
    expect(text()).not.toMatch(/senha/i);
  });

  it('menu: Equipe desabilitada; página Equipe explica que não há equipe neste modo', async () => {
    fakeServer();
    await mount(<><NavMenu /><EquipePage /></>, '/equipe');
    await until(() => text().includes('Sem equipe neste modo'));
    expect(text()).toContain('Neste modo o app é só deste computador; para a equipe usar junto, ver docs/IMPLANTACAO.md');
    expect(text()).not.toMatch(/Entrar|Criar convite|trocar a senha|Usuários/);
    const link = [...host.querySelectorAll('a')].find(a => a.textContent === 'Equipe');
    expect(link?.getAttribute('data-disabled') ?? link?.getAttribute('aria-disabled')).toBeTruthy();
  });

  it('Preferências: "Onde ficam os logs" com a pasta; sem servidor da equipe, conta, sair nem proteção do navegador', async () => {
    fakeServer();
    await mount(<PreferenciasPage />, '/config');
    await until(() => text().includes('Onde ficam os logs'));
    expect(host.querySelector('[data-testid="pc-data-dir"]')?.textContent).toBe(DATA_DIR);
    expect(text()).toContain('Copiar');
    expect(text()).toContain('com o app fechado');
    expect(text()).toContain('docs/NO-MEU-PC.md');
    expect(text()).not.toContain('Servidor da equipe');
    expect(text()).not.toMatch(/\bSair\b|Entrar|Proteger os logs|Armazenamento/);
    /* reabrir ao abrir o app continua lá */
    expect(text()).toContain('Reabrir a última sessão ao abrir o app');
  });

  it('Preferências no servidor da equipe (sem localMode): seção do servidor como antes', async () => {
    fakeServer(TEAM_INFO);
    await mount(<PreferenciasPage />, '/config');
    await until(() => text().includes('Servidor da equipe'));
    expect(text()).not.toContain('Onde ficam os logs');
  });

  it('Sessões: aviso da biblioteca deste computador com a pasta, sem "entrar" e sem o aviso de limpar o navegador', async () => {
    fakeServer();
    await mount(<SessoesPage />, '/');
    await until(() => text().includes('Biblioteca deste computador — os logs ficam em'));
    expect(text()).toContain(DATA_DIR);
    await until(() => text().includes(META.name));
    expect(text()).toContain('Sessões deste computador');
    expect(text()).not.toMatch(/Entrar|dados do site|Proteger os logs/);
  });
});

/* ---------------------------------------------------------------- 3. reabrir */
describe('reabrir a última sessão no modo este computador', () => {
  it('abrir da biblioteca deste computador lembra a sessão', async () => {
    fakeServer();
    const r = (await detectLibrary({ staticHost: false })).lib;
    expect(await useSessionStore.getState().openFromLibrary(META, r, { silent: true })).toBe(true);
    expect(usePrefs.getState().lastSession).toEqual({ id: META.id, lib: 'remote:' });
  });

  it('abrir o app de novo (atalho): reabre a mesma sessão sozinho, sem login', async () => {
    usePrefs.getState().set({ lastSession: { id: META.id, lib: 'remote:' } });
    const { calls } = fakeServer();
    await mount(<LibrarySync />);
    await until(() => useSessionStore.getState().status === 'ready');
    expect(useSessionStore.getState().source?.libraryId).toBe(META.id);
    expect(calls.some(c => c.url === `/api/sessions/${META.id}/file`)).toBe(true);
    expect(calls.every(c => c.auth === undefined)).toBe(true);
    expect(calls.some(c => /\/api\/auth\/login/.test(c.url))).toBe(false);
    await flush();
  });
});

/* ---------------------------------------------------------------- 4. backup na pasta do computador */
describe('Backup no modo este computador', () => {
  it('importar um backup do navegador: perfis ganham id do servidor, sessões apontam para eles, log repetido (409) é pulado', async () => {
    const { importBackup, BACKUP_FORMAT, BACKUP_VERSION } = await import('../src/pages/config/backup');
    const { ApiError } = await import('../src/library/remote');
    const added: { name: string; carId?: string; trackId?: string; summary?: unknown }[] = [];
    const lib = {
      mode: 'remote' as const,
      listCars: async () => [], listTracks: async () => [{ id: 't-servidor', name: 'Mauá', params: {} }],
      saveCar: async (p: { id?: string; name: string }) => { expect(p.id).toBeUndefined(); return { ...p, id: 'c-servidor', params: {} }; },
      saveTrack: async (p: { id?: string; name: string }) => ({ ...p, id: p.id ?? 't-novo', params: {} }),
      listSessions: async () => [],
      addSession: async (f: { name: string }, m: { carId?: string; trackId?: string; summary?: unknown }) => {
        if (added.length === 1) throw new ApiError('Este log já está na biblioteca', 409, { id: 'x' });
        added.push({ name: f.name, carId: m.carId, trackId: m.trackId, summary: m.summary });
        return { ...META, id: 'novo' };
      },
      addComment: async () => ({}),
    } as unknown as import('../src/library/types').Library;
    const sess = (name: string) => ({ meta: { ...META, fileName: name, carId: 'c-nav', trackId: 't-servidor', summary: { v: 1 } as never }, text: LOG, comments: [] });
    const r = await importBackup({
      format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: '2026-10-06T00:00:00Z', app: '0.1.0',
      cars: [{ id: 'c-nav', name: 'BJ26', params: {} }], tracks: [],
      sessions: [sess('a.csv'), sess('b.csv')],
    }, { profiles: true, sessions: true, config: false }, undefined, lib);
    expect(r).toMatchObject({ cars: 1, sessions: 1, skipped: 1 });
    expect(added[0]).toEqual({ name: 'a.csv', carId: 'c-servidor', trackId: 't-servidor', summary: undefined });
  });
});
