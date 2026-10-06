/* Análises (só cálculo; a interface fica nos relatórios), porte de legacy/js/analysis.js:
 *   suspensão   amortecedores por canto, estático, curso, histogramas de velocidade
 *   ressonância espectro (Welch) da posição -> frequência natural e ζ (meia potência)
 *               decaimento livre (teste de queda) -> frequência e ζ pelo decremento log.
 *   dinâmica    aceleração longitudinal/lateral e raio de curva pela trajetória do GPS
 *   voltas      perfil por distância, delta para a melhor volta */
import type { Channel, Session, SuspConfig } from './types';
import type { Lap, Track, TrackOk } from './gps';
import { smooth } from './gps';
import { finishChannel } from './parsers';
import { clamp, idxAt } from './util';

/* ---------------------------------------------------------------- tipos das saídas */
export type CornerId = 'FL' | 'FR' | 'RL' | 'RR';

/** Canto do carro: id, nome curto, eixo e o padrão do nome do canal no log. */
export interface Corner {
  id: CornerId;
  label: string;
  axle: 'F' | 'R';
  re: RegExp;
}

/** Amortecedor de um canto (saída de findShocks). suspPrep completa os campos de baixo nos
 *  ativos, e jumps grava ext/thr. Para os ativos use ActiveShock:
 *  `shocks.filter((k): k is ActiveShock => k.active)`. */
export interface Shock extends Corner {
  pos: Channel | null;           /* canal de posição (mm) */
  vel: Channel | null;           /* canal de velocidade (mm/s) da FT, se houver */
  active: boolean;               /* tem posição e ela não é constante */
  staticFromStop?: boolean;      /* estático pela mediana com o carro parado (senão: do log todo) */
  static?: number;               /* mm, posição estática */
  disp?: Float64Array;           /* mm em relação ao estático, + = compressão */
  v?: Float64Array;              /* mm/s, + = compressão */
  vCalc?: boolean;               /* velocidade derivada da posição (sem canal de velocidade) */
  ext?: number;                  /* (jumps) deslocamento mais estendido visto no log */
  thr?: number;                  /* (jumps) limiar de "no ar" = 0,7·ext */
}
/** Amortecedor com sinal, depois de suspPrep. */
export interface ActiveShock extends Shock {
  active: true;
  pos: Channel;
  staticFromStop: boolean;
  static: number;
  disp: Float64Array;
  v: Float64Array;
  vCalc: boolean;
}
/** Saída de suspPrep: os 4 cantos + canais calculados (vel. calc., afundamento, torção). */
export interface Susp {
  shocks: Shock[];
  channels: Channel[];
}

/** Estatística da velocidade do amortecedor (velStats). Frações do total de amostras. */
export interface VelStats {
  n: number;
  lsC: number; hsC: number;      /* compressão lenta / rápida (abaixo / acima do joelho) */
  lsR: number; hsR: number;      /* extensão lenta / rápida */
  meanC: number; meanR: number;  /* mm/s */
  p95C: number; p95R: number;
  maxC: number; maxR: number;
}

/** Histograma em % das amostras válidas: barra k cobre [lo + k·w, lo + (k+1)·w). */
export interface Hist {
  y: Float64Array;
  lo: number;
  w: number;
  n: number;
}

/** Espectro de Welch (unidade²/Hz). */
export interface Psd {
  f: Float64Array;
  p: Float64Array;
  nseg: number;
  N: number;
  fs: number;
}

/** Pico do espectro (findPeak). */
export interface Peak {
  f: number;
  p: number;
  f1: number | null;             /* meia potência à esquerda / direita */
  f2: number | null;
  zeta: number | null;
  snr: number;
  local: boolean;
}

/** Extremo do decaimento livre (refinado por parábola). */
export interface DecayExt { t: number; a: number }
interface DecayData {
  ts: number[];                  /* s, tempos das amostras válidas */
  d: Float64Array;               /* desvio em relação à base */
  base: number;
  noise: number;
}
/** freeDecay sem resultado (curto demais ou sem evento claro). */
export interface DecayFail extends Partial<DecayData> { ok: false; msg: string; over?: undefined }
/** freeDecay: não oscilou (amortecimento alto). */
export interface DecayOver extends DecayData { ok: true; over: true; msg: string; E: DecayExt[]; used?: string }
/** freeDecay com frequência e ζ. */
export interface DecayOk extends DecayData {
  ok: true; over?: undefined; E: DecayExt[]; used: string;
  fd: number; zeta: number; fn: number;
}
export type FreeDecay = DecayFail | DecayOver | DecayOk;

/** Evento de teste de queda: resultado por amortecedor ativo. */
export interface DropTest {
  t: number;
  i0: number;
  i1: number;
  res: (FreeDecay & { id: CornerId })[];
}

/** Rigidez e amortecimento equivalentes (na roda e no amortecedor). */
export interface RideRates {
  k: number;                     /* N/m na roda */
  c: number;                     /* N·s/m na roda (NaN sem ζ) */
  cShock: number;                /* × MR² (NaN sem MR) */
  kShock: number;
}

/** Saída de gpsDynamics. */
export interface Dyn {
  along: Float64Array;           /* g, + acelerando */
  alat: Float64Array;            /* g, + direita */
  radius: Float64Array;          /* m (999 = reta) */
  yaw: Float64Array;             /* rad/s, + = direita */
  channels: Channel[];
}

/** Perfil de uma volta por distância (lapProfile). */
export interface LapProfile {
  lap: Lap;
  d: Float64Array;               /* m desde a largada */
  t: Float64Array;               /* s desde a largada */
  v: Float64Array;               /* km/h */
  i: number[];                   /* índice de cada ponto na sessão */
  D: number;                     /* m, distância total da volta */
}

/** Comparação de duas voltas na distância da referência (compareLaps). */
export interface LapCompare {
  d: Float64Array;
  vRef: Float64Array;
  vCmp: Float64Array;
  delta: Float64Array;           /* s, + = a comparada está perdendo */
  tCmp: Float64Array;
}

/* ---------------------------------------------------------------- configuração */
export const DEFAULT_SUSP: SuspConfig = {
  compPos: true,          /* posição aumenta quando o amortecedor comprime */
  knee: 100,              /* mm/s: separa baixa / alta velocidade no histograma */
  moving: true,           /* histogramas só com o carro andando (> 3 km/h) */
  strokeF: 0, strokeR: 0, /* curso total do amortecedor (mm), opcional */
  massF: 0, massR: 0,     /* massa suspensa por roda (kg), opcional */
  mrF: 0, mrR: 0,         /* relação de movimento roda/amortecedor, opcional */
  fmin: 0.6, fmax: 4.5    /* banda onde procurar a frequência da carroceria (Hz) */
};

const L = '(^|[^a-z])', R = '([^a-z]|$)';
export const CORNERS: Corner[] = [
  { id: 'FL', label: 'Diant. esq.', axle: 'F', re: new RegExp(`front.?left|${L}fl${R}|diant\\w*.?esq|${L}de${R}`, 'i') },
  { id: 'FR', label: 'Diant. dir.', axle: 'F', re: new RegExp(`front.?right|${L}fr${R}|diant\\w*.?dir|${L}dd${R}`, 'i') },
  { id: 'RL', label: 'Tras. esq.', axle: 'R', re: new RegExp(`rear.?left|${L}rl${R}|tras\\w*.?esq|${L}te${R}`, 'i') },
  { id: 'RR', label: 'Tras. dir.', axle: 'R', re: new RegExp(`rear.?right|${L}rr${R}|tras\\w*.?dir|${L}td${R}`, 'i') }
];

/* Canais de amortecedor do log, por canto (posição e velocidade). */
export const findShocks = (chs: Channel[]): Shock[] => {
  const sh = chs.filter(c => c.src === 'log' && /shock|amort|susp|damper/i.test(c.key));
  return CORNERS.map(k => {
    const mine = sh.filter(c => k.re.test(c.key));
    const pos = mine.find(c => !/vel/i.test(c.key)) || null;
    const vel = mine.find(c => /vel/i.test(c.key)) || null;
    return Object.assign({}, k, { pos, vel, active: !!(pos && !pos.constant) });
  });
};

/* ---------------------------------------------------------------- utilidades */
/* derivada por diferença central em ±H s, só dentro de trechos sem NaN */
export const deriv = (t: ArrayLike<number>, a: ArrayLike<number>, H: number): Float64Array => {
  const n = t.length, out = new Float64Array(n).fill(NaN);
  let lo = 0, hi = 0, run = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] !== a[i]) continue;
    if (i === 0 || a[i - 1] !== a[i - 1]) run = i;
    if (lo < run) lo = run;
    while (lo < i && t[lo] < t[i] - H) lo++;
    if (hi < i) hi = i;
    while (hi + 1 < n && a[hi + 1] === a[hi + 1] && t[hi + 1] <= t[i] + H) hi++;
    let A = lo, B = hi;
    if (A === B) { if (i > run) A = i - 1; else if (i + 1 < n && a[i + 1] === a[i + 1]) B = i + 1; }
    out[i] = B > A ? (a[B] - a[A]) / (t[B] - t[A]) : 0;
  }
  return out;
};

export const median = (a: ArrayLike<number>, mask?: ArrayLike<number> | null): number => {
  const v: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] === a[i] && (!mask || mask[i])) v.push(a[i]);
  if (!v.length) return NaN;
  v.sort((x, y) => x - y);
  return v[v.length >> 1];
};
export const quant = (sorted: ArrayLike<number>, q: number): number => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] : NaN;

/* y(x) por interpolação linear, xs crescente */
export const interpAt = (xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number => {
  const n = xs.length;
  if (!n) return NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  const dx = xs[hi] - xs[lo];
  return dx > 0 ? ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / dx : ys[hi];
};

const mkCh = (key: string, name: string, unit: string, data: Float64Array, group: string): Channel =>
  finishChannel({ key, name, unit, data, src: 'calc', group });

/* ---------------------------------------------------------------- suspensão */
/* Parado = andou menos de 3 m em 3 s (±1,5 s). A velocidade instantânea do GPS não
 * serve: parado, a posição ainda pula entre passos de 0,86 m. Sem GPS: null. */
export const stoppedMask = (S: Session, tr: Track | null | undefined): Uint8Array | null => {
  if (!tr || !tr.ok) return null;
  const t = S.t, n = t.length, out = new Uint8Array(n);
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    while (a < i && t[a] < t[i] - 1.5) a++;
    while (b + 1 < n && t[b + 1] <= t[i] + 1.5) b++;
    if (tr.valid[a] && tr.valid[b] && tr.valid[i]) out[i] = Math.hypot(tr.x[b] - tr.x[a], tr.y[b] - tr.y[a]) < 3 ? 1 : 0;
  }
  return out;
};

/* Prepara cada amortecedor: estático (mediana parado), deslocamento em relação ao
 * estático com + = compressão, velocidade (do log ou derivada). Gera os canais
 * combinados que der com os sensores ligados. */
export const suspPrep = (S: Session, tr: Track | null | undefined, sp: Pick<SuspConfig, 'compPos'>): Susp => {
  const t = S.t, n = t.length, sign = sp.compPos ? 1 : -1;
  const dt = n > 1 ? (t[n - 1] - t[0]) / (n - 1) : 0.04;
  const shocks = findShocks(S.channels);
  const stopped = stoppedMask(S, tr);
  const G = 'Suspensão (calculado)', chans: Channel[] = [];
  shocks.forEach(k => {
    if (!k.active) return;
    const p = k.pos!.data;
    let st = NaN;
    if (stopped) {
      let c = 0;
      for (let i = 0; i < n; i++) if (stopped[i] && p[i] === p[i]) c++;
      if (c >= 25) st = median(p, stopped);
    }
    k.staticFromStop = st === st;
    if (!(st === st)) st = median(p);
    k.static = st;
    k.disp = Float64Array.from(p, v => (v - st) * sign);
    if (k.vel && !k.vel.constant) { k.v = Float64Array.from(k.vel.data, v => v * sign); k.vCalc = false; }
    else {
      k.v = deriv(t, k.disp, dt * 1.5); k.vCalc = true;
      chans.push(mkCh('susp:v' + k.id, `Vel. amortecedor ${k.id} (calc.)`, 'mm/s', k.v, G));
    }
  });
  const on = (id: CornerId) => shocks.find((k): k is ActiveShock => k.id === id && k.active);
  const mean = (list: ActiveShock[]) => {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (const k of list) s += k.disp[i];
      out[i] = s / list.length;
    }
    return out;
  };
  const F = [on('FL'), on('FR')].filter(Boolean) as ActiveShock[], Rr = [on('RL'), on('RR')].filter(Boolean) as ActiveShock[];
  const act = shocks.filter((k): k is ActiveShock => k.active);
  /* arfagem e rolagem em graus saem de bodyAngles (vehicle.ts), com a geometria do carro */
  if (act.length >= 2) chans.push(mkCh('susp:heave', 'Afundamento médio', 'mm', mean(act), G));
  if (F.length === 2 && Rr.length === 2) {
    chans.push(mkCh('susp:warp', 'Torção (rol. diant − tras)', 'mm',
      Float64Array.from({ length: n }, (_, i) => (F[0].disp[i] - F[1].disp[i]) - (Rr[0].disp[i] - Rr[1].disp[i])), G));
  }
  return { shocks, channels: chans };
};

/* histograma de velocidade e zonas baixa/alta velocidade, + = compressão */
export const velStats = (v: ArrayLike<number>, i0: number, i1: number, mask: ArrayLike<number> | null | undefined, knee: number): VelStats | null => {
  const c: number[] = [], r: number[] = [];
  for (let i = i0; i <= i1; i++) {
    const x = v[i];
    if (x !== x || (mask && !mask[i])) continue;
    if (x >= 0) c.push(x); else r.push(-x);
  }
  const n = c.length + r.length;
  if (!n) return null;
  c.sort((a, b) => a - b); r.sort((a, b) => a - b);
  const cnt = (a: number[], lo: number, hi: number) => { let k = 0; for (const x of a) if (x >= lo && x < hi) k++; return k; };
  const mean = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
  return {
    n,
    lsC: cnt(c, 0, knee) / n, hsC: cnt(c, knee, Infinity) / n,
    lsR: cnt(r, 0, knee) / n, hsR: cnt(r, knee, Infinity) / n,
    meanC: mean(c), meanR: mean(r),
    p95C: quant(c, 0.95), p95R: quant(r, 0.95),
    maxC: c.length ? c[c.length - 1] : NaN, maxR: r.length ? r[r.length - 1] : NaN
  };
};

export const hist = (a: ArrayLike<number>, i0: number, i1: number, mask: ArrayLike<number> | null | undefined, lo: number, hi: number, nb: number): Hist => {
  const out = new Float64Array(nb), w = (hi - lo) / nb;
  let n = 0;
  for (let i = i0; i <= i1; i++) {
    const x = a[i];
    if (x !== x || (mask && !mask[i])) continue;
    n++;
    const k = Math.floor((x - lo) / w);
    if (k >= 0 && k < nb) out[k]++;
  }
  if (n) for (let k = 0; k < nb; k++) out[k] = out[k] / n * 100;
  return { y: out, lo, w, n };
};

/* ---------------------------------------------------------------- espectro */
/* FFT radix-2 no lugar (n potência de 2) */
export const fft = (re: Float64Array | number[], im: Float64Array | number[]): void => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const a = i + k, b = a + h;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
};

/* PSD de Welch: janelas Hann de N pontos com 50 % de sobreposição. Unidade²/Hz. */
export const welch = (x: ArrayLike<number>, fs: number, N: number, starts?: number[] | null): Psd => {
  const w = new Float64Array(N);
  let U = 0;
  for (let i = 0; i < N; i++) { w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); U += w[i] * w[i]; }
  const half = N >> 1, P = new Float64Array(half + 1), re = new Float64Array(N), im = new Float64Array(N);
  let K = 0;
  if (!starts) { starts = []; for (let s = 0; s + N <= x.length; s += half) starts.push(s); }
  for (const s of starts) {
    let m = 0;
    for (let i = 0; i < N; i++) m += x[s + i];
    m /= N;
    for (let i = 0; i < N; i++) { re[i] = (x[s + i] - m) * w[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= half; k++) P[k] += re[k] * re[k] + im[k] * im[k];
    K++;
  }
  const f = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    P[k] /= K * fs * U;
    if (k > 0 && k < half) P[k] *= 2;
    f[k] = k * fs / N;
  }
  return { f, p: P, nseg: K, N, fs };
};

/* Espectro de um canal no trecho [i0, i1]. Antes tira a variação lenta (média móvel de
 * hp s: transferência de carga, mudança de altura) para sobrar a oscilação. */
export const psd = (t: ArrayLike<number>, a: ArrayLike<number>, i0: number, i1: number, hp = 2): Psd | null => {
  const n = i1 - i0 + 1;
  if (n < 64) return null;
  const x = new Float64Array(n);
  let nan = 0;
  for (let i = 0; i < n; i++) { x[i] = a[i0 + i]; if (x[i] !== x[i]) nan++; }
  if (nan > n * 0.3) return null;
  if (nan) {                                             /* tapa buracos com reta */
    let last = -1;
    for (let i = 0; i < n; i++) {
      if (x[i] !== x[i]) continue;
      if (last < 0) for (let k = 0; k < i; k++) x[k] = x[i];
      else for (let k = last + 1; k < i; k++) x[k] = x[last] + (x[i] - x[last]) * (k - last) / (i - last);
      last = i;
    }
    for (let k = last + 1; k < n; k++) x[k] = x[last];
  }
  const fs = (n - 1) / (t[i1] - t[i0]);
  if (hp > 0) {
    const w = Math.max(3, Math.round(hp * fs) | 1), h = w >> 1, ps = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) ps[i + 1] = ps[i] + x[i];
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) { const a0 = Math.max(0, i - h), b0 = Math.min(n - 1, i + h); y[i] = x[i] - (ps[b0 + 1] - ps[a0]) / (b0 - a0 + 1); }
    x.set(y);
  }
  let N = 256;
  while (N > n) N >>= 1;
  if (N < 64) return null;
  return welch(x, fs, N);
};

/* Maior pico na banda, com interpolação parabólica e largura de meia potência:
 * ζ ≈ (f2 − f1) / (2·fn). snr = pico / mediana da banda (pico "claro" > ~3). */
export const findPeak = (f: ArrayLike<number>, p: ArrayLike<number>, fmin: number, fmax: number): Peak | null => {
  let k = -1, best = 0;
  const band: number[] = [];
  for (let i = 1; i < f.length - 1; i++) {
    if (f[i] < fmin || f[i] > fmax) continue;
    band.push(p[i]);
    if (p[i] > best) { best = p[i]; k = i; }
  }
  if (k < 0) return null;
  const y0 = p[k - 1], y1 = p[k], y2 = p[k + 1], den = y0 - 2 * y1 + y2, df = f[1] - f[0];
  const off = den ? clamp(0.5 * (y0 - y2) / den, -0.5, 0.5) : 0;
  const fp = f[k] + off * df, half = y1 / 2;
  let f1: number | null = null, f2: number | null = null;
  for (let j = k; j > 0; j--) if (p[j - 1] < half) { f1 = f[j - 1] + (half - p[j - 1]) / (p[j] - p[j - 1]) * df; break; }
  for (let j = k; j < f.length - 1; j++) if (p[j + 1] < half) { f2 = f[j] + (p[j] - half) / (p[j] - p[j + 1]) * df; break; }
  let zeta: number | null = null;
  if (f1 !== null && f2 !== null) zeta = (f2 - f1) / (2 * fp);
  else if (f2 !== null) zeta = (f2 - fp) / fp;
  else if (f1 !== null) zeta = (fp - f1) / fp;
  band.sort((a, b) => a - b);
  const med = band[band.length >> 1];
  return { f: fp, p: y1, f1, f2, zeta, snr: med > 0 ? y1 / med : Infinity, local: y0 < y1 && y2 < y1 };
};

/* Decaimento livre (teste de queda): no trecho, acha o maior desvio em relação ao valor
 * final e os extremos alternados seguintes. Período entre picos e decremento log:
 *   δ = ln(a1/a3)  (ou 2·ln(a1/|a2|) com meio ciclo)   ζ = δ / √(4π² + δ²)
 *   fd = 1/T       fn = fd / √(1 − ζ²) */
export const freeDecay = (t: ArrayLike<number>, a: ArrayLike<number>, i0: number, i1: number): FreeDecay => {
  const ts: number[] = [], v: number[] = [];
  for (let i = i0; i <= i1; i++) if (a[i] === a[i]) { ts.push(t[i]); v.push(a[i]); }
  if (v.length < 20) return { ok: false, msg: 'trecho curto demais' };
  const tail = v.slice(Math.floor(v.length * 0.75)).sort((x, y) => x - y);
  const base = tail[tail.length >> 1];
  const mt = tail.reduce((s, x) => s + x, 0) / tail.length;
  const noise = Math.sqrt(tail.reduce((s, x) => s + (x - mt) ** 2, 0) / tail.length);
  const d = Float64Array.from(v, x => x - base);
  let p0 = 0;
  for (let i = 1; i < d.length; i++) if (Math.abs(d[i]) > Math.abs(d[p0])) p0 = i;
  const thr = Math.max(0.3, 3 * noise);
  /* o objeto cresce como no original: base, depois E/used, depois o resultado */
  const res = { ts, d, base, noise } as DecayData & { E?: DecayExt[]; used?: string };
  if (Math.abs(d[p0]) < Math.max(1, 5 * noise)) return Object.assign(res, { ok: false as const, msg: 'sem evento claro (amplitude pequena)' });
  const ext = [p0];
  let cur = Math.sign(d[p0]), k = p0;
  while (ext.length < 4) {
    while (k < d.length && d[k] * cur > 0) k++;
    if (k >= d.length) break;
    cur = -cur;
    let m = -1, best = 0;
    while (k < d.length && d[k] * cur >= 0) { if (Math.abs(d[k]) > best) { best = Math.abs(d[k]); m = k; } k++; }
    if (m < 0 || best < thr || m === d.length - 1) break;
    ext.push(m);
  }
  const refine = (k: number): DecayExt => {
    if (k <= 0 || k >= d.length - 1) return { t: ts[k], a: d[k] };
    const y0 = d[k - 1], y1 = d[k], y2 = d[k + 1], den = y0 - 2 * y1 + y2;
    const off = den ? clamp(0.5 * (y0 - y2) / den, -0.5, 0.5) : 0;
    return { t: ts[k] + off * (ts[k + 1] - ts[k - 1]) / 2, a: y1 - 0.25 * (y0 - y2) * off };
  };
  const E = ext.map(refine);
  res.E = E;
  let T: number, delta: number;
  if (E.length >= 3) { T = E[2].t - E[0].t; delta = Math.log(Math.abs(E[0].a / E[2].a)); res.used = 'picos 1 e 3'; }
  else if (E.length === 2) { T = 2 * (E[1].t - E[0].t); delta = 2 * Math.log(Math.abs(E[0].a / E[1].a)); res.used = 'meio ciclo'; }
  else return Object.assign(res, { ok: true as const, over: true as const, msg: 'não oscilou: amortecimento alto (ζ ≳ 0,7) ou evento fora do trecho' }) as DecayOver;
  const zeta = delta / Math.sqrt(4 * Math.PI ** 2 + delta ** 2), fd = 1 / T;
  return Object.assign(res, { ok: true as const, fd, zeta, fn: fd / Math.sqrt(1 - zeta * zeta) }) as DecayOk;
};

/* Picos locais do espectro na banda, do mais forte ao mais fraco. */
export const localPeaks = (f: ArrayLike<number>, p: ArrayLike<number>, fmin: number, fmax: number, max = 3): { f: number; p: number }[] => {
  const out: { f: number; p: number }[] = [];
  for (let i = 1; i < f.length - 1; i++) {
    if (f[i] < fmin || f[i] > fmax) continue;
    if (p[i] > p[i - 1] && p[i] >= p[i + 1]) out.push({ f: f[i], p: p[i] });
  }
  out.sort((a, b) => b.p - a.p);
  return out.slice(0, max);
};

/* Sinal menos a média móvel de sec s (tira transferência de carga / altura). */
export const highpass = (t: ArrayLike<number>, a: ArrayLike<number>, sec: number): Float64Array => {
  const m = smooth(t, a, sec);
  return Float64Array.from(a, (v, i) => v - m[i]);
};

/* Testes de queda com o carro parado: alguém empurra o carro para baixo e solta (ou
 * deixa cair alguns cm). Acha os eventos (desvio grande do estático com o carro parado,
 * separados por > 2 s) e analisa cada amortecedor como decaimento livre. */
export const dropTests = (t: ArrayLike<number>, shocks: Shock[], stopped: ArrayLike<number> | null | undefined, i0: number, i1: number): DropTest[] => {
  const act = shocks.filter((k): k is ActiveShock => k.active);
  if (!act.length) return [];
  const n = t.length, sum = new Float64Array(n).fill(NaN);
  for (let i = i0; i <= i1; i++) {
    if (stopped && !stopped[i]) continue;
    let s = 0, ok = true;
    for (const k of act) { const v = k.disp[i]; if (v !== v) { ok = false; break; } s += Math.abs(v); }
    if (ok) sum[i] = s / act.length;
  }
  const ev: DropTest[] = [];
  let last = -1e9;
  for (let i = i0 + 1; i < i1; i++) {
    const v = sum[i];
    if (!(v > 8) || !(v >= sum[i - 1]) || !(v >= sum[i + 1]) || t[i] - last < 2) continue;
    const j = Math.min(i1, idxAt(t, t[i] + 2));
    let pre = 0, pn = 0;                                    /* calmo antes do evento */
    for (let k = idxAt(t, t[i] - 1.2); k < idxAt(t, t[i] - 0.3); k++) if (sum[k] === sum[k]) { pre += sum[k]; pn++; }
    if (pn && pre / pn > 0.25 * v) continue;
    let calm = 0;
    for (let k = i; k <= j; k++) if (sum[k] === sum[k]) calm++;
    if (calm < (j - i + 1) * 0.9) continue;               /* tem que continuar parado */
    last = t[i];
    const a = Math.max(i0, idxAt(t, t[i] - 0.15));
    const res = act.map(k => Object.assign({ id: k.id }, freeDecay(t, k.disp, a, j)));
    if (res.some(r => r.ok && !r.over)) ev.push({ t: t[i], i0: a, i1: j, res });
  }
  return ev;
};

/* Espectro só com segmentos inteiros dentro da máscara (ex.: só trechos rápidos). */
export const psdMask = (t: ArrayLike<number>, a: ArrayLike<number>, i0: number, i1: number, mask: ArrayLike<number> | null | undefined, hp = 2, N = 128): Psd | null => {
  const x = highpass(t, a, hp);
  const fs = (i1 - i0) / (t[i1] - t[i0]);
  const starts: number[] = [];
  for (let s = i0; s + N - 1 <= i1;) {
    let bad = -1;
    for (let k = s; k < s + N; k++) if (x[k] !== x[k] || (mask && !mask[k])) { bad = k; break; }
    if (bad < 0) { starts.push(s); s += N >> 1; } else s = bad + 1;
  }
  if (!starts.length) return null;
  return welch(x, fs, N, starts);
};

/* Com massa suspensa por roda m e frequência fn: rigidez equivalente na roda
 * k = m·(2π·fn)² e amortecimento c = 2ζ·√(k·m). No amortecedor: × MR² (MR = roda/amort.). */
export const rideRates = (fn: number, zeta: number, m: number, mr: number): RideRates | null => {
  if (!(m > 0) || !(fn > 0)) return null;
  const k = m * (2 * Math.PI * fn) ** 2;
  const c = zeta > 0 ? 2 * zeta * Math.sqrt(k * m) : NaN;
  return { k, c, cShock: mr > 0 ? c * mr * mr : NaN, kShock: mr > 0 ? k * mr * mr : NaN };
};

/* ---------------------------------------------------------------- dinâmica pelo GPS */
export const gpsDynamics = (S: Session, tr: TrackOk): Dyn => {
  const t = S.t, n = t.length, G = 'Calculados do GPS';
  const v = Float64Array.from(tr.speed, x => x / 3.6);
  const hu = new Float64Array(n).fill(NaN);
  let prev = NaN, acc = 0;
  for (let i = 0; i < n; i++) {
    if (!tr.valid[i]) { prev = NaN; continue; }
    const h = tr.heading[i];
    if (prev === prev) { let d = h - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; acc += d; }
    else acc = h;
    hu[i] = acc; prev = h;
  }
  const dv = deriv(t, v, 0.5), dh = deriv(t, hu, 0.5);
  const along = new Float64Array(n).fill(NaN), alat = new Float64Array(n).fill(NaN), rad = new Float64Array(n).fill(NaN);
  const yaw = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!tr.valid[i]) continue;
    along[i] = dv[i] / 9.81;
    if (tr.speed[i] > 5) {
      yaw[i] = dh[i];
      alat[i] = v[i] * dh[i] / 9.81;
      const w = Math.abs(dh[i]);
      rad[i] = w > 1e-3 ? Math.min(v[i] / w, 999) : 999;
    }
  }
  const lon = smooth(t, along, 0.5), lat = smooth(t, alat, 0.5);
  return {
    along: lon, alat: lat, radius: rad, yaw: smooth(t, yaw, 0.5),   /* yaw: rad/s, + = direita */
    channels: [
      mkCh('gps:along', 'Acel. longitudinal (GPS)', 'g', lon, G),
      mkCh('gps:alat', 'Acel. lateral (GPS, + direita)', 'g', lat, G),
      mkCh('gps:radius', 'Raio de curva (GPS)', 'm', rad, G)
    ]
  };
};

/* ---------------------------------------------------------------- voltas */
export const lapProfile = (S: Session, tr: TrackOk, lap: Lap): LapProfile => {
  const d: number[] = [], tt: number[] = [], v: number[] = [], ii: number[] = [];
  const d0 = tr.dist[lap.i0];
  for (let i = lap.i0; i <= lap.i1; i++) {
    if (!tr.valid[i] || tr.dist[i] !== tr.dist[i]) continue;
    d.push(tr.dist[i] - d0); tt.push(S.t[i] - lap.t0); v.push(tr.speed[i]); ii.push(i);
  }
  return { lap, d: Float64Array.from(d), t: Float64Array.from(tt), v: Float64Array.from(v), i: ii, D: d.length ? d[d.length - 1] : 0 };
};

export const bestLap = (laps: Pick<Lap, 'time'>[]): number => laps.reduce((b, l, k) => (b < 0 || l.time < laps[b].time ? k : b), -1);

/* delta para a melhor volta em cada amostra (distância normalizada pelo tamanho da volta) */
export const deltaToBest = (S: Session, tr: TrackOk, laps: Lap[]): Float64Array => {
  const out = new Float64Array(S.t.length).fill(NaN);
  const b = bestLap(laps);
  if (laps.length < 2 || b < 0) return out;
  const ref = lapProfile(S, tr, laps[b]);
  laps.forEach(l => {
    const p = lapProfile(S, tr, l), sc = p.D > 0 ? ref.D / p.D : 1;
    for (let k = 0; k < p.d.length; k++) out[p.i[k]] = p.t[k] - interpAt(ref.d, ref.t, p.d[k] * sc);
  });
  return out;
};

export const compareLaps = (pr: Pick<LapProfile, 'd' | 't' | 'v' | 'D'>, pc: Pick<LapProfile, 'd' | 't' | 'v' | 'D'>, step = 1): LapCompare => {
  const sc = pc.D > 0 ? pr.D / pc.D : 1, dc = pc.d.map(x => x * sc);
  const m = Math.max(2, Math.floor(pr.D / step) + 1);
  const d = new Float64Array(m), vR = new Float64Array(m), vC = new Float64Array(m), dl = new Float64Array(m), tC = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    const x = Math.min(k * step, pr.D);
    d[k] = x;
    vR[k] = interpAt(pr.d, pr.v, x); vC[k] = interpAt(dc, pc.v, x);
    tC[k] = interpAt(dc, pc.t, x);
    dl[k] = tC[k] - interpAt(pr.d, pr.t, x);
  }
  return { d, vRef: vR, vCmp: vC, delta: dl, tCmp: tC };
};
