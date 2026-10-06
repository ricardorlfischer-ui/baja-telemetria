// @vitest-environment jsdom
/* Atalhos do play e o trecho das análises (useRange). Achados da revisão de correção:
 *  - os atalhos valiam em qualquer página com uma sessão aberta: na Ficha do carro (sem
 *    barra de reprodução) o End não rolava a página até o fim e o espaço disparava um play
 *    invisível;
 *  - useRange devolvia um array novo a cada mudança da janela dos gráficos mesmo no trecho
 *    "Sessão": escolher uma volta (que move a janela) recalculava os relatórios das páginas. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSessionStore, useRange } from '../src/state/session';
import { hashPath, useSessionHotkeys } from '../src/state/hotkeys';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const st = () => useSessionStore.getState();

let root: Root, host: HTMLDivElement;
const ranges: ([number, number, string] | null)[] = [];
function Probe() {
  useSessionHotkeys();
  ranges.push(useRange());
  return null;
}

beforeAll(async () => {
  expect(await st().openDemo()).toBe(true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<Probe />); });
});
afterAll(() => { act(() => root.unmount()); host.remove(); });

const key = (k: string, code = k) => {
  const e = new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true });
  document.body.dispatchEvent(e);
  return e;
};

describe('atalhos do play', () => {
  it('caminho da rota pelo hash', () => {
    expect(hashPath('#/canais')).toBe('/canais');
    expect(hashPath('#/canais?exemplo=1')).toBe('/canais');
    expect(hashPath('#/')).toBe('/');
    expect(hashPath('')).toBe('/');
    expect(hashPath('#/mapa/')).toBe('/mapa');
  });

  it('página sem a barra de reprodução: End e espaço ficam com o navegador', () => {
    window.location.hash = '#/projeto';
    st().pause();
    st().seek(10);
    const e1 = key('End'), e2 = key(' ', 'Space');
    expect(e1.defaultPrevented).toBe(false);
    expect(e2.defaultPrevented).toBe(false);
    expect(st().cursor).toBe(10);
    expect(st().playing).toBe(false);
  });

  it('página com a barra de reprodução: End, Home, setas e espaço mexem no play', () => {
    window.location.hash = '#/canais';
    const t = st().S!.t;
    st().setLap(-1);
    expect(key('End').defaultPrevented).toBe(true);
    expect(st().cursor).toBe(t[t.length - 1]);
    /* na borda do fim, → não passa da sessão */
    key('ArrowRight');
    expect(st().cursor).toBe(t[t.length - 1]);
    key('Home');
    expect(st().cursor).toBe(t[0]);
    /* na borda do começo, ← (e Shift+←) não passa da sessão */
    key('ArrowLeft');
    expect(st().cursor).toBe(t[0]);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true }));
    expect(st().cursor).toBe(t[0]);
    key('ArrowRight');
    expect(st().cursor).toBeCloseTo(t[1], 12);
    /* volta selecionada: Home/End vão ao começo/fim da volta */
    st().setLap(1);
    const L = st().ctx!.laps[1];
    key('End');
    expect(st().cursor).toBe(L.t1);
    key('Home');
    expect(st().cursor).toBe(L.t0);
    expect(key(' ', 'Space').defaultPrevented).toBe(true);
    expect(st().playing).toBe(true);
    key(' ', 'Space');
    expect(st().playing).toBe(false);
    st().setLap(-1);
  });

  it('tecla já usada por um elemento (espaço numa linha da lista de canais) não dispara o play', () => {
    window.location.hash = '#/canais';
    st().pause();
    const row = document.createElement('div');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    let toggled = 0;
    row.addEventListener('keydown', e => { if (e.key === ' ') { e.preventDefault(); toggled++; } });
    document.body.appendChild(row);
    row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
    expect(toggled).toBe(1);
    expect(st().playing).toBe(false);
    row.remove();
  });

  it('em campos de texto as teclas são do campo', () => {
    window.location.hash = '#/canais';
    const inp = document.createElement('input');
    document.body.appendChild(inp);
    st().seek(5);
    const e = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true });
    inp.dispatchEvent(e);
    const sp = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    inp.dispatchEvent(sp);
    expect(e.defaultPrevented).toBe(false);
    expect(sp.defaultPrevented).toBe(false);
    expect(st().cursor).toBe(5);
    expect(st().playing).toBe(false);
    inp.remove();
  });
});

describe('useRange', () => {
  it('no trecho Sessão, mexer na janela (zoom, volta escolhida) não muda o trecho', async () => {
    await act(async () => { st().setRangeMode('session'); st().setView(null); });
    const r0 = ranges[ranges.length - 1];
    expect(r0).not.toBeNull();
    await act(async () => { st().setView([20, 40]); });
    await act(async () => { st().zoomView(0.5, 30); });
    expect(ranges[ranges.length - 1]).toBe(r0);
  });

  it('no trecho Janela, a janela vira o trecho', async () => {
    await act(async () => { st().setRangeMode('view'); st().setView([20, 40]); });
    const r = ranges[ranges.length - 1]!;
    const t = st().S!.t;
    expect(t[r[0]]).toBeGreaterThanOrEqual(19.9);
    expect(t[r[1]]).toBeLessThanOrEqual(40.1);
    expect(r[2]).toBe('20.0–40.0 s');
    await act(async () => { st().setRangeMode('session'); st().setView(null); });
  });
});
