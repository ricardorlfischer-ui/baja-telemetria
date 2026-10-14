/* Equivalência de demo.ts: com o carro do app antigo (DEMO_SIM_V1) o CSV do exemplo tem que
 * ser idêntico (string) ao do app antigo, e DEMO_CAR_V1 igual ao de legacy/js/app.js. O
 * exemplo do app usa o carro da equipe (DEMO_SIM / DEMO_CAR): mesmo modelo, outros números. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadLegacy, LEGACY_DIR, DEMO_CAR as LEGACY_DEMO_CAR } from './legacy';
import { same } from './compare';
import { demoCSV, DEMO_CAR, DEMO_CAR_V1, DEMO_SIM_V1 } from '../src/demo';
import { parseCSV } from '../src/parsers';
import { computeSession } from '../src/pipeline';
import { sessionSummary, summaryMetric } from '../src/summary';

describe('demo', () => {
  it('demoCSV(DEMO_SIM_V1) idêntica à do app antigo', () => {
    const { BT } = loadLegacy();
    const a = BT.demoCSV(), b = demoCSV(DEMO_SIM_V1);
    expect(b.length).toBe(a.length);
    expect(b === a).toBe(true);
    expect(demoCSV(DEMO_SIM_V1) === b).toBe(true);   /* determinística (semente fixa) */
  });

  it('DEMO_CAR_V1 igual ao de app.js', () => {
    expect(same(LEGACY_DEMO_CAR, DEMO_CAR_V1)).toEqual([]);
    const src = readFileSync(path.join(LEGACY_DIR, 'app.js'), 'utf8');
    const m = /const DEMO_CAR = (\{[\s\S]*?\});/.exec(src);
    expect(m).not.toBeNull();
    const fromApp = new Function(`return (${m![1]});`)();
    expect(same(fromApp, DEMO_CAR_V1)).toEqual([]);
  });

  it('exemplo com o carro da equipe: as análises acham o que o modelo tem', () => {
    expect(demoCSV() === demoCSV()).toBe(true);
    expect(DEMO_CAR).toMatchObject({ mass: 180, wb: 1425, trackF: 1325, trackR: 1300 });
    const S = parseCSV(demoCSV(), 'exemplo_baja.csv'); S.demo = true;
    const sm = sessionSummary(computeSession(S, { car: DEMO_CAR }, { autoLine: true }));
    const v = (k: string) => summaryMetric(sm, k)!.value as number;
    expect(v('session.vmax')).toBeGreaterThan(45);                   /* máxima ~47 km/h */
    expect(v('session.vmax')).toBeLessThan(49);
    expect(v('session.laps')).toBe(80);                             /* 30 + 30 + 20 voltas */
    expect(Math.abs(v('session.duration') - 3600)).toBeLessThan(300); /* ~1 h */
    expect(v('cvt.margin')).toBeGreaterThan(10);                    /* CVT longe do limite */
    expect(Math.abs(v('power.pmax') - 5.5)).toBeLessThan(0.5);      /* 5,5 kW na roda */
    expect(Math.abs(v('susp.fn.F') - 1.65)).toBeLessThan(0.15);     /* ~1,6 Hz na frente */
    expect(Math.abs(v('susp.fn.R') - 1.95)).toBeLessThan(0.15);     /* ~1,9 Hz atrás */
    expect(Math.abs(v('power.tireError') - 3)).toBeLessThan(0.5);   /* roda marca 3 % a mais */
  });
});
