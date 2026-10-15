/* Bateria (battery.ts, novo): curva do LiFePO4, correção da FT450 e a estimativa pela tensão
 * de REPOUSO (motor parado, tensão estável) num log sintético com descarga conhecida e a
 * tensão com o motor ligado oscilando como nos logs de 14/10. */
import { describe, it, expect } from 'vitest';
import { parseCSV } from '../src/parsers';
import { computeSession } from '../src/pipeline';
import {
  batteryReport, batteryOf, DEFAULT_BATTERY, findBatteryCh, fmtHours, lfpSoc, lfpVolt, LFP_OCV, restPoints,
} from '../src/battery';
import { detectRoles } from '../src/quality';
import { sensorAvailability } from '../src/sensors';
import { getExplain } from '../src/explain';

/* Log de `min` minutos a 25 Hz: a carga cai de soc0 a `rate` %/h; a cada `every` min o motor
 * para por `restS` s (repouso: tensão = curva do LiFePO4, estável); no resto o motor gira e a
 * tensão fica `sag` V abaixo com ±0,3 V de oscilação. A FT grava 0,5 V a menos, em passos de 0,01. */
function log(o: { min: number; soc0: number; rate: number; every?: number; restS?: number; sag?: number; rpm?: boolean; name?: string }) {
  const { min, soc0, rate, every = 10, restS = 10, sag = 0.4, rpm = true, name = 'Tensão_da_Bateria' } = o;
  const n = Math.round(min * 60 * 25) + 1;
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  let csv = rpm ? `TIME,RPM,${name}\n` : `TIME,${name}\n`;
  for (let i = 0; i < n; i++) {
    const ts = i * 0.04, soc = soc0 - rate * ts / 3600;
    const resting = ts % (every * 60) < restS;
    const real = lfpVolt(soc) + (resting ? 0 : -sag + rnd() * 0.6);
    const ft = (Math.round((real - 0.5) * 100) / 100).toFixed(2);
    const r = resting ? 0 : 1500 + Math.round(rnd() * 400);
    csv += rpm ? `${(ts + 0.04).toFixed(3)},${r},${ft}\n` : `${(ts + 0.04).toFixed(3)},${ft}\n`;
  }
  return parseCSV(csv, 'Log 1_20261014-1038.csv');
}
const report = (S: ReturnType<typeof log>, car = {}) => batteryReport(computeSession(S, { car }), 0, S.t.length - 1);

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
      const S = log({ min: 1, soc0: 70, rate: 50, name: k });
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

describe('repousos', () => {
  it('um ponto por trecho de motor parado; o motor ligado não entra', () => {
    const S = log({ min: 31, soc0: 70, rate: 50 });
    const V = Float64Array.from(S.channels.find(c => /Tens/.test(c.key))!.data, v => v + 0.5);
    const R = S.channels.find(c => c.key === 'RPM')!.data;
    const p = restPoints(S.t, V, R, 0, S.t.length - 1);
    expect(p.length).toBe(4);                                  /* 0, 10, 20 e 30 min */
    p.forEach((x, k) => expect(x.soc).toBeCloseTo(70 - 50 * (k * 10) / 60, -0.5));
  });
  it('parado com carga ligada (bem abaixo do repouso seguinte) fica fora', () => {
    const S = log({ min: 21, soc0: 70, rate: 50 });
    const V = Float64Array.from(S.channels.find(c => /Tens/.test(c.key))!.data, v => v + 0.5);
    const R = S.channels.find(c => c.key === 'RPM')!.data;
    /* aos 5 min: motor parado 10 s com a bomba ligada (0,6 V abaixo, estável) */
    const a = S.t.findIndex(t => t >= 300), b = S.t.findIndex(t => t >= 310);
    for (let i = a; i < b; i++) { R[i] = 0; V[i] = 12.5; }
    const p = restPoints(S.t, V, R, 0, S.t.length - 1);
    expect(p.find(x => x.t > 300 && x.t < 310)!.loaded).toBe(true);
    expect(p.filter(x => !x.loaded).length).toBe(3);
  });
});

describe('batteryReport', () => {
  it('descarga conhecida: 50 %/h saindo de 70 % → ritmo, carga, duração e consumo', () => {
    const r = report(log({ min: 41, soc0: 70, rate: 50 }));
    expect(r.status).toBe('ok');
    expect(r.rate).toBeGreaterThan(45);
    expect(r.rate).toBeLessThan(55);
    expect(r.socEnd).toBeCloseTo(70 - 50 * 40 / 60, -0.5);       /* último repouso aos 40 min */
    expect(r.hoursLeft!).toBeCloseTo((r.socEnd - 10) / r.rate, 6);
    expect(r.hoursFull!).toBeCloseTo(90 / r.rate, 6);
    expect(r.watts!).toBeCloseTo(r.rate / 100 * 24, 6);            /* 50 %/h de 24 Wh ≈ 12 W */
    expect(r.watts!).toBeGreaterThan(10);
    expect(r.watts!).toBeLessThan(14);
    expect(r.sag!).toBeGreaterThan(0.3);
    expect(r.sag!).toBeLessThan(0.5);
    const tile = (k: string) => r.tiles.find(t => t.key === k)!;
    expect(tile('endurance').text).toMatch(/acaba aos \d+ min/);   /* 4 h a 50 %/h não dá */
    expect(r.reading).toMatch(/W, ≈/);
    expect(r.sensors).toEqual(['battery', 'engine_rpm', 'logger', 'car_data']);
  });
  it('a tensão com o motor ligado oscilando não engana: sem repouso não há número', () => {
    const r = report(log({ min: 30, soc0: 70, rate: 50, every: 1000, restS: 0 }));
    expect(r.status).toBe('noRest');
    expect(r.hoursLeft).toBeNull();
    expect(r.tiles[0].text).toBe('—');
    expect(r.reading).toMatch(/motor parado/);
  });
  it('sem canal de rotação: sem estimativa (não separa repouso de motor ligado)', () => {
    const r = report(log({ min: 30, soc0: 70, rate: 50, rpm: false }));
    expect(r.status).toBe('noRpm');
    expect(r.hoursLeft).toBeNull();
  });
  it('repousos que quase não caem: sem número absurdo ("> 34 h")', () => {
    const r = report(log({ min: 31, soc0: 70, rate: 1 }));
    expect(r.status).toBe('flat');
    expect(r.hoursLeft).toBeNull();
    expect(r.tiles.every(t => !/^>/.test(t.text))).toBe(true);
  });
  it('a correção da FT entra: sem ela a carga sai bem menor', () => {
    const S = log({ min: 21, soc0: 70, rate: 50 });
    expect(report(S, { batOffset: 0 }).socEnd).toBeLessThan(report(S).socEnd - 20);
  });
  it('log curto e carregando', () => {
    expect(report(log({ min: 0.5, soc0: 70, rate: 50 })).status).toBe('short');
    expect(report(log({ min: 21, soc0: 100, rate: 0 }), { batOffset: 1 }).status).toBe('charging');
  });
  it('todo explain usado existe e cita os sensores marcados', () => {
    const r = report(log({ min: 41, soc0: 70, rate: 50 }));
    for (const x of [r.src, r.plot!, r.curvePlot, ...r.tiles, ...r.notes]) {
      const e = getExplain(x.explain);
      expect(e, x.explain).toBeDefined();
      for (const s of x.sensors) expect(e!.sensors.map(q => q.id), `${x.explain}: ${s}`).toContain(s);
    }
  });
});
