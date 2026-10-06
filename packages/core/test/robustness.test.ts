/* Logs corrompidos não podem travar a aba nem o servidor. Onde o app antigo quebrava (ou
 * alocava memória sem limite) com um valor absurdo, o porte se protege SEM mudar o resultado
 * dos logs válidos (isso é conferido pelos testes de equivalência de cada módulo). */
import { describe, it, expect } from 'vitest';
import { powerCurve } from '../src/vehicle';
import { loadLegacy } from './legacy';
import { same } from './compare';

const ramp = (n: number, f: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => f(i));

describe('powerCurve com velocidade absurda', () => {
  it('um ponto de 6e8 m/s não aloca um balde por 2 km/h', () => {
    const n = 2000;
    const v = ramp(n, i => 2 + (i % 400) * 0.05);           /* 2–22 m/s */
    const P = ramp(n, i => 1 + (i % 400) * 0.01);
    const ax = ramp(n, () => 0.5);
    v[1234] = 6e8;                                           /* sensor de roda enlouquecido */
    const t0 = performance.now();
    const r = powerCurve(v, P, ax, 0, n - 1);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.x.length).toBeGreaterThan(5);
    expect(Array.from(r.x).every(x => x < 100)).toBe(true);  /* o ponto isolado não forma balde (< 10 amostras) */
  });

  it('dá o mesmo que o app antigo em dados normais, com e sem escorregamento', () => {
    const { BT } = loadLegacy();
    const n = 3000;
    const v = ramp(n, i => 1 + 14 * (0.5 - 0.5 * Math.cos(i / 300)));
    const P = ramp(n, i => 3 + 2 * Math.sin(i / 37));
    const ax = ramp(n, i => 0.4 * Math.cos(i / 300) + 0.02);
    const slip = ramp(n, i => (i % 97) / 400);
    for (const [i0, i1] of [[0, n - 1], [100, 900], [2500, 2999]]) {
      for (const bw of [1, 2, 5]) {
        expect(same(BT.powerCurve(v, P, ax, i0, i1, bw), powerCurve(v, P, ax, i0, i1, bw))).toEqual([]);
        expect(same(BT.powerCurve(v, P, ax, i0, i1, bw, slip), powerCurve(v, P, ax, i0, i1, bw, slip))).toEqual([]);
      }
    }
  });
});
