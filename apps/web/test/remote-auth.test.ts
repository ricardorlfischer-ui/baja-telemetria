// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference types="vite/client" />
/* Cliente do servidor da equipe (library/remote.ts): o que acontece quando o servidor recusa o
 * token. Achado no teste de ponta a ponta do modo servidor: o login com senha errada (401) com
 * um token antigo guardado derrubava a conta, e quem era desativado só via "entrar" sem saber
 * por quê. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteLibrary, getToken, setToken } from '../src/library/remote';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('RemoteLibrary e o 401', () => {
  let lib: RemoteLibrary;
  let lost: string[];

  beforeEach(() => {
    lib = new RemoteLibrary('http://servidor.test');
    lost = [];
    lib.onUnauthorized = m => { lost.push(m); };
    setToken('token-velho');
  });
  afterEach(() => { vi.unstubAllGlobals(); setToken(null); });

  it('pedido com token recusado: esquece o token e avisa com a mensagem do servidor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'Usuário desativado: fale com um administrador' })));
    await expect(lib.listSessions()).rejects.toMatchObject({ status: 401, message: 'Usuário desativado: fale com um administrador' });
    expect(getToken()).toBeNull();
    expect(lost).toEqual(['Usuário desativado: fale com um administrador']);
  });

  it('login com senha errada (pedido sem token) não derruba a conta guardada', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
      return json(401, { error: 'E-mail ou senha incorretos' });
    });
    vi.stubGlobal('fetch', f);
    await expect(lib.login('a@b.test', 'errada')).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBe('token-velho');
    expect(lost).toEqual([]);
  });

  it('401 de um pedido antigo não apaga o token de um login feito no meio', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { setToken('token-novo'); return json(401, { error: 'Sessão inválida: entre de novo' }); }));
    await expect(lib.listCars()).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBe('token-novo');
    expect(lost).toEqual([]);
  });

  it('troca de senha guarda o token novo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { token: 'token-da-senha-nova', user: { id: 'u', name: 'A', email: 'a@b.test', role: 'admin' } })));
    await lib.changePassword('velha', 'nova-senha-1');
    expect(getToken()).toBe('token-da-senha-nova');
  });
});
