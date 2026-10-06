/* Sessão de exemplo (legacy/js/demo.js) e dados do carro do exemplo (DEMO_CAR de
 * legacy/js/app.js). */
import type { CarConfig } from './types';
import { clamp } from './util';

/* Sessão de exemplo no mesmo formato do CSV do FT Manager (25 Hz) com os canais do carro:
 * GPS X/Y em volts (Back_pressure / O2_General, 4 Hz, passos de 0,86 m como o PIC),
 * 4 potenciômetros de suspensão (posição + velocidade), temperatura da CVT e velocidade da
 * roda. Tudo sai de um modelo físico com valores conhecidos, para conferir as análises:
 *
 *   carro 260 kg, 5,5 kW na roda, tração limitada a 4,7 m/s², Crr 0,06, CdA 0,9 m²
 *   suspensão: 1/4 de carro por roda, ~1,6 Hz na frente e ~1,9 Hz atrás, ζ ~0,3,
 *              relação roda/amortecedor 1,6, bitola 1300/1250 mm, entre-eixos 1600 mm
 *   roda: sensor na roda de tração, circunferência configurada 3 % maior (marca 3 % a
 *         mais), escorrega na largada e dispara no ar
 *   CVT: C·dT/dt = 0,15·P_motor − (2,5 + 0,6·v)·(T − 28 °C), C = 2500 J/K
 *
 * Roteiro: parado (teste de queda em t ≈ 1 s), largada, 2 voltas, parada de 8 s no box,
 * nova largada, 2 voltas, coast-down em ponto morto até quase parar. A pista tem terra,
 * costelas, 2 lombadas e uma rampa de salto por volta. */
export const demoCSV = (): string => {
  let seed = 12345;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) / 0.7071; };

  /* traçado (m, Leste/Norte) */
  const P = (th: number): number[] => [75 * Math.cos(th) + 14 * Math.cos(3 * th) - 6 * Math.sin(2 * th),
                   50 * Math.sin(th) + 16 * Math.sin(2 * th) + 6 * Math.cos(3 * th)];
  const M = 3000, pts = [], S = [0];
  for (let k = 0; k <= M; k++) pts.push(P(k / M * 2 * Math.PI));
  for (let k = 1; k <= M; k++) S.push(S[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const L = S[M];

  /* carro */
  const m = 260, g = 9.81, Pw = 5500, aTrac = 4.7, aBrake = 5.5, crr = 0.06, cda = 0.9, rho = 1.15;
  const Fres = (v: number) => crr * m * g + 0.5 * rho * cda * v * v;
  const aMax = (v: number) => Math.min(aTrac, (Pw / Math.max(v, 0.5) - Fres(v)) / m);

  /* curvatura com sinal (+ = esquerda) -> velocidade limite, aceleração por potência */
  const kap = new Float64Array(M + 1);
  for (let k = 1; k < M; k++) {
    const a = pts[k - 1], b = pts[k], c = pts[k + 1];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]) * Math.hypot(c[0] - a[0], c[1] - a[1]);
    kap[k] = d ? 2 * cr / d : 0;
  }
  kap[0] = kap[M] = kap[1];
  const v = new Float64Array(M + 1);
  for (let k = 0; k <= M; k++) v[k] = Math.min(15, Math.sqrt(5.2 / Math.max(Math.abs(kap[k]), 1e-4)));
  for (let rep = 0; rep < 2; rep++) {
    for (let k = 1; k <= M; k++) { const ds = S[k] - S[k - 1]; v[k] = Math.min(v[k], Math.sqrt(v[k - 1] ** 2 + 2 * Math.max(0.05, aMax(v[k - 1])) * ds)); }
    v[0] = v[M];
    for (let k = M - 1; k >= 0; k--) { const ds = S[k + 1] - S[k]; v[k] = Math.min(v[k], Math.sqrt(v[k + 1] ** 2 + 2 * aBrake * ds)); }
    v[M] = v[0];
  }
  const at = (arr: ArrayLike<number>, s: number) => { s = ((s % L) + L) % L; let lo = 0, hi = M; while (hi - lo > 1) { const q = (lo + hi) >> 1; if (S[q] <= s) lo = q; else hi = q; } const u = (s - S[lo]) / (S[hi] - S[lo] || 1); return arr[lo] + (arr[hi] - arr[lo]) * u; };
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);

  /* piso (m) */
  const hash = (i: number, sd: number) => { let h = Math.imul(i ^ sd, 0x27d4eb2d); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return ((h >>> 0) / 4294967296) * 2 - 1; };
  const vnoise = (x: number, sd: number) => { const i = Math.floor(x), f = x - i, u = (1 - Math.cos(f * Math.PI)) / 2; return hash(i, sd) * (1 - u) + hash(i + 1, sd) * u; };
  const JUMP = 0.27 * L, RAMP = 2.5, HJ = 0.35;
  const roadF = (s: number, side: number) => {
    const q = s / L;
    const rough = Math.max(0, Math.sin(q * 2 * Math.PI * 3)) ** 2;
    let z = rough * (0.022 * vnoise(s / 2.5, 11 + side) + 0.010 * vnoise(s / 1.0, 23 + side) + 0.004 * vnoise(s / 0.4, 37 + side));
    if (q > 0.55 && q < 0.63) z += 0.03 * Math.sin(2 * Math.PI * s / 3.2);                 /* costelas, λ = 3,2 m */
    for (let b = 0.2; b < 1; b += 0.6) { const x = (q - b) * L; if (x > 0 && x < 0.9) z += 0.07 * Math.sin(Math.PI * x / 0.9); }  /* lombadas */
    if (s > JUMP && s < JUMP + RAMP) z += HJ * (s - JUMP) / RAMP;                          /* rampa do salto */
    return z;
  };
  const RS = 0.02, RN = Math.ceil(L / RS) + 2, RT = [new Float32Array(RN), new Float32Array(RN)];
  for (let i = 0; i < RN; i++) { RT[0][i] = roadF(i * RS, 0); RT[1][i] = roadF(i * RS, 1); }
  const road = (s: number, side: number) => {
    const x = (((s % L) + L) % L) / RS, i = Math.floor(x), f = x - i, T = RT[side];
    return T[i] + (T[i + 1] - T[i]) * f;
  };

  /* 1/4 de carro por roda */
  const WB = 1.6, MR = 1.6;
  const corner = (front: boolean, side: number) => {
    const ms = 62, mu = 14, ks = front ? 6800 : 9500, ct = 150, kt = 55000;
    const c = 2 * 0.33 * Math.sqrt(ks * ms);
    return { front, side, ms, mu, ks, kt, ct, cC: c * 0.7, cR: c * 1.6, zs: 0, vs: 0, zu: 0, vu: 0, zr: road(front ? 0 : -WB, side), st: front ? 70 : 75, air: false };
  };
  const C = [corner(true, 0), corner(true, 1), corner(false, 0), corner(false, 1)];  /* FL FR RL RR */

  const dt = 0.04, res = 220 / 255, SUB = 10, h = dt / SUB;
  const code = (d: number) => Math.max(0, Math.min(255, Math.floor(128 + d / res)));
  const volts = (c: number) => (Math.ceil(c * 5000 / 255) / 1000).toFixed(3);
  let o = 'TIME,Wheel_speed,CVT_temp,O2_General,Back_pressure,' +
    'Shock_-_Front_Left,Shock_-_Front_Right,Shock_-_Rear_Left,Shock_-_Rear_Right,' +
    'Shock_velocity_FL,Shock_velocity_FR,Shock_velocity_RL,Shock_velocity_RR\n';
  let s = 0, sp = 0, t = 0, gx = '2.510', gy = '2.510', nx = 0, ny = 0;
  let Tcvt = 42, phase = 'grid', timer = 0, airV = 0;
  const PIT = 2 * L + 6, END = 4 * L + 6;
  while (true) {
    /* roteiro */
    let acc!: number;
    if (phase === 'grid') { acc = -sp / dt; if (t >= 4) phase = 'run1'; }
    else if (phase === 'run1' && s >= PIT) phase = 'pitIn';
    else if (phase === 'run2' && s >= END) phase = 'coast';
    if (phase === 'run1' || phase === 'run2') {
      const target = at(v, s) * (0.95 + 0.04 * Math.sin(Math.floor(s / L) * 1.7));
      acc = clamp((target - sp) / dt, -aBrake, aMax(sp));
    } else if (phase === 'pitIn') {
      acc = clamp(-sp / dt, -aBrake, 0);
      if (sp < 0.02) { sp = 0; timer += dt; if (timer > 8) { phase = 'run2'; timer = 0; } }
    } else if (phase === 'coast') {
      acc = sp > 2 ? -Fres(sp) / m : clamp(-sp / dt, -aBrake, 0);       /* ponto morto, depois freia */
      if (sp < 0.02) { timer += dt; if (timer > 3) break; }
    }
    const sp0 = sp;
    sp = Math.max(0, sp + acc * dt);
    s += (sp0 + sp) / 2 * dt;

    /* suspensão */
    const alatR = -sp * sp * at(kap, s) / g;
    const along = (sp - sp0) / dt / g;
    const push = t >= 1.0 && t < 1.12 ? 9 : 0;        /* teste de queda */
    const s0 = s - (sp0 + sp) / 2 * dt;
    for (let j = 1; j <= SUB; j++) {
      const sj = s0 + (s - s0) * j / SUB;
      for (const k of C) {
        const zr = road(k.front ? sj : sj - WB, k.side), vr = (zr - k.zr) / h;
        k.zr = zr;
        const F = k.ms * (push + (k.front ? -along : along) * g * 0.35 + (k.side === 0 ? alatR : -alatR) * g * 0.45);
        const x = k.zu - k.zs, xv = k.vu - k.vs;
        let fs = k.ks * x + (xv > 0 ? k.cC : k.cR) * xv;
        const pos = k.st + x * 1000 / MR;
        if (pos > 150) fs += 4e5 * (pos - 150) / 1000 * MR;
        if (pos < 2) fs -= 4e5 * (2 - pos) / 1000 * MR;
        const ftr = k.kt * (zr - k.zu) + k.ct * (vr - k.vu), lim = -(k.ms + k.mu) * g;
        k.air = ftr <= lim;
        const ft = Math.max(ftr, lim);
        k.vs += (fs - F) / k.ms * h; k.zs += k.vs * h;
        k.vu += (ft - fs) / k.mu * h; k.zu += k.vu * h;
      }
    }

    /* roda de tração: escorrega na largada, dispara no ar; sensor marca 3 % a mais */
    const slipV = acc > 1 ? 1.4 * Math.exp(-sp / 3) * Math.min(1, acc / aTrac) : 0;
    airV = C[2].air && C[3].air && acc >= 0 ? Math.min(3, airV + 6 * dt) : Math.max(0, airV - 12 * dt);
    const wheel = 1.03 * (sp + slipV + airV) * 3.6 + (sp > 0.1 ? gauss() * 0.15 : 0);

    /* CVT */
    const Pwheel = Math.max(0, (m * acc + (sp > 0.1 ? Fres(sp) : 0)) * sp);
    Tcvt += dt * (0.15 * Pwheel / 0.85 - (2.5 + 0.6 * sp) * (Tcvt - 28)) / 2500;

    /* GPS a 4 Hz com erro que anda devagar */
    if (Math.round(t / dt) % 6 === 0) {
      nx = nx * 0.85 + gauss() * 0.35; ny = ny * 0.85 + gauss() * 0.35;
      gx = volts(code(at(xs, s) + nx)); gy = volts(code(at(ys, s) + ny));
    }
    const pos = C.map(k => (k.st + (k.zu - k.zs) * 1000 / MR + gauss() * 0.15).toFixed(1));
    const vel = C.map(k => ((k.vu - k.vs) * 1000 / MR).toFixed(1));
    o += `${t.toFixed(3)},${Math.max(0, wheel).toFixed(1)},${(Tcvt + gauss() * 0.15).toFixed(1)},${gy},${gx},${pos.join(',')},${vel.join(',')}\n`;
    t += dt;
    if (t > 1500) break;
  }
  return o;
};

/* O exemplo usa os dados do carro simulado; os do carro real ficam guardados e voltam
 * ao abrir um log de verdade (e são eles que vão para o armazenamento). */
export const DEMO_CAR: Partial<CarConfig> = { mass: 260, wb: 1600, trackF: 1300, trackR: 1250, mrF: 1.6, mrR: 1.6, strokeF: 150, strokeR: 150,
  massF: 62, massR: 62, wheelCh: '', cvtCh: '', wheelDriven: true, tAmb: 28, tCvtMax: 100 };
