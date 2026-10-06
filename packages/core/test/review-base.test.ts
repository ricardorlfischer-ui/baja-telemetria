/* Revisão adversarial do porte de util/parsers/gps/demo/analysis/vehicle.
 *
 * Os testes de equivalência usam same() (test/compare.ts), que é tolerante de propósito:
 * tolerância relativa 1e-9, -0 igual a 0, Float64Array igual a Array, não olha a ordem das
 * chaves e trata { x: undefined } como "sem x". Aqui a comparação é ESTRITA, bit a bit
 * (Object.is em cada número, mesmo tipo de array, mesmas chaves na mesma ordem, mesmo tipo
 * de valor: 0 ≠ false), porque o código é o mesmo e roda no mesmo V8: qualquer diferença,
 * por menor que seja, é diferença de comportamento.
 *
 * As entradas saem de um gerador com semente fixa (fuzz diferencial): arrays com NaN no meio,
 * -0, ±Infinity, MAX_VALUE, trechos de 1 amostra, trechos invertidos, logs curtos, sem GPS,
 * sem roda, sem CVT, um só amortecedor, nomes de canais variados, números como texto (como
 * vinham do formulário do app antigo), CSV e BUSMASTER gerados por gramática. Cada função
 * recebe cópias próprias das entradas, e as entradas também são comparadas depois da chamada
 * (pega mutação de entrada que um lado faz e o outro não). Erros: mesmo nome e mensagem. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadLegacy, legacyCompute, readFixture, LEGACY_DIR, DEMO_CAR as LEGACY_DEMO_CAR } from './legacy';
import { same } from './compare';
import * as U from '../src/util';
import * as P from '../src/parsers';
import * as G from '../src/gps';
import * as A from '../src/analysis';
import * as V from '../src/vehicle';
import { demoCSV, DEMO_CAR } from '../src/demo';
import type { AnalysisConfig, Channel, Session } from '../src/types';

const { BT } = loadLegacy();
const NEW: Record<string, Fn> = { ...U, ...P, ...G, ...A, ...V } as any;

type Fn = (...a: any[]) => any;

/* ------------------------------------------------------------------ comparação estrita */
const TAG = (v: unknown) => Object.prototype.toString.call(v);
const TYPED = /^\[object (Float(32|64)|U?Int(8|16|32)|Uint8Clamped|Big(Ui|I)nt64)Array\]$/;
const show = (v: unknown) => (typeof v === 'number' && Object.is(v, -0) ? '-0' : typeof v === 'string' ? JSON.stringify(v).slice(0, 80) : String(v));

/** Diferenças bit a bit entre o resultado antigo (a) e o novo (b); vazia = idênticos. */
function sdiff(a: any, b: any, at = '$', out: string[] = [], max = 20): string[] {
  if (out.length >= max) return out;
  const ta = typeof a, tb = typeof b;
  if (ta !== tb) { out.push(`${at}: ${ta} ${show(a)} ≠ ${tb} ${show(b)}`); return out; }
  if (ta === 'function') return out;
  if (ta !== 'object' || a === null || b === null) {
    if (!Object.is(a, b)) out.push(`${at}: ${show(a)} ≠ ${show(b)}`);
    return out;
  }
  const ka = TAG(a), kb = TAG(b);
  if (ka !== kb) { out.push(`${at}: ${ka} ≠ ${kb}`); return out; }
  if (ka === '[object RegExp]') { if (String(a) !== String(b)) out.push(`${at}: ${a} ≠ ${b}`); return out; }
  if (Array.isArray(a) || TYPED.test(ka)) {
    if (a.length !== b.length) { out.push(`${at}: tamanho ${a.length} ≠ ${b.length}`); return out; }
    for (let i = 0; i < a.length && out.length < max; i++) sdiff(a[i], b[i], `${at}[${i}]`, out, max);
    return out;
  }
  const ea = Object.keys(a), eb = Object.keys(b);
  if (ea.join('|') !== eb.join('|')) out.push(`${at}: chaves [${ea.join(',')}] ≠ [${eb.join(',')}]`);
  for (const k of ea) if (Object.prototype.hasOwnProperty.call(b, k)) sdiff(a[k], b[k], `${at}.${k}`, out, max);
  return out;
}

/* cópia profunda que mantém o tipo dos typed arrays (structuredClone não aceita funções) */
function clone(v: any): any {
  if (v === null || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v)) return (v as any).slice();
  if (Array.isArray(v)) return v.map(clone);
  if (v instanceof RegExp) return v;
  const o: any = {};
  for (const k of Object.keys(v)) o[k] = clone(v[k]);
  return o;
}

const run = (f: Fn, args: unknown[]): { v?: unknown; e?: string } => {
  try { return { v: f(...args) }; } catch (e: any) { return { e: `${e?.name}: ${e?.message}` }; }
};

/** Junta as diferenças de muitas chamadas (um expect só no fim do teste, mais rápido). */
class Bag {
  diffs: string[] = [];
  calls = 0;
  /* chama o antigo e o novo com cópias das mesmas entradas; compara resultado (ou erro) e as
   * entradas depois da chamada */
  cmp(at: string, fo: Fn, fn: Fn, args: unknown[]): any {
    const ao = clone(args), an = clone(args);
    const ro = run(fo, ao), rn = run(fn, an);
    this.calls++;
    if (this.diffs.length >= 20) return rn.v;
    if (ro.e !== undefined || rn.e !== undefined) {
      if (ro.e !== rn.e) this.diffs.push(`${at}: erro antigo «${ro.e}» / novo «${rn.e}»`);
    } else sdiff(ro.v, rn.v, at, this.diffs);
    sdiff(ao, an, `${at} [entradas depois]`, this.diffs);
    return rn.v;
  }
  /* compara dois valores já calculados */
  eq(at: string, a: unknown, b: unknown): void { this.calls++; if (this.diffs.length < 20) sdiff(a, b, at, this.diffs); }
}

/* ------------------------------------------------------------------ gerador com semente */
const SPECIAL = [0, -0, NaN, Infinity, -Infinity, 1, -1, 0.5, -0.5, 1e-12, 1e300, -1e300, Number.MAX_VALUE, Number.MIN_VALUE,
  254, 255, 256, 5.2, 5200, 0.3, 0.8, 8, 100, 1000];

class Gen {
  constructor(private s: number) {}
  r(): number {
    this.s |= 0; this.s = this.s + 0x6D2B79F5 | 0;
    let t = Math.imul(this.s ^ this.s >>> 15, 1 | this.s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  int(a: number, b: number): number { return a + Math.floor(this.r() * (b - a + 1)); }
  pick<T>(a: readonly T[]): T { return a[Math.floor(this.r() * a.length)]; }
  chance(p: number): boolean { return this.r() < p; }
  num(scale = 100): number { return this.chance(0.25) ? this.pick(SPECIAL) : (this.r() * 2 - 1) * scale; }
  /* tempo: regular, com jitter, com buraco, repetido ou voltando (log real tem de tudo) */
  times(n: number, kind = this.pick(['reg', 'reg', 'jit', 'gap', 'dup', 'neg'] as const)): Float64Array {
    const t = new Float64Array(n), dt = this.pick([0.04, 0.05, 0.1, 0.2, 0.5]);
    let x = this.pick([0, 0, -2, 37.5]);
    for (let i = 0; i < n; i++) {
      t[i] = x;
      let st = dt;
      if (kind === 'jit') st *= 0.7 + 0.6 * this.r();
      if (kind === 'gap' && this.chance(0.01)) st += this.pick([1, 2.5, 10]);
      if (kind === 'dup' && this.chance(0.05)) st = 0;
      if (kind === 'neg' && this.chance(0.02)) st = -dt;
      x += st;
    }
    return t;
  }
  /* sinal com buracos de NaN, -0 e alguns valores especiais */
  signal(n: number, scale = 50, opts: { nan?: boolean; special?: boolean } = {}): Float64Array {
    const kind = this.pick(['sin', 'walk', 'const', 'step', 'spiky', 'int'] as const);
    const a = new Float64Array(n), f = 0.02 + this.r() * 0.5, off = this.num(scale);
    let w = 0;
    for (let i = 0; i < n; i++) {
      if (kind === 'sin') a[i] = off + scale * Math.sin(i * f) + (this.r() - 0.5) * scale * 0.1;
      else if (kind === 'walk') a[i] = w += (this.r() - 0.5) * scale * 0.1;
      else if (kind === 'const') a[i] = off;
      else if (kind === 'step') a[i] = Math.floor(i * f) % 3 * scale;
      else if (kind === 'int') a[i] = Math.round(off + scale * Math.sin(i * f));
      else a[i] = this.chance(0.05) ? scale * 5 * (this.r() - 0.5) : (this.r() - 0.5) * scale * 0.2;
    }
    if (opts.nan !== false && this.chance(0.5)) {
      for (let k = this.int(0, 3); k > 0; k--) { const s = this.int(0, Math.max(0, n - 1)), len = this.int(1, 30); for (let i = s; i < Math.min(n, s + len); i++) a[i] = NaN; }
      if (this.chance(0.3)) for (let i = 0; i < n; i++) if (this.chance(0.05)) a[i] = NaN;
    }
    if (this.chance(0.2)) for (let i = 0; i < n; i++) if (this.chance(0.05)) a[i] = -0;
    if (opts.special !== false && this.chance(0.15) && n) for (let k = this.int(1, 2); k > 0; k--) a[this.int(0, n - 1)] = this.pick(SPECIAL);
    return a;
  }
  /* trecho [i0, i1]: inteiro, aleatório, 1 amostra, invertido, fora do fim */
  win(n: number): [number, number] {
    const k = this.pick(['all', 'rnd', 'rnd', 'one', 'rev', 'out', 'small'] as const);
    if (k === 'all') return [0, n - 1];
    if (k === 'one') { const m = this.int(0, Math.max(0, n - 1)); return [m, m]; }
    if (k === 'rev') { const m = this.int(1, Math.max(1, n - 1)); return [m, m - 1]; }
    if (k === 'out') return [this.int(0, Math.max(0, n - 1)), n + this.int(0, 2)];
    if (k === 'small') { const m = this.int(0, Math.max(0, n - 1)); return [m, Math.min(n - 1, m + this.int(1, 12))]; }
    const a = this.int(0, Math.max(0, n - 1)), b = this.int(0, Math.max(0, n - 1));
    return [Math.min(a, b), Math.max(a, b)];
  }
  mask(n: number): Uint8Array | null {
    if (this.chance(0.3)) return null;
    const p = this.pick([0, 0.5, 0.9, 1]);
    return Uint8Array.from({ length: n }, () => (this.chance(p) ? 1 : 0));
  }
}

/* ------------------------------------------------------------------ sessões sintéticas */
const NAMES_SHOCK: Record<string, [string, string][]> = {
  FT: [['Shock_-_Front_Left', 'Shock_velocity_FL'], ['Shock_-_Front_Right', 'Shock_velocity_FR'], ['Shock_-_Rear_Left', 'Shock_velocity_RL'], ['Shock_-_Rear_Right', 'Shock_velocity_RR']],
  PT: [['amort_DE', 'amort_vel_DE'], ['amort_DD', 'amort_vel_DD'], ['amort_TE', 'amort_vel_TE'], ['amort_TD', 'amort_vel_TD']],
  CURTO: [['susp_fl', 'susp_fl_vel'], ['susp_fr', 'susp_fr_vel'], ['susp_rl', 'susp_rl_vel'], ['susp_rr', 'susp_rr_vel']],
};
const GPS_NAMES: [string, string][] = [['Back_pressure', 'O2_General'], ['GPS_X', 'GPS_Y'], ['x', 'y']];

/** Sessão com movimento numa elipse, GPS em degraus de 4 Hz (V/mV/código/m) ou lat/lon do
 *  BUSMASTER, amortecedores, roda e CVT, cada um podendo faltar, ser constante ou ter buracos. */
function genSession(g: Gen): Session {
  const dt = g.pick([0.04, 0.04, 0.1, 0.2]);
  const n = g.chance(0.08) ? g.pick([0, 1, 2, 5, 40]) : g.int(150, 700);
  const t = new Float64Array(n);
  let x0 = g.pick([0, 0, 12.3]);
  for (let i = 0; i < n; i++) { t[i] = x0; x0 += dt * (g.chance(0.005) ? g.pick([3, 10]) : 1) * (g.chance(0.05) ? 0.8 + 0.4 * g.r() : 1); }
  const dur = n ? t[n - 1] - t[0] : 0;
  const vmax = g.pick([0, 2, 6, 12, 20]), tGo = g.r() * Math.min(6, dur / 3), tStop = g.r() * dur, stopLen = g.pick([0, 2, 6]);
  const ox = g.pick([0, 0, 20, 150]), oy = g.pick([0, -15, 140]);
  const v = new Float64Array(n), X = new Float64Array(n), Y = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const ti = t[i] - t[0];
    v[i] = ti < tGo || (ti > tStop && ti < tStop + stopLen) ? 0 : vmax * Math.min(1, (ti - tGo) / 3);
    if (i) s += v[i] * (t[i] - t[i - 1]);
    X[i] = 60 * Math.cos(s / 50) + ox; Y[i] = 40 * Math.sin(s / 50) + oy;
  }
  const chs: Channel[] = [];
  const add = (key: string, data: Float64Array) => chs.push(P.finishChannel({ key, name: P.prettyName(key), unit: '', data, src: 'log' }));
  const holes = (a: Float64Array) => {
    if (g.chance(0.4)) for (let k = g.int(1, 3); k > 0; k--) { const st = g.int(0, Math.max(0, n - 1)), len = g.int(1, 60); for (let i = st; i < Math.min(n, st + len); i++) a[i] = NaN; }
    return a;
  };
  const bus = g.chance(0.15);
  let gps: Session['gps'];
  if (bus) {
    const m = G.mPerDeg(-23.6470278);
    const lat = new Float64Array(n), lon = new Float64Array(n);
    for (let i = 0; i < n; i++) { lat[i] = -23.6470278 + Y[i] / m.lat; lon[i] = -46.5747069 + X[i] / m.lon; }
    holes(lat);
    if (g.chance(0.2)) lon.fill(NaN, 0, Math.floor(n / 4));      /* lat sem lon */
    if (g.chance(0.1)) lat.fill(NaN);                            /* sem fix nenhum */
    gps = { lat, lon };
    add('GPS · tipo de fix', Float64Array.from(lat, q => (q === q ? 3 : 0)));
  } else if (g.chance(0.8)) {
    const fmt = g.pick(['V', 'mV', 'code', 'm'] as const), [nx, ny] = g.pick(GPS_NAMES), res = 220 / 255;
    const code = (d: number) => Math.max(0, Math.min(255, Math.floor(128 + d / res)));
    const out = (c: number, d: number) => (fmt === 'V' ? +(Math.ceil(c * 5000 / 255) / 1000).toFixed(3) : fmt === 'mV' ? Math.ceil(c * 5000 / 255) : fmt === 'code' ? c : Math.round(d * 100) / 100);
    const cx = new Float64Array(n), cy = new Float64Array(n);
    let hx = NaN, hy = NaN, slot = -1;
    for (let i = 0; i < n; i++) {
      const q = Math.floor(t[i] * 4);
      if (q !== slot) { slot = q; hx = out(code(X[i]), X[i]); hy = out(code(Y[i]), Y[i]); }
      cx[i] = hx; cy[i] = hy;
    }
    holes(cx); if (g.chance(0.5)) holes(cy);
    add(nx, cx); add(ny, cy);
    if (g.chance(0.3)) {
      const ok = fmt === 'V' ? 5 : fmt === 'mV' ? 5000 : 255;
      add(g.pick(['GPS_status', 'Status_GPS']), Float64Array.from({ length: n }, () => (g.chance(0.9) ? ok : 0)));
    }
  }
  const scheme = NAMES_SHOCK[g.pick(['FT', 'FT', 'PT', 'CURTO'])];
  const tJump = g.r() * dur, jLen = g.pick([0, 0.3, 0.8]);
  scheme.forEach(([pn, vn], k) => {
    if (!g.chance(0.7)) return;
    const st = 60 + 20 * g.r(), f = 1 + g.r() * 2, amp = g.pick([0, 3, 15]);
    const p = Float64Array.from(t, (q, i) => {
      const ti = q - t[0];
      if (ti > tJump && ti < tJump + jLen) return st - 40 - g.r();
      return st + amp * Math.sin(2 * Math.PI * f * ti + k) * (v[i] > 0 ? 1 : 0.2) + (g.r() - 0.5) * 0.5;
    });
    add(pn, g.chance(0.1) ? new Float64Array(n).fill(st) : holes(p));
    if (g.chance(0.6)) add(vn, g.chance(0.15) ? new Float64Array(n) : holes(Float64Array.from(p, (q, i) => (i ? (q - p[i - 1]) / dt : 0))));
  });
  if (g.chance(0.6)) add(g.pick(['Wheel_speed', 'vel_roda']), g.chance(0.1) ? new Float64Array(n) : holes(Float64Array.from(v, q => q * 3.6 * 1.03 + (g.r() - 0.5) * 0.3 + (g.chance(0.02) ? 8 : 0))));
  if (g.chance(0.5)) {
    let T = 40 + 10 * g.r();
    add('CVT_temp', g.chance(0.1) ? new Float64Array(n).fill(T) : holes(Float64Array.from(v, q => (T += dt * (0.05 * q - 0.01 * (T - 28)) + (g.r() - 0.5) * 0.05))));
  }
  if (g.chance(0.3)) add('RPM', g.signal(n, 3000));
  if (g.chance(0.3)) chs.reverse();
  return { name: 'fuzz.csv', kind: bus ? 'BUSMASTER' : 'FT', t, channels: chs, gps, info: '' };
}

function genCfg(g: Gen): any {
  const c: any = {};
  if (g.chance(0.5)) c.centerFixed = g.chance(0.7);
  if (g.chance(0.3)) Object.assign(c, { sizeX: g.pick([200, 150, 300, '200']), sizeY: g.pick([200, 120]), margin: g.pick([10, 5, 0]) });
  if (g.chance(0.4)) c.fmt = g.pick(['auto', 'V', 'mV', 'code', 'm']);
  if (g.chance(0.4)) c.smooth = g.pick([0, 0.25, 0.5, 1, 2]);
  if (g.chance(0.3)) c.minLap = g.pick([10, 5, 0, 30, '']);
  if (g.chance(0.2)) c.chStatus = g.pick(['', 'GPS_status', 'nao_existe']);
  if (g.chance(0.15)) c.line = [{ x: g.num(80), y: g.num(80) }, { x: g.num(80), y: g.num(80) }];
  c.susp = {};
  if (g.chance(0.3)) c.susp.compPos = false;
  if (g.chance(0.2)) c.susp.strokeF = 120;
  if (g.chance(0.2)) c.susp.mrR = 1.4;
  c.car = {};
  const opt = (k: string, vals: unknown[]) => { if (g.chance(0.35)) c.car[k] = g.pick(vals); };
  opt('mass', [260, 0, 180, '300', '']); opt('wb', [1500, 1600]); opt('trackF', [1300, 1400]); opt('trackR', [1250, '1200']);
  opt('mrF', [0, 1.6, '1.5']); opt('mrR', [0, 1.6]); opt('strokeF', [0, 150, 30]); opt('strokeR', [0, 150, '25']);
  opt('massF', [0, 62]); opt('massR', [0, 70]); opt('wheelCh', ['', 'Wheel_speed', 'nao_existe', 'CVT_temp']);
  opt('cvtCh', ['', 'CVT_temp', 'nao_existe']); opt('wheelDriven', [true, false]); opt('tAmb', [28, 35, '30']);
  opt('tCvtMax', [100, 60, 20]); opt('endurance', [240, 20, '']); opt('crr', [0.05, 0, '0.07']); opt('cda', [0.9, 0]);
  opt('rho', [1.15, 0, '']); opt('power', [7.5, 0, 5]);
  return c;
}

/* configuração da pista com os canais X/Y adivinhados (como o app faz) */
function trackCfg(S: Session): any {
  const gu = G.guessGpsChannels(S.channels.map(c => c.key));
  return { ...G.DEFAULT_CFG, chX: gu.x, chY: gu.y, chStatus: '' };
}

/* ------------------------------------------------------------------ estado novo (réplica de legacyCompute) */
function recomputeNew(S: Session, cfg: AnalysisConfig): any {
  const st: any = { S, cfg, sel: -1 };
  st.track = G.computeTrack(S, cfg);
  st.laps = G.computeLaps(S, st.track, cfg.line || null, +cfg.minLap || 10);
  st.stopped = A.stoppedMask(S, st.track);
  st.dyn = st.track.ok ? A.gpsDynamics(S, st.track) : null;
  st.veh = V.vehPrep(S, st.track, cfg.car, st.dyn);
  if (!st.stopped && st.veh.v) st.stopped = Uint8Array.from(G.smooth(S.t, st.veh.v, 1), x => (x === x && x < 0.8 ? 1 : 0));
  st.acc = {
    lon: st.veh.ax || (st.dyn && st.dyn.along), lat: (st.veh.wheel && st.veh.ay) || (st.dyn && st.dyn.alat),
    src: st.veh.wheel ? 'longitudinal pela velocidade da roda, lateral = velocidade da roda × guinada do GPS' : 'pela trajetória do GPS',
  };
  st.susp = A.suspPrep(S, st.track, cfg.susp);
  st.ang = V.bodyAngles(st.susp, cfg.car);
  const SG = 'Suspensão (calculado)';
  const sc = (key: string, name: string, unit: string, data: Float64Array) => P.finishChannel({ key, name, unit, data, src: 'calc', group: SG });
  if (st.ang.pitch) st.susp.channels.push(sc('susp:pitch', 'Arfagem (+ = frente baixa)', '°', st.ang.pitch));
  if (st.ang.rollF) st.susp.channels.push(sc('susp:rollF', 'Rolagem diant. (+ = esq. comprimida)', '°', st.ang.rollF));
  if (st.ang.rollR) st.susp.channels.push(sc('susp:rollR', 'Rolagem tras. (+ = esq. comprimida)', '°', st.ang.rollR));
  const rough = V.roughness(S.t, st.susp);
  if (rough) st.susp.channels.push(sc('susp:rough', 'Rugosidade (vel. amortecedores, RMS 1 s)', 'mm/s', rough));
  const derived: Channel[] = [];
  const tr = st.track;
  if (tr.ok) {
    const mk = (key: string, name: string, unit: string, data: Float64Array) => derived.push(P.finishChannel({ key, name, unit, data, src: 'gps' }));
    const lapTime = () => {
      const t = S.t, o = new Float64Array(t.length).fill(NaN);
      st.laps.forEach((l: any) => { for (let i = l.i0; i <= l.i1; i++) o[i] = t[i] - l.t0; });
      return o;
    };
    mk('gps:speed', 'GPS · Velocidade', 'km/h', tr.speed);
    mk('gps:lap', 'Tempo na volta', 's', lapTime());
    mk('gps:x', 'GPS · X Leste', 'm', tr.x);
    mk('gps:y', 'GPS · Y Norte', 'm', tr.y);
    mk('gps:dist', 'GPS · Distância', 'm', tr.dist);
    if (st.laps.length >= 2) mk('gps:delta', 'Delta p/ melhor volta', 's', A.deltaToBest(S, tr, st.laps));
    if (st.dyn) st.dyn.channels.forEach((c: Channel) => { if (!(st.veh && st.veh.wheel && /gps:a(lon|lat)g?/.test(c.key))) derived.push(c); });
    if (S.gps) {
      mk('gps:cx', 'Código X (calculado)', '', tr.codeX);
      mk('gps:cy', 'Código Y (calculado)', '', tr.codeY);
    }
  }
  st.all = derived.concat(st.veh.channels, st.susp.channels, S.channels);
  st.all.forEach((c: Channel) => { c.group = c.group || (c.src === 'gps' ? 'Calculados do GPS' : 'Do log'); });
  return st;
}

function computeNew(S: Session, cfgIn: any = {}, opts: { autoLine?: boolean } = {}): any {
  const cfg: any = Object.assign({}, G.DEFAULT_CFG, cfgIn);
  cfg.susp = Object.assign({}, A.DEFAULT_SUSP, cfgIn.susp || {});
  cfg.car = Object.assign({}, V.DEFAULT_CAR, cfgIn.car || {});
  ['strokeF', 'strokeR', 'massF', 'massR', 'mrF', 'mrR'].forEach(k => {
    if (!(+cfg.car[k] > 0) && +cfg.susp[k] > 0) cfg.car[k] = +cfg.susp[k];
    delete cfg.susp[k];
  });
  const keys = S.channels.map(c => c.key);
  if (!S.gps && (!keys.includes(cfg.chX) || !keys.includes(cfg.chY))) {
    const g = G.guessGpsChannels(keys);
    cfg.chX = g.x; cfg.chY = g.y; cfg.chStatus = g.status;
  }
  if (cfg.chStatus && !keys.includes(cfg.chStatus)) cfg.chStatus = '';
  let st = recomputeNew(S, cfg);
  if (opts.autoLine && !cfg.line) {
    const l = G.autoLine(S, st.track);
    if (l) {
      cfg.line = l.map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) }));
      st = recomputeNew(S, cfg);
    }
  }
  return st;
}

/* estado inteiro, bit a bit (veh.Fres é função: compara os valores) */
function stateDiff(bag: Bag, at: string, O: any, N: any): void {
  for (const k of ['cfg', 'track', 'laps', 'stopped', 'dyn', 'veh', 'acc', 'susp', 'ang', 'all']) bag.eq(`${at}.${k}`, O[k], N[k]);
  for (const v of [0, 1, 7.5, 20, NaN]) bag.eq(`${at}.veh.Fres(${v})`, O.veh.Fres(v), N.veh.Fres(v));
}

/* as funções de análise num trecho, como analysisui.js / vehicleui.js chamam (e mais) */
function windowCalls(bag: Bag, g: Gen, at: string, O: any, N: any, i0: number, i1: number): void {
  const tO = O.S.t, tN = N.S.t;
  const actO = O.susp.shocks.filter((k: any) => k.active), actN = N.susp.shocks.filter((k: any) => k.active);
  const mvO = O.stopped ? Uint8Array.from(O.stopped, (v: number) => 1 - v) : null;
  const mvN = N.stopped ? Uint8Array.from(N.stopped as Uint8Array, v => 1 - v) : null;
  const w = `${at} [${i0},${i1}]`;
  const two = (name: string, argsO: unknown[], argsN: unknown[]) => {
    /* entradas do estado: cada lado com as suas (já comparadas bit a bit) */
    const ro = run((BT as any)[name], argsO), rn = run(NEW[name], argsN);
    bag.calls++;
    if (ro.e !== undefined || rn.e !== undefined) { if (ro.e !== rn.e && bag.diffs.length < 20) bag.diffs.push(`${w} ${name}: erro «${ro.e}» / «${rn.e}»`); }
    else if (bag.diffs.length < 20) sdiff(ro.v, rn.v, `${w} ${name}`, bag.diffs);
    return [ro.v, rn.v] as [any, any];
  };
  actN.forEach((k: any, j: number) => {
    const kO = actO[j];
    two('velStats', [kO.v, i0, i1, mvO, 100], [k.v, i0, i1, mvN, 100]);
    two('velStats', [kO.v, i0, i1, null, 37], [k.v, i0, i1, null, 37]);
    two('hist', [kO.v, i0, i1, mvO, -300, 300, 24], [k.v, i0, i1, mvN, -300, 300, 24]);
    two('hist', [kO.disp, i0, i1, null, -40, 40, 33], [k.disp, i0, i1, null, -40, 40, 33]);
    two('freeDecay', [tO, kO.disp, i0, i1], [tN, k.disp, i0, i1]);
    for (const N2 of [128, 64]) two('psdMask', [tO, kO.disp, i0, i1, mvO, 2, N2], [tN, k.disp, i0, i1, mvN, 2, N2]);
    for (const hp of [2, 0]) {
      const [pO, pN] = two('psd', [tO, kO.disp, i0, i1, hp], [tN, k.disp, i0, i1, hp]);
      if (pO && pN) {
        two('findPeak', [pO.f, pO.p, 0.6, 4.5], [pN.f, pN.p, 0.6, 4.5]);
        two('localPeaks', [pO.f, pO.p, 0.6, 4.5, 3], [pN.f, pN.p, 0.6, 4.5, 3]);
      }
    }
  });
  for (const st of [true, false]) two('dropTests', [tO, O.susp.shocks, st ? O.stopped : null, i0, i1], [tN, N.susp.shocks, st ? N.stopped : null, i0, i1]);
  two('gradients', [O.ang || {}, O.acc || {}, mvO, i0, i1], [N.ang || {}, N.acc || {}, mvN, i0, i1]);
  two('gradients', [O.ang || {}, O.acc || {}, null, i0, i1], [N.ang || {}, N.acc || {}, null, i0, i1]);
  const car = N.cfg.car;
  two('bottomOuts', [tO, O.susp, car, i0, i1], [tN, N.susp, car, i0, i1]);
  two('jumps', [tO, O.susp, O.veh, car, i0, i1], [tN, N.susp, N.veh, car, i0, i1]);
  bag.eq(`${w} susp depois de jumps`, O.susp.shocks, N.susp.shocks);
  const vO = O.veh, vN = N.veh;
  if (vN.v) {
    for (const bw of [2, 5]) two('powerCurve', [vO.v, vO.P, vO.ax, i0, i1, bw, vO.slip || null], [vN.v, vN.P, vN.ax, i0, i1, bw, vN.slip || null]);
    const dO = N.cfg.car.wheelDriven && O.track.ok ? O.track.dist : vO.dist, dN = N.cfg.car.wheelDriven && N.track.ok ? N.track.dist : vN.dist;
    two('launches', [tO, vO.v, dO, vO.slip, vO.ax], [tN, vN.v, dN, vN.slip, vN.ax]);
    const [cO] = two('findCoasts', [tO, vO.v, vO.ax, i0, i1], [tN, vN.v, vN.ax, i0, i1]);
    for (const c of (cO || []).slice(0, 2)) two('coastFit', [vO.v, vO.a, c.i0, c.i1, 260, 1.15], [vN.v, vN.a, c.i0, c.i1, 260, 1.15]);
    two('coastFit', [vO.v, vO.a, i0, i1, +car.mass || 260, +car.rho || 1.15], [vN.v, vN.a, i0, i1, +car.mass || 260, +car.rho || 1.15]);
    if (vN.cvt) two('cvtFit', [tO, vO.cvt.data, vO.v, vO.P, car, i0, i1], [tN, vN.cvt.data, vN.v, vN.P, car, i0, i1]);
    const dist2O = O.track.ok ? O.track.dist : vO.dist, dist2N = N.track.ok ? N.track.dist : vN.dist;
    if (mvN && actN.length) for (const ds of [0.25, 0.5])
      two('roadSpectrum', [actO.map((k: any) => k.disp), dist2O, mvO, i0, i1, ds], [actN.map((k: any) => k.disp), dist2N, mvN, i0, i1, ds]);
  }
  if (N.track.ok) {
    two('stoppedMask', [O.S, O.track], [N.S, N.track]);
    two('deltaToBest', [O.S, O.track, O.laps], [N.S, N.track, N.laps]);
    const L = N.laps.slice(0, 3), LO = O.laps.slice(0, 3);
    L.forEach((_: any, a: number) => L.forEach((__: any, b: number) => {
      const pr = [two('lapProfile', [O.S, O.track, LO[a]], [N.S, N.track, L[a]]), two('lapProfile', [O.S, O.track, LO[b]], [N.S, N.track, L[b]])];
      const step = g.pick([1, 0.5, 3]);
      two('compareLaps', [pr[0][0], pr[1][0], step], [pr[0][1], pr[1][1], step]);
    }));
  }
}

/* ================================================================== testes */
describe('revisão: o comparador estrito pega o que same() deixa passar', () => {
  it('-0 × 0, Float64Array × Array, ordem das chaves, 0 × false, undefined × ausente', () => {
    const pairs: [unknown, unknown][] = [
      [0, -0], [Float64Array.of(1, 2), [1, 2]], [Float64Array.of(1), Float32Array.of(1)], [{ a: 1, b: 2 }, { b: 2, a: 1 }],
      [{ ok: 0 }, { ok: false }], [{ x: undefined }, {}], [1, 1 + 1e-12], [Uint8Array.of(1), [1]],
    ];
    for (const [a, b] of pairs) {
      expect(sdiff(a, b), JSON.stringify([a, b])).not.toEqual([]);
    }
    /* e o same() aceita todos menos o 0 × false (documenta a folga do comparador dos testes) */
    expect(pairs.map(([a, b]) => same(a, b).length === 0)).toEqual([true, true, true, true, false, true, true, true]);
    /* NaN = NaN, typed array de outro realm com o mesmo tipo = igual */
    expect(sdiff(NaN, NaN)).toEqual([]);
    expect(sdiff(BT.range(Float64Array.of(3, NaN, -1)), U.range(Float64Array.of(3, NaN, -1)))).toEqual([]);
    expect(sdiff(BT.smooth([0, 1, 2], [1, 2, 3], 1), G.smooth([0, 1, 2], [1, 2, 3], 1))).toEqual([]);
  });
});

describe('revisão: estado completo bit a bit (exemplo, variações e logs reais)', () => {
  const cases: [string, () => [any, any]][] = [];
  cases.push(['exemplo', () => {
    const So = BT.parseCSV(BT.demoCSV(), 'exemplo_baja.csv'); So.demo = true;
    const Sn = P.parseCSV(demoCSV(), 'exemplo_baja.csv'); Sn.demo = true;
    return [legacyCompute(BT, So, { car: LEGACY_DEMO_CAR }, { autoLine: true }), computeNew(Sn, { car: DEMO_CAR }, { autoLine: true })];
  }]);
  const variants: [string, (k: string) => boolean, any][] = [
    ['exemplo sem roda e sem CVT', k => k !== 'Wheel_speed' && k !== 'CVT_temp', { car: DEMO_CAR }],
    ['exemplo sem GPS', k => k !== 'O2_General' && k !== 'Back_pressure', { car: DEMO_CAR }],
    ['exemplo só um amortecedor (RR)', k => !/Left|Front|_F[LR]$|_RL$/.test(k), { car: { ...DEMO_CAR, strokeR: 40 } }],
    ['exemplo só GPS', k => k === 'O2_General' || k === 'Back_pressure', { car: DEMO_CAR }],
  ];
  for (const [label, keep, cfg] of variants) cases.push([label, () => {
    const So = BT.parseCSV(BT.demoCSV(), 'exemplo_baja.csv'); So.demo = true;
    const Sn = P.parseCSV(demoCSV(), 'exemplo_baja.csv'); Sn.demo = true;
    So.channels = So.channels.filter((c: any) => keep(c.key)); Sn.channels = Sn.channels.filter(c => keep(c.key));
    return [legacyCompute(BT, So, cfg, { autoLine: true }), computeNew(Sn, cfg, { autoLine: true })];
  }]);
  for (const f of ['ft_log3_gps.csv', 'ft_log3_shocks_compact.csv', 'busmaster_14.log', 'Log 3_20261005-1648_20261005-1651.csv', 'Log 3_20261005-1644.csv']) {
    const text = readFixture(f);
    if (text === null) continue;
    cases.push([f, () => [legacyCompute(BT, BT.parseLog(text, f), {}, { autoLine: true }), computeNew(P.parseLog(text, f), {}, { autoLine: true })]]);
  }
  for (const [label, mk] of cases) {
    it(label, () => {
      const bag = new Bag(), g = new Gen(label.length * 7919);
      const [O, N] = mk();
      bag.eq('S', O.S, N.S);
      stateDiff(bag, label, O, N);
      const n = N.S.t.length;
      const wins: [number, number][] = [[0, n - 1], [Math.floor(n / 3), Math.floor(2 * n / 3)], [n >> 1, (n >> 1) + 10]];
      N.laps.slice(0, 2).forEach((l: any) => wins.push([l.i0, l.i1]));
      for (const [i0, i1] of wins) windowCalls(bag, g, label, O, N, i0, i1);
      expect(bag.diffs).toEqual([]);
      expect(bag.calls).toBeGreaterThan(10);
    });
  }
});

describe('revisão: sessões sintéticas aleatórias (fuzz do pipeline inteiro)', () => {
  for (let block = 0; block < 6; block++) {
    it(`bloco ${block + 1}`, () => {
      const bag = new Bag();
      let ok = 0, laps = 0, veh = 0, act = 0, bus = 0, cvt = 0;
      for (let k = 0; k < 14; k++) {
        const seed = 1000 + block * 100 + k, g = new Gen(seed);
        const S = genSession(g), cfg = genCfg(g), auto = g.chance(0.6);
        const at = `semente ${seed}`;
        const O = legacyCompute(BT, clone(S), clone(cfg), { autoLine: auto });
        const N = computeNew(clone(S), clone(cfg), { autoLine: auto });
        stateDiff(bag, at, O, N);
        if (N.track.ok) ok++;
        if (N.laps.length) laps++;
        if (N.veh.v) veh++;
        if (N.veh.cvt) cvt++;
        if (S.gps) bus++;
        act += N.susp.shocks.filter((s: any) => s.active).length;
        const n = N.S.t.length;
        for (let w = 0; w < 4; w++) { const [i0, i1] = g.win(n); windowCalls(bag, g, at, O, N, i0, i1); }
        if (n) for (let q = 0; q < 30; q++) {
          if (!N.track.ok) break;
          const tc = g.chance(0.2) ? g.num(200) : N.S.t[0] + g.r() * (N.S.t[n - 1] - N.S.t[0] + 2) - 1;
          bag.cmp(`${at} posAt ${tc}`, BT.posAt, G.posAt, [N.S, N.track, tc]);
        }
      }
      expect(bag.diffs).toEqual([]);
      /* o gerador tem que exercitar os caminhos (senão o teste não prova nada) */
      expect(ok).toBeGreaterThan(3);
      expect(veh).toBeGreaterThan(3);
      expect(act).toBeGreaterThan(5);
      if (block === 0) expect(laps + bus + cvt).toBeGreaterThan(0);
    });
  }
});

describe('revisão: util (fuzz)', () => {
  it('clamp, fmtTime, decimalsFor, fmtVal, heat, idxAt, niceTicks, range, pctRange, esc', () => {
    const bag = new Bag(), g = new Gen(42);
    for (let k = 0; k < 3000; k++) {
      const a = g.num(1e4), b = g.num(1e4), c = g.num(1e4);
      bag.cmp('clamp', BT.clamp, U.clamp, [a, b, c]);
      bag.cmp('fmtTime', BT.fmtTime, U.fmtTime, [g.chance(0.5) ? a : g.r() * 7200 - 100]);
      bag.cmp('decimalsFor', BT.decimalsFor, U.decimalsFor, [a, b]);
      bag.cmp('fmtVal', BT.fmtVal, U.fmtVal, [a, g.pick([0, 1, 2, 3, 20, 100, 101, -1, 2.5])]);
      bag.cmp('heat', BT.heat, U.heat, [g.chance(0.3) ? a : g.r() * 1.4 - 0.2, g.pick([true, false, undefined, 0, 1])]);
    }
    for (const d of [true, false, undefined]) bag.cmp('heatGradientCss', BT.heatGradientCss, U.heatGradientCss, [d]);
    for (let k = 0; k < 400; k++) {
      const n = g.pick([0, 1, 2, 3, 10, 100, 9000]);
      const t = g.chance(0.7) ? g.times(n) : g.signal(n, 100);
      for (let q = 0; q < 10; q++) bag.cmp('idxAt', BT.idxAt, U.idxAt, [t, g.chance(0.2) ? g.num(1e3) : (n ? t[g.int(0, n - 1)] + g.pick([0, 0.01, -0.01, 1e-12]) : g.num(10))]);
      const a = g.signal(n, g.pick([1, 100, 1e5]));
      bag.cmp('range', BT.range, U.range, [a]);
      const [i0, i1] = g.win(n);
      bag.cmp('range i0 i1', BT.range, U.range, [a, i0, i1]);
      bag.cmp('range i0', BT.range, U.range, [a, i0]);
      bag.cmp('pctRange', BT.pctRange, U.pctRange, [a, i0, i1, g.pick([0, 0.02, 0.5, 1, -0.1, NaN])]);
    }
    /* niceTicks: só entradas em que o laço termina (o original fica em laço infinito se
     * step < ulp(lo), igual nos dois) */
    for (let k = 0; k < 3000; k++) {
      const lo = g.chance(0.2) ? g.pick(SPECIAL) : (g.r() * 2 - 1) * g.pick([1, 100, 1e4]);
      const hi = g.chance(0.2) ? g.pick(SPECIAL) : lo + g.r() * g.pick([1e-6, 1, 50, 1e4]) * (g.chance(0.1) ? -1 : 1);
      const n = g.pick([0, 1, 2, 5, 8, 12, 30, -3, NaN]);
      const span = hi - lo, ulp = Math.max(Math.abs(lo), Math.abs(hi)) * 2.3e-16;
      if (span > 0 && Number.isFinite(span) && span / Math.max(1, n || 1) / 10 < ulp * 4) continue;
      /* hi perto de MAX_VALUE: hi + step·1e-9 vira Infinity e o laço só acaba com RangeError
       * depois de ~10^8 pushes (esquisitice do original, igual nos dois) */
      if (span > 0 && Number.isFinite(span) && !Number.isFinite(hi + span * 1e-8)) continue;
      bag.cmp('niceTicks', BT.niceTicks, U.niceTicks, [lo, hi, n]);
    }
    const chars = ['&', '<', '>', '"', "'", 'a', ' ', 'ç', '\n'];
    for (let k = 0; k < 300; k++) bag.cmp('esc', BT.esc, U.esc, [Array.from({ length: g.int(0, 8) }, () => g.pick(chars)).join('')]);
    for (const v of [null, undefined, 0, -0, NaN, true, [1, '<'], { a: 1 }]) bag.cmp('esc', BT.esc, U.esc, [v]);
    expect(bag.diffs).toEqual([]);
  });
});

/* ------------------------------------------------------------------ parsers */
const BIG = '1797693134862315708145274237317043567980705675258449965989174768031572607800285387605895586327668781715404589535143824642343213268894641827684675467035375169860499105765512820762454900903893289440758685084551339423045832369032229481658085593321233482747978262041447231687381771809192998812504040261841248583680';

function genCSV(g: Gen): string {
  const delim = g.pick([',', ',', ';', '\t']);
  const pool = ['TIME', 'Time (s)', 'tempo', 't', 'Tempo(s)', 'A', 'Shock_-_Front_Left', 'Back_pressure', 'O2_General', '"Quoted"', ' spaced ', '', 'x' + delim + 'y', 'Shock_velocity_FL', 'Wheel_speed'];
  const nc = g.int(1, 6), cols: string[] = [];
  for (let i = 0; i < nc; i++) cols.push(g.pick(pool));
  if (g.chance(0.6)) cols[g.chance(0.8) ? 0 : g.int(0, nc - 1)] = g.pick(['TIME', 'Time (s)', 'tempo']);
  const fmtNum = (v: number) => {
    const s = g.chance(0.5) ? v.toFixed(g.int(0, 4)) : String(v);
    return delim !== ',' && g.chance(0.7) ? s.replace('.', ',') : s;
  };
  const vals = () => g.pick(['', ' ', 'abc', '1e301', '-1e300', BIG, '0x10', 'Infinity', '-0', '1.797e308', '  4  ', '"5,5"', '"7"', '1,234.5', '-', '.5', '5.', '1e-5']);
  const lines: string[] = [];
  for (let k = g.int(0, 2); k > 0; k--) lines.push(g.pick(['', '   ', '\t']));
  lines.push(cols.join(delim));
  if (g.chance(0.3)) lines.push(cols.map(() => g.pick(['(s)', 'km/h', '°C', '"mm"', '', 'V', 'x'.repeat(g.pick([3, 39, 40, 41]))])).join(delim));
  let tt = g.pick([0, -1, 100]);
  const rows = g.pick([0, 1, 2, 5, 20, 60]);
  for (let r = 0; r < rows; r++) {
    if (g.chance(0.05)) { lines.push(g.pick(['', '  '])); continue; }
    const len = g.chance(0.85) ? nc : g.int(0, nc + 2), cells: string[] = [];
    tt += g.pick([0.04, 0.04, 0, -0.04, 1]);
    for (let c = 0; c < len; c++) cells.push(g.chance(0.75) ? fmtNum(c === 0 ? tt : g.num(100)) : vals());
    lines.push(cells.join(delim));
  }
  return lines.join(g.chance(0.3) ? '\r\n' : '\n') + (g.chance(0.5) ? '\n' : '');
}

function genBus(g: Gen): string {
  const dec = g.chance(0.2);
  const head = g.pick([
    '***BUSMASTER Ver 3.2.2***\n***PROTOCOL CAN***\n' + (dec ? '***DEC***' : '***HEX***') + '\n***<Time><Tx/Rx><Channel><CAN ID><Type><DLC><DataBytes>***\n',
    '***<Time><Tx/Rx><Channel><CAN ID><Type><DLC><DataBytes>***\n',
    '***BUSMASTER***\n',
  ]);
  const b = (v: number) => (dec ? String(v & 255) : (v & 255).toString(16).toUpperCase().padStart(2, '0'));
  const idTxt = (id: number) => (dec && g.chance(0.7) ? String(id) : '0x' + id.toString(16).toUpperCase().padStart(3, '0'));
  /* perto da meia-noite só anda para frente: voltar no tempo cruzando a meia-noite faz a
   * grade de 20 Hz ter um dia inteiro (certo nos dois, mas lento demais para o fuzz) */
  const midnight = g.chance(0.3);
  let t = midnight ? 23 * 3600 + 59 * 60 + 58.5 : 10 * 3600;
  let lon = g.int(-466000000, -465000000), lat = g.int(-236500000, -236400000);
  const frames: string[] = [];
  const nf = g.pick([0, 1, 5, 30, 80]);
  const ftId = (prod: number, dtype: number, msg: number) => prod * 2 ** 14 + (dtype << 11) + msg;
  for (let k = 0; k < nf; k++) {
    t += g.pick([0.01, 0.05, 0.1, 0.25, 0, 1.6]) * (!midnight && g.chance(0.03) ? -1 : 1);
    const tt = ((t % 86400) + 86400) % 86400;
    const hh = Math.floor(tt / 3600), mm = Math.floor(tt / 60) % 60, ss = Math.floor(tt) % 60, fr = Math.floor((tt % 1) * 10000);
    const time = `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(fr).padStart(4, '0')}`;
    const kind = g.pick(['pos', 'pos', 'pos', 'sol', 'sat', 'pic', 'ft', 'ft', 'ft', 'junk', 'remote']);
    let id = 0, type = 's', d: number[] = [];
    if (kind === 'pos') {
      const mux = g.pick([0, 1, 1, 2]);
      lon += g.int(-300, 300); lat += g.int(-300, 300);
      const v = mux === 0 ? lon : lat;
      id = 0x028; d = [mux, v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
      if (g.chance(0.05)) d = d.slice(0, 4);
    } else if (kind === 'sol') {
      id = 0x023; d = [0x1F, 0xD3, g.pick([0, 0, 1]), 0, 0, g.pick([0, 2, 3, 4]), g.pick([0, 1, 1, 3]), 0];
    } else if (kind === 'sat') {
      id = 0x023; d = [0x0C, g.pick([0xD3, 0xD4]), g.int(0, 12), 0, 0, 0, 0, 0];
      if (g.chance(0.1)) d = d.slice(0, 7);
    } else if (kind === 'pic') {
      id = 0x7E9; d = [g.int(0, 255), g.int(0, 255), g.int(0, 255), g.int(0, 4)].slice(0, g.pick([3, 4, 4]));
    } else if (kind === 'ft') {
      type = 'x';
      id = ftId(g.pick([0x47E0, 0x47E0, 0x1234]), g.pick([1, 2, 3]), g.pick([0x0FF, 0x2FF, 0x3FF, 0x200]));
      const start = g.pick(['ff', 'ff', 'ini', 'cont', 'cont', 'vazio']);
      const pay = () => Array.from({ length: g.int(0, 7) }, () => g.int(0, 255));
      if (start === 'ff') d = [0xFF, ...pay()];
      else if (start === 'ini') d = [0x00, 0, g.pick([4, 8, 12, 2]), ...pay()].slice(0, 8);
      else if (start === 'cont') d = [g.int(1, 3), ...pay()];
    } else if (kind === 'remote') {
      type = g.pick(['sr', 'xr']); id = 0x100;
    } else { id = g.int(0, 0x7FF); d = Array.from({ length: g.int(0, 8) }, () => g.int(0, 255)); }
    frames.push(`${time} ${g.pick(['Rx', 'Tx'])} 1 ${idTxt(id)} ${type} ${d.length} ${d.map(b).join(' ')}`);
    if (g.chance(0.03)) frames.push(g.pick(['lixo', '', '12:00 Rx']));
  }
  return head + frames.join('\n') + '\n';
}

describe('revisão: parsers (fuzz por gramática)', () => {
  it('parseCSV / parseLog com CSVs gerados', () => {
    const bag = new Bag(), g = new Gen(7);
    let ok = 0;
    for (let k = 0; k < 1500; k++) {
      const text = genCSV(g);
      const r = bag.cmp(`CSV ${k}: ${JSON.stringify(text.slice(0, 60))}`, BT.parseLog, P.parseLog, [text, `f${k}.csv`]);
      if (r) ok++;
    }
    expect(bag.diffs).toEqual([]);
    expect(ok).toBeGreaterThan(300);
  });

  it('parseBusmaster / parseLog com logs gerados', () => {
    const bag = new Bag(), g = new Gen(11);
    let withFix = 0, ftcan = 0, wrap = 0, fail = 0;
    for (let k = 0; k < 500; k++) {
      const text = genBus(g);
      const r = bag.cmp(`BUS ${k}`, BT.parseLog, P.parseLog, [text, `f${k}.log`]) as Session | undefined;
      bag.cmp(`BUS direto ${k}`, BT.parseBusmaster, P.parseBusmaster, [text, `f${k}.log`]);
      if (!r) { fail++; continue; }
      if (r.gps && Array.from(r.gps.lat).some(x => x === x)) withFix++;
      if (r.channels.some(c => / · ID 0x/.test(c.key))) ftcan++;
      if (r.clock0?.startsWith('23:59') && r.t[r.t.length - 1] > 1.6) wrap++;
    }
    expect(bag.diffs).toEqual([]);
    /* o gerador passou pelos caminhos: fix válido, FTCAN decodificado, meia-noite, sem quadros */
    expect([withFix > 5, ftcan > 5, wrap > 5, fail > 0]).toEqual([true, true, true, true]);
  });

  it('prettyName e finishChannel', () => {
    const bag = new Bag(), g = new Gen(13);
    const parts = ['_', '-', ' ', 'a', 'B', '_-_', '  ', '\t', 'ç'];
    for (let k = 0; k < 1000; k++) bag.cmp('prettyName', BT.prettyName, P.prettyName, [Array.from({ length: g.int(0, 10) }, () => g.pick(parts)).join('')]);
    for (let k = 0; k < 500; k++) {
      const n = g.pick([0, 1, 2, 10, 100]);
      const ch: any = { key: 'k', name: 'n', unit: 'u', data: g.signal(n, g.pick([1e-10, 1, 1e6])), src: 'log' };
      if (g.chance(0.3)) ch.group = 'G';
      bag.cmp('finishChannel', BT.finishChannel, P.finishChannel, [ch]);
    }
    expect(bag.diffs).toEqual([]);
  });
});

/* ------------------------------------------------------------------ gps */
describe('revisão: gps (fuzz)', () => {
  it('mPerDeg, spanOf, detectFmt, toCode, guessGpsChannels, smooth', () => {
    const bag = new Bag(), g = new Gen(17);
    for (let k = 0; k < 500; k++) {
      bag.cmp('mPerDeg', BT.mPerDeg, G.mPerDeg, [g.num(90)]);
      bag.cmp('spanOf', BT.spanOf, G.spanOf, [{ centerFixed: g.pick([true, false, 0, 1, '']), sizeX: g.pick([200, '200', 0, NaN, -5, '']), sizeY: g.num(300), margin: g.pick([10, '10', 0, 2.5]) }]);
      bag.cmp('toCode', BT.toCode, G.toCode, [g.num(300), g.pick(['V', 'mV', 'code', 'm', 'auto', ''])]);
      const n = g.pick([0, 1, 7, 8, 50, 300]);
      const scale = g.pick([5, 255, 5000, 6000, 100]);
      const d = Float64Array.from(g.signal(n, scale), v => (g.chance(0.5) ? Math.abs(v) : v));
      if (g.chance(0.3)) for (let i = 0; i < n; i++) d[i] = Math.round(d[i]);
      bag.cmp('detectFmt', BT.detectFmt, G.detectFmt, [d]);
      bag.cmp('detectFmt array', BT.detectFmt, G.detectFmt, [Array.from(d)]);
    }
    const vocab = ['Back_pressure', 'O2_General', 'GPS_X', 'GPS_Y', 'gps-x', 'GPSY', 'x', 'y', 'X', 'Leste', 'Norte', 'east', 'NORTH', 'GPS_status', 'status gps', 'gpsst', 'TIME', 'Shock_-_Front_Left', 'xx', 'Ox'];
    for (let k = 0; k < 1000; k++) bag.cmp('guessGpsChannels', BT.guessGpsChannels, G.guessGpsChannels, [Array.from({ length: g.int(0, 6) }, () => g.pick(vocab))]);
    for (let k = 0; k < 600; k++) {
      const n = g.pick([0, 1, 2, 3, 30, 400]);
      bag.cmp('smooth', BT.smooth, G.smooth, [g.times(n), g.signal(n, 50), g.pick([0, -1, NaN, 0.04, 0.1, 0.25, 0.5, 1, 3, 1e9, Infinity, '0.5'])]);
    }
    expect(bag.diffs).toEqual([]);
  });

  it('computeTrack, computeLaps, autoLine, posAt em sessões geradas e configurações aleatórias', () => {
    const bag = new Bag(), g = new Gen(19);
    let ok = 0, laps = 0;
    for (let k = 0; k < 160; k++) {
      const S = genSession(g);
      const keys = S.channels.map(c => c.key), gu = G.guessGpsChannels(keys);
      const cfg: any = { ...G.DEFAULT_CFG, chX: gu.x, chY: gu.y, chStatus: gu.status, ...genCfg(g) };
      if (g.chance(0.1)) cfg.chX = g.pick(['', 'nao_existe', keys[0] ?? '']);
      if (g.chance(0.05)) cfg.fmt = 'xyz';
      const tr = bag.cmp(`computeTrack ${k}`, BT.computeTrack, G.computeTrack, [S, cfg]);
      if (!tr) continue;
      const trO = BT.computeTrack(S, cfg);
      const al = bag.cmp(`autoLine ${k}`, BT.autoLine, G.autoLine, [S, tr]);
      const lines: unknown[] = [null, al, [{ x: 0, y: 0 }, { x: 0, y: 0 }], [{ x: -200, y: 10 }, { x: 200, y: 10.5 }], [{ x: 60, y: -100 }, { x: 60, y: 100 }]];
      if (al) lines.push(al.map((p: any) => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) })));
      for (const l of lines) for (const ml of [10, 0, NaN, 3]) {
        const L = bag.cmp(`computeLaps ${k}`, (...a: any[]) => BT.computeLaps(a[0], trO, a[2], a[3]), (...a: any[]) => G.computeLaps(a[0], tr, a[2], a[3]), [S, null, l, ml]);
        if (L && L.length) laps++;
      }
      if (tr.ok) {
        ok++;
        const n = S.t.length;
        for (let q = 0; q < 40; q++) {
          const tc = g.chance(0.2) ? g.num(100) : g.chance(0.3) ? S.t[g.int(0, n - 1)] : S.t[0] + g.r() * (S.t[n - 1] - S.t[0]);
          bag.cmp(`posAt ${k} ${tc}`, (...a: any[]) => BT.posAt(a[0], trO, a[2]), (...a: any[]) => G.posAt(a[0], tr, a[2]), [S, null, tc]);
        }
      }
    }
    /* posAt numa trajetória de sessão vazia (idxAt = -1) */
    const S0 = { name: '', kind: 'FT', t: new Float64Array(0), channels: [], info: '' } as unknown as Session;
    const tr0 = { ok: true, valid: new Uint8Array(0), x: new Float64Array(0), y: new Float64Array(0), heading: new Float64Array(0) };
    bag.cmp('posAt vazio', BT.posAt, G.posAt, [S0, tr0, 1]);
    expect(bag.diffs).toEqual([]);
    expect(ok).toBeGreaterThan(40);
    expect(laps).toBeGreaterThan(5);
  });
});

/* ------------------------------------------------------------------ analysis */
describe('revisão: analysis (fuzz)', () => {
  it('deriv, median, quant, interpAt, velStats, hist, highpass', () => {
    const bag = new Bag(), g = new Gen(23);
    for (let k = 0; k < 600; k++) {
      const n = g.pick([0, 1, 2, 3, 20, 300]);
      const t = g.times(n), a = g.signal(n, g.pick([1, 50, 1e4]));
      bag.cmp('deriv', BT.deriv, A.deriv, [t, a, g.pick([0, 0.01, 0.06, 0.5, 3, -1, NaN, Infinity])]);
      const m = g.mask(n);
      bag.cmp('median', BT.median, A.median, [a, m]);
      bag.cmp('median sem máscara', BT.median, A.median, [a]);
      const sorted = Array.from(a).filter(x => x === x).sort((x, y) => x - y);
      bag.cmp('quant', BT.quant, A.quant, [g.chance(0.5) ? sorted : Float64Array.from(sorted), g.pick([0, 0.002, 0.5, 0.9, 0.95, 1, -1, 2, NaN])]);
      const xs = Float64Array.from(sorted.slice(0, 50)), ys = g.signal(xs.length, 10);
      for (let q = 0; q < 4; q++) bag.cmp('interpAt', BT.interpAt, A.interpAt, [xs, ys, g.chance(0.5) && xs.length ? xs[g.int(0, xs.length - 1)] : g.num(100)]);
      const [i0, i1] = g.win(n);
      bag.cmp('velStats', BT.velStats, A.velStats, [a, i0, i1, m, g.pick([100, 50, 0, -1, NaN, Infinity])]);
      bag.cmp('hist', BT.hist, A.hist, [a, i0, i1, m, g.num(100), g.num(100), g.pick([1, 2, 10, 33, 0])]);
      bag.cmp('hist faixa', BT.hist, A.hist, [a, i0, i1, m, -40, 40, g.pick([33, 2.5])]);
      bag.cmp('highpass', BT.highpass, A.highpass, [t, a, g.pick([0, 0.5, 2, NaN])]);
    }
    expect(bag.diffs).toEqual([]);
  });

  it('fft, welch, psd, findPeak, localPeaks, psdMask, freeDecay, rideRates', () => {
    const bag = new Bag(), g = new Gen(29);
    for (const n of [0, 1, 2, 3, 4, 6, 8, 12, 16, 64, 100, 128]) for (let q = 0; q < 3; q++)
      bag.cmp(`fft ${n}`, (re: any, im: any) => (BT.fft(re, im), [re, im]), (re: any, im: any) => (A.fft(re, im), [re, im]), [g.signal(n, 5, { nan: false }), g.signal(n, 5, { nan: false })]);
    for (let k = 0; k < 300; k++) {
      const n = g.pick([20, 63, 64, 65, 129, 300, 600]);
      const t = g.times(n, g.pick(['reg', 'jit', 'gap', 'dup'] as const)), a = g.signal(n, g.pick([1, 30]));
      const N = g.pick([2, 4, 8, 16, 64, 100, 128, 256]);
      const st = g.chance(0.5) ? undefined : g.chance(0.2) ? [] : Array.from({ length: g.int(1, 4) }, () => g.int(-2, n));
      bag.cmp('welch', BT.welch, A.welch, [a, g.pick([25, 10, 0, NaN]), N, st]);
      const [i0, i1] = g.chance(0.5) ? [0, n - 1] : g.win(n);
      const p = bag.cmp('psd', BT.psd, A.psd, [t, a, i0, i1, g.pick([2, 0, 0.5, 10, undefined])]);
      if (p) for (let q = 0; q < 3; q++) {
        const f0 = g.pick([0, 0.6, 1, 5, 20]), f1 = f0 + g.pick([-1, 0, 0.5, 4, 100]);
        bag.cmp('findPeak', BT.findPeak, A.findPeak, [p.f, p.p, f0, f1]);
        bag.cmp('localPeaks', BT.localPeaks, A.localPeaks, [p.f, p.p, f0, f1, g.pick([1, 3, 5, 0, -1, undefined])]);
      }
      bag.cmp('psdMask', BT.psdMask, A.psdMask, [t, a, i0, i1, g.mask(n), g.pick([2, 0, 0.5]), g.pick([128, 64, 32, 2, 100])]);
      bag.cmp('freeDecay', BT.freeDecay, A.freeDecay, [t, a, i0, i1]);
    }
    /* espectros sintéticos curtos: menos de 3 pontos, NaN, platô, banda vazia */
    for (let k = 0; k < 300; k++) {
      const n = g.pick([0, 1, 2, 3, 5, 20]);
      const f = Float64Array.from({ length: n }, (_, i) => i * 0.25), p = g.signal(n, 3);
      const f0 = g.num(3), f1 = g.num(5);
      bag.cmp('findPeak curto', BT.findPeak, A.findPeak, [f, p, f0, f1]);
      bag.cmp('localPeaks curto', BT.localPeaks, A.localPeaks, [f, p, f0, f1, g.pick([3, 1])]);
    }
    /* decaimento livre sintético com ruído, buracos e trechos de 19/20/21 amostras */
    const decay = new Set<string>();
    for (let k = 0; k < 400; k++) {
      const n = g.pick([19, 20, 21, 40, 200]), t = g.times(n, 'reg');
      const z = g.pick([0.02, 0.2, 0.5, 0.8, 1.2]), amp = g.pick([0.5, 1.2, 5, 30, -30]), nz = g.pick([0, 0.05, 0.5, 3]), wn = 2 * Math.PI * g.pick([1.2, 1.6, 4]);
      const a = Float64Array.from(t, (x, i) => {
        const s = x - t[0] - 0.2;
        return (s < 0 ? 0 : amp * Math.exp(-z * wn * s) * Math.cos(wn * Math.sqrt(Math.abs(1 - z * z)) * s)) + (g.r() - 0.5) * nz + (g.chance(0.03) ? NaN : 0);
      });
      const [i0, i1] = g.chance(0.7) ? [0, n - 1] : g.win(n);
      const fd = bag.cmp('freeDecay sintético', BT.freeDecay, A.freeDecay, [t, a, i0, i1]);
      if (fd) decay.add(fd.ok ? (fd.over ? 'over' : fd.used) : fd.msg);
    }
    for (let k = 0; k < 500; k++) bag.cmp('rideRates', BT.rideRates, A.rideRates, [g.num(5), g.num(1), g.num(100), g.num(3)]);
    expect(bag.diffs).toEqual([]);
    expect([...decay].sort()).toEqual(['meio ciclo', 'over', 'picos 1 e 3', 'sem evento claro (amplitude pequena)', 'trecho curto demais']);
  });

  it('findShocks, stoppedMask, suspPrep, dropTests, gpsDynamics, voltas', () => {
    const bag = new Bag(), g = new Gen(31);
    const names = ['Shock_-_Front_Left', 'Shock_-_Front_Right', 'Shock_-_Rear_Left', 'Shock_-_Rear_Right', 'Shock_velocity_FL', 'Shock_vel_RR',
      'amort_DE', 'amort_dd', 'susp TE', 'damper td', 'Shock FL vel', 'susp_fl', 'susp_fr_pos', 'Amortecedor diant esq', 'Amortecedor traseiro direito',
      'Shock_rl', 'shockrr', 'Back_pressure', 'Shock_-_Front_Left_2', 'suspensao', 'FL', 'Shock_DE_velocidade'];
    for (let k = 0; k < 400; k++) {
      const n = g.pick([1, 5, 30]);
      const chs = Array.from({ length: g.int(0, 8) }, () => P.finishChannel({ key: g.pick(names), name: 'x', unit: 'mm', data: g.chance(0.2) ? new Float64Array(n).fill(3) : g.signal(n, 10), src: g.pick(['log', 'log', 'calc'] as const) }));
      bag.cmp('findShocks', BT.findShocks, A.findShocks, [chs]);
    }
    for (let k = 0; k < 120; k++) {
      const S = genSession(g);
      const n = S.t.length;
      const tr = G.computeTrack(S, trackCfg(S));
      const trO = BT.computeTrack(S, trackCfg(S));
      bag.eq(`track ${k}`, trO, tr);
      const trArg = g.pick([tr, null, undefined, { ok: false }]);
      bag.cmp(`stoppedMask ${k}`, BT.stoppedMask, A.stoppedMask, [S, trArg]);
      const sp = { compPos: g.pick([true, false, 0, 1]) };
      const su = bag.cmp(`suspPrep ${k}`, BT.suspPrep, A.suspPrep, [S, trArg, sp]);
      if (tr.ok) bag.cmp(`gpsDynamics ${k}`, BT.gpsDynamics, A.gpsDynamics, [S, tr]);
      if (su) {
        const stp = A.stoppedMask(S, trArg as any);
        for (let w = 0; w < 4; w++) { const [i0, i1] = g.win(n); bag.cmp(`dropTests ${k}`, BT.dropTests, A.dropTests, [S.t, su.shocks, g.pick([stp, null, g.mask(n)]), i0, i1]); }
      }
      if (tr.ok) {
        const al = G.autoLine(S, tr);
        const laps = al ? G.computeLaps(S, tr, al, g.pick([0, 3, 10])) : [];
        bag.cmp(`bestLap ${k}`, BT.bestLap, A.bestLap, [laps]);
        bag.cmp(`deltaToBest ${k}`, BT.deltaToBest, A.deltaToBest, [S, tr, laps]);
        const fake = [...laps, { n: 99, t0: S.t[0], t1: S.t[0], time: NaN, i0: 5, i1: 2, vmax: 0, vavg: NaN, dist: 0 }];
        for (const l of fake.slice(0, 4)) {
          const pr = bag.cmp(`lapProfile ${k}`, BT.lapProfile, A.lapProfile, [S, tr, l]);
          const pc = A.lapProfile(S, tr, g.pick(fake));
          bag.cmp(`compareLaps ${k}`, BT.compareLaps, A.compareLaps, [pr, pc, g.pick([1, 0.5, 7, undefined])]);
        }
        bag.cmp(`bestLap empate/NaN ${k}`, BT.bestLap, A.bestLap, [[{ time: NaN }, { time: 5 }, { time: 5 }, { time: 3 }, { time: NaN }]]);
      }
    }
    /* compareLaps com perfis vazios e passo que estoura o tamanho do array (mesmo erro) */
    const empty = { d: new Float64Array(0), t: new Float64Array(0), v: new Float64Array(0), D: 0 };
    const one = { d: Float64Array.of(0, 10), t: Float64Array.of(0, 2), v: Float64Array.of(20, 30), D: 10 };
    for (const [a, b] of [[empty, empty], [empty, one], [one, empty], [one, one]]) for (const st of [1, 0, -1, NaN])
      bag.cmp('compareLaps borda', BT.compareLaps, A.compareLaps, [a, b, st]);
    expect(bag.diffs).toEqual([]);
  });
});

/* ------------------------------------------------------------------ vehicle */
describe('revisão: vehicle (fuzz)', () => {
  it('findWheelCh, findCvtCh, lstsq, linFit', () => {
    const bag = new Bag(), g = new Gen(37);
    const names = ['Wheel_speed', 'speed_wheel', 'vel_roda', 'Velocidade roda', 'rodaD', 'xroda', 'hall', 'Hall_sensor', 'CVT_temp', 'cvt_rpm', 'Belt temp',
      'correia', 'TempCVT', 'speed', 'RPM'];
    for (let k = 0; k < 600; k++) {
      const chs = Array.from({ length: g.int(0, 6) }, () => P.finishChannel({ key: g.pick(names), name: 'x', unit: '', data: g.chance(0.3) ? new Float64Array(4).fill(1) : g.signal(4, 10), src: g.pick(['log', 'log', 'calc'] as const) }));
      bag.cmp('findWheelCh', BT.findWheelCh, V.findWheelCh, [chs]);
      bag.cmp('findCvtCh', BT.findCvtCh, V.findCvtCh, [chs]);
    }
    for (let k = 0; k < 600; k++) {
      const p = g.int(1, 4), rows = g.pick([0, 1, 2, 3, 5, 30, 200]);
      const base = Array.from({ length: p }, () => g.num(10));
      const X = Array.from({ length: rows }, () => Array.from({ length: p }, (_, j) => (g.chance(0.2) ? base[j] : g.num(10))));
      if (g.chance(0.2)) X.forEach(r => { r[p - 1] = r[0] * 2; });        /* colunas colineares */
      const y = Array.from({ length: rows }, () => g.num(50));
      bag.cmp('lstsq', BT.lstsq, V.lstsq, [X, g.chance(0.5) ? y : Float64Array.from(y)]);
      const n = g.pick([10, 19, 20, 21, 100]);
      bag.cmp('linFit', BT.linFit, V.linFit, [g.signal(n, 10), g.signal(n, 10), g.mask(n)]);
    }
    expect(bag.diffs).toEqual([]);
  });

  it('vehPrep com GPS/roda/CVT/dinâmica ligados e desligados', () => {
    const bag = new Bag(), g = new Gen(41);
    let veh = 0, cal = 0;
    for (let k = 0; k < 100; k++) {
      const S = genSession(g);
      const tr = G.computeTrack(S, trackCfg(S));
      const dyn = tr.ok ? A.gpsDynamics(S, tr) : null;
      const car = { ...V.DEFAULT_CAR, ...genCfg(g).car };
      const dynArg = g.pick([dyn, null, undefined, {}]);
      const trArg = g.pick([tr, tr, null, { ok: false }]);
      const So = clone(S), Sn = clone(S);
      const vo = BT.vehPrep(So, trArg, car, dynArg), vn = V.vehPrep(Sn, trArg as any, car, dynArg as any);
      bag.eq(`vehPrep ${k}`, vo, vn);
      for (const v of [0, 3, 12, NaN]) bag.eq(`vehPrep ${k} Fres(${v})`, vo.Fres(v), vn.Fres(v));
      bag.eq(`vehPrep ${k} sessão depois`, So, Sn);
      if (vn.v) veh++;
      if (vn.wheel && vn.kN) cal++;
    }
    expect(bag.diffs).toEqual([]);
    expect(veh).toBeGreaterThan(30);
    expect(cal).toBeGreaterThan(0);
  });

  it('launches, powerCurve, findCoasts, coastFit (perfis de velocidade gerados)', () => {
    const bag = new Bag(), g = new Gen(43);
    const seen = { launch: 0, curve: 0, coast: 0, fit: 0 };
    for (let k = 0; k < 300; k++) {
      const n = g.pick([0, 1, 2, 50, 400, 900]), dt = g.pick([0.04, 0.1, 0.2]);
      const t = Float64Array.from({ length: n }, (_, i) => i * dt + (g.chance(0.01) ? 0.5 : 0));
      const v = new Float64Array(n), ax = new Float64Array(n), dist = new Float64Array(n), slip = new Float64Array(n);
      let sp = 0, d = 0, phase = 0;
      for (let i = 0; i < n; i++) {
        if (g.chance(0.01)) phase = g.int(0, 3);
        const acc = phase === 0 ? 0 : phase === 1 ? g.pick([2, 4, 6]) : phase === 2 ? -0.08 * 9.81 - 0.01 * sp * sp : -6;
        sp = Math.max(0, sp + acc * dt);
        if (phase === 0) sp = 0;
        v[i] = sp + (g.chance(0.02) ? NaN : 0) + (g.chance(0.01) ? 0.31 : 0);
        ax[i] = acc / 9.81 + (g.r() - 0.5) * 0.01;
        d += sp * dt; dist[i] = d;
        slip[i] = g.chance(0.05) ? NaN : (g.r() - 0.3) * 0.3;
      }
      if (bag.cmp('launches', BT.launches, V.launches, [t, v, dist, g.pick([slip, null, undefined]), ax])?.length) seen.launch++;
      const P2 = Float64Array.from(v, (x, i) => (x > 0.5 ? (260 * ax[i] * 9.81 + 100) * x / 1000 : x === x ? 0 : NaN));
      const [i0, i1] = g.win(n);
      if (bag.cmp('powerCurve', BT.powerCurve, V.powerCurve, [v, P2, ax, i0, i1, g.pick([2, 5, 1, undefined]), g.pick([slip, null, undefined])])?.x.length) seen.curve++;
      const cs = bag.cmp('findCoasts', BT.findCoasts, V.findCoasts, [t, v, ax, i0, i1]);
      if (cs?.length) seen.coast++;
      const a = Float64Array.from(ax, x => x * 9.81);
      for (const c of [...(cs || []), { i0, i1 }]) if (bag.cmp('coastFit', BT.coastFit, V.coastFit, [v, a, c.i0, c.i1, g.pick([260, 0, 180]), g.pick([1.15, 0])])) seen.fit++;
    }
    expect(Object.values(seen).every(x => x > 0), JSON.stringify(seen)).toBe(true);
    /* velocidade infinita: os dois estouram do mesmo jeito */
    bag.cmp('powerCurve infinita', BT.powerCurve, V.powerCurve, [Float64Array.of(1, Infinity, 2), Float64Array.of(1, 1, 1), Float64Array.of(1, 1, 1), 0, 2]);
    expect(bag.diffs).toEqual([]);
  });

  it('cvtFit em todos os ramos (curto, pouca variação, θ3 < 0, sem resfriamento, ajuste ok)', () => {
    const bag = new Bag(), g = new Gen(47);
    const msgs = new Set<string>();
    for (let k = 0; k < 160; k++) {
      const dt = g.pick([0.2, 0.5, 1]), n = g.pick([100, 250, 600, 900]);
      const t = Float64Array.from({ length: n }, (_, i) => i * dt);
      const v = new Float64Array(n), Pw = new Float64Array(n), T = new Float64Array(n);
      const th = [g.pick([0.002, 0.01, 0.02, -0.001]), g.pick([0.002, 0.005, 0, -0.001]), g.pick([0.0005, 0, -0.0005])];
      let x = g.pick([30, 40, 60]);
      const Ta = g.pick([28, 35]), mode = g.pick(['ciclo', 'parado', 'andando', 'const']);
      for (let i = 0; i < n; i++) {
        const mv = mode === 'andando' || (mode === 'ciclo' && Math.floor(t[i] / 40) % 2 === 0);
        v[i] = mv ? 8 + 3 * Math.sin(t[i] / 7) : 0;
        Pw[i] = mv ? 4 + 2 * Math.sin(t[i] / 3) : g.chance(0.5) ? 0 : NaN;
        if (mode !== 'const') x += dt * (th[0] * 100 * (Pw[i] === Pw[i] ? Pw[i] : 0) - (th[1] + th[2] * v[i]) * (x - Ta));
        T[i] = x + (g.r() - 0.5) * 0.1 + (g.chance(0.01) ? NaN : 0);
      }
      const car = { ...V.DEFAULT_CAR, tAmb: Ta, tCvtMax: g.pick([100, 50, 20, '']), endurance: g.pick([240, 30, '', 0]), power: g.pick([7.5, 0, 3]) };
      const [i0, i1] = g.chance(0.7) ? [0, n - 1] : g.win(n);
      const r = bag.cmp('cvtFit', BT.cvtFit, V.cvtFit, [t, T, v, Pw, car, i0, i1]);
      if (r) msgs.add(r.ok ? 'ok' : r.msg.slice(0, 20));
    }
    expect(bag.diffs).toEqual([]);
    /* só aquecendo, potência liga/desliga: o ajuste completo dá θ3 < 0, o refeito com 2
     * parâmetros dá θ2 ≈ 4–9·10⁻⁶ e cai em "não achou resfriamento" */
    for (const th2 of [0, 2e-6, 5e-6]) for (const nz of [0, 1e-5]) {
      const dt = 1, n = 900, t = Float64Array.from({ length: n }, (_, i) => i * dt);
      const v = Float64Array.from(t, x => 6 + 4 * Math.sin(x / 9)), Pw = Float64Array.from(t, x => (Math.floor(x / 60) % 2 ? 0 : 5));
      let x = 30;
      const T = Float64Array.from(Pw, p => (x += dt * (0.01 * p - th2 * (x - 28))) + (g.r() - 0.5) * nz);
      const r = bag.cmp('cvtFit só aquecendo', BT.cvtFit, V.cvtFit, [t, T, v, Pw, { ...V.DEFAULT_CAR, tAmb: 28 }, 0, n - 1]);
      if (r) msgs.add(r.ok ? 'ok' : r.msg.slice(0, 20));
    }
    expect(msgs.size).toBe(5);     /* os 4 avisos e o ajuste ok */
  });

  it('bodyAngles, gradients, jumps, bottomOuts, roughness, roadSpectrum', () => {
    const bag = new Bag(), g = new Gen(53);
    const seen = { jumps: 0, bottom: 0, roll: 0, pitch: 0, road: 0, rough: 0 };
    for (let k = 0; k < 120; k++) {
      const S = genSession(g);
      const n = S.t.length;
      const tr = G.computeTrack(S, trackCfg(S));
      const su = A.suspPrep(S, tr, { compPos: g.chance(0.7) });
      const car = { ...V.DEFAULT_CAR, ...genCfg(g).car };
      const ang = bag.cmp(`bodyAngles ${k}`, BT.bodyAngles, V.bodyAngles, [su, car]);
      const dyn = tr.ok ? A.gpsDynamics(S, tr) : null;
      const veh = V.vehPrep(S, tr, car, dyn);
      const acc = { lon: veh.ax || (dyn && dyn.along), lat: (veh.wheel && veh.ay) || (dyn && dyn.alat) };
      const stp = A.stoppedMask(S, tr);
      const mv = stp ? Uint8Array.from(stp, x => 1 - x) : null;
      for (let w = 0; w < 3; w++) {
        const [i0, i1] = g.win(n);
        const gr = bag.cmp(`gradients ${k}`, BT.gradients, V.gradients, [ang || {}, g.chance(0.8) ? acc : {}, g.pick([mv, null]), i0, i1]);
        if (gr?.roll) seen.roll++;
        if (gr?.pitchBrake || gr?.pitchAccel) seen.pitch++;
        const J = bag.cmp(`jumps ${k}`, BT.jumps, V.jumps, [S.t, su, g.pick([{ v: veh.v, slip: veh.slip }, { v: veh.v }, {}]), car, i0, i1]);
        if (J?.length) seen.jumps++;
        const B = bag.cmp(`bottomOuts ${k}`, BT.bottomOuts, V.bottomOuts, [S.t, su, g.pick([car, { strokeF: '30', strokeR: 25 }, { strokeF: 0, strokeR: NaN }]), i0, i1]);
        if (B?.length) seen.bottom++;
        const act = su.shocks.filter(s => s.active) as A.ActiveShock[];
        const dist = tr.ok && g.chance(0.7) ? tr.dist : (veh.dist || Float64Array.from(S.t, (x, i) => i * 0.4));
        if (bag.cmp(`roadSpectrum ${k}`, BT.roadSpectrum, V.roadSpectrum, [g.pick([act.map(s => s.disp), act.slice(0, 1).map(s => s.v), []]), dist, mv || new Uint8Array(n).fill(1), i0, i1, g.pick([0.25, 0.5, 1, undefined])])) seen.road++;
      }
      if (bag.cmp(`roughness ${k}`, BT.roughness, V.roughness, [S.t, su])) seen.rough++;
    }
    expect(bag.diffs).toEqual([]);
    expect(Object.values(seen).every(x => x > 0), JSON.stringify(seen)).toBe(true);
  });
});

describe('revisão: demo', () => {
  it('demoCSV idêntica e DEMO_CAR com as mesmas chaves na mesma ordem', () => {
    expect(demoCSV() === BT.demoCSV()).toBe(true);
    const src = readFileSync(path.join(LEGACY_DIR, 'app.js'), 'utf8');
    const m = /const DEMO_CAR = (\{[\s\S]*?\});/.exec(src)!;
    expect(sdiff(new Function(`return (${m[1]});`)(), DEMO_CAR)).toEqual([]);
    expect(sdiff(LEGACY_DEMO_CAR, DEMO_CAR)).toEqual([]);
  });
});
