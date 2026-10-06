/* Qualidade dos dados (quality.ts): papéis detectados, números por canal e avisos nos
 * fixtures, no exemplo e em versões do exemplo com defeitos fabricados (sensor travado,
 * pico, GPS na borda, calibração "1 V = 1", buraco no tempo, GPS congelado, ...). */
import { describe, it, expect } from 'vitest';
import { readFixture } from './legacy';
import { parseLog, parseCSV, finishChannel } from '../src/parsers';
import { demoCSV, DEMO_CAR } from '../src/demo';
import { computeSession, type AnalysisConfigInput } from '../src/pipeline';
import { dataQuality, detectRoles, CHANNEL_ROLES, ROLE_SENSOR, ROLE_LABEL, type DataQuality } from '../src/quality';
import { SENSORS } from '../src/sensors';
import { getExplain } from '../src/explain';
import { idxAt } from '../src/util';
import type { Session } from '../src/types';

const demo = (): Session => { const S = parseCSV(demoCSV(), 'exemplo_baja.csv'); S.demo = true; return S; };
const run = (S: Session, cfg: AnalysisConfigInput = {}, autoLine = true) => {
  const ctx = computeSession(S, cfg, { autoLine });
  return { ctx, q: dataQuality(S, ctx) };
};
const ids = (q: DataQuality) => q.issues.map(i => i.id);
const ch = (S: Session, key: string) => S.channels.find(c => c.key === key)!;

/* conferências que valem para qualquer resultado */
function sane(q: DataQuality) {
  const seen = new Set<string>();
  for (const i of q.issues) {
    expect(seen.has(i.id), `id repetido ${i.id}`).toBe(false); seen.add(i.id);
    expect(getExplain(i.explain), `${i.id} → ${i.explain}`).toBeDefined();
    expect(i.sensors.length, i.id).toBeGreaterThan(0);
    for (const s of i.sensors) expect(SENSORS[s], `${i.id}: ${s}`).toBeDefined();
    expect(i.text.length).toBeGreaterThan(10);
    expect(i.action.length).toBeGreaterThan(10);
    expect(['info', 'warn', 'error']).toContain(i.level);
  }
  const lv = q.issues.map(i => ({ error: 0, warn: 1, info: 2 }[i.level]));
  expect(lv).toEqual([...lv].sort((a, b) => a - b));
  for (const c of q.channels) {
    expect(getExplain(c.explain), c.key).toBeDefined();
    if (c.role) { expect(c.sensor).toBe(ROLE_SENSOR[c.role]); expect(q.roles[c.role]).toBe(c.key); }
  }
}

describe('papéis', () => {
  it('todo papel tem sensor e rótulo', () => {
    for (const r of CHANNEL_ROLES) { expect(SENSORS[ROLE_SENSOR[r]]).toBeDefined(); expect(ROLE_LABEL[r].length).toBeGreaterThan(3); }
  });
  it('exemplo: GPS, 4 amortecedores (posição e velocidade), roda e CVT', () => {
    expect(detectRoles(demo())).toEqual({
      gps_x: 'Back_pressure', gps_y: 'O2_General',
      shock_pos_FL: 'Shock_-_Front_Left', shock_vel_FL: 'Shock_velocity_FL', shock_pos_FR: 'Shock_-_Front_Right', shock_vel_FR: 'Shock_velocity_FR',
      shock_pos_RL: 'Shock_-_Rear_Left', shock_vel_RL: 'Shock_velocity_RL', shock_pos_RR: 'Shock_-_Rear_Right', shock_vel_RR: 'Shock_velocity_RR',
      wheel: 'Wheel_speed', cvt_temp: 'CVT_temp',
    });
  });
  it('usa os canais escolhidos na configuração', () => {
    const r = detectRoles(demo(), { chX: 'O2_General', chY: 'Back_pressure', chStatus: '', car: { wheelCh: 'CVT_temp', cvtCh: 'Wheel_speed' } });
    expect([r.gps_x, r.gps_y, r.wheel, r.cvt_temp]).toEqual(['O2_General', 'Back_pressure', 'CVT_temp', 'Wheel_speed']);
  });
  it('BUSMASTER: GPS vem da lat/lon (sem papéis de canal)', () => {
    const S = parseLog(readFixture('busmaster_14.log')!, 'busmaster_14.log');
    expect(detectRoles(S)).toEqual({});
  });
});

describe('exemplo', () => {
  const { ctx, q } = run(demo(), { car: DEMO_CAR });
  it('números por canal', () => {
    sane(q);
    expect(q.logRateHz).toBeCloseTo(25, 6);
    expect(q.duration).toBeCloseTo(ctx.S.t[ctx.S.t.length - 1] - ctx.S.t[0], 9);
    expect(q.gpsBorderPct).toBe(0);
    expect(q.gpsUpdateHz).toBeGreaterThan(3.5);
    expect(q.gpsUpdateHz).toBeLessThan(5);
    for (const c of q.channels) {
      expect(c.validPct).toBe(100);
      expect(c.rateHz).toBeCloseTo(25, 3);
      expect(c.stuck).toEqual([]);
      expect(c.jumpCount).toBe(0);
      expect(c.outOfRange).toBe(0);
    }
    expect(q.channels.find(c => c.key === 'Shock_-_Front_Left')!.updateHz).toBeCloseTo(25, 3);
  });
  it('só a calibração da roda (+2,8 %) e a taxa do log', () => {
    expect(ids(q)).toEqual(['wheel.calib', 'log.rate']);
    expect(q.issues[0].text).toContain('+2.8 %');
    expect(q.issues[0].action).toContain(ctx.veh.k.toFixed(4));
  });
});

describe('logs reais', () => {
  it('ft_log3_gps: só GPS, sem borda, avisos de sensores ausentes e de dados do carro', () => {
    const S = parseLog(readFixture('ft_log3_gps.csv')!, 'ft_log3_gps.csv');
    const { q } = run(S);
    sane(q);
    expect(q.roles).toEqual({ gps_x: 'Back_pressure', gps_y: 'O2_General' });
    expect(q.gpsBorderPct).toBe(0);
    expect(ids(q).sort()).toEqual(['car.data', 'cvt.none', 'log.rate', 'susp.none', 'wheel.none'].sort());
    expect(q.issues.every(i => i.level === 'info')).toBe(true);
  });
  for (const f of ['ft_log3_shocks_compact.csv', 'Log 3_20261005-1648_20261005-1651.csv']) {
    it(`${f}: FL, FR e RR constantes em 0, só RL com sinal`, () => {
      const text = readFixture(f);
      if (text === null) return;
      const { q } = run(parseLog(text, f));
      sane(q);
      for (const k of ['Shock_-_Front_Left', 'Shock_-_Front_Right', 'Shock_-_Rear_Right', 'Shock_velocity_FL', 'Shock_velocity_FR', 'Shock_velocity_RR']) {
        const i = q.issues.find(x => x.id === 'const:' + k)!;
        expect(i.level).toBe('warn');
        expect(i.explain).toBe('quality.constant');
      }
      expect(q.issues.some(x => x.id.endsWith('Shock_-_Rear_Left'))).toBe(false);
      expect(q.issues.find(x => x.id === 'susp.partial')!.sensors).toEqual(['shock_fl', 'shock_fr', 'shock_rr']);
      expect(q.issues.find(x => x.id === 'car.data')!.level).toBe('warn');
      expect(q.channels.find(c => c.key === 'Shock_-_Rear_Left')!.updateHz).toBeCloseTo(25, 3);
    });
  }
  it('busmaster_14.log: GPS sem fix = erro', () => {
    const { q } = run(parseLog(readFixture('busmaster_14.log')!, 'busmaster_14.log'));
    sane(q);
    expect(q.issues[0].id).toBe('gps.track');
    expect(q.issues[0].level).toBe('error');
    expect(q.issues[0].text).toContain('fix 3D');
    expect(q.gpsBorderPct).toBeNull();
    expect(q.logRateHz).toBeCloseTo(20, 6);
  });
});

describe('defeitos fabricados no exemplo', () => {
  it('amortecedor travado com o carro andando', () => {
    const S = demo(), t = S.t, c = ch(S, 'Shock_-_Front_Left');
    const a = idxAt(t, 100), b = idxAt(t, 104);
    for (let i = a; i <= b; i++) c.data[i] = c.data[a];
    finishChannel(c);
    const { ctx, q } = run(S, { car: DEMO_CAR });
    sane(q);
    expect(ctx.stopped![a + 10]).toBe(0);
    const iss = q.issues.find(i => i.id === 'stuck:Shock_-_Front_Left')!;
    expect(iss.level).toBe('warn');
    expect(iss.sensors).toEqual(['shock_fl', 'gps']);
    const cq = q.channels.find(x => x.key === 'Shock_-_Front_Left')!;
    expect(cq.stuck.length).toBe(1);
    expect(cq.stuck[0].t0).toBeCloseTo(100, 1);
    expect(cq.stuck[0].t1).toBeCloseTo(104, 1);
  });
  it('pico de uma amostra no amortecedor e roda fora da faixa', () => {
    const S = demo(), t = S.t, c = ch(S, 'Shock_-_Rear_Right'), w = ch(S, 'Wheel_speed');
    const k = idxAt(t, 80);
    c.data[k] += 400; finishChannel(c);
    w.data[k] = 400; finishChannel(w);
    const { q } = run(S, { car: DEMO_CAR });
    sane(q);
    expect(q.channels.find(x => x.key === 'Shock_-_Rear_Right')!.jumpCount).toBe(2);
    expect(q.issues.find(i => i.id === 'jump:Shock_-_Rear_Right')!.t).toBeCloseTo(t[k], 9);
    expect(q.channels.find(x => x.key === 'Wheel_speed')!.outOfRange).toBe(1);
    expect(ids(q)).toContain('range:Wheel_speed');
  });
  it('GPS na borda da área', () => {
    const S = demo(), t = S.t, c = ch(S, 'Back_pressure');
    const a = idxAt(t, 60), b = idxAt(t, 66);
    for (let i = a; i <= b; i++) c.data[i] = 5;
    finishChannel(c);
    const { q } = run(S, { car: DEMO_CAR });
    sane(q);
    const iss = q.issues.find(i => i.id === 'gps.border')!;
    expect(iss.level).toBe('warn');
    expect(iss.action).toContain('track_config.h');
    expect(q.gpsBorderPct).toBeCloseTo((b - a + 1) / t.length * 100, 6);
    expect(ids(q)).toContain('jump:Back_pressure');
  });
  it('calibração "1 V = 1" (valor travado em 1,000)', () => {
    const S = demo(), c = ch(S, 'O2_General');
    for (let i = 0; i < c.data.length; i += 10) c.data[i] = 1;
    finishChannel(c);
    const { q } = run(S, { car: DEMO_CAR });
    sane(q);
    const iss = q.issues.find(i => i.id === 'gps.calib1V:O2_General')!;
    expect(iss.explain).toBe('quality.gpsCalibration');
    expect(iss.action).toContain('0,00 V = 0 e 5,00 V = 5');
  });
  it('GPS em código 0–255 = aviso de formato', () => {
    const S = demo();
    for (const k of ['O2_General', 'Back_pressure']) { const c = ch(S, k); for (let i = 0; i < c.data.length; i++) c.data[i] = Math.round(c.data[i] * 51); finishChannel(c); }
    const { ctx, q } = run(S, { car: DEMO_CAR });
    expect(ctx.track.fmt).toBe('code');
    sane(q);
    expect(q.issues.find(i => i.id === 'gps.fmt')!.level).toBe('info');
  });
  it('GPS congelado com a roda andando', () => {
    const S = demo(), t = S.t, a = idxAt(t, 120), b = idxAt(t, 124);
    for (const k of ['O2_General', 'Back_pressure']) { const c = ch(S, k); for (let i = a; i <= b; i++) c.data[i] = c.data[a]; finishChannel(c); }
    const { q } = run(S, { car: DEMO_CAR });
    sane(q);
    const iss = q.issues.find(i => i.id === 'gps.frozen')!;
    expect(iss.sensors).toEqual(['gps', 'wheel']);
    expect(q.channels.find(c => c.key === 'O2_General')!.stuck.length).toBeGreaterThan(0);
  });
  it('roda com poucas amostras', () => {
    const S = demo(), c = ch(S, 'Wheel_speed');
    for (let i = 0; i < c.data.length; i++) if (i % 5 < 3) c.data[i] = NaN;
    finishChannel(c);
    const { q } = run(S, { car: DEMO_CAR });
    sane(q);
    const cq = q.channels.find(x => x.key === 'Wheel_speed')!;
    expect(cq.validPct).toBeCloseTo(40, 0);
    expect(q.issues.find(i => i.id === 'valid:Wheel_speed')!.level).toBe('warn');
  });
  it('buraco no tempo do log', () => {
    const lines = demoCSV().split('\n');
    const S = parseCSV(lines.slice(0, 1000).concat(lines.slice(1100)).join('\n'), 'buraco.csv');
    const { q } = run(S, { car: DEMO_CAR });
    sane(q);
    const iss = q.issues.find(i => i.id === 'log.gaps')!;
    expect(iss.text).toContain('1 buraco');
    expect(iss.t).toBeCloseTo(S.t[998], 6);
  });
  it('sem GPS: parado pela roda, avisos de GPS ausente', () => {
    const S = demo();
    S.channels = S.channels.filter(c => c.key !== 'O2_General' && c.key !== 'Back_pressure');
    const { q } = run(S, { car: DEMO_CAR });
    sane(q);
    expect(ids(q)).toContain('gps.missing');
    expect(q.gpsBorderPct).toBeNull();
    expect(Number.isNaN(q.gpsUpdateHz)).toBe(true);
  });
  it('carro sem dados de suspensão', () => {
    const { q } = run(demo(), {});
    sane(q);
    const iss = q.issues.find(i => i.id === 'car.data')!;
    expect(iss.level).toBe('warn');
    expect(iss.text).toContain('relação roda/amortecedor');
  });
});
