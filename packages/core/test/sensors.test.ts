/* Catálogo de sensores (sensors.ts) e de explicações (explain.ts): todo sensor tem
 * entrada, todo sensor citado existe, ids únicos e bem formados, links válidos, e a
 * disponibilidade dos sensores no exemplo e nos logs reais. */
import { describe, it, expect } from 'vitest';
import { readFixture } from './legacy';
import { parseLog, parseCSV } from '../src/parsers';
import { demoCSV, DEMO_CAR } from '../src/demo';
import { computeSession } from '../src/pipeline';
import { SENSORS, SENSOR_IDS, sensorAvailability, sensorMatrix } from '../src/sensors';
import { EXPLAIN, EXPLAIN_AREAS, getExplain, explainSensorIds } from '../src/explain';
import type { SensorId } from '../src/types';

/* lista do tipo SensorId (types.ts), repetida aqui para o teste pegar um id esquecido */
const ALL_IDS: SensorId[] = ['gps', 'shock_fl', 'shock_fr', 'shock_rl', 'shock_rr', 'wheel', 'cvt_temp', 'logger', 'car_data',
  'engine_rpm', 'imu', 'brake_pressure', 'steering', 'throttle'];
const PLANNED: SensorId[] = ['engine_rpm', 'imu', 'brake_pressure', 'steering', 'throttle'];

describe('SENSORS', () => {
  it('todo SensorId tem entrada completa, com o id certo', () => {
    expect([...SENSOR_IDS].sort()).toEqual([...ALL_IDS].sort());
    expect(Object.keys(SENSORS).sort()).toEqual([...ALL_IDS].sort());
    for (const id of ALL_IDS) {
      const s = SENSORS[id];
      expect(s.id).toBe(id);
      for (const k of ['name', 'short', 'where', 'signal', 'rate', 'purpose'] as const) expect(s[k].length, `${id}.${k}`).toBeGreaterThan(1);
      expect(!!s.planned).toBe(PLANNED.includes(id));
    }
  });
  it('sugeridos dizem o que destravariam', () => {
    for (const id of PLANNED) expect(SENSORS[id].unlocks!.length).toBeGreaterThan(0);
  });
  it('GPS descreve o caminho real do sinal (firmware do PIC)', () => {
    const g = SENSORS.gps;
    for (const s of ['0x028', '0x023', 'entradas 7', 'Back_pressure', 'O2_General', '0x0177', '0x0027', 'V × 51', 'track_config.h']) expect(g.signal + g.where).toContain(s);
    expect(g.rate).toContain('4 Hz');
    expect(g.resolution).toContain('0,863 m');
  });
});

describe('EXPLAIN', () => {
  const entries = Object.entries(EXPLAIN);
  it('ids únicos, iguais à chave, no formato <área>.<item>', () => {
    const ids = entries.map(([, e]) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [k, e] of entries) {
      expect(e.id).toBe(k);
      const [area, item, ...rest] = k.split('.');
      expect(EXPLAIN_AREAS as readonly string[]).toContain(area);
      expect(item && item.length).toBeTruthy();
      expect(rest).toEqual([]);
    }
  });
  it('todo sensor citado existe e tem o porquê; campos obrigatórios preenchidos', () => {
    for (const [k, e] of entries) {
      for (const f of ['title', 'what', 'how', 'design'] as const) expect(e[f].length, `${k}.${f}`).toBeGreaterThan(10);
      expect(e.sensors.length, k).toBeGreaterThan(0);
      for (const s of e.sensors) {
        expect(ALL_IDS, `${k}: ${s.id}`).toContain(s.id);
        expect(['required', 'alternative', 'improves']).toContain(s.need);
        expect(s.why.length, `${k}: ${s.id}`).toBeGreaterThan(3);
      }
      const sid = e.sensors.map(s => s.id);
      expect(new Set(sid).size, `${k}: sensor repetido`).toBe(sid.length);
    }
  });
  it('todo "Veja também" aponta para um card que existe', () => {
    for (const [k, e] of entries) for (const r of e.related || []) expect(getExplain(r), `${k} → ${r}`).toBeDefined();
  });
  it('as entradas exemplares existem', () => {
    for (const id of ['susp.naturalFreq', 'susp.travelUsed', 'power.wheelPower', 'cvt.thermalModel', 'dyn.gg', 'laps.delta', 'track.gpsPosition',
      'quality.gpsBorder', 'channel.roughness', 'freq.roadWavelength', 'power.tireCalibration', 'susp.rollGradient']) expect(getExplain(id), id).toBeDefined();
  });
  it('cada sensor tem o seu card sensor.<id>', () => {
    for (const id of ALL_IDS) expect(getExplain('sensor.' + id)!.sensors[0].id).toBe(id);
  });
  it('getExplain não confunde com propriedades do objeto', () => {
    expect(getExplain('constructor')).toBeUndefined();
    expect(getExplain('toString')).toBeUndefined();
    expect(getExplain('nao.existe')).toBeUndefined();
  });
  it('explainSensorIds', () => {
    expect(explainSensorIds('power.tireCalibration')).toEqual(['wheel', 'gps']);
    expect(explainSensorIds('nao.existe')).toEqual([]);
  });
});

describe('sensorMatrix', () => {
  const M = sensorMatrix();
  it('uma linha por sensor, todo explain existe e toda decisão está escrita', () => {
    expect(M.map(r => r.sensor).sort()).toEqual([...ALL_IDS].sort());
    for (const r of M) {
      expect(r.items.length, r.sensor).toBeGreaterThan(0);
      for (const it of r.items) { expect(getExplain(it.explain), `${r.sensor} → ${it.explain}`).toBeDefined(); expect(it.decision.length).toBeGreaterThan(5); }
    }
  });
  it('o sensor da linha é usado pelo card da célula', () => {
    for (const r of M) for (const it of r.items) expect(explainSensorIds(it.explain), `${r.sensor} → ${it.explain}`).toContain(r.sensor);
  });
});

describe('sensorAvailability', () => {
  it('exemplo: todos os sensores instalados presentes, sugeridos planejados', () => {
    const S = parseCSV(demoCSV(), 'exemplo_baja.csv'); S.demo = true;
    const av = sensorAvailability(computeSession(S, { car: DEMO_CAR }, { autoLine: true }));
    for (const id of ALL_IDS) expect(av[id], id).toBe(PLANNED.includes(id) ? 'planned' : 'present');
  });
  it('exemplo sem roda e sem a traseira direita', () => {
    const S = parseCSV(demoCSV(), 'exemplo_baja.csv');
    S.channels = S.channels.filter(c => c.key !== 'Wheel_speed' && !/Rear_Right|_RR$/.test(c.key));
    const av = sensorAvailability(computeSession(S, { car: DEMO_CAR }));
    expect(av.wheel).toBe('absent');
    expect(av.shock_rr).toBe('absent');
    expect(av.shock_rl).toBe('present');
  });
  it('ft_log3_gps: só GPS e logger', () => {
    const text = readFixture('ft_log3_gps.csv')!;
    const av = sensorAvailability(computeSession(parseLog(text, 'ft_log3_gps.csv')));
    const present = ALL_IDS.filter(id => av[id] === 'present');
    expect(present).toEqual(['gps', 'logger']);
    for (const id of PLANNED) expect(av[id]).toBe('planned');
    expect(av.car_data).toBe('absent');
  });
  it('ft_log3_shocks_compact: GPS, só a traseira esquerda com sinal, logger', () => {
    const text = readFixture('ft_log3_shocks_compact.csv')!;
    const av = sensorAvailability(computeSession(parseLog(text, 'ft_log3_shocks_compact.csv')));
    expect(ALL_IDS.filter(id => av[id] === 'present')).toEqual(['gps', 'shock_rl', 'logger']);
  });
  it('busmaster_14.log: GPS sem fix = ausente', () => {
    const text = readFixture('busmaster_14.log')!;
    const av = sensorAvailability(computeSession(parseLog(text, 'busmaster_14.log')));
    expect(av.gps).toBe('absent');
    expect(av.logger).toBe('present');
  });
  it('sugerido com canal no log passa a presente', () => {
    const S = parseCSV('TIME,RPM,TPS,Brake_pressure_F,Steering_angle\n' + Array.from({ length: 30 }, (_, i) => `${(i * 0.04).toFixed(2)},${3000 + i * 10},${i},${i % 5},${i - 15}`).join('\n'), 'x.csv');
    const av = sensorAvailability(computeSession(S));
    expect([av.engine_rpm, av.throttle, av.brake_pressure, av.steering, av.imu]).toEqual(['present', 'present', 'present', 'present', 'planned']);
  });
});
