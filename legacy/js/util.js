/* Utilidades compartilhadas. Scripts clássicos (sem módulos) para abrir o index.html
 * direto do disco (file://) sem servidor. Tudo fica no objeto global BT. */
'use strict';
const BT = window.BT = {};

BT.$ = id => document.getElementById(id);
BT.clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* 83.456 -> "1:23.46" */
BT.fmtTime = s => {
  if (!isFinite(s)) return '—';
  const neg = s < 0; s = Math.abs(s);
  const m = Math.floor(s / 60), r = s - m * 60;
  return (neg ? '-' : '') + m + ':' + r.toFixed(2).padStart(5, '0');
};

/* casas decimais adequadas à faixa do canal */
BT.decimalsFor = (lo, hi) => {
  const r = Math.max(Math.abs(lo), Math.abs(hi), Math.abs(hi - lo));
  if (!isFinite(r) || r === 0) return 0;
  if (r >= 1000) return 0;
  if (r >= 100) return 1;
  if (r >= 10) return 2;
  return 3;
};
BT.fmtVal = (v, dec) => isFinite(v) ? v.toFixed(dec) : '—';

/* último índice i com t[i] <= x (0 se x < t[0]) */
BT.idxAt = (t, x) => {
  let lo = 0, hi = t.length - 1;
  if (hi < 0) return -1;
  if (x <= t[0]) return 0;
  if (x >= t[hi]) return hi;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (t[m] <= x) lo = m; else hi = m;
  }
  return lo;
};

/* ticks "redondos" entre lo e hi */
BT.niceTicks = (lo, hi, n) => {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / Math.max(1, n);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
};

BT.css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* Canvas nítido em telas HiDPI. Retorna [ctx, largura, altura] em px CSS. */
BT.setupCanvas = (c, w, h) => {
  const d = window.devicePixelRatio || 1;
  w = w ?? c.clientWidth; h = h ?? c.clientHeight;
  if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) {
    c.width = Math.round(w * d); c.height = Math.round(h * d);
  }
  const g = c.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, w, h);
  return [g, w, h];
};

/* Rampa "calor" para colorir a pista por magnitude (sequencial, uma família de cor).
 * Fundo claro: claro -> escuro (amarelo -> vinho). Fundo escuro ou satélite: o inverso,
 * escuro -> claro (vermelho -> amarelo claro), para "mais" sempre ser o mais visível.
 * A pista é desenhada com contorno escuro por baixo. */
const HEAT_LIGHT = [[247, 208, 56], [235, 104, 52], [196, 43, 43], [110, 13, 37]];
const HEAT_DARK = [[178, 34, 52], [226, 82, 46], [246, 168, 52], [255, 238, 150]];
BT.isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
BT.heat = (u, dark) => {
  const H = dark ? HEAT_DARK : HEAT_LIGHT;
  u = BT.clamp(isFinite(u) ? u : 0, 0, 1) * (H.length - 1);
  const i = Math.min(H.length - 2, Math.floor(u)), f = u - i, a = H[i], b = H[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
};
BT.heatGradientCss = dark => `linear-gradient(90deg,${[0, .33, .67, 1].map(u => BT.heat(u, dark)).join(',')})`;

/* faixa robusta (percentis) para a escala de cor não ser dominada por poucos pontos */
BT.pctRange = (a, i0, i1, p) => {
  const v = [];
  const step = Math.max(1, Math.floor((i1 - i0 + 1) / 4000));
  for (let i = i0; i <= i1; i += step) if (a[i] === a[i]) v.push(a[i]);
  if (!v.length) return { lo: NaN, hi: NaN, n: 0 };
  v.sort((x, y) => x - y);
  const q = f => v[Math.min(v.length - 1, Math.max(0, Math.round(f * (v.length - 1))))];
  return { lo: q(p), hi: q(1 - p), n: v.length };
};

/* localStorage pode não existir (aba privada, file:// em alguns navegadores) */
BT.store = {
  get(k, def) {
    try { const v = localStorage.getItem('bajatel.' + k); return v === null ? def : JSON.parse(v); }
    catch (e) { return def; }
  },
  set(k, v) { try { localStorage.setItem('bajatel.' + k, JSON.stringify(v)); } catch (e) { /* sem storage */ } }
};

/* min/max ignorando NaN */
BT.range = (a, i0 = 0, i1 = a.length - 1) => {
  let lo = Infinity, hi = -Infinity, n = 0;
  for (let i = i0; i <= i1; i++) {
    const v = a[i];
    if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; n++; }
  }
  return { lo, hi, n };
};

BT.esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

BT.download = (name, text) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
