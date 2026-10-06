/* Utilidades compartilhadas (parte pura de legacy/js/util.js: sem DOM, canvas nem
 * localStorage). */

export const clamp = (v: number, a: number, b: number): number => v < a ? a : v > b ? b : v;

/* 83.456 -> "1:23.46" */
export const fmtTime = (s: number): string => {
  if (!isFinite(s)) return '—';
  const neg = s < 0; s = Math.abs(s);
  const m = Math.floor(s / 60), r = s - m * 60;
  return (neg ? '-' : '') + m + ':' + r.toFixed(2).padStart(5, '0');
};

/* casas decimais adequadas à faixa do canal */
export const decimalsFor = (lo: number, hi: number): number => {
  const r = Math.max(Math.abs(lo), Math.abs(hi), Math.abs(hi - lo));
  if (!isFinite(r) || r === 0) return 0;
  if (r >= 1000) return 0;
  if (r >= 100) return 1;
  if (r >= 10) return 2;
  return 3;
};
export const fmtVal = (v: number, dec: number): string => isFinite(v) ? v.toFixed(dec) : '—';

/* último índice i com t[i] <= x (0 se x < t[0]) */
export const idxAt = (t: ArrayLike<number>, x: number): number => {
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
export const niceTicks = (lo: number, hi: number, n: number): number[] => {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / Math.max(1, n);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
};

/* Rampa "calor" para colorir a pista por magnitude (sequencial, uma família de cor).
 * Fundo claro: claro -> escuro (amarelo -> vinho). Fundo escuro ou satélite: o inverso,
 * escuro -> claro (vermelho -> amarelo claro), para "mais" sempre ser o mais visível.
 * A pista é desenhada com contorno escuro por baixo. */
export const HEAT_LIGHT: readonly (readonly [number, number, number])[] = [[247, 208, 56], [235, 104, 52], [196, 43, 43], [110, 13, 37]];
export const HEAT_DARK: readonly (readonly [number, number, number])[] = [[178, 34, 52], [226, 82, 46], [246, 168, 52], [255, 238, 150]];
export const heat = (u: number, dark?: boolean): string => {
  const H = dark ? HEAT_DARK : HEAT_LIGHT;
  u = clamp(isFinite(u) ? u : 0, 0, 1) * (H.length - 1);
  const i = Math.min(H.length - 2, Math.floor(u)), f = u - i, a = H[i], b = H[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
};
export const heatGradientCss = (dark?: boolean): string => `linear-gradient(90deg,${[0, .33, .67, 1].map(u => heat(u, dark)).join(',')})`;

/* faixa robusta (percentis) para a escala de cor não ser dominada por poucos pontos */
export const pctRange = (a: ArrayLike<number>, i0: number, i1: number, p: number): { lo: number; hi: number; n: number } => {
  const v: number[] = [];
  const step = Math.max(1, Math.floor((i1 - i0 + 1) / 4000));
  for (let i = i0; i <= i1; i += step) if (a[i] === a[i]) v.push(a[i]);
  if (!v.length) return { lo: NaN, hi: NaN, n: 0 };
  v.sort((x, y) => x - y);
  const q = (f: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(f * (v.length - 1))))];
  return { lo: q(p), hi: q(1 - p), n: v.length };
};

/* min/max ignorando NaN */
export const range = (a: ArrayLike<number>, i0 = 0, i1 = a.length - 1): { lo: number; hi: number; n: number } => {
  let lo = Infinity, hi = -Infinity, n = 0;
  for (let i = i0; i <= i1; i++) {
    const v = a[i];
    if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; n++; }
  }
  return { lo, hi, n };
};

export const esc = (s: unknown): string => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);
