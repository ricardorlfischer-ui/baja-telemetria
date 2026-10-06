/* Equivalência de util.ts com legacy/js/util.js (parte pura). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadLegacy, LEGACY_DIR } from './legacy';
import { same } from './compare';
import {
  clamp, fmtTime, decimalsFor, fmtVal, idxAt, niceTicks, HEAT_LIGHT, HEAT_DARK, heat, heatGradientCss,
  pctRange, range, esc,
} from '../src/util';

const { BT } = loadLegacy();

const NUMS = [0, -0, 1, -1, 0.5, -0.5, 0.004, 0.005, 0.0049999, 0.995, 9.999, 10, 59.994, 59.995, 59.999, 60, 61.5,
  83.456, 99.95, 100, 999.95, 1000, 3599.999, 3600, 1e6, -83.456, -1000, -0.001, 1e-12, 123456.789,
  NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE];

describe('util', () => {
  it('clamp', () => {
    for (const v of NUMS) for (const [a, b] of [[0, 1], [-1, 1], [5, 2], [NaN, 1], [0, NaN], [-Infinity, Infinity]])
      expect(same(BT.clamp(v, a, b), clamp(v, a, b)), `${v} ${a} ${b}`).toEqual([]);
  });

  it('fmtTime', () => {
    for (const v of NUMS) expect(fmtTime(v), String(v)).toBe(BT.fmtTime(v));
  });

  it('decimalsFor e fmtVal', () => {
    for (const lo of NUMS) for (const hi of NUMS) expect(decimalsFor(lo, hi), `${lo} ${hi}`).toBe(BT.decimalsFor(lo, hi));
    for (const v of NUMS) for (const d of [0, 1, 2, 3, 5]) expect(fmtVal(v, d), `${v} ${d}`).toBe(BT.fmtVal(v, d));
  });

  it('idxAt (bordas, vazio, um elemento, repetidos, NaN)', () => {
    const arrays: number[][] = [
      [], [5], [0, 1], [0, 0.04, 0.08, 0.12, 0.16, 0.2], [0, 1, 1, 1, 2, 3], [-3, -2, -1, 0, 10, 100],
      Array.from({ length: 1001 }, (_, i) => i * 0.04 - 8.6),
    ];
    const xs = [...NUMS, -8.6, -8.61, 31.4, 31.39, 0.04, 0.06, 0.12, 0.2, 0.21, 2, 1, 5, 4.99, 5.01, 100, 101, -3, -4];
    for (const a of arrays) {
      const f = Float64Array.from(a);
      for (const x of xs) {
        expect(idxAt(a, x), `${a.length} ${x}`).toBe(BT.idxAt(a, x));
        expect(idxAt(f, x), `F ${a.length} ${x}`).toBe(BT.idxAt(f, x));
      }
    }
  });

  it('niceTicks', () => {
    const cases: [number, number, number][] = [];
    for (const lo of [-123.4, -1, -0.003, 0, 0.1, 2.5, 7, 1000]) for (const hi of [-1, 0, 0.004, 1, 3.3, 12, 255, 5000, 1e6]) for (const n of [0, 1, 4, 5, 8, 10])
      cases.push([lo, hi, n]);
    cases.push([0, NaN, 5], [NaN, 1, 5], [0, Infinity, 5], [1, 1, 5], [0, 1, NaN], [0, 1, -3]);
    for (const [lo, hi, n] of cases) expect(same(BT.niceTicks(lo, hi, n), niceTicks(lo, hi, n)), `${lo} ${hi} ${n}`).toEqual([]);
  });

  it('heat, heatGradientCss e as rampas', () => {
    const src = readFileSync(path.join(LEGACY_DIR, 'util.js'), 'utf8');
    const ramp = (name: string) => JSON.parse(new RegExp(`const ${name} = (\\[.*?\\]\\]);`).exec(src)![1]);
    expect(same(ramp('HEAT_LIGHT'), HEAT_LIGHT)).toEqual([]);
    expect(same(ramp('HEAT_DARK'), HEAT_DARK)).toEqual([]);
    const us = [...NUMS, 0.1, 0.25, 0.333, 0.3333333, 0.5, 0.6667, 0.75, 0.999, 1.5];
    for (const u of us) for (const d of [false, true, undefined]) expect(heat(u, d), `${u} ${d}`).toBe(BT.heat(u, d));
    for (const d of [false, true]) expect(heatGradientCss(d)).toBe(BT.heatGradientCss(d));
  });

  it('range e pctRange', () => {
    const arrays: number[][] = [
      [], [NaN], [NaN, NaN, 3], [1, 2, 3], [5, -2, NaN, 7, Infinity, -Infinity], [0, -0],
      Array.from({ length: 20000 }, (_, i) => (i % 13 === 0 ? NaN : Math.sin(i * 0.37) * 100 + i * 0.01)),
    ];
    for (const a of arrays) {
      const f = Float64Array.from(a);
      expect(same(BT.range(f), range(f))).toEqual([]);
      expect(same(BT.range(a), range(a))).toEqual([]);
      for (const [i0, i1] of [[0, a.length - 1], [1, 2], [0, 0], [3, 1], [0, a.length + 5], [-2, 4], [100, 9000]]) {
        expect(same(BT.range(f, i0, i1), range(f, i0, i1)), `${a.length} ${i0} ${i1}`).toEqual([]);
        for (const p of [0, 0.02, 0.05, 0.5, 0.98, 1]) expect(same(BT.pctRange(f, i0, i1, p), pctRange(f, i0, i1, p)), `${a.length} ${i0} ${i1} ${p}`).toEqual([]);
      }
    }
  });

  it('esc', () => {
    for (const s of ['', 'abc', '<b>"x" & y</b>', "'aspas'", 'a&amp;b', 123, null, undefined, NaN, { a: 1 }])
      expect(esc(s), String(s)).toBe(BT.esc(s));
  });
});
