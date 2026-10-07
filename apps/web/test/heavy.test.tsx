// @vitest-environment jsdom
/* Logs grandes (state/heavy.ts) e erro numa página (components/PageErrorBoundary.tsx).
 * Achados da revisão de correção, com um log sintético de 28 MB (384 mil amostras):
 *  - Visão geral, Ficha, Suspensão, Ressonância e Dinâmica congelavam a aba 2–5 s logo depois
 *    do clique no menu, sem aviso nenhum (a conta rodava no render);
 *  - uma exceção ao desenhar uma página desmontava o app inteiro (tela em branco, sem menu). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import type { Session } from '@baja/core';
import { BIG_LOG, useComputed } from '../src/state/heavy';
import { useSessionStore } from '../src/state/session';
import { PageErrorBoundary } from '../src/components/PageErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
/* o Mantine pede matchMedia (jsdom não tem) */
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const fakeSession = (n: number) => ({ t: new Float64Array(n), channels: [], name: 'x', kind: 'FT', info: '' }) as unknown as Session;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); useSessionStore.setState({ S: null }); });

describe('useComputed', () => {
  const seen: (number | null)[] = [];
  let calls = 0;
  function Probe({ k }: { k: number }) {
    const v = useComputed(() => { calls++; return k * 2; }, [k]);
    seen.push(v);
    return <span>{v === null ? 'Calculando' : v}</span>;
  }

  it('log pequeno: na hora, como o useMemo', async () => {
    useSessionStore.setState({ S: fakeSession(1000) });
    seen.length = 0; calls = 0;
    await act(async () => { root.render(<Probe k={2} />); });
    expect(seen[0]).toBe(4);
    expect(host.textContent).toBe('4');
    await act(async () => { root.render(<Probe k={2} />); });
    expect(calls).toBe(1);
  });

  it('log grande: primeiro o aviso, a conta depois de pintar; deps novas = aviso de novo', async () => {
    useSessionStore.setState({ S: fakeSession(BIG_LOG + 1) });
    seen.length = 0; calls = 0;
    await act(async () => { root.render(<Probe k={3} />); });
    expect(seen[0]).toBeNull();
    expect(calls).toBe(0);
    expect(host.textContent).toBe('Calculando');
    await act(async () => { await wait(150); });
    expect(host.textContent).toBe('6');
    expect(calls).toBe(1);
    await act(async () => { root.render(<Probe k={5} />); });
    expect(host.textContent).toBe('Calculando');
    await act(async () => { await wait(150); });
    expect(host.textContent).toBe('10');
    expect(calls).toBe(2);
  });

  it('erro na conta de um log grande chega na página (não fica "Calculando" para sempre)', async () => {
    useSessionStore.setState({ S: fakeSession(BIG_LOG + 1) });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Bad() { const v = useComputed<number>(() => { throw new Error('conta quebrou'); }, []); return <span>{v === null ? 'Calculando' : v}</span>; }
    await act(async () => {
      root.render(<MantineProvider><PageErrorBoundary route="/x"><Bad /></PageErrorBoundary></MantineProvider>);
    });
    await act(async () => { await wait(150); });
    expect(host.textContent).toContain('Esta página não conseguiu mostrar este log');
    expect(host.textContent).toContain('conta quebrou');
    spy.mockRestore();
  });
});

describe('PageErrorBoundary', () => {
  it('erro numa página mostra a mensagem e trocar de página tenta de novo', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let broken = true;
    function Page() { if (broken) throw new Error('relatório falhou'); return <span>página ok</span>; }
    await act(async () => {
      root.render(<MantineProvider><div id="menu">menu</div><PageErrorBoundary route="/a"><Page /></PageErrorBoundary></MantineProvider>);
    });
    expect(host.textContent).toContain('menu');
    expect(host.textContent).toContain('relatório falhou');
    broken = false;
    await act(async () => {
      root.render(<MantineProvider><div id="menu">menu</div><PageErrorBoundary route="/b"><Page /></PageErrorBoundary></MantineProvider>);
    });
    expect(host.textContent).toContain('página ok');
    spy.mockRestore();
  });

  it('código da página que não baixou (CSS do chunk, servidor fora do ar): pede para recarregar, não culpa o log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Page(): never { throw new Error('Unable to preload CSS for http://localhost:8090/assets/shared-abc.css'); }
    await act(async () => {
      root.render(<MantineProvider><PageErrorBoundary route="/c"><Page /></PageErrorBoundary></MantineProvider>);
    });
    expect(host.textContent).toContain('Não consegui carregar esta página');
    expect(host.textContent).toContain('Recarregar');
    expect(host.textContent).not.toContain('não conseguiu mostrar este log');
    spy.mockRestore();
  });
});
