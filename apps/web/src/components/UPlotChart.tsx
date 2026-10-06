/* Gráfico de tempo/distância com uPlot (página Canais e afins).
 *
 *   <UPlotChart data={[t, v1, v2]} series={[{ label: 'Amort. FL', id: 'FL' }, { label: 'FR' }]}
 *               syncKey="canais" yLabel="mm" onCursor={x => ...} onZoom={r => ...} ref={h} />
 *   h.current.setCursorTime(t)   // cursor do play: move só uma linha, sem redesenhar o gráfico
 *
 * - Tema claro/escuro: cores dos eixos/grade de useChartTheme(); série sem `stroke` pega a cor
 *   pelo id/role (FL, ref...) ou pela ordem dos slots da paleta.
 * - syncKey: cursor (hover) sincronizado entre os gráficos com a mesma chave (uPlot.sync).
 * - Arrastar = zoom no eixo X (onZoom); duplo clique = volta ao todo (onZoom(null)). */
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useChartTheme, type ChartTheme } from '../theme';
import { seriesColor } from './XYPlot';

export interface UPlotSeries extends Omit<uPlot.Series, 'stroke'> {
  /** cor CSS ou papel (FL, ref, c3...) */
  stroke?: string;
  id?: string;
  role?: string;
  slot?: number;
}

export interface UPlotHandle {
  /** cursor do tempo (play): linha vertical; NaN/null esconde */
  setCursorTime(t: number | null): void;
  /** zoom no eixo X (sem chamar onZoom) */
  setXRange(x0: number, x1: number): void;
  /** volta ao todo */
  resetX(): void;
  getPlot(): uPlot | null;
}

export interface UPlotChartProps {
  /** [x, y1, y2, ...] (x crescente) */
  data: uPlot.AlignedData;
  /** séries Y (sem a série X) */
  series: UPlotSeries[];
  height?: number;
  syncKey?: string;
  xLabel?: string;
  yLabel?: string;
  /** faixa Y fixa */
  yRange?: [number, number];
  /** faixa X inicial (zoom) */
  xRange?: [number, number];
  /** legenda com valores no cursor (padrão: com ≥ 2 séries) */
  legend?: boolean;
  /** formatação dos valores do eixo X (padrão: número) */
  fmtX?: (v: number) => string;
  /** hover: x sob o mouse e índice (null ao sair) */
  onCursor?: (x: number | null, idx: number | null) => void;
  /** zoom pelo usuário: [x0, x1] ou null (todo) */
  onZoom?: (range: [number, number] | null) => void;
  /** clique sem arrastar: x */
  onClick?: (x: number) => void;
  /** opções extras do uPlot (mescladas por cima) */
  options?: Partial<uPlot.Options>;
  ref?: Ref<UPlotHandle>;
}

function buildOpts(p: UPlotChartProps, th: ChartTheme, width: number, cb: { zoomFromUser: { v: boolean }; onScale: () => void }): uPlot.Options {
  const axis = (label?: string, fmt?: (v: number) => string): uPlot.Axis => ({
    stroke: th.text,
    grid: { stroke: th.grid, width: 1 },
    ticks: { stroke: th.axis, width: 1, size: 5 },
    font: `12px ${th.font}`,
    labelFont: `500 12.5px ${th.font}`,
    label,
    labelSize: label ? 22 : 0,
    values: fmt ? (_u, vals) => vals.map(v => (v == null ? '' : fmt(v))) : undefined,
  });
  const showLegend = p.legend ?? p.series.length > 1;
  return {
    width,
    height: p.height ?? 240,
    pxAlign: 0,
    legend: { show: showLegend, live: true },
    cursor: {
      sync: p.syncKey ? { key: p.syncKey, setSeries: false } : undefined,
      drag: { x: true, y: false, setScale: true },
      y: false,
      points: { size: 7, width: 2 },
    },
    scales: {
      x: { time: false, ...(p.xRange ? { min: p.xRange[0], max: p.xRange[1] } : {}) },
      y: p.yRange ? { range: () => [p.yRange![0], p.yRange![1]] } : {},
    },
    axes: [axis(p.xLabel, p.fmtX), { ...axis(p.yLabel), size: 56 }],
    series: [
      { label: p.xLabel ?? 'x', value: (_u, v) => (v == null ? '—' : p.fmtX ? p.fmtX(v) : v.toFixed(2)) },
      ...p.series.map((s, i) => {
        const { id: _id, role: _role, slot: _slot, ...rest } = s;
        return { width: 1.5, ...rest, stroke: seriesColor(th, s, i), points: { show: false } } as uPlot.Series;
      }),
    ],
    hooks: {
      setCursor: [u => { const i = u.cursor.idx; p.onCursor?.(i == null ? null : u.posToVal(u.cursor.left ?? -1, 'x'), i ?? null); }],
      setSize: [() => cb.onScale()],
      setScale: [(u, key) => {
        if (key !== 'x') return;
        cb.onScale();
        if (!cb.zoomFromUser.v) return;
        cb.zoomFromUser.v = false;
        const d = u.data[0], x0 = u.scales.x.min!, x1 = u.scales.x.max!;
        const full = d.length && x0 <= d[0] && x1 >= d[d.length - 1];
        p.onZoom?.(full ? null : [x0, x1]);
      }],
    },
    ...p.options,
  };
}

export function UPlotChart(props: UPlotChartProps) {
  const { data, height = 240, ref } = props;
  const th = useChartTheme();
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const headT = useRef<number | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const flags = useRef({ zoomFromUser: { v: false }, onScale: () => placeHead() });

  const placeHead = () => {
    const u = plotRef.current, el = headRef.current, t = headT.current;
    if (!u || !el) return;
    if (t === null || t !== t) { el.style.display = 'none'; return; }
    const x = u.valToPos(t, 'x');
    if (!(x >= 0 && x <= u.over.clientWidth)) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.transform = `translateX(${Math.round(x)}px)`;
  };

  /* (re)cria o gráfico quando mudam séries, rótulos, tema ou opções */
  const seriesKey = props.series.map(s => `${s.label}|${s.stroke ?? ''}|${s.id ?? ''}|${s.role ?? ''}|${s.slot ?? ''}`).join(';');
  useLayoutEffect(() => {
    const wrap = wrapRef.current!;
    const width = Math.max(100, wrap.clientWidth);
    const u = new uPlot(buildOpts(propsRef.current, th, width, flags.current), propsRef.current.data, wrap);
    plotRef.current = u;
    /* cursor do play: uma linha dentro da área do gráfico */
    const head = document.createElement('div');
    head.className = 'bt-uplot-head';
    head.style.background = th.cursor;
    u.over.appendChild(head);
    headRef.current = head;
    placeHead();
    /* clique sem arrastar */
    let downX = 0;
    /* zoom pelo usuário = setScale durante um arraste começado aqui (o uPlot aplica o zoom no
     * mouseup do document, depois deste; por isso o flag cai só no próximo tique) */
    const md = (e: MouseEvent) => { downX = e.clientX; flags.current.zoomFromUser.v = true; };
    const mu = (e: MouseEvent) => {
      setTimeout(() => { flags.current.zoomFromUser.v = false; }, 0);
      if (Math.abs(e.clientX - downX) > 3) return;
      const r = u.over.getBoundingClientRect();
      propsRef.current.onClick?.(u.posToVal(e.clientX - r.left, 'x'));
    };
    const dbl = () => { flags.current.zoomFromUser.v = false; propsRef.current.onZoom?.(null); };
    u.over.addEventListener('mousedown', md);
    u.over.addEventListener('mouseup', mu);
    u.over.addEventListener('dblclick', dbl);
    return () => {
      u.over.removeEventListener('mousedown', md);
      u.over.removeEventListener('mouseup', mu);
      u.over.removeEventListener('dblclick', dbl);
      u.destroy();
      plotRef.current = null; headRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [th, seriesKey, props.syncKey, props.xLabel, props.yLabel, props.yRange?.[0], props.yRange?.[1], props.legend, props.options, props.fmtX]);

  /* dados novos sem recriar */
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    plotRef.current?.setData(data);
    placeHead();
  }, [data]);

  /* altura e largura */
  useEffect(() => {
    const wrap = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const u = plotRef.current;
      if (!u) return;
      const w = Math.max(100, wrap.clientWidth);
      if (Math.abs(u.width - w) > 1 || u.height !== height) { u.setSize({ width: w, height }); placeHead(); }
    });
    ro.observe(wrap);
    const u = plotRef.current;
    if (u && u.height !== height) u.setSize({ width: Math.max(100, wrap.clientWidth), height });
    return () => ro.disconnect();
  }, [height]);

  useImperativeHandle(ref, () => ({
    setCursorTime: t => { headT.current = t; placeHead(); },
    setXRange: (x0, x1) => { const u = plotRef.current; if (u) { flags.current.zoomFromUser.v = false; u.setScale('x', { min: x0, max: x1 }); placeHead(); } },
    resetX: () => {
      const u = plotRef.current;
      if (!u) return;
      const d = u.data[0];
      if (d.length) { flags.current.zoomFromUser.v = false; u.setScale('x', { min: d[0], max: d[d.length - 1] }); placeHead(); }
    },
    getPlot: () => plotRef.current,
  }), []);

  return <div ref={wrapRef} className="bt-uplot" />;
}
