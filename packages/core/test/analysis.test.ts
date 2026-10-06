/* Equivalência de analysis.ts com legacy/js/analysis.js: o estado da sessão etapa a etapa
 * (trajetória, parado, dinâmica, veículo, suspensão, ângulos, canais) e cada função de
 * análise chamada como a interface antiga chama (analysisui.js), na sessão inteira, em cada
 * volta, numa janela, num trecho curto e num trecho vazio. */
import { describe, it, expect } from 'vitest';
import { loadLegacy, legacyCompute, readFixture, DEMO_CAR as LEGACY_DEMO_CAR, type LegacyState } from './legacy';
import { same } from './compare';
import { parseLog, parseCSV, finishChannel } from '../src/parsers';
import { DEFAULT_CFG, guessGpsChannels, computeTrack, computeLaps, autoLine, smooth } from '../src/gps';
import { idxAt, niceTicks } from '../src/util';
import { demoCSV, DEMO_CAR } from '../src/demo';
import {
  DEFAULT_SUSP, CORNERS, findShocks, deriv, median, quant, interpAt, stoppedMask, suspPrep, velStats, hist, fft, welch, psd,
  findPeak, freeDecay, localPeaks, highpass, dropTests, psdMask, rideRates, gpsDynamics, lapProfile, bestLap, deltaToBest,
  compareLaps, type ActiveShock, type Shock,
} from '../src/analysis';
import { DEFAULT_CAR, vehPrep, bodyAngles, roughness } from '../src/vehicle';
import type { AnalysisConfig, Channel, Session } from '../src/types';
import type { TrackOk } from '../src/gps';

const { BT } = loadLegacy();

/* ------------------------------------------------------------------ estado novo (= legacyCompute) */
function recomputeNew(S: Session, cfg: AnalysisConfig): any {
  const A: any = { S, cfg, sel: -1 };
  A.track = computeTrack(S, cfg);
  A.laps = computeLaps(S, A.track, cfg.line || null, +cfg.minLap || 10);
  A.stopped = stoppedMask(S, A.track);
  A.dyn = A.track.ok ? gpsDynamics(S, A.track) : null;
  A.veh = vehPrep(S, A.track, cfg.car, A.dyn);
  if (!A.stopped && A.veh.v) A.stopped = Uint8Array.from(smooth(S.t, A.veh.v, 1), x => (x === x && x < 0.8 ? 1 : 0));
  A.acc = {
    lon: A.veh.ax || (A.dyn && A.dyn.along), lat: (A.veh.wheel && A.veh.ay) || (A.dyn && A.dyn.alat),
    src: A.veh.wheel ? 'longitudinal pela velocidade da roda, lateral = velocidade da roda × guinada do GPS' : 'pela trajetória do GPS',
  };
  A.susp = suspPrep(S, A.track, cfg.susp);
  A.ang = bodyAngles(A.susp, cfg.car);
  const SG = 'Suspensão (calculado)';
  const sc = (key: string, name: string, unit: string, data: Float64Array) => finishChannel({ key, name, unit, data, src: 'calc', group: SG });
  if (A.ang.pitch) A.susp.channels.push(sc('susp:pitch', 'Arfagem (+ = frente baixa)', '°', A.ang.pitch));
  if (A.ang.rollF) A.susp.channels.push(sc('susp:rollF', 'Rolagem diant. (+ = esq. comprimida)', '°', A.ang.rollF));
  if (A.ang.rollR) A.susp.channels.push(sc('susp:rollR', 'Rolagem tras. (+ = esq. comprimida)', '°', A.ang.rollR));
  const rough = roughness(S.t, A.susp);
  if (rough) A.susp.channels.push(sc('susp:rough', 'Rugosidade (vel. amortecedores RMS 1 s)', 'mm/s', rough));
  const derived: Channel[] = [];
  const tr = A.track;
  if (tr.ok) {
    const mk = (key: string, name: string, unit: string, data: Float64Array) => derived.push(finishChannel({ key, name, unit, data, src: 'gps' }));
    const lapTime = () => {
      const t = S.t, o = new Float64Array(t.length).fill(NaN);
      A.laps.forEach((l: any) => { for (let i = l.i0; i <= l.i1; i++) o[i] = t[i] - l.t0; });
      return o;
    };
    mk('gps:speed', 'GPS · Velocidade', 'km/h', tr.speed);
    mk('gps:lap', 'Tempo na volta', 's', lapTime());
    mk('gps:x', 'GPS · X Leste', 'm', tr.x);
    mk('gps:y', 'GPS · Y Norte', 'm', tr.y);
    mk('gps:dist', 'GPS · Distância', 'm', tr.dist);
    if (A.laps.length >= 2) mk('gps:delta', 'Delta p/ melhor volta', 's', deltaToBest(S, tr, A.laps));
    if (A.dyn) A.dyn.channels.forEach((c: Channel) => { if (!(A.veh && A.veh.wheel && /gps:a(lon|lat)g?/.test(c.key))) derived.push(c); });
    if (S.gps) {
      mk('gps:cx', 'Código X (calculado)', '', tr.codeX);
      mk('gps:cy', 'Código Y (calculado)', '', tr.codeY);
    }
  }
  A.all = derived.concat(A.veh.channels, A.susp.channels, S.channels);
  A.all.forEach((c: Channel) => { c.group = c.group || (c.src === 'gps' ? 'Calculados do GPS' : 'Do log'); });
  return A;
}

function computeNew(S: Session, cfgIn: any = {}, opts: { autoLine?: boolean } = {}): any {
  const cfg: any = Object.assign({}, DEFAULT_CFG, cfgIn);
  cfg.susp = Object.assign({}, DEFAULT_SUSP, cfgIn.susp || {});
  cfg.car = Object.assign({}, DEFAULT_CAR, cfgIn.car || {});
  ['strokeF', 'strokeR', 'massF', 'massR', 'mrF', 'mrR'].forEach(k => {
    if (!(+cfg.car[k] > 0) && +cfg.susp[k] > 0) cfg.car[k] = +cfg.susp[k];
    delete cfg.susp[k];
  });
  const keys = S.channels.map(c => c.key);
  if (!S.gps && (!keys.includes(cfg.chX) || !keys.includes(cfg.chY))) {
    const g = guessGpsChannels(keys);
    cfg.chX = g.x; cfg.chY = g.y; cfg.chStatus = g.status;
  }
  if (cfg.chStatus && !keys.includes(cfg.chStatus)) cfg.chStatus = '';
  let A = recomputeNew(S, cfg);
  if (opts.autoLine && !cfg.line) {
    const l = autoLine(S, A.track);
    if (l) {
      cfg.line = l.map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) }));
      A = recomputeNew(S, cfg);
    }
  }
  return A;
}

/* ------------------------------------------------------------------ sessões */
interface Case { label: string; O: LegacyState; N: any }
function makeCases(): Case[] {
  const out: Case[] = [];
  {
    const So = BT.parseCSV(BT.demoCSV(), 'exemplo_baja.csv'); So.demo = true;
    const Sn = parseCSV(demoCSV(), 'exemplo_baja.csv'); Sn.demo = true;
    out.push({ label: 'exemplo', O: legacyCompute(BT, So, { car: LEGACY_DEMO_CAR }, { autoLine: true }), N: computeNew(Sn, { car: DEMO_CAR }, { autoLine: true }) });
  }
  /* variações do exemplo tirando sensores: os caminhos sem roda (velocidade do GPS), sem GPS
   * (parado pela roda), com só um lado e com a suspensão invertida e outro carro */
  const variants: [string, (k: string) => boolean, any][] = [
    ['exemplo sem roda', k => k !== 'Wheel_speed', { car: DEMO_CAR }],
    ['exemplo sem GPS', k => k !== 'O2_General' && k !== 'Back_pressure', { car: DEMO_CAR }],
    ['exemplo só FL e RL, sem vel. da FT', k => !/Right|velocity/.test(k), { car: { ...DEMO_CAR, mrF: 0 } }],
    ['exemplo só a frente', k => !/Rear|_R[LR]$/.test(k), { car: DEFAULT_CAR, susp: { compPos: false, strokeF: 120 } }],
    ['exemplo roda livre, sem CVT', k => k !== 'CVT_temp', { car: { ...DEMO_CAR, wheelDriven: false, mass: 0, rho: 0 } }],
  ];
  for (const [label, keep, cfg] of variants) {
    const So = BT.parseCSV(BT.demoCSV(), 'exemplo_baja.csv'); So.demo = true;
    const Sn = parseCSV(demoCSV(), 'exemplo_baja.csv'); Sn.demo = true;
    So.channels = So.channels.filter((c: any) => keep(c.key)); Sn.channels = Sn.channels.filter(c => keep(c.key));
    out.push({ label, O: legacyCompute(BT, So, cfg, { autoLine: true }), N: computeNew(Sn, cfg, { autoLine: true }) });
  }
  for (const f of ['ft_log3_gps.csv', 'ft_log3_shocks_compact.csv', 'busmaster_14.log', 'Log 3_20261005-1648_20261005-1651.csv']) {
    const text = readFixture(f);
    if (text === null) continue;
    out.push({ label: f, O: legacyCompute(BT, BT.parseLog(text, f), {}, { autoLine: true }), N: computeNew(parseLog(text, f), {}, { autoLine: true }) });
  }
  return out;
}
const CASES = makeCases();

/* trechos como Analysis.range(): sessão, voltas, janela do gráfico, curto, um ponto, vazio */
function windows(N: any): [string, number, number][] {
  const t: Float64Array = N.S.t, n = t.length, out: [string, number, number][] = [['sessão', 0, n - 1]];
  N.laps.slice(0, 6).forEach((l: any) => out.push([`volta ${l.n}`, l.i0, l.i1]));
  out.push(['janela do meio', Math.floor(n / 3), Math.floor(2 * n / 3)]);
  const t0 = t[0] + (t[n - 1] - t[0]) * 0.2, t1 = t0 + 30;
  out.push(['janela 30 s', idxAt(t, t0), idxAt(t, t1)]);
  const m = n >> 1;
  out.push(['curto', m, Math.min(n - 1, m + 10)], ['um ponto', m, m], ['vazio', m, m - 1]);
  return out;
}

/* chama as duas e compara (resultado, ou os dois lançam erro) */
function eq(at: string, fo: () => unknown, fn: () => unknown, opts?: Parameters<typeof same>[2]): void {
  let ro: unknown, rn: unknown, eo: unknown = null, en: unknown = null;
  try { ro = fo(); } catch (e) { eo = e; }
  try { rn = fn(); } catch (e) { en = e; }
  expect(en ? `erro: ${(en as Error).message}` : 'ok', at).toBe(eo ? `erro: ${(eo as Error).message}` : 'ok');
  if (!eo) expect(same(ro, rn, opts), at).toEqual([]);
}

const actOf = (shocks: Shock[]) => shocks.filter((k): k is ActiveShock => k.active);

describe('analysis: constantes', () => {
  it('DEFAULT_SUSP e CORNERS', () => {
    expect(same(BT.DEFAULT_SUSP, DEFAULT_SUSP)).toEqual([]);
    expect(CORNERS.map(c => [c.id, c.label, c.axle, c.re.source, c.re.flags]))
      .toEqual(BT.CORNERS.map((c: any) => [c.id, c.label, c.axle, c.re.source, c.re.flags]));
  });
});

describe('analysis: utilidades', () => {
  const tReg = Float64Array.from({ length: 300 }, (_, i) => i * 0.04);
  const tIrr = Float64Array.from({ length: 300 }, (_, i) => i * 0.04 + (i % 5) * 0.011 + (i > 150 ? 2 : 0));
  const A1 = Float64Array.from({ length: 300 }, (_, i) => Math.sin(i * 0.13) * 12 + (i % 4));
  const A2 = Float64Array.from(A1, (v, i) => (i % 29 < 3 || (i > 80 && i < 95) || i === 0 || i === 299 ? NaN : v));
  const A3 = Float64Array.from(A1, (v, i) => (i % 2 ? NaN : v));     /* só pontos isolados */
  const A4 = new Float64Array(300).fill(NaN);

  it('deriv', () => {
    for (const t of [tReg, tIrr]) for (const a of [A1, A2, A3, A4]) for (const H of [0, 0.01, 0.04, 0.06, 0.12, 0.5, 3, 100])
      eq(`H=${H}`, () => BT.deriv(t, a, H), () => deriv(t, a, H));
    eq('vazio', () => BT.deriv([], [], 1), () => deriv([], [], 1));
    eq('1 ponto', () => BT.deriv([0], [3], 1), () => deriv([0], [3], 1));
    for (const c of CASES) for (const ch of c.N.S.channels as Channel[]) {
      const o = c.O.S.channels.find((x: any) => x.key === ch.key);
      eq(`${c.label} ${ch.key}`, () => BT.deriv(c.O.S.t, o.data, 0.06), () => deriv(c.N.S.t, ch.data, 0.06));
    }
  });

  it('median, quant, interpAt', () => {
    const mask = Uint8Array.from({ length: 300 }, (_, i) => (i % 3 ? 1 : 0));
    for (const a of [A1, A2, A3, A4, new Float64Array(0), Float64Array.of(5), Float64Array.of(2, 1)]) {
      eq('median', () => BT.median(a), () => median(a));
      eq('median mask', () => BT.median(a, mask), () => median(a, mask));
      eq('median mask null', () => BT.median(a, null), () => median(a, null));
      const s = Array.from(a).filter(x => x === x).sort((x, y) => x - y);
      for (const q of [0, 0.002, 0.05, 0.1, 0.5, 0.9, 0.95, 0.995, 1, -1, 2, NaN]) eq(`quant ${q}`, () => BT.quant(s, q), () => quant(s, q));
    }
    const xs = [0, 1, 1, 2, 5, 5, 9], ys = [10, 20, 25, 30, 0, 7, -3];
    for (const x of [-1, 0, 0.5, 1, 1.5, 2, 3, 5, 6, 9, 10, NaN]) {
      eq(`interpAt ${x}`, () => BT.interpAt(xs, ys, x), () => interpAt(xs, ys, x));
      eq(`interpAt vazio ${x}`, () => BT.interpAt([], [], x), () => interpAt([], [], x));
      eq(`interpAt 1 ${x}`, () => BT.interpAt([2], [4], x), () => interpAt([2], [4], x));
    }
  });

  it('fft, welch, psd, findPeak, localPeaks, highpass', () => {
    for (const N of [1, 2, 4, 8, 64, 256]) {
      const ro = Float64Array.from({ length: N }, (_, i) => Math.cos(i * 0.7) + (i % 3)), io = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.3));
      const rn = Float64Array.from(ro), inn = Float64Array.from(io);
      BT.fft(ro, io); fft(rn, inn);
      expect(same(ro, rn), `fft re ${N}`).toEqual([]);
      expect(same(io, inn), `fft im ${N}`).toEqual([]);
    }
    const x = Float64Array.from({ length: 1000 }, (_, i) => Math.sin(i * 2 * Math.PI * 1.6 / 25) * 10 + Math.sin(i * 0.9) * 2 + (i % 7) * 0.1);
    for (const N of [64, 128, 256]) {
      eq(`welch ${N}`, () => BT.welch(x, 25, N), () => welch(x, 25, N));
      eq(`welch ${N} starts`, () => BT.welch(x, 25, N, [0, 10, 300]), () => welch(x, 25, N, [0, 10, 300]));
      eq(`welch ${N} null`, () => BT.welch(x, 25, N, null), () => welch(x, 25, N, null));
      eq(`welch ${N} sem segmentos`, () => BT.welch(x, 25, N, []), () => welch(x, 25, N, []));
    }
    const t = Float64Array.from({ length: 1000 }, (_, i) => i / 25);
    const xn = Float64Array.from(x, (v, i) => (i % 11 === 0 || (i > 500 && i < 540) ? NaN : v));
    const xnn = Float64Array.from(x, (v, i) => (i % 2 ? NaN : v));
    for (const a of [x, xn, xnn]) for (const [i0, i1] of [[0, 999], [0, 62], [0, 63], [100, 300], [10, 140], [400, 999], [5, 4]]) for (const hp of [0, 2, 0.5, 10]) {
      eq(`psd ${i0}-${i1} hp=${hp}`, () => BT.psd(t, a, i0, i1, hp), () => psd(t, a, i0, i1, hp));
      const p = psd(t, a, i0, i1, hp);
      if (p) for (const [f0, f1] of [[0.6, 4.5], [0, 20], [1, 1.2], [10, 11], [5, 1]]) {
        eq(`findPeak ${f0}-${f1}`, () => BT.findPeak(p.f, p.p, f0, f1), () => findPeak(p.f, p.p, f0, f1));
        for (const mx of [1, 3, 5, 100]) eq(`localPeaks ${f0}-${f1} ${mx}`, () => BT.localPeaks(p.f, p.p, f0, f1, mx), () => localPeaks(p.f, p.p, f0, f1, mx));
        eq(`localPeaks padrão`, () => BT.localPeaks(p.f, p.p, f0, f1), () => localPeaks(p.f, p.p, f0, f1));
      }
    }
    eq('psd padrão', () => BT.psd(t, x, 0, 999), () => psd(t, x, 0, 999));
    /* picos sintéticos: borda, meia potência só de um lado, platô, banda vazia, tudo zero */
    const f = Float64Array.from({ length: 20 }, (_, i) => i * 0.25);
    const ps = [
      Float64Array.from({ length: 20 }, (_, i) => Math.exp(-((i - 7) ** 2) / 3)),
      Float64Array.from({ length: 20 }, (_, i) => 1 / (1 + i)),
      Float64Array.from({ length: 20 }, (_, i) => i),
      Float64Array.from({ length: 20 }, () => 1),
      new Float64Array(20),
      Float64Array.from({ length: 20 }, (_, i) => (i === 5 || i === 6 ? 4 : 1)),
    ];
    for (const p of ps) for (const [f0, f1] of [[0, 5], [0.6, 4.5], [1.5, 1.5], [3, 2]]) {
      eq('findPeak sintético', () => BT.findPeak(f, p, f0, f1), () => findPeak(f, p, f0, f1));
      eq('localPeaks sintético', () => BT.localPeaks(f, p, f0, f1, 3), () => localPeaks(f, p, f0, f1, 3));
    }
    for (const a of [x, xn]) for (const s of [0, 0.5, 2]) eq(`highpass ${s}`, () => BT.highpass(t, a, s), () => highpass(t, a, s));
  });

  it('freeDecay e rideRates (sintéticos)', () => {
    const t = Float64Array.from({ length: 200 }, (_, i) => i / 25);
    const mk = (zeta: number, amp: number, noise: number) => Float64Array.from(t, (x, i) => {
      const wn = 2 * Math.PI * 1.6, wd = wn * Math.sqrt(1 - zeta * zeta);
      return x < 0.5 ? (i % 3) * noise : amp * Math.exp(-zeta * wn * (x - 0.5)) * Math.cos(wd * (x - 0.5)) + ((i * 7) % 5 - 2) * noise;
    });
    for (const z of [0.05, 0.2, 0.33, 0.6, 0.9]) for (const amp of [0.5, 3, 30, -30]) for (const nz of [0, 0.1, 2]) {
      const a = mk(z, amp, nz);
      for (const [i0, i1] of [[0, 199], [10, 199], [12, 60], [0, 18], [0, 19], [190, 199]])
        eq(`freeDecay z=${z} a=${amp} n=${nz} ${i0}-${i1}`, () => BT.freeDecay(t, a, i0, i1), () => freeDecay(t, a, i0, i1));
    }
    eq('freeDecay NaN', () => BT.freeDecay(t, new Float64Array(200).fill(NaN), 0, 199), () => freeDecay(t, new Float64Array(200).fill(NaN), 0, 199));
    for (const fn of [0, -1, NaN, 1.6, 2.5]) for (const z of [0, 0.3, NaN, -1]) for (const m of [0, 62, NaN, -5]) for (const mr of [0, 1.6, NaN])
      eq(`rideRates ${fn} ${z} ${m} ${mr}`, () => BT.rideRates(fn, z, m, mr), () => rideRates(fn, z, m, mr));
  });

  it('dropTests sintético (limiares de evento, calma antes e depois, espaçamento)', () => {
    const fs = 25, n = 60 * fs, t = Float64Array.from({ length: n }, (_, i) => i / fs);
    /* eventos: [t, amplitude, ruído antes, fração de buracos depois] */
    const evs: [number, number, number, number][] = [
      [3, 7.5, 0, 0], [7, 8.5, 0, 0], [10, 20, 0, 0], [11.8, 20, 0, 0], [15, 20, 0, 0], [17.4, 20, 0, 0],
      [22, 20, 3, 0], [26, 20, 6, 0], [30, 20, 0, 0.05], [34, 20, 0, 0.15], [38, 12, 0, 0], [44, 30, 0, 0.08], [50, -25, 0, 0],
    ];
    const mk = (zeta: number, ph: number) => {
      const d = new Float64Array(n);
      for (const [te, amp, pre, holes] of evs) for (let i = 0; i < n; i++) {
        const x = t[i] - te, wn = 2 * Math.PI * 1.6;
        if (x >= -1.2 && x < -0.3 && pre) d[i] += pre * Math.sin(i + ph);
        if (x >= 0 && x < 3.5) d[i] += amp * Math.exp(-zeta * wn * x) * Math.cos(wn * Math.sqrt(1 - zeta * zeta) * x);
        if (holes && x > 0.2 && x < 2 && ((i * 7 + ph) % 100) < holes * 100) d[i] = NaN;
      }
      return d;
    };
    const shocks = ['FL', 'FR', 'RL', 'RR'].map((id, k) => ({ id, active: k !== 2, disp: mk(0.2 + 0.1 * k, k) })) as unknown as Shock[];
    const stopped = Uint8Array.from(t, x => (x > 41 && x < 42.5 ? 0 : 1));
    for (const st of [stopped, null]) for (const [i0, i1] of [[0, n - 1], [100, 900], [10 * fs, 10 * fs + 30], [500, 499]])
      eq(`dropTests ${i0}-${i1}`, () => BT.dropTests(t, shocks, st, i0, i1), () => dropTests(t, shocks, st, i0, i1));
    eq('dropTests sem ativos', () => BT.dropTests(t, shocks.map(k => ({ ...k, active: false })), stopped, 0, n - 1),
      () => dropTests(t, shocks.map(k => ({ ...k, active: false })), stopped, 0, n - 1));
    expect(dropTests(t, shocks, stopped, 0, n - 1).length).toBeGreaterThan(3);
  });

  it('suspPrep e gpsDynamics sintéticos (estático com 24/25 amostras paradas, raio no limite)', () => {
    const n = 600, t = Float64Array.from({ length: n }, (_, i) => i * 0.04);
    const x = new Float64Array(n), y = new Float64Array(n), heading = new Float64Array(n), speed = new Float64Array(n);
    let px = 0, h = 0.3;
    for (let i = 0; i < n; i++) {
      const v = t[i] > 8 && t[i] < 11 ? 0 : 5;
      const rate = t[i] < 4 ? 0.0015 : t[i] < 6 ? 0.0008 : t[i] > 16 ? 0.5 : 0.002;
      h += rate * 0.04; px += v * 0.04;
      x[i] = px * Math.sin(0.3); y[i] = px * Math.cos(0.3); heading[i] = h > Math.PI ? h - 2 * Math.PI : h; speed[i] = v * 3.6;
    }
    const valid = Uint8Array.from(t, (q, i) => (i % 53 === 0 ? 0 : 1));
    const tr = { ok: true, x, y, valid, speed, heading, dist: new Float64Array(n) } as unknown as TrackOk;
    const Sbase = { name: 's', kind: 'FT', t, channels: [], info: '' } as unknown as Session;
    const stopped = stoppedMask(Sbase, tr)!;
    expect(same(BT.stoppedMask(Sbase, tr), stopped)).toEqual([]);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (stopped[i]) idx.push(i);
    expect(idx.length).toBeGreaterThan(26);
    for (const K of [24, 25, 26, 0]) {
      const p = Float64Array.from(t, (q, i) => 20 + Math.sin(i * 0.2) * 3 + (stopped[i] ? 5 : 0));
      idx.slice(K).forEach(i => { p[i] = NaN; });
      const ch = (key: string, data: Float64Array) => finishChannel({ key, name: key, unit: 'mm', data, src: 'log' as const });
      const S = { ...Sbase, channels: [ch('Shock_-_Front_Left', p), ch('Shock_-_Rear_Right', Float64Array.from(p, v => v * 2)), ch('Shock_velocity_RR', new Float64Array(n).fill(1))] } as Session;
      for (const compPos of [true, false]) eq(`suspPrep K=${K}`, () => BT.suspPrep(S, tr, { compPos }), () => suspPrep(S, tr, { compPos }));
    }
    eq('gpsDynamics', () => BT.gpsDynamics(Sbase, tr), () => gpsDynamics(Sbase, tr));
  });

  it('findShocks em listas sintéticas', () => {
    const names = ['Shock_-_Front_Left', 'Shock_-_Front_Right', 'Shock_-_Rear_Left', 'Shock_-_Rear_Right', 'Shock_vel_-_Front_Left',
      'amort_DE', 'amort_dd', 'susp TE', 'damper td', 'Shock FL vel', 'susp_fl', 'susp_fr_pos', 'Amortecedor diant esq', 'Amortecedor traseiro direito',
      'Shock_rl', 'shockrr', 'Back_pressure', 'Shock_-_Front_Left_2'];
    const chs = names.map((key, k) => finishChannel({ key, name: key, unit: 'mm', data: Float64Array.from({ length: 10 }, (_, i) => (k % 4 === 3 ? 1 : i + k)), src: 'log' as const }));
    const lists = [chs, chs.slice(0, 4), chs.slice(4), chs.slice(10), [], chs.map(c => ({ ...c, src: 'calc' as const }))];
    for (const l of lists) eq('findShocks', () => BT.findShocks(l), () => findShocks(l));
  });
});

describe('analysis: estado da sessão (recompute) igual ao do app antigo', () => {
  for (const c of CASES) {
    it(c.label, () => {
      const { O, N } = c;
      expect(same(O.track, N.track), 'track').toEqual([]);
      expect(same(O.laps, N.laps), 'laps').toEqual([]);
      expect(same(O.stopped, N.stopped), 'stopped').toEqual([]);
      expect(same(O.dyn, N.dyn), 'dyn').toEqual([]);
      expect(same(O.veh, N.veh), 'veh').toEqual([]);
      expect(same(O.acc, N.acc), 'acc').toEqual([]);
      expect(same(O.susp, N.susp), 'susp').toEqual([]);
      expect(same(O.ang, N.ang), 'ang').toEqual([]);
      expect(same(O.all.map((x: any) => x.key), N.all.map((x: any) => x.key)), 'chaves dos canais').toEqual([]);
      expect(same(O.all, N.all), 'canais').toEqual([]);
      /* chamadas diretas com as entradas do estado */
      eq('stoppedMask', () => BT.stoppedMask(O.S, O.track), () => stoppedMask(N.S, N.track));
      eq('stoppedMask null', () => BT.stoppedMask(O.S, null), () => stoppedMask(N.S, null));
      eq('findShocks', () => BT.findShocks(O.S.channels), () => findShocks(N.S.channels));
      for (const compPos of [true, false]) {
        eq(`suspPrep compPos=${compPos}`, () => BT.suspPrep(O.S, O.track, { compPos }), () => suspPrep(N.S, N.track, { compPos }));
        eq(`suspPrep sem GPS compPos=${compPos}`, () => BT.suspPrep(O.S, null, { compPos }), () => suspPrep(N.S, null, { compPos }));
      }
      if (N.track.ok) {
        eq('gpsDynamics', () => BT.gpsDynamics(O.S, O.track), () => gpsDynamics(N.S, N.track));
        eq('deltaToBest', () => BT.deltaToBest(O.S, O.track, O.laps), () => deltaToBest(N.S, N.track, N.laps));
        eq('deltaToBest 1 volta', () => BT.deltaToBest(O.S, O.track, O.laps.slice(0, 1)), () => deltaToBest(N.S, N.track, N.laps.slice(0, 1)));
        eq('deltaToBest sem voltas', () => BT.deltaToBest(O.S, O.track, []), () => deltaToBest(N.S, N.track, []));
      }
      expect(N.track.ok, c.label).toBe(O.track.ok);
      if (!['busmaster_14.log', 'exemplo sem GPS'].includes(c.label)) expect(N.track.ok, c.label).toBe(true);
    });
  }
});

describe('analysis: funções nos trechos (como analysisui.js)', () => {
  for (const c of CASES) {
    it(c.label, () => {
      const { O, N } = c;
      const tO = O.S.t, tN: Float64Array = N.S.t;
      const actO = O.susp.shocks.filter((k: any) => k.active), actN = actOf(N.susp.shocks);
      expect(actN.map(k => k.id)).toEqual(actO.map((k: any) => k.id));
      const mvO = O.stopped ? Uint8Array.from(O.stopped, (v: number) => 1 - v) : null;
      const mvN = N.stopped ? Uint8Array.from(N.stopped as Uint8Array, v => 1 - v) : null;
      const sp = N.cfg.susp, fmin = +sp.fmin || 0.6, fmax = +sp.fmax || 4.5;
      for (const [wl, i0, i1] of windows(N)) {
        const at = `${c.label} · ${wl}`;
        /* ---- suspensão (renderSusp) */
        let R = 0;
        actN.forEach((k, j) => {
          const kO = actO[j];
          for (const knee of [100, 50]) for (const mv of [true, false])
            eq(`${at} velStats ${k.id} ${knee} ${mv}`, () => BT.velStats(kO.v, i0, i1, mv ? mvO : null, knee), () => velStats(k.v, i0, i1, mv ? mvN : null, knee));
          const a: number[] = [];
          for (let i = i0; i <= i1; i++) { const v = k.v[i]; if (v === v && (!mvN || mvN[i])) a.push(Math.abs(v)); }
          a.sort((x, y) => x - y);
          expect(quant(a, 0.995), at).toBe(BT.quant(a, 0.995));
          R = Math.max(R, quant(a, 0.995) || 0);
        });
        const step = niceTicks(0, Math.max(R, 10), 12);
        const bw = step.length > 1 ? step[1] - step[0] : 10, nb = Math.ceil(Math.max(R, 10) / bw);
        actN.forEach((k, j) => {
          const kO = actO[j];
          eq(`${at} hist v ${k.id}`, () => BT.hist(kO.v, i0, i1, mvO, -nb * bw, nb * bw, 2 * nb), () => hist(k.v, i0, i1, mvN, -nb * bw, nb * bw, 2 * nb));
          eq(`${at} hist disp ${k.id}`, () => BT.hist(kO.disp, i0, i1, null, -40, 40, 33), () => hist(k.disp, i0, i1, null, -40, 40, 33));
        });
        /* ---- ressonância (renderFreq / analyzeManual) */
        for (const stopped of [true, false])
          eq(`${at} dropTests stopped=${stopped}`, () => BT.dropTests(tO, O.susp.shocks, stopped ? O.stopped : null, i0, i1),
            () => dropTests(tN, N.susp.shocks, stopped ? N.stopped : null, i0, i1));
        const ev = dropTests(tN, N.susp.shocks, N.stopped, i0, i1);
        ev.forEach(e => e.res.forEach(r => {
          if (!(r.ok && !r.over)) return;
          const F = r.id[0] === 'F', car = N.cfg.car;
          eq(`${at} rideRates`, () => BT.rideRates(r.fn, r.zeta, +(F ? car.massF : car.massR), +(F ? car.mrF : car.mrR)),
            () => rideRates(r.fn, r.zeta, +(F ? car.massF : car.massR), +(F ? car.mrF : car.mrR)));
        }));
        actN.forEach((k, j) => {
          const kO = actO[j];
          eq(`${at} freeDecay ${k.id}`, () => BT.freeDecay(tO, kO.disp, i0, i1), () => freeDecay(tN, k.disp, i0, i1));
          for (const N2 of [256, 128])
            eq(`${at} psdMask ${k.id} ${N2}`, () => BT.psdMask(tO, kO.disp, i0, i1, mvO, 2, N2), () => psdMask(tN, k.disp, i0, i1, mvN, 2, N2));
          eq(`${at} psdMask padrão ${k.id}`, () => BT.psdMask(tO, kO.disp, i0, i1, null), () => psdMask(tN, k.disp, i0, i1, null));
          const all = psdMask(tN, k.disp, i0, i1, mvN, 2, 256) || psdMask(tN, k.disp, i0, i1, mvN, 2, 128);
          const allO = BT.psdMask(tO, kO.disp, i0, i1, mvO, 2, 256) || BT.psdMask(tO, kO.disp, i0, i1, mvO, 2, 128);
          if (all) eq(`${at} localPeaks ${k.id}`, () => BT.localPeaks(allO.f, allO.p, fmin, fmax, 3), () => localPeaks(all.f, all.p, fmin, fmax, 3));
          for (const hp of [2, 0]) {
            eq(`${at} psd ${k.id} hp=${hp}`, () => BT.psd(tO, kO.disp, i0, i1, hp), () => psd(tN, k.disp, i0, i1, hp));
            const p = psd(tN, k.disp, i0, i1, hp), pO = BT.psd(tO, kO.disp, i0, i1, hp);
            if (p) eq(`${at} findPeak ${k.id}`, () => BT.findPeak(pO.f, pO.p, fmin, fmax), () => findPeak(p.f, p.p, fmin, fmax));
          }
        });
        if (N.track.ok && mvN && actN.length) {
          /* devagar × rápido: mesmas máscaras do renderFreq */
          const speeds: number[] = [];
          for (let i = i0; i <= i1; i++) if (mvN[i] && N.track.speed[i] === N.track.speed[i]) speeds.push(N.track.speed[i]);
          speeds.sort((a, b) => a - b);
          for (const [ql, qh] of [[1 / 3, 2 / 3], [0.4, 0.6], [0.5, 0.5]]) {
            if (!speeds.length) break;
            const a = quant(speeds, ql), b = quant(speeds, qh);
            expect([a, b]).toEqual([BT.quant(speeds, ql), BT.quant(speeds, qh)]);
            const slow = Uint8Array.from(N.track.speed as Float64Array, (v, i) => (mvN[i] && v < a ? 1 : 0));
            const fast = Uint8Array.from(N.track.speed as Float64Array, (v, i) => (mvN[i] && v >= b ? 1 : 0));
            actN.forEach((k, j) => {
              eq(`${at} psdMask lento ${k.id} ${ql}`, () => BT.psdMask(tO, actO[j].disp, i0, i1, slow, 2, 128), () => psdMask(tN, k.disp, i0, i1, slow, 2, 128));
              eq(`${at} psdMask rápido ${k.id} ${ql}`, () => BT.psdMask(tO, actO[j].disp, i0, i1, fast, 2, 128), () => psdMask(tN, k.disp, i0, i1, fast, 2, 128));
            });
          }
        }
        /* ---- dinâmica (renderDyn): tempo por faixa de velocidade */
        if (N.track.ok) {
          let vmax = 0;
          for (let i = i0; i <= i1; i++) { const v = N.track.speed[i]; if (v === v && v > vmax) vmax = v; }
          const bw2 = vmax > 40 ? 5 : vmax > 15 ? 2 : 1, nb2 = Math.max(1, Math.ceil(vmax / bw2));
          eq(`${at} hist velocidade`, () => BT.hist(O.track.speed, i0, i1, mvO, 0, nb2 * bw2, nb2), () => hist(N.track.speed, i0, i1, mvN, 0, nb2 * bw2, nb2));
          eq(`${at} highpass speed`, () => BT.highpass(tO, O.track.speed, 2), () => highpass(tN, N.track.speed, 2));
        }
      }
      /* ---- voltas (renderLaps): todas as combinações referência × comparada */
      if (N.track.ok) {
        eq('bestLap', () => BT.bestLap(O.laps), () => bestLap(N.laps));
        eq('bestLap vazio', () => BT.bestLap([]), () => bestLap([]));
        const L = N.laps.slice(0, 5), LO = O.laps.slice(0, 5);
        L.forEach((lr: any, a: number) => {
          eq(`lapProfile ${lr.n}`, () => BT.lapProfile(O.S, O.track, LO[a]), () => lapProfile(N.S, N.track as TrackOk, lr));
          L.forEach((lc: any, b: number) => {
            const pr = lapProfile(N.S, N.track, lr), pc = lapProfile(N.S, N.track, lc);
            const prO = BT.lapProfile(O.S, O.track, LO[a]), pcO = BT.lapProfile(O.S, O.track, LO[b]);
            for (const st of [1, 0.5, 7]) eq(`compareLaps ${lr.n}×${lc.n} passo ${st}`, () => BT.compareLaps(prO, pcO, st), () => compareLaps(pr, pc, st));
            eq(`compareLaps padrão ${lr.n}×${lc.n}`, () => BT.compareLaps(prO, pcO), () => compareLaps(pr, pc));
          });
        });
      }
    });
  }
});

describe('analysis: sanidade no exemplo (tabela de validação do legacy/README.md)', () => {
  it('frequência natural e ζ da dianteira pelo teste de queda', () => {
    const N = CASES.find(c => c.label === 'exemplo')!.N;
    const n = N.S.t.length;
    const ev = dropTests(N.S.t, N.susp.shocks, N.stopped, 0, n - 1)[0];
    expect(ev).toBeTruthy();
    const front = ev.res.filter(r => ['FL', 'FR'].includes(r.id) && r.ok && !r.over);
    const fn = front.reduce((s, r) => s + (r.ok && !r.over ? r.fn : 0), 0) / front.length;
    const zeta = front.reduce((s, r) => s + (r.ok && !r.over ? r.zeta : 0), 0) / front.length;
    expect(fn.toFixed(2)).toBe('1.61');            /* README: app 1,61 Hz (modelo ~1,6 Hz) */
    expect(Math.abs(zeta - 0.34)).toBeLessThan(0.02); /* README: app 0,34 (modelo 0,33) */
  });
});
