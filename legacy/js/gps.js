/* GPS: código 0..255 do expander -> metros -> lat/lon, velocidade, distância e voltas.
 *
 * Mesmo modelo do firmware (gps_pos.c / track_config.h):
 *   vão do eixo = tamanho + 2*margem          (centro fixo)
 *               = 2*tamanho + 2*margem        (centro automático)
 *   resolução   = vão / 255  metros por passo
 *   código      = floor(128 + d / resolução), travado em 0..255
 * Então o código c cobre d em [(c-128)·res, (c-127)·res); aqui usamos o meio do passo,
 * d = (c - 127,5)·res.
 * Com GPS_OUT_MV o PIC manda mV = ceil(c·5000/255) e a FT aplica a calibração do FT
 * Manager; com "0 V = 0, 5 V = 5" o log fica em volts e c = V·51. */
'use strict';

BT.DEFAULT_CFG = {
  lat0: -23.6470278, lon0: -46.5747069, centerFixed: true,    /* track_config.h */
  sizeX: 200, sizeY: 200, margin: 10,
  chX: '', chY: '', chStatus: '', fmt: 'auto',
  smooth: 0.5, minLap: 10, line: null
};

BT.WGS84 = { a: 6378137, e2: 0.00669437999 };
BT.mPerDeg = lat => {
  const phi = lat * Math.PI / 180, s = Math.sin(phi), w = 1 - BT.WGS84.e2 * s * s, sw = Math.sqrt(w);
  return {
    lat: Math.PI / 180 * BT.WGS84.a * (1 - BT.WGS84.e2) / (w * sw),
    lon: Math.PI / 180 * BT.WGS84.a / sw * Math.cos(phi)
  };
};
BT.spanOf = cfg => ({
  x: (cfg.centerFixed ? +cfg.sizeX : 2 * cfg.sizeX) + 2 * cfg.margin,
  y: (cfg.centerFixed ? +cfg.sizeY : 2 * cfg.sizeY) + 2 * cfg.margin
});

BT.FMT_LABEL = { V: 'volts (0–5)', mV: 'mV (0–5000)', code: 'código (0–255)', m: 'metros' };

/* Formato do valor no log, pelo que aparece no canal. */
BT.detectFmt = data => {
  const r = BT.range(data);
  if (!r.n) return 'V';
  if (r.lo >= -0.01 && r.hi <= 5.2) return 'V';
  let ints = true;
  for (let i = 0; i < data.length && ints; i += 7) { const v = data[i]; if (v === v && Math.abs(v - Math.round(v)) > 1e-6) ints = false; }
  if (ints && r.lo >= 0 && r.hi <= 255) return 'code';
  if (r.lo >= 0 && r.hi <= 5200) return 'mV';
  return 'm';
};
BT.toCode = (v, fmt) => fmt === 'V' ? v * 51 : fmt === 'mV' ? v * 0.051 : v;

/* Canais X/Y pelo nome. Sem nome óbvio, usa a configuração atual do expander:
 * entrada 7 (X, Leste) = Back pressure, entrada 8 (Y, Norte) = O2 General
 * (visto no log do BUSMASTER: bloco 0x2FF leva DataID 0x0177 e depois 0x0027). */
BT.guessGpsChannels = keys => {
  const f = re => keys.find(k => re.test(k)) || '';
  let x = f(/gps.?x|^x$|leste|east/i), y = f(/gps.?y|^y$|norte|north/i);
  if (!x || !y) {
    if (keys.includes('Back_pressure') && keys.includes('O2_General')) { x = 'Back_pressure'; y = 'O2_General'; }
  }
  return { x, y, status: f(/gps.?st|status.?gps/i) };
};

/* Reconstrução da posição a partir dos degraus de 0,86 m (4 Hz, o log da FT segura o
 * valor a 25 Hz). Cada eixo separado: quando o código muda um passo, o carro está
 * cruzando a fronteira entre os dois passos, então essa é a posição naquele instante;
 * entre as mudanças, reta no tempo. Saltos de vários passos (carro rápido) usam o meio
 * do passo novo. Parado por muito tempo não vira "andando devagar": a rampa dura no
 * máximo CAP s antes da mudança seguinte. */
function destairAxis(t, A, valid, step) {
  const n = t.length, out = new Float64Array(n).fill(NaN), CAP = 3;
  let i = 0;
  while (i < n) {
    if (!valid[i]) { i++; continue; }
    let j = i;
    while (j + 1 < n && valid[j + 1]) j++;
    const KT = [t[i]], KP = [A[i]];
    for (let k = i + 1; k <= j; k++) {
      const d = A[k] - A[k - 1];
      if (d !== 0) { KT.push(t[k]); KP.push(Math.abs(d) <= step * 1.5 ? (A[k] + A[k - 1]) / 2 : A[k]); }
    }
    let m = 0;
    for (let k = i; k <= j; k++) {
      while (m + 1 < KT.length && KT[m + 1] <= t[k]) m++;
      if (m + 1 >= KT.length) { out[k] = KP[m]; continue; }
      const span = Math.min(CAP, KT[m + 1] - KT[m]), ts = KT[m + 1] - span;
      const u = span > 0 ? BT.clamp((t[k] - ts) / span, 0, 1) : 1;
      out[k] = KP[m] + (KP[m + 1] - KP[m]) * u;
    }
    i = j + 1;
  }
  return out;
}

/* média móvel centrada de w segundos, só dentro de trechos válidos */
function smooth(t, A, w) {
  const n = t.length, out = new Float64Array(n).fill(NaN);
  if (!(w > 0)) { out.set(A); return out; }
  let i = 0;
  while (i < n) {
    if (A[i] !== A[i]) { i++; continue; }
    let j = i;
    while (j + 1 < n && A[j + 1] === A[j + 1]) j++;
    const ps = new Float64Array(j - i + 2);
    for (let k = i; k <= j; k++) ps[k - i + 1] = ps[k - i] + A[k];
    let a = i, b = i;
    for (let k = i; k <= j; k++) {
      while (t[a] < t[k] - w / 2) a++;
      while (b < j && t[b + 1] <= t[k] + w / 2) b++;
      out[k] = (ps[b - i + 1] - ps[a - i]) / (b - a + 1);
    }
    i = j + 1;
  }
  return out;
}

BT.smooth = smooth;

/* Calcula a trajetória. Retorna { ok, msg, x, y, valid, sat, speed, heading, dist, lat, lon,
 * codeX, codeY, center, fmt, res, span, source } */
BT.computeTrack = (S, cfg) => {
  const t = S.t, n = t.length;
  const span = BT.spanOf(cfg), res = { x: span.x / 255, y: span.y / 255 };
  const tr = { ok: false, msg: '', span, res, center: null, fmt: null, source: '' };
  let X = new Float64Array(n).fill(NaN), Y = new Float64Array(n).fill(NaN);
  const valid = new Uint8Array(n), sat = new Uint8Array(n);
  const codeX = new Float64Array(n).fill(NaN), codeY = new Float64Array(n).fill(NaN);

  if (S.gps) {
    /* BUSMASTER: lat/lon reais do módulo GPS */
    let first = null;
    for (let i = 0; i < n && !first; i++) if (S.gps.lat[i] === S.gps.lat[i]) first = { lat: S.gps.lat[i], lon: S.gps.lon[i] };
    const c = cfg.centerFixed ? { lat: +cfg.lat0, lon: +cfg.lon0 } : first;
    if (!first) { tr.msg = 'O log do BUSMASTER não tem nenhuma posição com fix 3D válido (GPS sem fix nessa gravação).'; return tr; }
    const m = BT.mPerDeg(c.lat);
    for (let i = 0; i < n; i++) {
      const la = S.gps.lat[i], lo = S.gps.lon[i];
      if (la !== la) continue;
      X[i] = (lo - c.lon) * m.lon; Y[i] = (la - c.lat) * m.lat; valid[i] = 1;
      codeX[i] = BT.clamp(Math.floor(128 + X[i] / res.x), 0, 255);
      codeY[i] = BT.clamp(Math.floor(128 + Y[i] / res.y), 0, 255);
      sat[i] = codeX[i] === 0 || codeX[i] === 255 || codeY[i] === 0 || codeY[i] === 255 ? 1 : 0;
    }
    tr.center = c; tr.source = 'lat/lon do módulo GPS (0x028)';
    X = smooth(t, X, Math.min(cfg.smooth, 0.25)); Y = smooth(t, Y, Math.min(cfg.smooth, 0.25));
  } else {
    const cx = S.channels.find(c => c.key === cfg.chX), cy = S.channels.find(c => c.key === cfg.chY);
    if (!cx || !cy) { tr.msg = 'Escolha os canais X (Leste) e Y (Norte) do GPS em “Pista / GPS”.'; return tr; }
    const fmt = cfg.fmt === 'auto' ? BT.detectFmt(cx.data) : cfg.fmt;
    const cs = cfg.chStatus ? S.channels.find(c => c.key === cfg.chStatus) : null;
    tr.fmt = fmt; tr.source = `canais ${cx.name} (X) / ${cy.name} (Y) em ${BT.FMT_LABEL[fmt]}`;
    for (let i = 0; i < n; i++) {
      const vx = cx.data[i], vy = cy.data[i];
      if (vx !== vx || vy !== vy) continue;
      if (cs) { const st = cs.data[i]; if (!(fmt === 'm' ? st >= 254 : BT.toCode(st, fmt) >= 254)) continue; }
      if (fmt === 'm') { X[i] = vx; Y[i] = vy; }
      else {
        const a = BT.toCode(vx, fmt), b = BT.toCode(vy, fmt);
        codeX[i] = a; codeY[i] = b;
        X[i] = (a - 127.5) * res.x; Y[i] = (b - 127.5) * res.y;
        sat[i] = a < 0.5 || a > 254.5 || b < 0.5 || b > 254.5 ? 1 : 0;
      }
      valid[i] = 1;
    }
    if (cfg.centerFixed) tr.center = { lat: +cfg.lat0, lon: +cfg.lon0 };
    X = destairAxis(t, X, valid, res.x); Y = destairAxis(t, Y, valid, res.y);
    X = smooth(t, X, cfg.smooth); Y = smooth(t, Y, cfg.smooth);
  }

  let nv = 0;
  for (let i = 0; i < n; i++) if (X[i] === X[i]) nv++; else valid[i] = 0;
  if (nv < 2) { tr.msg = 'Os canais de GPS não têm dados válidos.'; return tr; }

  /* velocidade e rumo: diferença central de ±0,5 s */
  const speed = new Float64Array(n).fill(NaN), heading = new Float64Array(n).fill(NaN), dist = new Float64Array(n).fill(NaN);
  const H = 0.5;
  let a = 0, b = 0, hd = 0, d = 0, last = -1;
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;
    while (a < i && (t[a] < t[i] - H || !valid[a])) a++;
    if (b < i) b = i;
    while (b + 1 < n && t[b + 1] <= t[i] + H && valid[b + 1]) b++;
    const dt = t[b] - t[a];
    const dx = X[b] - X[a], dy = Y[b] - Y[a];
    speed[i] = dt > 0 ? Math.hypot(dx, dy) / dt * 3.6 : 0;
    if (speed[i] > 1.5) hd = Math.atan2(dx, dy);
    heading[i] = hd;
    if (last >= 0 && valid[last] && i - last === 1) d += Math.hypot(X[i] - X[last], Y[i] - Y[last]);
    dist[i] = d; last = i;
  }

  let lat = null, lon = null;
  if (tr.center) {
    const m = BT.mPerDeg(tr.center.lat);
    lat = new Float64Array(n).fill(NaN); lon = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) if (valid[i]) { lat[i] = tr.center.lat + Y[i] / m.lat; lon[i] = tr.center.lon + X[i] / m.lon; }
  }
  return Object.assign(tr, { ok: true, x: X, y: Y, valid, sat, speed, heading, dist, lat, lon, codeX, codeY });
};

/* Posição interpolada no tempo tc (movimento suave no play). */
BT.posAt = (S, tr, tc) => {
  const t = S.t, i = BT.idxAt(t, tc);
  if (i < 0 || !tr.valid[i]) return null;
  let x = tr.x[i], y = tr.y[i];
  const j = i + 1;
  if (j < t.length && tr.valid[j] && tc > t[i]) {
    const u = BT.clamp((tc - t[i]) / (t[j] - t[i]), 0, 1);
    x += (tr.x[j] - x) * u; y += (tr.y[j] - y) * u;
  }
  return { x, y, h: tr.heading[i], i };
};

/* ---------------------------------------------------------------- voltas */
function cross(p, q, a, b) {
  const d = (q.x - p.x) * (b.y - a.y) - (q.y - p.y) * (b.x - a.x);
  if (!d) return null;
  const s = ((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x)) / d;
  const u = ((a.x - p.x) * (q.y - p.y) - (a.y - p.y) * (q.x - p.x)) / d;
  return s >= 0 && s < 1 && u >= 0 && u <= 1 ? { s, dir: Math.sign(d) } : null;
}

BT.computeLaps = (S, tr, line, minLap) => {
  if (!tr.ok || !line) return [];
  const t = S.t, X = [];
  let dir = 0;
  for (let i = 1; i < t.length; i++) {
    if (!tr.valid[i] || !tr.valid[i - 1]) continue;
    const h = cross({ x: tr.x[i - 1], y: tr.y[i - 1] }, { x: tr.x[i], y: tr.y[i] }, line[0], line[1]);
    if (!h) continue;
    if (!dir) dir = h.dir;
    if (h.dir !== dir) continue;
    const tm = t[i - 1] + (t[i] - t[i - 1]) * h.s;
    if (X.length && tm - X[X.length - 1].tm < minLap) continue;
    X.push({ tm, i });
  }
  const laps = [];
  for (let k = 0; k + 1 < X.length; k++) {
    const i0 = X[k].i, i1 = X[k + 1].i - 1;
    let vmax = 0, vs = 0, vn = 0;
    for (let i = i0; i <= i1; i++) { const v = tr.speed[i]; if (v === v) { if (v > vmax) vmax = v; vs += v; vn++; } }
    laps.push({ n: k + 1, t0: X[k].tm, t1: X[k + 1].tm, time: X[k + 1].tm - X[k].tm, i0, i1, vmax, vavg: vn ? vs / vn : NaN, dist: tr.dist[i1] - tr.dist[i0] });
  }
  return laps;
};

/* linha de largada automática: perpendicular ao movimento no primeiro trecho andando */
BT.autoLine = (S, tr) => {
  if (!tr.ok) return null;
  const n = S.t.length;
  for (let i = 0; i < n; i++) {
    if (!tr.valid[i] || !(tr.speed[i] > 8)) continue;
    const h = tr.heading[i], nx = Math.cos(h) * 12, ny = -Math.sin(h) * 12;
    return [{ x: tr.x[i] + nx, y: tr.y[i] + ny }, { x: tr.x[i] - nx, y: tr.y[i] - ny }];
  }
  return null;
};
