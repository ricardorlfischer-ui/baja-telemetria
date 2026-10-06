/* Gráfico da dispersão em canvas: pontos coloridos (uma cor, por volta ou por Z) ou mapa de
 * calor (histograma 2D). Duas camadas: a de baixo com os dados (redesenha quando os dados, o
 * tamanho ou o tema mudam) e a de cima com o cursor do log, a célula/ponto escolhido e a cruz
 * de leitura (60×/s sem redesenhar os dados). Mesmo visual do XYPlot (margens, grade, fontes).
 * Não existe no componente compartilhado porque o XYPlot só tem uma cor por nuvem de pontos e
 * não tem grade de células. */
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import { heat, niceTicks } from '@baja/core';
import { setupCanvas } from '../../components';
import { useChartTheme, type ChartTheme } from '../../theme';
import { cellBounds, type Grid2D, type XYData } from './binning';

export interface ScatterHandle {
  /** ponto do cursor do log (unidades dos canais); null = fora do trecho / sem valor */
  setCursor(p: { x: number; y: number } | null): void;
}

export interface ScatterProps {
  data: XYData;
  xr: [number, number];
  yr: [number, number];
  xLabel: string;
  yLabel: string;
  mode: 'points' | 'heat';
  /** cor de cada ponto (índice na paleta); null = todos na cor 0 */
  colorIndex: Uint16Array | null;
  palette: string[];
  grid: Grid2D | null;
  /** 'count' = contagem por célula; 'mean' = média de Z por célula */
  heatValue: 'count' | 'mean';
  selCell: number;
  /** ponto escolhido (posição em data) */
  selPoint: number;
  height: number;
  onPick: (x: number, y: number) => void;
  /** HTML do tooltip em (x, y); null = sem tooltip */
  tip: (x: number, y: number) => string | null;
  ref?: Ref<ScatterHandle>;
}

interface Geo { P: { l: number; r: number; t: number; b: number }; pw: number; ph: number; w: number; h: number }

/** Cor da célula (rampa "calor" do app; contagem em escala log, que senão só a célula mais cheia aparece). */
export function cellColor(th: ChartTheme, g: Grid2D, k: number, value: 'count' | 'mean'): string | null {
  const c = g.count[k];
  if (!c) return null;
  if (value === 'mean' && g.sum) {
    const m = g.sum[k] / c, span = g.meanHi - g.meanLo;
    return heat(span > 0 ? (m - g.meanLo) / span : 0.5, th.dark);
  }
  return heat(g.maxCount > 1 ? Math.log(1 + c) / Math.log(1 + g.maxCount) : 1, th.dark);
}

const decOf = (ticks: number[]) => (ticks.length > 1 ? Math.max(0, -Math.floor(Math.log10(ticks[1] - ticks[0]))) : 0);

export function ScatterCanvas(props: ScatterProps) {
  const { height, ref } = props;
  const th = useChartTheme();
  const boxRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const thRef = useRef(th);
  thRef.current = th;
  const geoRef = useRef<Geo | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const hoverRef = useRef<{ px: number; py: number } | null>(null);

  const X = (G: Geo, x: number) => { const p = propsRef.current; return G.P.l + (x - p.xr[0]) / (p.xr[1] - p.xr[0]) * G.pw; };
  const Y = (G: Geo, y: number) => { const p = propsRef.current; return G.P.t + (p.yr[1] - y) / (p.yr[1] - p.yr[0]) * G.ph; };

  const drawBase = useCallback(() => {
    const c = baseRef.current;
    if (!c) return;
    const p = propsRef.current, T = thRef.current;
    const [g, w, h] = setupCanvas(c);
    if (!w) return;
    const P = { l: 68, r: 18, t: 14, b: 50 };
    const G: Geo = { P, pw: w - P.l - P.r, ph: h - P.t - P.b, w, h };
    geoRef.current = G;
    const F = (sz: number, wt = 400) => `${wt} ${sz}px ${T.font}`;
    g.fillStyle = T.surface; g.fillRect(0, 0, w, h);

    /* grade e eixos */
    const xt = niceTicks(p.xr[0], p.xr[1], Math.max(2, G.pw / 90)), yt = niceTicks(p.yr[0], p.yr[1], Math.max(2, G.ph / 50));
    g.strokeStyle = T.grid; g.lineWidth = 1; g.beginPath();
    xt.forEach(v => { const x = Math.round(X(G, v)) + .5; g.moveTo(x, P.t); g.lineTo(x, P.t + G.ph); });
    yt.forEach(v => { const y = Math.round(Y(G, v)) + .5; g.moveTo(P.l, y); g.lineTo(P.l + G.pw, y); });
    g.stroke();

    g.save();
    g.beginPath(); g.rect(P.l, P.t, G.pw, G.ph); g.clip();
    const d = p.data;
    if (p.mode === 'heat' && p.grid) {
      const gr = p.grid;
      for (let k = 0; k < gr.count.length; k++) {
        const col = cellColor(T, gr, k, p.heatValue);
        if (!col) continue;
        const b = cellBounds(gr, k);
        const xa = X(G, b.xa), xb = X(G, b.xb), ya = Y(G, b.yb), yb = Y(G, b.ya);
        g.fillStyle = col;
        g.fillRect(Math.floor(xa), Math.floor(ya), Math.ceil(xb - xa) + 0.5, Math.ceil(yb - ya) + 0.5);
      }
    } else {
      /* pontos: um preenchimento por cor (milhares de pontos sem trocar fillStyle a cada um) */
      const sz = d.n > 20000 ? 2 : d.n > 3000 ? 3 : 4, hs = sz / 2;
      g.globalAlpha = d.n > 20000 ? 0.35 : d.n > 3000 ? 0.5 : 0.75;
      const nc = Math.max(1, p.palette.length);
      for (let ci = 0; ci < nc; ci++) {
        g.fillStyle = p.palette[ci] ?? T.series[0];
        g.beginPath();
        for (let q = 0; q < d.n; q++) {
          if ((p.colorIndex ? p.colorIndex[q] : 0) !== ci) continue;
          g.rect(X(G, d.x[q]) - hs, Y(G, d.y[q]) - hs, sz, sz);
        }
        g.fill();
      }
      g.globalAlpha = 1;
    }
    g.restore();

    /* eixos, rótulos */
    g.strokeStyle = T.axis; g.beginPath(); g.moveTo(P.l, P.t + G.ph + .5); g.lineTo(P.l + G.pw, P.t + G.ph + .5); g.moveTo(P.l - .5, P.t); g.lineTo(P.l - .5, P.t + G.ph); g.stroke();
    g.font = F(12); g.fillStyle = T.text; g.textAlign = 'center';
    const xd = decOf(xt), yd = decOf(yt);
    xt.forEach(v => g.fillText(v.toFixed(xd), X(G, v), P.t + G.ph + 18));
    g.textAlign = 'right';
    yt.forEach(v => g.fillText(v.toFixed(yd), P.l - 8, Y(G, v) + 4));
    g.font = F(13, 500); g.fillStyle = T.fg2; g.textAlign = 'center';
    g.fillText(p.xLabel, P.l + G.pw / 2, h - 10);
    g.save(); g.translate(16, P.t + G.ph / 2); g.rotate(-Math.PI / 2); g.fillText(p.yLabel, 0, 0); g.restore();
    g.textAlign = 'left';
  }, []);

  const drawTop = useCallback(() => {
    const c = topRef.current, G = geoRef.current;
    if (!c || !G) return;
    const p = propsRef.current, T = thRef.current;
    const [g] = setupCanvas(c, G.w, G.h);
    g.save();
    g.beginPath(); g.rect(G.P.l, G.P.t, G.pw, G.ph); g.clip();
    /* célula escolhida */
    if (p.mode === 'heat' && p.grid && p.selCell >= 0) {
      const b = cellBounds(p.grid, p.selCell);
      g.strokeStyle = T.fg; g.lineWidth = 2.5;
      g.strokeRect(X(G, b.xa), Y(G, b.yb), X(G, b.xb) - X(G, b.xa), Y(G, b.ya) - Y(G, b.yb));
    }
    /* ponto escolhido */
    if (p.selPoint >= 0 && p.selPoint < p.data.n) {
      const x = X(G, p.data.x[p.selPoint]), y = Y(G, p.data.y[p.selPoint]);
      g.strokeStyle = T.fg; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 8, 0, 7); g.stroke();
    }
    /* cruz de leitura */
    const hv = hoverRef.current;
    if (hv) {
      g.strokeStyle = T.muted; g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath();
      g.moveTo(hv.px + .5, G.P.t); g.lineTo(hv.px + .5, G.P.t + G.ph); g.moveTo(G.P.l, hv.py + .5); g.lineTo(G.P.l + G.pw, hv.py + .5);
      g.stroke(); g.setLineDash([]);
    }
    /* cursor do log */
    const cu = cursorRef.current;
    if (cu && cu.x === cu.x && cu.y === cu.y) {
      const x = X(G, cu.x), y = Y(G, cu.y);
      g.fillStyle = T.cursor; g.strokeStyle = T.surface; g.lineWidth = 2.5;
      g.beginPath(); g.arc(x, y, 6, 0, 7); g.stroke(); g.fill();
    }
    g.restore();
  }, []);

  /* dados/tema novos → as duas camadas */
  useLayoutEffect(() => { drawBase(); drawTop(); });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    let last = 0;
    const ro = new ResizeObserver(() => { const w = el.clientWidth; if (w !== last) { last = w; drawBase(); drawTop(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawBase, drawTop]);

  useImperativeHandle(ref, () => ({ setCursor: q => { cursorRef.current = q; drawTop(); } }), [drawTop]);

  const toData = (e: React.PointerEvent | React.MouseEvent) => {
    const G = geoRef.current, p = propsRef.current;
    if (!G) return null;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    if (px < G.P.l || px > G.P.l + G.pw || py < G.P.t || py > G.P.t + G.ph) return null;
    return {
      px, py, w: r.width,
      x: p.xr[0] + (px - G.P.l) / G.pw * (p.xr[1] - p.xr[0]),
      y: p.yr[1] - (py - G.P.t) / G.ph * (p.yr[1] - p.yr[0]),
    };
  };
  const hide = () => { hoverRef.current = null; if (tipRef.current) tipRef.current.hidden = true; drawTop(); };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const q = toData(e), tip = tipRef.current;
    if (!q || !tip) { hide(); return; }
    hoverRef.current = { px: q.px, py: q.py };
    const html = propsRef.current.tip(q.x, q.y);
    if (html) {
      tip.innerHTML = html;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = (q.px + 16 + tw > q.w ? Math.max(0, q.px - tw - 16) : q.px + 16) + 'px';
      tip.style.top = Math.max(4, q.py - 20) + 'px';
    } else tip.hidden = true;
    drawTop();
  };
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const q = toData(e);
    if (q) propsRef.current.onPick(q.x, q.y);
  };

  return (
    <div ref={boxRef} className="bt-scatter" style={{ height }}>
      <canvas ref={baseRef} aria-hidden />
      <canvas ref={topRef} style={{ cursor: 'crosshair' }} onPointerMove={onMove} onPointerLeave={hide} onClick={onClick}
        role="img" aria-label={`${props.yLabel} em função de ${props.xLabel}`} />
      <div ref={tipRef} className="bt-plot-tip" hidden />
    </div>
  );
}
