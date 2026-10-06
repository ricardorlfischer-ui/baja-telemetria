/* Gráfico XY genérico em canvas para as análises (porte de legacy/js/plots.js, BT.Plot):
 * linhas, barras e dispersão, com eixos, grade discreta, marcadores verticais, linhas de
 * referência, legenda e cruz de leitura no hover.
 *
 *   <XYPlot spec={{ series: [{ x, y, label, id: 'FL' }], bars: { x0, w, y, colors },
 *           points: { x, y, color }, xLabel, yLabel, logY, equal, xRange, yRange,
 *           zeroY, circles: [r...], markers: [{ x, color, label }], hi: { x, y },
 *           onClick: x => ..., tipX: x => 'html', empty: 'mensagem' }} height={280} ref={h} />
 *
 * Mesmo formato de spec do app antigo. Diferenças só visuais: fonte 12–13 px, margens maiores,
 * tooltip estilizado, legenda em HTML acima, e cor opcional: série sem `color` pega a cor do
 * tema pelo `id`/`role` (FL/FR/RL/RR, ref, cmp, pos, neg, muted...) ou pela ordem dos slots.
 * As contas de faixa, ticks e casas decimais dos eixos são as do antigo.
 *
 * Para mudar só o ponto atual ou os marcadores (cursor do log, 60×/s) sem re-render do React:
 * ref.current.setHi({ x, y }) / ref.current.update({ markers }). */
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, type Ref } from 'react';
import { esc, niceTicks } from '@baja/core';
import { resolveColor, slotColor, useChartTheme, type ChartTheme } from '../theme';
import { setupCanvas } from './canvas';

type Num = ArrayLike<number>;

export interface XYSeries {
  x: Num;
  y: Num;
  /** cor CSS ou nome de papel (FL, ref, pos, c3...); sem cor: id/role, depois o slot pela ordem */
  color?: string;
  id?: string;
  role?: string;
  /** slot 1..8 da paleta (sobrepõe a ordem) */
  slot?: number;
  label?: string;
  width?: number;
  alpha?: number;
  dots?: { x: number; y: number }[];
}
export interface XYBars { x0: number; w: number; y: Num; colors?: (string | undefined)[]; color?: string }
export interface XYPoints { x: Num; y: Num; color?: string; alpha?: number }
export interface XYMarker { x: number; color?: string; label?: string; width?: number; row?: number }
export interface XYHLine { y: number; color?: string; label?: string }
export interface XYLegendItem { label: string; color?: string; id?: string; role?: string }

export interface XYSpec {
  series?: XYSeries[];
  bars?: XYBars;
  points?: XYPoints;
  markers?: XYMarker[];
  hlines?: XYHLine[];
  /** círculos em torno da origem (diagrama g-g), rótulo "r g" */
  circles?: number[];
  xLabel?: string;
  yLabel?: string;
  logY?: boolean;
  /** mesma escala nos dois eixos */
  equal?: boolean;
  xRange?: [number, number];
  yRange?: [number, number];
  zeroY?: boolean;
  /** ponto atual (cursor do log) */
  hi?: { x: number; y: number } | null;
  onClick?: (x: number) => void;
  /** HTML da primeira linha do tooltip (escape com esc() o que vier do usuário) */
  tipX?: (x: number) => string;
  /** HTML do tooltip quando o mouse está sobre a barra k */
  tipBar?: (k: number) => string;
  fmtY?: (v: number) => string;
  /** mensagem no lugar do gráfico */
  empty?: string;
  /** legenda explícita (senão: séries com rótulo, se houver mais de uma) */
  legend?: XYLegendItem[];
}

export interface XYPlotHandle {
  /** posição do ponto atual sem recalcular o resto */
  setHi(hi: { x: number; y: number } | null): void;
  /** altera campos do spec e redesenha sem passar pelo React (ex.: markers) */
  update(patch: Partial<XYSpec>): void;
  redraw(): void;
}

export interface XYPlotProps {
  spec: XYSpec;
  /** altura da área do gráfico em px (padrão 280) */
  height?: number;
  ref?: Ref<XYPlotHandle>;
  className?: string;
  'aria-label'?: string;
}

interface Geo {
  X: (x: number) => number;
  Y: (y: number) => number;
  P: { l: number; r: number; t: number; b: number };
  pw: number; ph: number; x0: number; x1: number;
  ix: (px: number) => number;
}

/* BT.interpAt (analysis.js): cópia local para o tooltip, o core é dono da original */
function interpAt(xs: Num, ys: Num, x: number): number {
  const n = xs.length;
  if (!n) return NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  const dx = xs[hi] - xs[lo];
  return dx > 0 ? ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / dx : ys[hi];
}
function valAt(q: XYSeries, x: number): number {
  const xs = q.x, n = xs.length;
  if (!n || x < xs[0] || x > xs[n - 1]) return NaN;
  return interpAt(xs, q.y, x);
}
function fmtLog(v: number): string {
  if (v >= 0.01 && v < 1e4) return String(+v.toPrecision(1));
  return v.toExponential(0).replace('e', 'e');
}
function roundTop(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x, y + h); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h);
  g.closePath(); g.fill();
}

/** Cor final da série i (cor explícita > id/role > slot > ordem). */
export function seriesColor(th: ChartTheme, q: { color?: string; id?: string; role?: string; slot?: number }, i: number): string {
  return resolveColor(th, q.color) ?? resolveColor(th, q.id) ?? resolveColor(th, q.role) ?? slotColor(th, q.slot ?? i + 1);
}

export function XYPlot({ spec, height = 280, ref, className, ...rest }: XYPlotProps) {
  const th = useChartTheme();
  const boxRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const specRef = useRef<XYSpec>(spec);
  const thRef = useRef(th);
  const geoRef = useRef<Geo | null>(null);
  const hxRef = useRef<number | null>(null);
  const colorsRef = useRef<string[]>([]);

  const draw = useCallback(() => {
    const c = cvRef.current;
    if (!c) return;
    const s = specRef.current, T = thRef.current;
    const [g, w, h] = setupCanvas(c);
    if (!w) return;
    const ink = T.fg, mut = T.text, grid = T.grid, axis = T.axis;
    const F = (sz: number, wt = 400) => `${wt} ${sz}px ${T.font}`;
    const tickFont = F(12);
    g.font = tickFont;
    const cols = (s.series || []).map((q, i) => seriesColor(T, q, i));
    colorsRef.current = cols;
    if (s.empty) { g.fillStyle = mut; g.font = F(13); g.fillText(s.empty, 16, 28); geoRef.current = null; return; }

    /* faixas */
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const acc = (xs: Num, ys: Num) => {
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i], y = ys[i];
        if (x !== x || y !== y || (s.logY && !(y > 0))) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    };
    (s.series || []).forEach(q => acc(q.x, q.y));
    if (s.points) acc(s.points.x, s.points.y);
    if (s.bars) { const b = s.bars; x0 = Math.min(x0, b.x0); x1 = Math.max(x1, b.x0 + b.w * b.y.length); for (let k = 0; k < b.y.length; k++) { const v = b.y[k]; if (v > y1) y1 = v; } y0 = Math.min(y0, 0); }
    (s.hlines || []).forEach(l => { if (l.y > y1) y1 = l.y; if (l.y < y0) y0 = l.y; });
    if (s.xRange) [x0, x1] = s.xRange;
    if (s.yRange) [y0, y1] = s.yRange;
    if (!isFinite(x0) || !isFinite(y0)) { g.fillStyle = mut; g.font = F(13); g.fillText('sem dados', 16, 28); geoRef.current = null; return; }
    if (x1 <= x0) x1 = x0 + 1;
    if (y1 <= y0) { y1 = y0 + (Math.abs(y0) || 1); }
    if (s.zeroY) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
    if (!s.yRange && !s.logY && !s.bars) { const p = (y1 - y0) * 0.06; y0 -= p; y1 += p; }
    if (s.bars && !s.yRange) y1 *= 1.08;
    if (s.logY) { y0 = Math.pow(10, Math.floor(Math.log10(y0))); y1 = Math.pow(10, Math.ceil(Math.log10(y1))); }

    const P = { l: s.yLabel ? 64 : 50, r: 16, t: 12, b: s.xLabel ? 46 : 28 };
    const pw = w - P.l - P.r, ph = h - P.t - P.b;
    if (s.equal) {                        /* mesma escala nos dois eixos (diagrama g-g) */
      const u = Math.min(pw / (x1 - x0), ph / (y1 - y0)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      x0 = cx - pw / u / 2; x1 = cx + pw / u / 2; y0 = cy - ph / u / 2; y1 = cy + ph / u / 2;
    }
    const ty = (v: number) => (s.logY ? Math.log10(v) : v), Y0 = ty(y0), Y1 = ty(y1);
    const X = (x: number) => P.l + (x - x0) / (x1 - x0) * pw;
    const Y = (y: number) => P.t + (Y1 - ty(y)) / (Y1 - Y0) * ph;
    geoRef.current = { X, Y, P, pw, ph, x0, x1, ix: px => x0 + (px - P.l) / pw * (x1 - x0) };

    /* grade e eixos */
    const xt = niceTicks(x0, x1, Math.max(2, pw / 90));
    let yt: number[];
    if (s.logY) { yt = []; for (let e = Math.round(Math.log10(y0)); e <= Math.round(Math.log10(y1)); e++) yt.push(Math.pow(10, e)); }
    else yt = niceTicks(y0, y1, Math.max(2, ph / 46));
    g.strokeStyle = grid; g.lineWidth = 1; g.beginPath();
    xt.forEach(v => { const x = Math.round(X(v)) + .5; g.moveTo(x, P.t); g.lineTo(x, P.t + ph); });
    yt.forEach(v => { const y = Math.round(Y(v)) + .5; g.moveTo(P.l, y); g.lineTo(P.l + pw, y); });
    g.stroke();
    if (s.circles) {
      g.strokeStyle = axis;
      s.circles.forEach(r => { g.beginPath(); g.ellipse(X(0), Y(0), Math.abs(X(r) - X(0)), Math.abs(Y(r) - Y(0)), 0, 0, 7); g.stroke(); });
      g.fillStyle = mut; s.circles.forEach(r => g.fillText(r + ' g', X(0) + 4, Y(r) - 4));
    }
    g.strokeStyle = axis; g.beginPath();
    const yb = s.zeroY || s.circles ? Math.round(Y(0)) + .5 : P.t + ph + .5;
    g.moveTo(P.l, yb); g.lineTo(P.l + pw, yb);
    if (s.circles) { const xz = Math.round(X(0)) + .5; g.moveTo(xz, P.t); g.lineTo(xz, P.t + ph); }
    g.stroke();
    g.fillStyle = mut; g.textAlign = 'center';
    const xd = xt.length > 1 ? Math.max(0, -Math.floor(Math.log10(xt[1] - xt[0]))) : 0;
    xt.forEach(v => g.fillText(v.toFixed(xd), X(v), P.t + ph + 17));
    g.textAlign = 'right';
    const yd = s.logY ? 0 : yt.length > 1 ? Math.max(0, -Math.floor(Math.log10(yt[1] - yt[0]))) : 0;
    yt.forEach(v => g.fillText(s.logY ? fmtLog(v) : v.toFixed(yd), P.l - 8, Y(v) + 4));
    g.textAlign = 'left';
    g.font = F(12.5, 500); g.fillStyle = T.fg2;
    if (s.xLabel) { g.textAlign = 'center'; g.fillText(s.xLabel, P.l + pw / 2, h - 8); g.textAlign = 'left'; }
    if (s.yLabel) { g.save(); g.translate(15, P.t + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(s.yLabel, 0, 0); g.restore(); }
    g.font = tickFont;

    g.save();
    g.beginPath(); g.rect(P.l, P.t - 1, pw, ph + 2); g.clip();
    /* barras com 2 px de folga entre elas */
    if (s.bars) {
      const b = s.bars;
      const base = resolveColor(T, b.color) ?? T.series[0];
      for (let k = 0; k < b.y.length; k++) {
        if (!(b.y[k] > 0)) continue;
        const xa = X(b.x0 + k * b.w) + 1, xb = X(b.x0 + (k + 1) * b.w) - 1, ya = Y(b.y[k]), yz = Y(0);
        g.fillStyle = (b.colors && resolveColor(T, b.colors[k])) || base;
        roundTop(g, xa, ya, Math.max(1, xb - xa), yz - ya, Math.min(3, (xb - xa) / 2));
      }
    }
    /* dispersão */
    if (s.points) {
      const p = s.points;
      g.fillStyle = resolveColor(T, p.color) ?? T.series[0]; g.globalAlpha = p.alpha ?? 0.35;
      for (let i = 0; i < p.x.length; i++) { const x = p.x[i], y = p.y[i]; if (x === x && y === y) g.fillRect(X(x) - 1.5, Y(y) - 1.5, 3, 3); }
      g.globalAlpha = 1;
    }
    /* linhas */
    (s.series || []).forEach((q, qi) => {
      g.strokeStyle = cols[qi]; g.lineWidth = q.width || 1.75; g.globalAlpha = q.alpha ?? 1; g.lineJoin = 'round';
      g.beginPath();
      let pen = false;
      for (let i = 0; i < q.x.length; i++) {
        const x = q.x[i], y = q.y[i];
        if (x !== x || y !== y || (s.logY && !(y > 0))) { pen = false; continue; }
        if (pen) g.lineTo(X(x), Y(y)); else { g.moveTo(X(x), Y(y)); pen = true; }
      }
      g.stroke(); g.globalAlpha = 1;
      if (q.dots) { g.fillStyle = cols[qi]; q.dots.forEach(d => { g.beginPath(); g.arc(X(d.x), Y(d.y), 4, 0, 7); g.fill(); }); }
    });
    /* marcadores verticais */
    (s.markers || []).forEach(m => {
      const x = Math.round(X(m.x)) + .5, mc = resolveColor(T, m.color) ?? ink;
      g.strokeStyle = mc; g.lineWidth = m.width || 1.25;
      g.beginPath(); g.moveTo(x, P.t); g.lineTo(x, P.t + ph); g.stroke();
      if (m.label) { g.fillStyle = mc; g.font = F(11.5, 600); g.fillText(m.label, x + 4, P.t + 12 + (m.row || 0) * 14); g.font = tickFont; }
    });
    /* linhas horizontais de referência (limites) */
    (s.hlines || []).forEach(l => {
      const y = Math.round(Y(l.y)) + .5, lc = resolveColor(T, l.color) ?? ink;
      g.strokeStyle = lc; g.lineWidth = 1.25;
      g.beginPath(); g.moveTo(P.l, y); g.lineTo(P.l + pw, y); g.stroke();
      if (l.label) { g.fillStyle = lc; g.font = F(11.5, 600); g.textAlign = 'right'; g.fillText(l.label, P.l + pw - 4, y - 5); g.textAlign = 'left'; g.font = tickFont; }
    });
    /* ponto atual */
    if (s.hi && s.hi.x === s.hi.x && s.hi.y === s.hi.y) {
      g.fillStyle = ink; g.strokeStyle = T.surface; g.lineWidth = 2;
      g.beginPath(); g.arc(X(s.hi.x), Y(s.hi.y), 5.5, 0, 7); g.stroke(); g.fill();
    }
    /* cruz de leitura */
    const hx = hxRef.current;
    if (hx !== null && !s.equal) {
      const x = Math.round(X(hx)) + .5;
      g.strokeStyle = T.muted; g.lineWidth = 1; g.beginPath(); g.moveTo(x, P.t); g.lineTo(x, P.t + ph); g.stroke();
      (s.series || []).forEach((q, qi) => {
        const v = valAt(q, hx);
        if (v === v && (!s.logY || v > 0)) { g.fillStyle = cols[qi]; g.strokeStyle = T.surface; g.lineWidth = 2; g.beginPath(); g.arc(X(hx), Y(v), 4, 0, 7); g.stroke(); g.fill(); }
      });
    }
    g.restore();
  }, []);

  /* spec/tema novos: redesenha */
  useLayoutEffect(() => { specRef.current = spec; draw(); }, [spec, draw]);
  useLayoutEffect(() => { thRef.current = th; draw(); }, [th, draw]);

  /* tamanho: ResizeObserver no contêiner */
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    let last = 0;
    const ro = new ResizeObserver(() => { const w = el.clientWidth; if (w !== last) { last = w; draw(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  useImperativeHandle(ref, () => ({
    setHi: hi => { specRef.current = { ...specRef.current, hi }; draw(); },
    update: patch => { specRef.current = { ...specRef.current, ...patch }; draw(); },
    redraw: draw,
  }), [draw]);

  /* hover e clique */
  const hideTip = () => { hxRef.current = null; if (tipRef.current) tipRef.current.hidden = true; draw(); };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const G = geoRef.current, s = specRef.current, tip = tipRef.current;
    if (!G || s.equal || !tip) return;
    const r = e.currentTarget.getBoundingClientRect(), px = e.clientX - r.left;
    if (px < G.P.l || px > G.P.l + G.pw) { hideTip(); return; }
    const hx = G.ix(px);
    hxRef.current = hx;
    let html = s.tipX ? s.tipX(hx) : `<b>${hx.toFixed(2)}</b>`;
    if (s.bars && s.tipBar) { const k = Math.floor((hx - s.bars.x0) / s.bars.w); if (k >= 0 && k < s.bars.y.length) html = s.tipBar(k); }
    const cols = colorsRef.current;
    (s.series || []).forEach((q, qi) => {
      if (!q.label) return;
      const v = valAt(q, hx);
      html += `<div class="bt-tip-row"><i style="background:${cols[qi]}"></i><span>${esc(q.label)}</span><b>${v === v ? (s.fmtY ? s.fmtY(v) : v.toFixed(2)) : '—'}</b></div>`;
    });
    tip.innerHTML = html;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = (px + 16 + tw > r.width ? Math.max(0, px - tw - 16) : px + 16) + 'px';
    tip.style.top = '8px';
    draw();
  };
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const G = geoRef.current, s = specRef.current;
    if (!G || !s.onClick) return;
    const r = e.currentTarget.getBoundingClientRect();
    s.onClick(G.ix(e.clientX - r.left));
  };

  /* legenda em HTML acima do gráfico */
  const legend = useMemo(() => {
    if (spec.legend) return spec.legend.map((l, i) => ({ label: l.label, color: seriesColor(th, l, i) }));
    const S = spec.series || [];
    if (S.length < 2) return [];
    return S.map((q, i) => ({ label: q.label, color: seriesColor(th, q, i) })).filter(l => l.label) as { label: string; color: string }[];
  }, [spec, th]);

  return (
    <div className={className ? `bt-plot ${className}` : 'bt-plot'} {...rest}>
      {legend.length > 0 && (
        <div className="bt-plot-legend">
          {legend.map((l, i) => <span key={i}><i style={{ background: l.color }} />{l.label}</span>)}
        </div>
      )}
      <div ref={boxRef} className="bt-plot-box" style={{ height }}>
        <canvas
          ref={cvRef} className="bt-plot-canvas"
          style={{ cursor: spec.onClick ? 'pointer' : 'crosshair' }}
          onPointerMove={onMove} onPointerLeave={hideTip} onClick={onClick}
        />
        <div ref={tipRef} className="bt-plot-tip" hidden />
      </div>
    </div>
  );
}
