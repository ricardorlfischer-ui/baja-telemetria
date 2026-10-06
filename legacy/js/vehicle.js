/* Física do carro a partir de GPS + velocidade da roda + temperatura da CVT + 4 potenciômetros
 * de suspensão. Só cálculo; a interface fica em vehicleui.js.
 *
 *   roda × GPS        fator de calibração do pneu (raio efetivo), escorregamento
 *   longitudinal      a = dv/dt, potência na roda P = (m·a + F_res(v))·v,
 *                     F_res = Crr·m·g + ½·ρ·CdA·v²   (coast-down mede Crr e CdA)
 *   largadas          tempos de 0–10/20/30 m e 0–20/40 km/h a partir do carro parado
 *   CVT               modelo térmico de 1ª ordem ajustado por mínimos quadrados:
 *                     dT/dt = θ1·P⁺ − (θ2 + θ3·v)·(T − T_amb)
 *   suspensão         gradiente de rolagem (°/g) e de arfagem (°/g), saltos, fim de curso,
 *                     rugosidade, espectro em distância (comprimento de onda das ondulações) */
'use strict';

BT.DEFAULT_CAR = {
  mass: 260,                 /* kg, carro + piloto */
  wb: 1500,                  /* entre-eixos, mm */
  trackF: 1300, trackR: 1250,/* bitola, mm */
  mrF: 0, mrR: 0,            /* relação roda/amortecedor (curso roda ÷ curso amortecedor); 0 = não informado */
  strokeF: 0, strokeR: 0,    /* curso total do amortecedor, mm */
  massF: 0, massR: 0,        /* massa suspensa por roda, kg */
  wheelCh: '', wheelDriven: true, cvtCh: '',
  tAmb: 28, tCvtMax: 100, endurance: 240,
  crr: 0.05, cda: 0.9, rho: 1.15,
  power: 7.5                 /* kW no motor (B&S 10 hp ≈ 7,5 kW) */
};
const G0 = 9.81;

BT.findWheelCh = chs => {
  const c = chs.filter(c => c.src === 'log' && /wheel.?speed|speed.?wheel|vel\w*.?roda|(^|[^a-z])roda|hall/i.test(c.key));
  return c.find(x => !x.constant) || c[0] || null;
};
BT.findCvtCh = chs => {
  const c = chs.filter(c => c.src === 'log' && /cvt|correia|belt/i.test(c.key));
  return c.find(x => /temp/i.test(x.key) && !x.constant) || c.find(x => !x.constant) || c[0] || null;
};

/* mínimos quadrados: y ≈ X·θ (X em linhas), pelas equações normais */
BT.lstsq = (X, y) => {
  const p = X[0].length, A = Array.from({ length: p }, () => new Float64Array(p + 1));
  for (let r = 0; r < X.length; r++) {
    const x = X[r];
    for (let i = 0; i < p; i++) { for (let j = 0; j < p; j++) A[i][j] += x[i] * x[j]; A[i][p] += x[i] * y[r]; }
  }
  for (let c = 0; c < p; c++) {                       /* Gauss com pivô parcial */
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= p; k++) A[r][k] -= f * A[c][k];
    }
  }
  const th = A.map((row, i) => row[p] / row[i]);
  let ss = 0, st = 0, my = 0;
  for (const v of y) my += v;
  my /= y.length;
  for (let r = 0; r < X.length; r++) { let e = y[r]; for (let i = 0; i < p; i++) e -= X[r][i] * th[i]; ss += e * e; st += (y[r] - my) ** 2; }
  return { th, r2: st > 0 ? 1 - ss / st : 0, n: X.length, rmse: Math.sqrt(ss / X.length) };
};

BT.linFit = (x, y, mask) => {
  const X = [], Y = [];
  for (let i = 0; i < x.length; i++) if (x[i] === x[i] && y[i] === y[i] && (!mask || mask[i])) { X.push([x[i], 1]); Y.push(y[i]); }
  if (X.length < 20) return null;
  const r = BT.lstsq(X, Y);
  return r && { slope: r.th[0], icpt: r.th[1], r2: r.r2, n: r.n };
};

/* ---------------------------------------------------------------- roda, aceleração, potência */
BT.vehPrep = (S, tr, car, dyn) => {
  const t = S.t, n = t.length, G = 'Veículo (calculado)';
  const pick = (key, find) => (key ? S.channels.find(c => c.key === key) : null) || find(S.channels);
  const wc = pick(car.wheelCh, BT.findWheelCh), cc = pick(car.cvtCh, BT.findCvtCh);
  const out = { wheel: wc && !wc.constant ? wc : null, cvt: cc && !cc.constant ? cc : null, wheelAny: wc, cvtAny: cc, channels: [], k: 1, kN: 0 };
  const m = +car.mass || 260, rho = +car.rho || 1.15;
  out.Fres = v => (+car.crr) * m * G0 + 0.5 * rho * (+car.cda) * v * v;
  const gpsOk = tr && tr.ok;
  let v;
  if (out.wheel) {
    const raw = Float64Array.from(out.wheel.data, x => x / 3.6);
    if (gpsOk) {
      /* distância da roda × distância do GPS em trechos sem aceleração forte (sem escorregar) */
      const a0 = BT.deriv(t, raw, 0.25);
      let sg = 0, sw = 0, nn = 0;
      for (let i = 0; i < n; i++) {
        const vg = tr.speed[i] / 3.6, vw = raw[i];
        if (!tr.valid[i] || !(vg > 4) || !(vw > 4) || Math.abs(a0[i]) > 0.5) continue;
        sg += vg; sw += vw; nn++;
      }
      if (nn > 100) { out.k = sg / sw; out.kN = nn; }
    }
    v = Float64Array.from(raw, x => x * out.k);
    out.src = 'roda';
  } else if (gpsOk) { v = Float64Array.from(tr.speed, x => x / 3.6); out.src = 'GPS'; }
  else return out;
  out.v = v;
  const a = BT.smooth(t, BT.deriv(t, v, out.src === 'roda' ? 0.12 : 0.5), 0.3);
  out.a = a;
  out.ax = Float64Array.from(a, x => x / G0);
  out.ay = dyn && dyn.yaw ? Float64Array.from(v, (x, i) => x * dyn.yaw[i] / G0) : null;
  out.P = Float64Array.from(v, (x, i) => (x > 0.5 && a[i] === a[i] ? (m * a[i] + out.Fres(x)) * x / 1000 : x === x ? 0 : NaN));
  /* distância percorrida pela velocidade */
  const d = new Float64Array(n);
  for (let i = 1; i < n; i++) d[i] = d[i - 1] + (v[i] === v[i] && v[i - 1] === v[i - 1] ? (v[i] + v[i - 1]) / 2 * (t[i] - t[i - 1]) : 0);
  out.dist = d;
  if (out.wheel && car.wheelDriven && gpsOk) {
    const vg = BT.smooth(t, Float64Array.from(tr.speed, x => x / 3.6), 0.5);
    out.slip = Float64Array.from(v, (x, i) => {
      const g = vg[i];
      if (!(g === g) || !(x === x) || (x < 1 && g < 1)) return NaN;
      return BT.clamp((x - g) / Math.max(g, 1.5), -1, 3);
    });
  }
  const mk = (key, name, unit, data) => out.channels.push(BT.finishChannel({ key, name, unit, data, src: 'calc', group: G }));
  if (out.wheel) mk('veh:v', 'Velocidade da roda (corrigida)', 'km/h', Float64Array.from(v, x => x * 3.6));
  mk('veh:ax', `Acel. longitudinal (${out.src})`, 'g', out.ax);
  if (out.ay && out.wheel) mk('veh:ay', 'Acel. lateral (roda × GPS)', 'g', out.ay);
  mk('veh:P', 'Potência na roda (estimada)', 'kW', out.P);
  if (out.slip) mk('veh:slip', 'Escorregamento roda × GPS', '%', Float64Array.from(out.slip, x => x * 100));
  return out;
};

/* largadas com o carro parado (≥ 0,8 s abaixo de 1 km/h) */
BT.launches = (t, v, dist, slip, ax) => {
  const n = t.length, res = [];
  let i = 0;
  while (i < n) {
    if (!(v[i] < 0.3)) { i++; continue; }
    let j = i;
    while (j + 1 < n && !(v[j + 1] >= 0.3)) j++;
    if (t[j] - t[i] < 0.8 || j + 1 >= n) { i = j + 1; continue; }
    const t0 = t[j], d0 = dist[j];
    const ev = { t0, i0: j, d10: NaN, d20: NaN, d30: NaN, v20: NaN, v40: NaN, amax: 0, slip10: NaN };
    let k = j, ss = 0, sn = 0;
    while (k + 1 < n && t[k + 1] - t0 < 20) {
      k++;
      if (v[k] < 0.3 && t[k] - t0 > 1.5) break;
      const d = dist[k] - d0, dp = dist[k - 1] - d0, tt = t[k] - t0, tp = t[k - 1] - t0;
      const cross = (x1, x0, lvl) => tp + (tt - tp) * (lvl - x0) / (x1 - x0 || 1);
      for (const L of [10, 20, 30]) if (ev['d' + L] !== ev['d' + L] && d >= L) ev['d' + L] = cross(d, dp, L);
      for (const V of [20, 40]) if (ev['v' + V] !== ev['v' + V] && v[k] * 3.6 >= V) ev['v' + V] = cross(v[k], v[k - 1], V / 3.6);
      if (tt < 3 && ax[k] > ev.amax) ev.amax = ax[k];
      if (slip && d <= 10 && slip[k] === slip[k]) { ss += slip[k]; sn++; }
      if (ev.d30 === ev.d30 && ev.v40 === ev.v40) break;
    }
    if (sn) ev.slip10 = ss / sn;
    if (ev.d10 === ev.d10) res.push(ev);
    i = k + 1;
  }
  return res;
};

/* potência na roda por faixa de velocidade: percentil 90 enquanto acelera. Fora os
 * instantes com a roda de tração patinando (largada, no ar): ali a roda acelera mais que o
 * carro e a potência sairia inflada. Mediana de 3 faixas vizinhas tira picos isolados. */
BT.powerCurve = (v, P, ax, i0, i1, bw = 2, slip = null) => {
  let vmax = 0;
  for (let i = i0; i <= i1; i++) if (v[i] > vmax) vmax = v[i];
  const nb = Math.max(1, Math.ceil(vmax * 3.6 / bw)), B = Array.from({ length: nb }, () => []);
  for (let i = i0; i <= i1; i++) {
    if (!(v[i] > 1.5) || !(ax[i] > 0.03) || P[i] !== P[i] || (slip && slip[i] > 0.12)) continue;
    B[Math.min(nb - 1, Math.floor(v[i] * 3.6 / bw))].push(P[i]);
  }
  const x = [], y = [], c = [];
  B.forEach((b, k) => { if (b.length >= 10) { b.sort((p, q) => p - q); x.push((k + 0.5) * bw); y.push(BT.quant(b, 0.9)); c.push(b.length); } });
  const ym = y.map((_, k) => { const w = y.slice(Math.max(0, k - 1), k + 2).sort((p, q) => p - q); return w[w.length >> 1]; });
  return { x: Float64Array.from(x), y: Float64Array.from(ym), n: c };
};

/* coast-down: −m·a = A + B·v²  →  Crr = A/(m·g), CdA = 2B/ρ */
BT.coastFit = (v, a, i0, i1, m, rho) => {
  const X = [], Y = [], pv = [], pf = [];
  for (let i = i0; i <= i1; i++) {
    if (!(v[i] > 2) || a[i] !== a[i]) continue;
    X.push([1, v[i] * v[i]]); Y.push(-m * a[i]); pv.push(v[i]); pf.push(-m * a[i]);
  }
  if (X.length < 40) return null;
  const r = BT.lstsq(X, Y);
  if (!r) return null;
  const [A, B] = r.th;
  return { A, B, crr: A / (m * G0), cda: 2 * B / rho, r2: r.r2, n: r.n, v: Float64Array.from(pv), F: Float64Array.from(pf) };
};

/* trechos candidatos a coast-down: desacelerando devagar e sem tranco por ≥ 4 s */
BT.findCoasts = (t, v, ax, i0, i1) => {
  const res = [];
  let s = -1;
  const ok = i => v[i] > 3 && ax[i] < -0.012 && ax[i] > -0.2;
  for (let i = i0; i <= i1 + 1; i++) {
    if (i <= i1 && ok(i)) { if (s < 0) s = i; continue; }
    if (s >= 0 && t[i - 1] - t[s] >= 4) {
      let m = 0, q = 0, c = 0;
      for (let k = s; k < i; k++) { m += ax[k]; c++; }
      m /= c;
      for (let k = s; k < i; k++) q += (ax[k] - m) ** 2;
      if (Math.sqrt(q / c) < 0.04) res.push({ i0: s, i1: i - 1, t0: t[s], t1: t[i - 1], v0: v[s], v1: v[i - 1] });
    }
    s = -1;
  }
  return res;
};

/* ---------------------------------------------------------------- CVT */
BT.cvtFit = (t, T, v, P, car, i0, i1) => {
  const Ta = +car.tAmb, Pcap = Math.max(1, +car.power || 7.5) * 1.2;
  const Ts = BT.smooth(t, T, 4), dT = BT.deriv(t, Ts, 3);
  /* dT/dt sai de T suavizado (média de 4 s) e derivado em ±3 s (média de 6 s): as
   * entradas passam pelo mesmo filtro, senão o ajuste subestima o efeito da potência */
  const filt = a => BT.smooth(t, BT.smooth(t, a, 4), 6);
  const Pp = Float64Array.from(P, x => (x === x ? BT.clamp(x, 0, Pcap) : 0));
  const vv = Float64Array.from(v, x => (x === x ? x : 0));
  const fP = filt(Pp), fE = filt(Float64Array.from(Ts, x => x - Ta)), fVE = filt(Float64Array.from(Ts, (x, i) => vv[i] * (x - Ta)));
  const X = [], Y = [];
  let tmin = Infinity, tmax = -Infinity;
  for (let i = i0; i <= i1; i++) {
    if ([Ts[i], dT[i], fP[i], fE[i], fVE[i]].some(x => x !== x)) continue;
    X.push([fP[i], -fE[i], -fVE[i]]); Y.push(dT[i]);
    if (Ts[i] < tmin) tmin = Ts[i]; if (Ts[i] > tmax) tmax = Ts[i];
  }
  const dur = t[i1] - t[i0];
  if (X.length < 200 || dur < 60) return { ok: false, msg: 'log curto demais para o modelo térmico (precisa de pelo menos ~1 min com a CVT variando de temperatura)' };
  if (tmax - tmin < 2) return { ok: false, msg: `a temperatura da CVT variou só ${(tmax - tmin).toFixed(1)} °C neste trecho: não dá para ajustar o modelo` };
  let r = BT.lstsq(X, Y), th = r && r.th;
  if (th && th[2] < 0) { r = BT.lstsq(X.map(x => [x[0], x[1]]), Y); th = r && [r.th[0], r.th[1], 0]; }
  if (!th || th[0] <= 0 || th[1] < 0) return { ok: false, msg: 'o ajuste não fechou (dados pouco variados); grave um trecho mais longo com aquecimento e resfriamento' };
  if (th[1] < 1e-5 && th[2] < 1e-6) return { ok: false, msg: 'o ajuste não achou resfriamento: grave também a CVT esfriando com o carro parado' };
  /* simulação do modelo com a potência e a velocidade medidas */
  const Tm = new Float64Array(t.length).fill(NaN);
  let x = Ts[i0] === Ts[i0] ? Ts[i0] : T[i0], se = 0, sn = 0;
  for (let i = i0; i <= i1; i++) {
    Tm[i] = x;
    if (T[i] === T[i]) { se += (x - T[i]) ** 2; sn++; }
    if (i < i1) x += (t[i + 1] - t[i]) * (th[0] * Pp[i] - (th[1] + th[2] * vv[i]) * (x - Ta));
  }
  /* médias com o carro andando */
  let ps = 0, vs = 0, mn = 0, hm = 0, hn = 0, cm = 0, cn = 0;
  for (let i = i0; i <= i1; i++) {
    if (!(v[i] > 1)) { if (dT[i] === dT[i]) { cm += dT[i]; cn++; } continue; }
    ps += Pp[i]; vs += v[i]; mn++;
    if (dT[i] === dT[i]) { hm += dT[i]; hn++; }
  }
  const Pm = mn ? ps / mn : 0, vm = mn ? vs / mn : 0, hmov = th[1] + th[2] * vm;
  const Tss = Ta + th[0] * Pm / hmov, Tlim = +car.tCvtMax;
  /* projeção do enduro: repete o perfil (P, v) do trecho */
  const prof = [];
  for (let i = i0; i < i1; i++) prof.push([Pp[i], vv[i], t[i + 1] - t[i]]);
  const minutes = +car.endurance || 240, proj = { x: [], y: [] };
  let tt = 0, T0 = Ta, k = 0, tReach = NaN, last = -1;
  while (tt < minutes * 60 && prof.length) {
    const [p, vv, dt] = prof[k];
    T0 += dt * (th[0] * p - (th[1] + th[2] * vv) * (T0 - Ta));
    tt += dt; k = (k + 1) % prof.length;
    if (tReach !== tReach && T0 >= Tlim) tReach = tt;
    if (tt - last >= 10) { proj.x.push(tt / 60); proj.y.push(T0); last = tt; }
  }
  return {
    ok: true, th, r2: r.r2, rmse: sn ? Math.sqrt(se / sn) : NaN, Tm, Ts, Ta, Tlim,
    Pm, vm, Tss, tauMove: 1 / hmov, tauStop: th[1] > 0 ? 1 / th[1] : Infinity,
    heatRate: hn ? hm / hn * 60 : NaN, coolRate: cn ? cm / cn * 60 : NaN,
    proj: { x: Float64Array.from(proj.x), y: Float64Array.from(proj.y) }, tReach: tReach / 60, Tend: T0,
    coolNeed: Tlim > Ta ? (Tss - Ta) / (Tlim - Ta) : NaN,
    vGain: th[2] > 0 ? th[1] / th[2] : Infinity          /* velocidade (m/s) em que o vento dobra a troca de calor */
  };
};

/* ---------------------------------------------------------------- suspensão × dinâmica */
const DEG = 180 / Math.PI;
/* ângulos de rolagem e arfagem (°) a partir do curso da roda = curso do amortecedor × MR */
BT.bodyAngles = (susp, car) => {
  const on = id => susp.shocks.find(k => k.id === id && k.active);
  const mrF = +car.mrF || 1, mrR = +car.mrR || 1;
  const FL = on('FL'), FR = on('FR'), RL = on('RL'), RR = on('RR');
  const n = (FL || FR || RL || RR || { disp: [] }).disp.length, out = {};
  if (FL && FR) out.rollF = Float64Array.from({ length: n }, (_, i) => Math.atan2((FL.disp[i] - FR.disp[i]) * mrF, +car.trackF) * DEG);
  if (RL && RR) out.rollR = Float64Array.from({ length: n }, (_, i) => Math.atan2((RL.disp[i] - RR.disp[i]) * mrR, +car.trackR) * DEG);
  const F = [FL, FR].filter(Boolean), R = [RL, RR].filter(Boolean);
  if (F.length && R.length) {
    out.pitch = Float64Array.from({ length: n }, (_, i) => {
      const f = F.reduce((s, k) => s + k.disp[i], 0) / F.length * mrF, r = R.reduce((s, k) => s + k.disp[i], 0) / R.length * mrR;
      return Math.atan2(f - r, +car.wb) * DEG;
    });
  }
  if (out.rollF && out.rollR) out.roll = out.rollF.map((v, i) => (v + out.rollR[i]) / 2);
  else out.roll = out.rollF || out.rollR || null;
  out.mrKnown = +car.mrF > 0 && +car.mrR > 0;
  return out;
};

BT.gradients = (ang, acc, moving, i0, i1) => {
  const sub = a => (a ? a.subarray(i0, i1 + 1) : null);
  const mv = moving ? moving.subarray(i0, i1 + 1) : null;
  const res = {};
  const lat = sub(acc.lat), lon = sub(acc.lon);
  if (ang.roll && lat) {
    const m = Uint8Array.from(lat, (x, i) => (Math.abs(x) > 0.08 && (!mv || mv[i]) ? 1 : 0));
    res.roll = BT.linFit(lat, sub(ang.roll), m);
  }
  if (ang.pitch && lon) {
    const mb = Uint8Array.from(lon, (x, i) => (x < -0.05 && (!mv || mv[i]) ? 1 : 0));
    const ma = Uint8Array.from(lon, (x, i) => (x > 0.05 && (!mv || mv[i]) ? 1 : 0));
    res.pitchBrake = BT.linFit(lon, sub(ang.pitch), mb);
    res.pitchAccel = BT.linFit(lon, sub(ang.pitch), ma);
  }
  return res;
};

/* saltos: todos os amortecedores com sinal perto da extensão total ao mesmo tempo */
BT.jumps = (t, susp, veh, car, i0, i1) => {
  const act = susp.shocks.filter(k => k.active);
  if (!act.length) return [];
  act.forEach(k => {
    const s = [];
    for (let i = 0; i < k.disp.length; i++) if (k.disp[i] === k.disp[i]) s.push(k.disp[i]);
    s.sort((a, b) => a - b);
    k.ext = BT.quant(s, 0.002);                       /* mais estendido visto no log */
    k.thr = k.ext * 0.7;
  });
  const air = i => act.every(k => k.disp[i] < k.thr);
  const res = [];
  let i = i0;
  while (i <= i1) {
    if (!air(i)) { i++; continue; }
    let j = i;
    while (j + 1 <= i1 && (air(j + 1) || (j + 2 <= i1 && air(j + 2)))) j++;
    const T = t[j + 1 < t.length ? j + 1 : j] - t[i];
    if (T >= 0.1 && veh.v && veh.v[i] > 2) {
      const e = BT.idxAt(t, t[j] + 0.6), shock = {};
      act.forEach(k => {
        let vmax = 0, dmax = -Infinity;
        for (let q = j; q <= e; q++) { if (k.v[q] > vmax) vmax = k.v[q]; if (k.disp[q] > dmax) dmax = k.disp[q]; }
        const stroke = k.axle === 'F' ? +car.strokeF : +car.strokeR;
        shock[k.id] = { vmax, travel: k.static + dmax, bottom: stroke > 0 && k.static + dmax >= 0.95 * stroke };
      });
      let over = NaN;
      if (veh.slip) { over = -Infinity; for (let q = i; q <= j; q++) if (veh.slip[q] > over) over = veh.slip[q]; }
      res.push({ t0: t[i], t1: t[j], i0: i, T, h: G0 * T * T / 8, vland: G0 * T / 2, v: veh.v[i] * 3.6, shock, over });
    }
    i = j + 1;
  }
  return res;
};

/* fim de curso: passou de 95 % do curso total (precisa do curso informado) */
BT.bottomOuts = (t, susp, car, i0, i1) => {
  const res = [];
  susp.shocks.filter(k => k.active).forEach(k => {
    const stroke = k.axle === 'F' ? +car.strokeF : +car.strokeR;
    if (!(stroke > 0)) return;
    let last = -1e9, n = 0;
    for (let i = i0; i <= i1; i++) {
      if (k.static + k.disp[i] >= 0.95 * stroke && t[i] - last > 0.5) { n++; last = t[i]; res.push({ id: k.id, t: t[i], i }); }
    }
  });
  return res;
};

/* rugosidade: RMS em 1 s da velocidade dos amortecedores com sinal (mm/s) */
BT.roughness = (t, susp) => {
  const act = susp.shocks.filter(k => k.active);
  if (!act.length) return null;
  const n = t.length, sum = new Float64Array(n);
  act.forEach(k => {
    const m = BT.smooth(t, Float64Array.from(k.v, x => x * x), 1);
    for (let i = 0; i < n; i++) sum[i] += m[i];
  });
  return Float64Array.from(sum, x => Math.sqrt(x / act.length));
};

/* Espectro em distância (ciclos por metro) do curso médio dos amortecedores com o carro
 * andando: ondulações periódicas da pista aparecem num comprimento de onda λ fixo. Com a
 * frequência natural fn, a velocidade que entra em ressonância é v = fn·λ. */
BT.roadSpectrum = (sigs, dist, moving, i0, i1, ds = 0.25) => {
  /* média dos espectros de cada amortecedor: a média dos cursos cancelaria ondulações de
   * λ = 2 × entre-eixos (frente e traseira em oposição) */
  let acc = null;
  for (const sig of sigs) {
    const r = roadSpec1(sig, dist, moving, i0, i1, ds);
    if (!r) continue;
    if (!acc) acc = { f: r.f, p: Float64Array.from(r.p), nseg: r.nseg, k: 1 };
    else { for (let i = 0; i < acc.p.length; i++) acc.p[i] += r.p[i]; acc.k++; }
  }
  if (acc) for (let i = 0; i < acc.p.length; i++) acc.p[i] /= acc.k;
  return acc;
};
function roadSpec1(sig, dist, moving, i0, i1, ds) {
  const runs = [];
  let s = -1;
  for (let i = i0; i <= i1 + 1; i++) {
    const ok = i <= i1 && moving[i] && sig[i] === sig[i] && dist[i] === dist[i];
    if (ok) { if (s < 0) s = i; continue; }
    if (s >= 0 && dist[i - 1] - dist[s] > 70) runs.push([s, i - 1]);
    s = -1;
  }
  if (!runs.length) return null;
  const x = [], starts = [], N = 256;
  runs.forEach(([a, b]) => {
    const grid = [];
    let k = a;
    for (let d = dist[a]; d <= dist[b]; d += ds) {
      while (k < b && dist[k + 1] < d) k++;
      const d0 = dist[k], d1 = dist[Math.min(b, k + 1)];
      grid.push(d1 > d0 ? sig[k] + (sig[Math.min(b, k + 1)] - sig[k]) * (d - d0) / (d1 - d0) : sig[k]);
    }
    const w = 64, ps = [0];                             /* tira ondas > 16 m */
    for (const g of grid) ps.push(ps[ps.length - 1] + g);
    const off = x.length;
    grid.forEach((g, j) => { const lo = Math.max(0, j - w / 2), hi = Math.min(grid.length - 1, j + w / 2); x.push(g - (ps[hi + 1] - ps[lo]) / (hi - lo + 1)); });
    for (let q = 0; q + N <= grid.length; q += N / 2) starts.push(off + q);
  });
  if (!starts.length) return null;
  return BT.welch(Float64Array.from(x), 1 / ds, N, starts);
}
