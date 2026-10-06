/* Carrega o app antigo (legacy/js) dentro de um contexto vm do Node, para os testes de
 * equivalência: cada função portada para @baja/core tem que dar o mesmo resultado que a
 * original nos mesmos dados.
 *
 *   loadLegacy()            só os módulos de cálculo (util, parsers, gps, analysis, vehicle, demo)
 *   loadLegacy({ ui: true}) também analysisui.js + vehicleui.js com um DOM falso: dá para chamar
 *                           os render*() das abas e ler o que eles escreveram (innerHTML,
 *                           textContent) e os dados que mandaram para os gráficos (BT.Plot.set).
 *   legacyCompute(BT, S, cfg)  réplica fiel do recompute() de legacy/js/app.js
 *
 * Os typed arrays criados lá dentro são de outro "realm": compare elemento a elemento
 * (helpers em ./compare.ts), não com instanceof / toEqual. */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LEGACY_DIR = path.resolve(HERE, '../../../legacy/js');
export const FIXTURES = path.resolve(HERE, 'fixtures');
export const SAMPLES = path.resolve(HERE, '../../../samples');

const CALC = ['util.js', 'parsers.js', 'gps.js', 'analysis.js', 'vehicle.js', 'demo.js'];
const UI = ['analysisui.js', 'vehicleui.js'];

/* elemento falso: guarda o que a interface escreve nele */
export interface FakeEl {
  id: string;
  innerHTML: string;
  textContent: string;
  hidden: boolean;
  value: string;
  disabled: boolean;
  checked: boolean;
  title: string;
  className: string;
  style: Record<string, string>;
  dataset: Record<string, string>;
  attrs: Record<string, string>;
  plot?: unknown;                 /* último spec passado a BT.Plot.set para este host */
  [k: string]: unknown;
}

function makeEl(id: string): FakeEl {
  const cls = new Set<string>();
  const el: FakeEl = {
    id, innerHTML: '', textContent: '', hidden: false, value: '', disabled: false, checked: false, title: '', className: '',
    style: {}, dataset: {}, attrs: {},
    classList: {
      add: (...c: string[]) => c.forEach(x => cls.add(x)),
      remove: (...c: string[]) => c.forEach(x => cls.delete(x)),
      toggle: (c: string, on?: boolean) => { const v = on ?? !cls.has(c); if (v) cls.add(c); else cls.delete(c); return v; },
      contains: (c: string) => cls.has(c),
    },
    setAttribute(k: string, v: string) { el.attrs[k] = String(v); },
    getAttribute(k: string) { return el.attrs[k] ?? null; },
    querySelectorAll: () => [],
    querySelector: () => makeEl(''),
    appendChild: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getContext: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 300, right: 800, bottom: 300 }),
    clientWidth: 800, clientHeight: 300,
    closest: () => null,
    focus: () => undefined,
  };
  return el;
}

export interface Legacy {
  BT: any;                        /* o objeto global BT do app antigo */
  el(id: string): FakeEl;         /* elemento falso pelo id (cria se não existir) */
  els: Map<string, FakeEl>;
}

export function loadLegacy(opts: { ui?: boolean } = {}): Legacy {
  const els = new Map<string, FakeEl>();
  const el = (id: string) => { let e = els.get(id); if (!e) els.set(id, e = makeEl(id)); return e; };
  const ctx: any = {
    console,
    setTimeout: () => 0, clearTimeout: () => undefined,
    requestAnimationFrame: () => 0,
    performance: { now: () => 0 },
    matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
    getComputedStyle: () => ({ getPropertyValue: () => '#888888' }),
    IntersectionObserver: class { observe() { /* nada */ } },
    ResizeObserver: class { observe() { /* nada */ } },
    devicePixelRatio: 1,
    document: {
      documentElement: { dataset: {} },
      getElementById: el,
      querySelectorAll: () => [],
      querySelector: () => null,
      createElement: () => makeEl(''),
      body: { appendChild: () => undefined },
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const run = (f: string) => vm.runInContext(readFileSync(path.join(LEGACY_DIR, f), 'utf8'), ctx, { filename: f });
  CALC.forEach(run);
  if (opts.ui) {
    /* BT.Plot (canvas) vira um gravador: o spec de cada gráfico fica em el(id).plot */
    vm.runInContext(`BT.Plot = class { constructor(host) { this.host = host; } set(spec) { this.spec = spec; this.host.plot = spec; } draw() {} move() {} };`, ctx);
    UI.forEach(run);
  }
  return { BT: ctx.BT, el, els };
}

/* ------------------------------------------------------------------ recompute() do app.js */
const GPS_GROUP = 'Calculados do GPS';

/** Estado equivalente ao objeto A do app antigo depois de setSession()/recompute(). */
export interface LegacyState {
  S: any; cfg: any; track: any; laps: any[]; stopped: Uint8Array | null; dyn: any; veh: any; acc: any;
  susp: any; ang: any; all: any[]; sel: number; channel(key: string): any;
}

function buildDerived(BT: any, A: any): any[] {
  const tr = A.track, S = A.S, out: any[] = [];
  if (!tr || !tr.ok) return out;
  const mk = (key: string, name: string, unit: string, data: ArrayLike<number>) => out.push(BT.finishChannel({ key, name, unit, data, src: 'gps' }));
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
  if (A.laps.length >= 2) mk('gps:delta', 'Delta p/ melhor volta', 's', BT.deltaToBest(S, tr, A.laps));
  if (A.dyn) A.dyn.channels.forEach((c: any) => { if (!(A.veh && A.veh.wheel && /gps:a(lon|lat)g?/.test(c.key))) out.push(c); });
  if (S.gps) {
    mk('gps:cx', 'Código X (calculado)', '', tr.codeX);
    mk('gps:cy', 'Código Y (calculado)', '', tr.codeY);
  }
  return out;
}

function recompute(BT: any, S: any, cfg: any): LegacyState {
  const A: any = { S, cfg, sel: -1 };
  A.track = BT.computeTrack(S, cfg);
  A.laps = BT.computeLaps(S, A.track, cfg.line || null, +cfg.minLap || 10);
  A.stopped = BT.stoppedMask(S, A.track);
  A.dyn = A.track.ok ? BT.gpsDynamics(S, A.track) : null;
  A.veh = BT.vehPrep(S, A.track, cfg.car, A.dyn);
  if (!A.stopped && A.veh.v) A.stopped = Uint8Array.from(BT.smooth(S.t, A.veh.v, 1), (x: number) => (x === x && x < 0.8 ? 1 : 0));
  A.acc = {
    lon: A.veh.ax || (A.dyn && A.dyn.along), lat: (A.veh.wheel && A.veh.ay) || (A.dyn && A.dyn.alat),
    src: A.veh.wheel ? 'longitudinal pela velocidade da roda, lateral = velocidade da roda × guinada do GPS' : 'pela trajetória do GPS',
  };
  A.susp = BT.suspPrep(S, A.track, cfg.susp);
  A.ang = BT.bodyAngles(A.susp, cfg.car);
  const SG = 'Suspensão (calculado)';
  const sc = (key: string, name: string, unit: string, data: ArrayLike<number>) => BT.finishChannel({ key, name, unit, data, src: 'calc', group: SG });
  if (A.ang.pitch) A.susp.channels.push(sc('susp:pitch', 'Arfagem (+ = frente baixa)', '°', A.ang.pitch));
  if (A.ang.rollF) A.susp.channels.push(sc('susp:rollF', 'Rolagem diant. (+ = esq. comprimida)', '°', A.ang.rollF));
  if (A.ang.rollR) A.susp.channels.push(sc('susp:rollR', 'Rolagem tras. (+ = esq. comprimida)', '°', A.ang.rollR));
  const rough = BT.roughness(S.t, A.susp);
  if (rough) A.susp.channels.push(sc('susp:rough', 'Rugosidade (vel. amortecedores RMS 1 s)', 'mm/s', rough));
  const derived = buildDerived(BT, A);
  A.all = derived.concat(A.veh.channels, A.susp.channels, S.channels);
  A.all.forEach((c: any) => { c.group = c.group || (c.src === 'gps' ? GPS_GROUP : 'Do log'); });
  A.channel = (key: string) => A.all.find((c: any) => c.key === key);
  return A as LegacyState;
}

/** Mesma sequência do app antigo: configuração com os padrões, migração dos dados do carro,
 *  canais X/Y adivinhados quando os salvos não existem no log, e recompute(). Com
 *  autoLine, faz como o botão "Automática" / o exemplo: põe a linha de largada (arredondada
 *  a 2 casas, como A.setLine) e recalcula. */
export function legacyCompute(BT: any, S: any, cfgIn: any = {}, opts: { autoLine?: boolean } = {}): LegacyState {
  const cfg = Object.assign({}, BT.DEFAULT_CFG, cfgIn);
  cfg.susp = Object.assign({}, BT.DEFAULT_SUSP, cfgIn.susp || {});
  cfg.car = Object.assign({}, BT.DEFAULT_CAR, cfgIn.car || {});
  ['strokeF', 'strokeR', 'massF', 'massR', 'mrF', 'mrR'].forEach(k => {
    if (!(+cfg.car[k] > 0) && +cfg.susp[k] > 0) cfg.car[k] = +cfg.susp[k];
    delete cfg.susp[k];
  });
  const keys = S.channels.map((c: any) => c.key);
  if (!S.gps && (!keys.includes(cfg.chX) || !keys.includes(cfg.chY))) {
    const g = BT.guessGpsChannels(keys);
    cfg.chX = g.x; cfg.chY = g.y; cfg.chStatus = g.status;
  }
  if (cfg.chStatus && !keys.includes(cfg.chStatus)) cfg.chStatus = '';
  let A = recompute(BT, S, cfg);
  if (opts.autoLine && !cfg.line) {
    const l = BT.autoLine(S, A.track);
    if (l) {
      cfg.line = l.map((p: any) => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) }));
      A = recompute(BT, S, cfg);
    }
  }
  return A;
}

/** Dados do carro do exemplo (DEMO_CAR em legacy/js/app.js). */
export const DEMO_CAR = {
  mass: 260, wb: 1600, trackF: 1300, trackR: 1250, mrF: 1.6, mrR: 1.6, strokeF: 150, strokeR: 150,
  massF: 62, massR: 62, wheelCh: '', cvtCh: '', wheelDriven: true, tAmb: 28, tCvtMax: 100,
};

/** Sessão de exemplo como o botão "Dados de exemplo": CSV do modelo físico + carro do exemplo + linha automática. */
export function legacyDemo(BT: any): LegacyState {
  const S = BT.parseCSV(BT.demoCSV(), 'exemplo_baja.csv');
  S.demo = true;
  return legacyCompute(BT, S, { car: DEMO_CAR }, { autoLine: true });
}

/** Objeto "aba de análises" do app antigo, sem o construtor (que mexe no DOM), para chamar
 *  os render*() com o estado A. win: 'session' | 'lap' | 'view'. */
export function legacyAnalysis(L: Legacy, A: LegacyState, win: 'session' | 'lap' | 'view' = 'session'): any {
  const an = Object.create(L.BT.Analysis.prototype);
  an.A = A; an.win = win; an.plots = {}; an.minis = []; an.visible = true; an.drop = null;
  an.dirty = new Set();
  (A as any).charts = (A as any).charts || { v: { t0: A.S.t[0], t1: A.S.t[A.S.t.length - 1] } };
  return an;
}

/** Arquivos de teste: os pequenos estão em test/fixtures (vão para o git); os grandes em
 *  samples/ (só no PC de quem tem os logs). Retorna null se o arquivo não existir. */
export function readFixture(name: string): string | null {
  for (const dir of [FIXTURES, SAMPLES]) {
    const p = path.join(dir, name);
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  return null;
}
