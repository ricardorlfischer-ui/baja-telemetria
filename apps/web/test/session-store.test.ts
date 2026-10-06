// @vitest-environment jsdom
/* Estado da sessão (state/session.ts): play, limites, troca de sessão no meio do play,
 * recálculo que muda as voltas e a linha de largada. Achados da revisão de correção:
 *  - depois de uma conta que muda as voltas (volta mínima, perfil de pista), a volta
 *    selecionada ficava no mesmo ÍNDICE: o trecho "Volta" e o play iam para outra volta
 *    enquanto a janela dos gráficos continuava na antiga;
 *  - desenhar/apagar a linha zerava a volta mas deixava a janela presa nela. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keepLap, useSessionStore } from '../src/state/session';
import { useProfiles } from '../src/state/profiles';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/core/test/fixtures');
const st = () => useSessionStore.getState();

/* laço do play sob controle: requestAnimationFrame vira uma fila e performance.now um relógio */
let frames: FrameRequestCallback[] = [];
let clock = 1000;
const step = (ms: number, n = 1) => {
  for (let k = 0; k < n; k++) {
    clock += ms;
    const f = frames;
    frames = [];
    f.forEach(cb => cb(clock));
  }
};
/* o recálculo é agendado (setTimeout 0) e cede o frame antes da conta */
const settle = async () => {
  for (let k = 0; k < 40; k++) {
    await new Promise(r => setTimeout(r, 10));
    if (!st().busy) { await new Promise(r => setTimeout(r, 10)); if (!st().busy) return; }
  }
};

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterAll(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('play: limites, volta, repetir', () => {
  beforeEach(async () => {
    st().pause();
    st().setLoop(false);
    st().setSpeed(1);
    if (!st().S?.demo) expect(await st().openDemo()).toBe(true);
    st().setLap(-1);
    st().setRangeMode('session');
    /* quadros pendentes rodam (como no navegador): o laço termina e solta o rAF */
    step(0);
  });

  it('com uma volta selecionada o play começa na volta e para no fim dela', () => {
    st().setLap(1);
    const L = st().ctx!.laps[1];
    expect(st().cursor).toBeCloseTo(L.t0, 9);
    st().setSpeed(16);
    st().play();
    expect(st().playing).toBe(true);
    step(100, 400);
    expect(st().playing).toBe(false);
    expect(st().cursor).toBe(L.t1);
    /* play de novo no fim: recomeça no começo da volta (play() do antigo) */
    st().play();
    expect(st().cursor).toBe(L.t0);
    st().pause();
  });

  it('repetir: passa do fim da volta e volta ao começo dela, sem parar', () => {
    st().setLap(2);
    const L = st().ctx!.laps[2];
    st().setLoop(true);
    st().setSpeed(16);
    st().play();
    let wrapped = false, last = st().cursor;
    for (let k = 0; k < 200; k++) {
      step(50);
      const c = st().cursor;
      if (c < last) wrapped = true;
      expect(c).toBeGreaterThanOrEqual(L.t0);
      expect(c).toBeLessThan(L.t1);
      last = c;
    }
    expect(wrapped).toBe(true);
    expect(st().playing).toBe(true);
    st().pause();
  });

  it('um quadro muito atrasado (aba em segundo plano) avança no máximo 0,25 s × velocidade', () => {
    const c0 = st().cursor;
    st().play();
    step(5000);
    expect(st().cursor - c0).toBeCloseTo(0.25, 9);
    st().pause();
  });

  it('seek fica dentro da sessão', () => {
    const t = st().S!.t;
    st().seek(-100);
    expect(st().cursor).toBe(t[0]);
    st().seek(1e9);
    expect(st().cursor).toBe(t[t.length - 1]);
  });

  it('trocar de sessão no meio do play pausa e o laço antigo não mexe no cursor novo', async () => {
    st().setLap(1);
    st().setRangeMode('lap');
    st().setSpeed(4);
    st().play();
    step(16, 10);
    expect(st().playing).toBe(true);
    const text = readFileSync(path.join(FIX, 'ft_log3_gps.csv'), 'utf8');
    const p = st().openText(text, 'ft_log3_gps.csv');
    expect(st().playing).toBe(false);
    expect(await p).toBe(true);
    const c = st().cursor;
    expect(c).toBe(st().S!.t[0]);
    step(16, 10);
    expect(st().cursor).toBe(c);
    expect(st().selLap).toBe(-1);
    expect(st().view).toBeNull();
    /* a volta era do outro log: o trecho volta a ser a sessão (não "Volta" sem volta) */
    expect(st().rangeMode).toBe('session');
  });
});

describe('exemplo × carro real', () => {
  it('mexer no carro com o exemplo aberto não muda o carro real (nem a linha da pista real)', async () => {
    const P = useProfiles.getState;
    const text = readFileSync(path.join(FIX, 'ft_log3_gps.csv'), 'utf8');
    expect(await st().openText(text, 'ft_log3_gps.csv')).toBe(true);
    st().updateConfig({ car: { mass: 251 } });
    await settle();
    expect(st().cfg!.car.mass).toBe(251);
    const realLine = P().draft.track.line ?? null;
    expect(await st().openDemo()).toBe(true);
    const demoMass = st().cfg!.car.mass;
    expect(demoMass).not.toBe(251);
    st().updateConfig({ car: { mass: 999 } });
    await settle();
    expect(st().cfg!.car.mass).toBe(999);
    st().setLine([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    await settle();
    expect(P().draft.car.mass).toBe(251);
    expect(P().draft.track.line ?? null).toEqual(realLine);
    expect(await st().openText(text, 'ft_log3_gps.csv')).toBe(true);
    expect(st().cfg!.car.mass).toBe(251);
    /* o carro do exemplo editado volta quando o exemplo é reaberto (A.demoCar do antigo) */
    expect(await st().openDemo()).toBe(true);
    expect(st().cfg!.car.mass).toBe(999);
    P().resetCar(true);
    await settle();
    expect(st().cfg!.car.mass).toBe(demoMass);
    /* devolve a linha automática do exemplo para os próximos testes */
    P().setDemoLine(null);
    expect(await st().openText(text, 'ft_log3_gps.csv')).toBe(true);
  });
});

describe('recálculo e voltas', () => {
  const minLap0 = useProfiles.getState().draft.track.minLap;
  beforeEach(async () => {
    if (!st().S?.demo) expect(await st().openDemo()).toBe(true);
    if (st().cfg!.minLap !== 10) { st().updateConfig({ minLap: 10 }); await settle(); }
    st().setLap(-1);
  });
  afterAll(() => { useProfiles.getState().applyPatch({ minLap: minLap0 }, false); });

  it('volta mínima maior junta duas voltas: a selecionada que sumiu sai, e a janela dela também', async () => {
    const laps = st().ctx!.laps;
    expect(laps.length).toBe(4);
    st().setLap(2);
    st().setRangeMode('lap');
    expect(st().view).not.toBeNull();
    /* a volta 2 tem ~37 s: com volta mínima de 38 s ela some (junta com a seguinte) */
    st().updateConfig({ minLap: 38 });
    await settle();
    expect(st().ctx!.laps.length).toBe(3);
    expect(st().selLap).toBe(-1);
    expect(st().view).toBeNull();
    st().setRangeMode('session');
  });

  it('a mesma volta em outro índice continua selecionada (e a janela fica)', async () => {
    st().setLap(3);
    const L = st().ctx!.laps[3], view = st().view;
    st().updateConfig({ minLap: 38 });
    await settle();
    const k = st().selLap;
    expect(k).toBe(2);
    expect(st().ctx!.laps[k].i0).toBe(L.i0);
    expect(st().ctx!.laps[k].i1).toBe(L.i1);
    expect(st().view).toEqual(view);
  });

  it('apagar a linha de largada zera a volta e solta a janela dela', async () => {
    st().setLap(1);
    expect(st().view).not.toBeNull();
    const line = st().cfg!.line;
    st().setLine(null);
    expect(st().selLap).toBe(-1);
    expect(st().view).toBeNull();
    await settle();
    expect(st().ctx!.laps.length).toBe(0);
    st().setLine(line);
    await settle();
    expect(st().ctx!.laps.length).toBe(4);
  });

  it('a janela de zoom (que não é a da volta) fica quando a volta some', () => {
    const S = st().S!, laps = st().ctx!.laps;
    const zoom: [number, number] = [50, 60];
    expect(keepLap(S, laps, [], 1, zoom)).toEqual({ selLap: -1, view: zoom });
    expect(keepLap(S, laps, laps, 1, zoom)).toEqual({ selLap: 1, view: zoom });
    expect(keepLap(S, laps, laps, -1, null)).toEqual({ selLap: -1, view: null });
  });
});
