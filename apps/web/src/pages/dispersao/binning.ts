/* Agrupamento da dispersão (visualização, não física): pares (x, y[, z]) válidos do trecho,
 * faixa dos eixos, histograma 2D (contagem e soma de z por célula), estatísticas de uma célula
 * e o ponto mais perto de um clique. Nada aqui muda número de projeto: as contas do carro
 * ficam no core. */

/** Amostras do trecho com X e Y (e Z, se pedido) válidos. idx = índice da amostra no log. */
export interface XYData {
  idx: Uint32Array;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array | null;
  n: number;
  /** amostras no trecho (antes de filtrar os inválidos) */
  total: number;
}

const ok = (v: number) => v === v && v !== Infinity && v !== -Infinity;

export function collect(X: ArrayLike<number>, Y: ArrayLike<number>, Z: ArrayLike<number> | null, i0: number, i1: number): XYData {
  const total = Math.max(0, i1 - i0 + 1);
  const idx = new Uint32Array(total), x = new Float64Array(total), y = new Float64Array(total), z = Z ? new Float64Array(total) : null;
  let n = 0;
  for (let i = i0; i <= i1; i++) {
    const a = X[i], b = Y[i];
    if (!ok(a) || !ok(b)) continue;
    if (Z) { const c = Z[i]; if (!ok(c)) continue; z![n] = c; }
    idx[n] = i; x[n] = a; y[n] = b; n++;
  }
  return { idx: idx.subarray(0, n), x: x.subarray(0, n), y: y.subarray(0, n), z: z ? z.subarray(0, n) : null, n, total };
}

/** Faixa [lo, hi] dos valores; constante ou vazio ganha uma folga para o eixo existir. */
export function extent(a: ArrayLike<number>): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(lo <= hi)) return [0, 1];
  if (hi === lo) { const d = Math.abs(lo) * 0.05 || 1; return [lo - d, hi + d]; }
  return [lo, hi];
}

/** Grade do histograma 2D: célula k = j·nx + i (i no X, j no Y, j = 0 embaixo). */
export interface Grid2D {
  nx: number; ny: number;
  x0: number; x1: number; y0: number; y1: number;
  count: Uint32Array;
  /** soma de z por célula (null sem z) */
  sum: Float64Array | null;
  /** célula de cada amostra de XYData */
  cellOf: Int32Array;
  maxCount: number;
  /** faixa das médias de z nas células com amostras */
  meanLo: number; meanHi: number;
}

export function bin2d(d: XYData, nx: number, ny: number, xr: [number, number], yr: [number, number]): Grid2D {
  const [x0, x1] = xr, [y0, y1] = yr;
  const count = new Uint32Array(nx * ny), sum = d.z ? new Float64Array(nx * ny) : null, cellOf = new Int32Array(d.n);
  const sx = nx / (x1 - x0), sy = ny / (y1 - y0);
  let maxCount = 0;
  for (let p = 0; p < d.n; p++) {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((d.x[p] - x0) * sx)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor((d.y[p] - y0) * sy)));
    const k = j * nx + i;
    cellOf[p] = k;
    const c = ++count[k];
    if (c > maxCount) maxCount = c;
    if (sum) sum[k] += d.z![p];
  }
  let meanLo = Infinity, meanHi = -Infinity;
  if (sum) for (let k = 0; k < count.length; k++) if (count[k]) { const m = sum[k] / count[k]; if (m < meanLo) meanLo = m; if (m > meanHi) meanHi = m; }
  return { nx, ny, x0, x1, y0, y1, count, sum, cellOf, maxCount, meanLo, meanHi };
}

/** Célula do ponto (x, y) em unidades dos canais; -1 fora da grade. */
export function cellAt(g: Grid2D, x: number, y: number): number {
  if (x < g.x0 || x > g.x1 || y < g.y0 || y > g.y1) return -1;
  const i = Math.min(g.nx - 1, Math.floor((x - g.x0) / (g.x1 - g.x0) * g.nx));
  const j = Math.min(g.ny - 1, Math.floor((y - g.y0) / (g.y1 - g.y0) * g.ny));
  return j * g.nx + i;
}

/** Limites da célula k em unidades dos canais. */
export function cellBounds(g: Grid2D, k: number): { xa: number; xb: number; ya: number; yb: number } {
  const i = k % g.nx, j = Math.floor(k / g.nx), wx = (g.x1 - g.x0) / g.nx, wy = (g.y1 - g.y0) / g.ny;
  return { xa: g.x0 + i * wx, xb: g.x0 + (i + 1) * wx, ya: g.y0 + j * wy, yb: g.y0 + (j + 1) * wy };
}

export interface Stat { mean: number; min: number; max: number; std: number }
export interface CellStats { n: number; x: Stat; y: Stat; z: Stat | null; members: number[] }

function stat(vals: number[]): Stat {
  const n = vals.length;
  if (!n) return { mean: NaN, min: NaN, max: NaN, std: NaN };
  let s = 0, lo = Infinity, hi = -Infinity;
  for (const v of vals) { s += v; if (v < lo) lo = v; if (v > hi) hi = v; }
  const m = s / n;
  let q = 0;
  for (const v of vals) q += (v - m) * (v - m);
  return { mean: m, min: lo, max: hi, std: n > 1 ? Math.sqrt(q / (n - 1)) : 0 };
}

/** Estatísticas das amostras da célula k (n, média, mín, máx, desvio padrão amostral). */
export function cellStats(d: XYData, g: Grid2D, k: number): CellStats {
  const members: number[] = [];
  for (let p = 0; p < d.n; p++) if (g.cellOf[p] === k) members.push(p);
  const pick = (a: Float64Array) => members.map(p => a[p]);
  return { n: members.length, x: stat(pick(d.x)), y: stat(pick(d.y)), z: d.z ? stat(pick(d.z)) : null, members };
}

/** Amostra (posição em XYData) mais perto de (x, y), com a distância medida em frações da
 *  faixa de cada eixo (os dois eixos pesam igual). Só entre `among`, se passado. */
export function nearest(d: XYData, x: number, y: number, xr: [number, number], yr: [number, number], among?: number[]): number {
  const wx = xr[1] - xr[0] || 1, wy = yr[1] - yr[0] || 1;
  let best = -1, bd = Infinity;
  const test = (p: number) => {
    const dx = (d.x[p] - x) / wx, dy = (d.y[p] - y) / wy, dd = dx * dx + dy * dy;
    if (dd < bd) { bd = dd; best = p; }
  };
  if (among) among.forEach(test); else for (let p = 0; p < d.n; p++) test(p);
  return best;
}

/** Coeficiente de correlação de Pearson entre x e y (NaN com menos de 3 pontos ou sem variação). */
export function pearson(d: XYData): number {
  const n = d.n;
  if (n < 3) return NaN;
  let mx = 0, my = 0;
  for (let p = 0; p < n; p++) { mx += d.x[p]; my += d.y[p]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let p = 0; p < n; p++) { const a = d.x[p] - mx, b = d.y[p] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}
