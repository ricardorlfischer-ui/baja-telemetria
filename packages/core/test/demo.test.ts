/* Equivalência de demo.ts: o CSV do exemplo tem que ser idêntico (string) ao do app antigo,
 * e DEMO_CAR igual ao de legacy/js/app.js. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadLegacy, LEGACY_DIR, DEMO_CAR as LEGACY_DEMO_CAR } from './legacy';
import { same } from './compare';
import { demoCSV, DEMO_CAR } from '../src/demo';

describe('demo', () => {
  it('demoCSV() idêntica à do app antigo', () => {
    const { BT } = loadLegacy();
    const a = BT.demoCSV(), b = demoCSV();
    expect(b.length).toBe(a.length);
    expect(b === a).toBe(true);
    expect(demoCSV() === b).toBe(true);   /* determinística (semente fixa) */
  });

  it('DEMO_CAR igual ao de app.js', () => {
    expect(same(LEGACY_DEMO_CAR, DEMO_CAR)).toEqual([]);
    const src = readFileSync(path.join(LEGACY_DIR, 'app.js'), 'utf8');
    const m = /const DEMO_CAR = (\{[\s\S]*?\});/.exec(src);
    expect(m).not.toBeNull();
    const fromApp = new Function(`return (${m![1]});`)();
    expect(same(fromApp, DEMO_CAR)).toEqual([]);
  });
});
