/* Bateria (battery.ts, novo): curva do LiFePO4, correção da FT450 e a estimativa de duração
 * num log sintético com consumo conhecido. */
import { describe, it, expect } from 'vitest';
import { parseCSV } from '../src/parsers';
import { computeSession } from '../src/pipeline';
import {
  batteryReport, batteryOf, DEFAULT_BATTERY, findBatteryCh, fmtHours, lfpSoc, lfpVolt, LFP_OCV,
} from '../src/battery';
import { detectRoles } from '../src/quality';
import { sensorAvailability } from '../src/sensors';
import { getExplain } from '../src/explain';

/* log de `min` minutos a 25 Hz com a tensão REAL indo de v0 a v1 (a FT grava 0,5 V a menos),
 * passos de `q` V e um pouco de ruído */
function log(min: number, v0: number, v1: number, q = 0.01, name = 'Tensão_da_bateria') {
  const n = Math.round(min * 60 * 25) + 1;
  let o = `TIME,RPM,${name}\n`;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let i = 0; i < n; i++) {
    const real = v0 + (v1 - v0) * i / (n - 1) + rnd() * 0.02;
    const ft = Math.round((real - 0.5) / q) * q;
    o += `${((i + 1) * 0.04).toFixed(3)},${3000 + Math.round(rnd() * 100)},${ft.toFixed(3)}\n`;
  }
  return parseCSV(o, 'Log 1_20261014-1038.csv');
}
const report = (S: ReturnType<typeof log>, car = {}) => {
  const ctx = computeSession(S, { car });
  return batteryReport(ctx, 0, S.t.length - 1);
};

describe('curva LiFePO4', () => {
  it('pontos da tabela, entre eles reta, e a inversa', () => {
    for (const [v, s] of LFP_OCV) { expect(lfpSoc(v)).toBeCloseTo(s, 9); expect(lfpVolt(s)).toBeCloseTo(v, 9); }
    expect(lfpSoc(13.05)).toBeCloseTo(55, 9);
    expect(lfpSoc(9)).toBe(0);
    expect(lfpSoc(14.2)).toBe(100);
    expect(lfpSoc(NaN)).toBeNaN();
  });
  it('bateria padrão = Aliant YLP07 24 Wh, correção +0,5 V; campos do carro por cima', () => {
    expect(DEFAULT_BATTERY).toMatchObject({ wh: 24, vNom: 12.8, offset: 0.5, reserve: 10 });
    expect(batteryOf({ batWh: 30, batOffset: 0.3, batReserve: 20, batModel: ' X ' })).toMatchObject({ wh: 30, offset: 0.3, reserve: 20, model: 'X' });
    expect(batteryOf({ batWh: 0, batOffset: 0 })).toMatchObject({ wh: 24, offset: 0 });
  });
  it('fmtHours', () => {
    expect(fmtHours(0.5)).toBe('30 min');
    expect(fmtHours(3.0834)).toBe('3 h 05 min');
  });
});

describe('canal e sensor', () => {
  it('acha pelo nome (português e inglês) e vira o sensor battery', () => {
    for (const k of ['Tensão_da_bateria', 'Battery_voltage', 'VBat']) {
      const S = log(1, 13.3, 13.2, 0.01, k);
      expect(findBatteryCh(S.channels)?.key).toBe(k);
      expect(detectRoles(S).battery).toBe(k);
      expect(sensorAvailability(computeSession(S, {})).battery).toBe('present');
    }
  });
  it('sem canal: relatório vazio dizendo o que exportar', () => {
    const S = parseCSV('TIME,RPM\n0.04,1\n0.08,2\n', 'x.csv');
    const r = batteryReport(computeSession(S, {}), 0, 1);
    expect(r.ok).toBe(false);
    expect(r.empty).toMatch(/Tensão da bateria/);
  });
});

describe('batteryReport', () => {
  it('consumo conhecido: 13,20 → 13,10 V reais em 60 min = 10 %/h', () => {
    const r = report(log(60, 13.2, 13.1));
    expect(r.status).toBe('ok');
    expect(r.vStart).toBeCloseTo(13.2, 2);
    expect(r.vEnd).toBeCloseTo(13.1, 2);
    expect(r.socStart).toBeCloseTo(70, 0);
    expect(r.socEnd).toBeCloseTo(60, 0);
    expect(r.rate).toBeCloseTo(10, 0);
    expect(r.hoursLeft!).toBeCloseTo(5, 0);           /* (60 − 10) ÷ 10 */
    expect(r.hoursFull!).toBeCloseTo(9, 0);           /* (100 − 10) ÷ 10 */
    expect(r.watts!).toBeCloseTo(2.4, 1);             /* 10 % de 24 Wh em 1 h */
    expect(r.quantum).toBeCloseTo(0.01, 6);
    const tile = (k: string) => r.tiles.find(t => t.key === k)!;
    expect(tile('endurance').text).toBe('sobra 60 %');   /* 240 min a 10 %/h */
    expect(r.notes).toEqual([]);
    expect(r.reading).toMatch(/2,4 W/);
    expect(r.sensors).toEqual(['battery', 'logger', 'car_data']);
  });
  it('a correção da FT entra: sem ela a carga sai bem menor', () => {
    const S = log(60, 13.2, 13.1);
    const sem = report(S, { batOffset: 0 });
    expect(sem.vStart).toBeCloseTo(12.7, 2);
    expect(sem.socStart).toBeLessThan(30);
  });
  it('sem queda medível: limite inferior ("mais de")', () => {
    const r = report(log(30, 13.15, 13.15, 0.1));
    expect(r.status).toBe('flat');
    expect(r.hoursLeft).not.toBeNull();
    expect(r.tiles[0].text.startsWith('> ')).toBe(true);
    expect(r.hoursFull).toBeNull();
  });
  it('log curto e carregando', () => {
    expect(report(log(0.5, 13.2, 13.1)).status).toBe('short');
    expect(report(log(10, 14.2, 14.1)).status).toBe('charging');
    const c = report(log(10, 13.2, 13.15));
    expect(c.status).toBe('ok');
    expect(c.notes.some(n => /Log curto/.test(n.text))).toBe(true);
  });
  it('todo explain usado existe', () => {
    const r = report(log(60, 13.2, 13.1));
    for (const id of [r.explain, r.src.explain, r.plot!.explain, r.curvePlot.explain, ...r.tiles.map(t => t.explain), ...r.notes.map(n => n.explain)]) {
      expect(getExplain(id), id).toBeDefined();
    }
  });
});
