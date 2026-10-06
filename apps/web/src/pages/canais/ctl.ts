/* Controlador imperativo dos gráficos da página Canais: o "BT.Charts" do app antigo
 * (legacy/js/charts.js) por cima de vários uPlot (UPlotChart), sem re-render do React.
 *
 *   clicar/arrastar   = mover o cursor (seek)        Shift + arrastar = zoom no trecho
 *   Ctrl + roda       = zoom no tempo/distância      Shift + roda     = andar
 *   duplo clique      = tudo (volta selecionada ±2 % ou a sessão)
 *
 * A janela visível é a `view` do estado da sessão (em tempo): o trecho "Janela" das análises
 * usa a mesma. No eixo de distância, a janela é convertida pela distância de cada amostra.
 * Cursor e janela chegam 60×/s no play (acompanhar): os gráficos recebem setCursorTime e
 * setXRange direto, e os textos dos valores são escritos no DOM (~20×/s). */
import type uPlot from 'uplot';
import { esc, fmtVal, idxAt, type Lap, type SessionContext } from '@baja/core';
import type { UPlotHandle } from '../../components';
import type { ChartTheme } from '../../theme';
import { useSessionStore } from '../../state/session';
import { refIndexAt, timeAtX, xAtTime, type ChannelInfo, type Overlay, type XAxisData } from './model';

/** Largura fixa do eixo Y (todos os painéis alinhados) e margem direita da área do gráfico. */
export const Y_AXIS = 64;
export const PAD_R = 14;

type Listener = () => void;

interface LiveItem { el: HTMLElement; key: string; kind: 'cur' | 'ref' }

export class ChartsCtl {
  ctx: SessionContext | null = null;
  info: ChannelInfo | null = null;
  ax: XAxisData | null = null;
  th: ChartTheme | null = null;
  overlay: Overlay | null = null;
  /** painel → handle do UPlotChart montado */
  plots = new Map<string, UPlotHandle>();
  private viewL = new Set<Listener>();
  private curL = new Set<Listener>();
  private live = new Set<LiveItem>();
  private liveTimer: ReturnType<typeof setTimeout> | undefined;
  private liveLast = 0;
  private unsub: (() => void) | null = null;

  get t(): Float64Array { return this.ctx ? this.ctx.S.t : new Float64Array(0); }
  get X(): Float64Array { return this.ax ? this.ax.X : this.t; }
  get laps(): Lap[] { return this.ctx ? this.ctx.laps : []; }
  private get st() { return useSessionStore.getState(); }

  /* ------------------------------------------------------------ estado da sessão */
  /** Liga ao estado da sessão (cursor e janela). Devolve o desligar. */
  attach(): () => void {
    this.unsub?.();
    this.unsub = useSessionStore.subscribe((s, p) => {
      if (s.view !== p.view || s.S !== p.S) this.applyView();
      if (s.cursor !== p.cursor || s.S !== p.S) this.applyCursor(s.playing);
    });
    return () => { this.unsub?.(); this.unsub = null; if (this.liveTimer) clearTimeout(this.liveTimer); };
  }

  onView(fn: Listener): () => void { this.viewL.add(fn); return () => { this.viewL.delete(fn); }; }
  onCursor(fn: Listener): () => void { this.curL.add(fn); return () => { this.curL.delete(fn); }; }

  /* ------------------------------------------------------------ eixo X */
  fullX(): [number, number] {
    const X = this.X, n = X.length;
    return n ? [X[0], X[n - 1]] : [0, 1];
  }

  /** Janela visível no eixo X (a `view` em tempo convertida). Nunca de largura zero. */
  viewX(): [number, number] {
    const v = this.st.view;
    const [f0, f1] = this.fullX();
    if (!v) return f1 > f0 ? [f0, f1] : [f0, f0 + 1];
    let a = xAtTime(this.t, this.X, v[0]), b = xAtTime(this.t, this.X, v[1]);
    if (!(b - a > 1e-6)) {
      /* janela toda dentro de uma parada (distância não anda): abre ±1 m */
      const c = (a + b) / 2;
      a = c - 1; b = c + 1;
    }
    return [a, b];
  }

  xOfTime(tc: number): number { return xAtTime(this.t, this.X, tc); }
  timeOfX(x: number): number { return timeAtX(this.t, this.X, x); }
  cursorX(): number { return this.xOfTime(this.st.cursor); }

  /** Nova janela em x (convertida para tempo no estado). */
  setXView(a: number, b: number): void {
    const [f0, f1] = this.fullX();
    if (b < a) [a, b] = [b, a];
    if (a <= f0 && b >= f1) { this.st.setView(null); return; }
    this.st.setView([this.timeOfX(Math.max(a, f0)), this.timeOfX(Math.min(b, f1))]);
  }

  /** Zoom em torno de xc (f < 1 aproxima) — Charts.zoom do antigo. */
  zoomAt(f: number, xc?: number): void {
    const [a, b] = this.viewX();
    const c = xc ?? Math.min(b, Math.max(a, this.cursorX()));
    this.setXView(c - (c - a) * f, c + (b - c) * f);
  }

  /** Anda dx (unidades do eixo), mantendo a largura. */
  pan(dx: number): void {
    const [a, b] = this.viewX(), [f0, f1] = this.fullX(), w = b - a;
    let a2 = a + dx;
    a2 = Math.max(f0, Math.min(f1 - w, a2));
    this.setXView(a2, a2 + w);
  }

  reset(): void { this.st.resetView(); }

  seekX(x: number): void { this.st.seek(this.timeOfX(x)); }

  /** Vai ao instante t; se ficar fora da janela, centraliza a janela nele (mesma largura). */
  goTo(tc: number): void {
    const st = this.st;
    st.seek(tc);
    const v = st.view;
    if (v && (tc < v[0] || tc > v[1])) {
      const w = v[1] - v[0];
      st.setView([tc - w / 2, tc + w / 2]);
    }
  }

  /* ------------------------------------------------------------ aplicar nos gráficos */
  applyView(): void {
    const [a, b] = this.viewX();
    this.plots.forEach(h => h.setXRange(a, b));
    this.viewL.forEach(f => f());
  }

  applyCursor(playing = false): void {
    const x = this.cursorX();
    this.plots.forEach(h => h.setCursorTime(x));
    this.curL.forEach(f => f());
    this.scheduleLive(playing);
  }

  /** Painel montado: janela e cursor atuais. */
  register(id: string, h: UPlotHandle): () => void {
    this.plots.set(id, h);
    const [a, b] = this.viewX();
    h.setXRange(a, b);
    h.setCursorTime(this.cursorX());
    return () => { if (this.plots.get(id) === h) this.plots.delete(id); };
  }

  redrawAll(): void {
    this.plots.forEach(h => h.getPlot()?.redraw(false, true));
  }

  /** Seleção do Shift + arrastar desenhada em todos os painéis (px na área do gráfico). */
  showSelect(left: number, width: number): void {
    this.plots.forEach(h => {
      const u = h.getPlot();
      if (u) u.setSelect({ left, width, top: 0, height: u.over.clientHeight }, false);
    });
  }

  /* ------------------------------------------------------------ valores no cursor */
  /** Liga um <span> ao valor de um canal no cursor (ou da volta de referência). */
  bindValue(el: HTMLElement, key: string, kind: 'cur' | 'ref' = 'cur'): () => void {
    const it: LiveItem = { el, key, kind };
    this.live.add(it);
    const i = this.cursorIdx();
    this.paint(it, i, this.refIdx(i));
    return () => { this.live.delete(it); };
  }

  private cursorIdx(): number {
    const t = this.t;
    return t.length ? idxAt(t, this.st.cursor) : -1;
  }

  private refIdx(i: number): number {
    return this.overlay && i >= 0 ? refIndexAt(this.t, this.X, this.overlay, i) : -1;
  }

  private paint(it: LiveItem, i: number, ri: number): void {
    const c = this.info?.chan(it.key);
    const j = it.kind === 'ref' ? ri : i;
    const txt = c && j >= 0 ? fmtVal(c.data[j], this.info!.dec(it.key)) : '—';
    if (it.el.textContent !== txt) it.el.textContent = txt;
  }

  updateLive(): void {
    const i = this.cursorIdx(), ri = this.refIdx(i);
    this.live.forEach(it => this.paint(it, i, ri));
  }

  /* ~20×/s no play; parado, na hora */
  private scheduleLive(playing: boolean): void {
    const now = performance.now();
    if (!playing || now - this.liveLast >= 50) {
      if (this.liveTimer) { clearTimeout(this.liveTimer); this.liveTimer = undefined; }
      this.liveLast = now;
      this.updateLive();
      return;
    }
    if (!this.liveTimer) {
      this.liveTimer = setTimeout(() => { this.liveTimer = undefined; this.liveLast = performance.now(); this.updateLive(); }, 50 - (now - this.liveLast));
    }
  }

  /* ------------------------------------------------------------ interação no gráfico */
  /** Plugin do uPlot de cada painel: interação do antigo, linhas das voltas e o aviso
   *  "sem dados neste trecho". */
  plugin(keysOf: () => string[]): uPlot.Plugin {
    const unbinds = new WeakMap<uPlot, () => void>();
    return {
      hooks: {
        init: [u => { unbinds.set(u, this.bindPlot(u)); }],
        destroy: [u => { unbinds.get(u)?.(); }],
        draw: [u => this.drawExtras(u, keysOf())],
      },
    };
  }

  private bindPlot(u: uPlot): () => void {
    const over = u.over;
    const xAt = (clientX: number) => {
      const r = over.getBoundingClientRect();
      return { px: Math.max(0, Math.min(r.width, clientX - r.left)), w: r.width };
    };
    let mode: 'scrub' | 'select' | null = null, x0 = 0;
    const move = (e: PointerEvent) => {
      const { px } = xAt(e.clientX);
      if (mode === 'scrub') this.seekX(u.posToVal(px, 'x'));
      else if (mode === 'select') this.showSelect(Math.min(x0, px), Math.abs(px - x0));
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (mode === 'select') {
        const { px } = xAt(e.clientX);
        this.showSelect(0, 0);
        const a = Math.min(x0, px), b = Math.max(x0, px);
        if (b - a > 6) this.setXView(u.posToVal(a, 'x'), u.posToVal(b, 'x'));
      }
      mode = null;
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { px } = xAt(e.clientX);
      e.preventDefault();
      if (e.shiftKey) { mode = 'select'; x0 = px; this.showSelect(px, 0); }
      else { mode = 'scrub'; this.seekX(u.posToVal(px, 'x')); }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };
    const wheel = (e: WheelEvent) => {
      const { px, w } = xAt(e.clientX);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.zoomAt(Math.exp(e.deltaY * (e.deltaMode ? 0.05 : 0.002)), u.posToVal(px, 'x'));
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const d = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * (e.deltaMode ? 20 : 1);
        const [a, b] = this.viewX();
        this.pan(d / (w || 1) * (b - a));
      }
    };
    const dbl = (e: MouseEvent) => { e.preventDefault(); this.reset(); };
    over.addEventListener('pointerdown', down);
    over.addEventListener('wheel', wheel, { passive: false });
    over.addEventListener('dblclick', dbl);
    return () => {
      over.removeEventListener('pointerdown', down);
      over.removeEventListener('wheel', wheel);
      over.removeEventListener('dblclick', dbl);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }

  /* linhas das voltas (como o antigo) e "sem dados neste trecho" */
  private drawExtras(u: uPlot, keys: string[]): void {
    const th = this.th, ctx = this.ctx;
    if (!th || !ctx) return;
    const g = u.ctx, { left, top, width, height } = u.bbox;
    const laps = ctx.laps, X = this.X;
    const pr = devicePixelRatio || 1;
    g.save();
    if (laps.length) {
      g.strokeStyle = th.axis; g.lineWidth = pr; g.setLineDash([4 * pr, 4 * pr]);
      g.beginPath();
      const line = (xv: number) => {
        const x = Math.round(u.valToPos(xv, 'x', true)) + 0.5;
        if (x >= left && x <= left + width) { g.moveTo(x, top); g.lineTo(x, top + height); }
      };
      laps.forEach(l => line(X[l.i0]));
      line(X[laps[laps.length - 1].i1]);
      g.stroke();
      g.setLineDash([]);
      /* volta selecionada com sobreposição: faixa discreta */
      const ov = this.overlay;
      if (ov) {
        const a = u.valToPos(X[ov.sel.i0], 'x', true), b = u.valToPos(X[ov.sel.i1], 'x', true);
        const x0 = Math.max(left, a), x1 = Math.min(left + width, b);
        if (x1 > x0) { g.fillStyle = th.sel; g.globalAlpha = 0.35; g.fillRect(x0, top, x1 - x0, height); g.globalAlpha = 1; }
      }
    }
    /* algum canal sem nenhum valor na janela? */
    const xs = u.data[0] as ArrayLike<number>;
    const [a, b] = [u.scales.x.min ?? 0, u.scales.x.max ?? 1];
    const i0 = Math.max(0, idxAt(xs, a)), i1 = Math.min(xs.length - 1, idxAt(xs, b) + 1);
    const empty: string[] = [];
    keys.forEach((k, s) => {
      const ys = u.data[s + 1] as ArrayLike<number | null> | undefined;
      if (!ys) return;
      let any = false;
      for (let i = i0; i <= i1; i++) { const v = ys[i]; if (v !== null && v === v) { any = true; break; } }
      if (!any) empty.push(this.info?.chan(k)?.name ?? k);
    });
    if (empty.length) {
      g.font = `${13 * pr}px ${th.font}`;
      g.fillStyle = th.muted;
      g.textAlign = 'center';
      g.fillText(`sem dados neste trecho: ${empty.join(', ')}`, left + width / 2, top + height / 2);
    }
    g.restore();
  }

  /* ------------------------------------------------------------ dica do mouse */
  tipHtml(keys: string[], colors: string[], i: number): string {
    const info = this.info, ax = this.ax, t = this.t;
    if (!info || !ax || i < 0 || i >= t.length) return '';
    const head = ax.mode === 'dist'
      ? `<b>${this.X[i].toFixed(0)} m</b> · t ${t[i].toFixed(2)} s`
      : `<b>t ${t[i].toFixed(2)} s</b>`;
    const ri = this.refIdx(i);
    const rows = keys.map((k, s) => {
      const c = info.chan(k);
      if (!c) return '';
      const v = fmtVal(c.data[i], info.dec(k));
      const rv = this.overlay ? ` <span>· ref. ${ri >= 0 ? fmtVal(c.data[ri], info.dec(k)) : '—'}</span>` : '';
      return `<div class="bt-tip-row"><i style="background:${colors[s]}"></i><span>${esc(c.name)}</span><b>${v} ${esc(c.unit || '')}${rv}</b></div>`;
    }).join('');
    return head + rows;
  }
}
