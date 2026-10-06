/* Mapa da pista em canvas (porte de legacy/js/mapview.js, BT.MapView): metros Leste/Norte
 * em torno do centro da pista. Roda/pinça = zoom, arrastar = mover, clique = ir para aquele
 * ponto do log, duplo clique = enquadrar. Fundo de satélite opcional (Esri World Imagery,
 * precisa de internet e do centro em lat/lon). Camada estática em cache; por quadro só o carro.
 *
 * Desacoplado do objeto A do app antigo: tudo o que o mapa lia de A vem em `source`
 * (MapSource). O cursor muda 60×/s no play: use ref.current.setCursor(t), que redesenha só a
 * camada dinâmica (o carro) sem re-render do React. */
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { ActionIcon, Badge, Tooltip } from '@mantine/core';
import { IconFocusCentered, IconMinus, IconPlus, IconCurrentLocation, IconWorld } from '@tabler/icons-react';
import { clamp, heat, mPerDeg, pctRange, posAt, type Lap, type LatLon, type Pt, type Session, type Track, type TrackOk } from '@baja/core';
import { useChartTheme, type ChartTheme } from '../theme';
import { setupCanvas } from './canvas';

export interface MapSource {
  /** tempo do log (S.t) */
  t: Float64Array;
  /** trajetória (computeTrack); null/!ok = só grade e área */
  track: Track | null;
  /** posição real em lat/lon (BUSMASTER, S.gps): sem o retângulo da área dos códigos 0..255 */
  hasLatLon?: boolean;
  /** área coberta pelos códigos (spanOf(cfg)), usada quando a trajetória falhou */
  span?: { x: number; y: number };
  /** trecho [i0, i1]; sem isto: volta selecionada (laps[selLap]) ou a sessão inteira (A.range()) */
  range?: [number, number];
  laps?: Lap[];
  selLap?: number;
  /** valores para colorir o trecho (A.colorValues()); null = velocidade do GPS */
  colorValues?: ArrayLike<number> | null;
  /** faixa fixa da cor; sem isto: 2–98 % do trecho (pctRange) */
  colorRange?: { lo: number; hi: number };
  /** linha de largada (A.getLine()) */
  line?: Pt[] | null;
  /** tempo inicial do cursor (depois use setCursor) */
  cursor?: number;
  /** HTML do tooltip do ponto i (A.tipHtml). Escape com esc() os textos do usuário. */
  tipHtml?: (i: number) => string;
  /** clique na pista: ir para o tempo t */
  onSeek?: (t: number) => void;
  /** linha de largada desenhada com 2 cliques (metros, ainda sem arredondar) */
  onLineDrawn?: (pts: Pt[]) => void;
}

export interface MapLegendInfo { lo: number; hi: number; dark: boolean }

export interface TrackMapHandle {
  /** move o carro (só a camada dinâmica) */
  setCursor(t: number): void;
  fit(): void;
  /** redesenha a camada estática (ex.: cores mudaram por fora) */
  invalidate(): void;
  zoom(f: number): void;
}

export interface TrackMapProps {
  source: MapSource;
  height?: number | string;
  satellite?: boolean;
  onSatelliteChange?: (on: boolean) => void;
  follow?: boolean;
  onFollowChange?: (on: boolean) => void;
  /** modo de desenhar a linha de largada (2 cliques) */
  lineMode?: boolean;
  onLineModeChange?: (on: boolean) => void;
  /** faixa de cor do trecho, para a MapLegend */
  onLegend?: (info: MapLegendInfo) => void;
  /** botões de zoom/enquadrar/seguir/satélite sobre o mapa (padrão true) */
  controls?: boolean;
  ref?: Ref<TrackMapHandle>;
}

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/';

/* Controlador imperativo (a classe do app antigo), dono do canvas e da interação. */
class MapCtl {
  c: HTMLCanvasElement;
  tip: HTMLDivElement;
  v = { cx: 0, cy: 0, s: 2 };            /* centro (m) e escala (px/m) */
  w = 0; h = 0;
  sat = false;
  follow = false;
  lineMode = false; linePts: Pt[] = [];
  hover = -1;
  userView = false;
  /* já enquadrou com o tamanho real do canvas? (o 1º quadro pode medir antes do ResizeObserver) */
  fitted = false;
  tiles = new Map<string, HTMLImageElement>();
  off = document.createElement('canvas');
  dirty = true;
  ptr = new Map<number, [number, number]>();
  src: MapSource;
  th: ChartTheme;
  cur = 0;
  raf = 0;
  dead = false;
  props: TrackMapProps;
  legKey = '';
  onLinePts: (n: number) => void = () => {};
  unbind: () => void;

  constructor(c: HTMLCanvasElement, tip: HTMLDivElement, props: TrackMapProps, th: ChartTheme) {
    this.c = c; this.tip = tip; this.props = props; this.src = props.source; this.th = th;
    this.cur = props.source.cursor ?? (props.source.t.length ? props.source.t[0] : 0);
    this.unbind = this.bind();
  }

  destroy() { this.dead = true; cancelAnimationFrame(this.raf); this.unbind(); }

  requestRender() { if (!this.raf && !this.dead) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }
  invalidate() { this.dirty = true; this.requestRender(); }

  get okTrack(): TrackOk | null { const tr = this.src.track; return tr && tr.ok ? tr : null; }

  /* trecho ativo: o informado, a volta selecionada ou a sessão inteira */
  range(): [number, number] {
    const s = this.src;
    if (s.range) return s.range;
    if (s.laps && s.selLap !== undefined && s.selLap >= 0 && s.laps[s.selLap]) return [s.laps[s.selLap].i0, s.laps[s.selLap].i1];
    return [0, s.t.length - 1];
  }
  spanOf() { const tr = this.src.track; return tr ? tr.span : this.src.span ?? { x: 200, y: 200 }; }

  resize() {
    const r = this.c.getBoundingClientRect();
    const changed = Math.abs(r.width - this.w) > 1 || Math.abs(r.height - this.h) > 1;
    this.w = r.width; this.h = r.height;
    this.dirty = true;
    if ((changed || !this.fitted) && !this.userView) this.fit();     /* sem zoom manual: reenquadra */
    else this.requestRender();
  }

  /* enquadra os pontos (do trecho selecionado, ou tudo) */
  fit() {
    this.fitView();
    this.invalidate();
  }
  /* calcula o enquadramento (sem pedir quadro: draw() usa isto no 1º desenho) */
  fitView() {
    const tr = this.okTrack;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    if (tr) {
      const [a, b] = this.range();
      for (let i = a; i <= b; i++) if (tr.valid[i]) {
        const x = tr.x[i], y = tr.y[i];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (!isFinite(x0)) { const sp = this.spanOf(); x0 = -sp.x / 2; x1 = sp.x / 2; y0 = -sp.y / 2; y1 = sp.y / 2; }
    const pad = 36, dw = Math.max(x1 - x0, 10), dh = Math.max(y1 - y0, 10);
    this.v.s = Math.max(0.05, Math.min((this.w - 2 * pad) / dw, (this.h - 2 * pad) / dh));
    this.v.cx = (x0 + x1) / 2; this.v.cy = (y0 + y1) / 2;
    this.userView = false;
    if (this.w > 0 && this.h > 0) this.fitted = true;
    this.dirty = true;
  }

  sx(x: number) { return this.w / 2 + (x - this.v.cx) * this.v.s; }
  sy(y: number) { return this.h / 2 - (y - this.v.cy) * this.v.s; }
  wx(px: number) { return (px - this.w / 2) / this.v.s + this.v.cx; }
  wy(py: number) { return -(py - this.h / 2) / this.v.s + this.v.cy; }

  zoomAt(px: number, py: number, f: number) {
    const x = this.wx(px), y = this.wy(py);
    this.v.s = clamp(this.v.s * f, 0.05, 200);
    this.v.cx = x - (px - this.w / 2) / this.v.s;
    this.v.cy = y + (py - this.h / 2) / this.v.s;
    this.userView = true;
    this.invalidate();
  }

  pos(tc: number) {
    const tr = this.okTrack;
    if (!tr) return null;
    return posAt({ t: this.src.t } as Session, tr, tc);   /* posAt só usa S.t */
  }

  /* ---------------------------------------------------------------- desenho */
  draw() {
    if (!this.w) { const r = this.c.getBoundingClientRect(); this.w = r.width; this.h = r.height; }
    if (!this.w || !this.h) return;
    /* 1º desenho com o tamanho real: enquadra (o ResizeObserver pode chegar depois sem mudança) */
    if (!this.fitted && !this.userView) this.fitView();
    if (this.follow && this.okTrack) {
      const p = this.pos(this.cur);
      if (p) { this.v.cx = p.x; this.v.cy = p.y; this.dirty = true; }
    }
    if (this.dirty) { this.drawStatic(); this.dirty = false; }
    const [g, w, h] = setupCanvas(this.c, this.w, this.h);
    g.drawImage(this.off, 0, 0, w, h);
    this.drawDynamic(g);
  }

  drawStatic() {
    const T = this.th, tr = this.src.track, ok = this.okTrack;
    const [g, w, h] = setupCanvas(this.off, this.w, this.h);
    g.fillStyle = T.surface; g.fillRect(0, 0, w, h);
    const center = tr ? tr.center : null;
    const showSat = !!(this.sat && center);
    if (showSat) this.drawTiles(g, center!);
    else this.drawGrid(g);

    /* área coberta pelos códigos 0..255 (fora disso o valor trava na borda) */
    if ((this.src.t.length || this.src.span) && !this.src.hasLatLon) {
      const sp = this.spanOf();
      g.strokeStyle = showSat ? 'rgba(255,255,255,.55)' : T.axis; g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.strokeRect(this.sx(-sp.x / 2), this.sy(sp.y / 2), sp.x * this.v.s, sp.y * this.v.s);
      g.setLineDash([]);
    }

    const dark = showSat || T.dark;
    if (ok) {
      const X = ok.x, Y = ok.y, V = ok.valid, n = X.length;
      const [a, b] = this.range();
      const path = (i0: number, i1: number) => {
        g.beginPath();
        let pen = false;
        for (let i = i0; i <= i1; i++) {
          if (!V[i]) { pen = false; continue; }
          const px = this.sx(X[i]), py = this.sy(Y[i]);
          if (pen) g.lineTo(px, py); else { g.moveTo(px, py); pen = true; }
        }
      };
      g.lineJoin = 'round'; g.lineCap = 'round';
      /* sessão inteira, apagada */
      path(0, n - 1);
      g.strokeStyle = showSat ? 'rgba(255,255,255,.35)' : T.mutedLine; g.lineWidth = 2; g.stroke();
      /* trecho selecionado colorido pelo canal escolhido: contorno + 24 faixas de cor */
      const val = this.src.colorValues ?? ok.speed;
      const r = this.src.colorRange ? { ...this.src.colorRange, n: 1 } : pctRange(val, a, b, 0.02);
      const lo = r.lo, hi = r.hi > r.lo ? r.hi : r.lo + 1;
      path(a, b);
      g.strokeStyle = 'rgba(12,12,12,.70)'; g.lineWidth = 6; g.stroke();
      const NB = 24, paths = Array.from({ length: NB }, () => new Path2D());
      for (let i = a + 1; i <= b; i++) {
        if (!V[i] || !V[i - 1]) continue;
        const v = val[i];
        const k = v === v ? clamp(Math.floor((v - lo) / (hi - lo) * NB), 0, NB - 1) : 0;
        paths[k].moveTo(this.sx(X[i - 1]), this.sy(Y[i - 1]));
        paths[k].lineTo(this.sx(X[i]), this.sy(Y[i]));
      }
      g.lineWidth = 3.5;
      paths.forEach((p, k) => { g.strokeStyle = heat((k + 0.5) / NB, dark); g.stroke(p); });
      this.legend(r.n ? lo : NaN, r.n ? hi : NaN, dark);
    } else if (this.src.t.length) this.legend(NaN, NaN, T.dark);

    /* linha de largada */
    const L = this.src.line;
    if (L && L.length === 2) {
      g.lineCap = 'butt';
      g.strokeStyle = 'rgba(12,12,12,.8)'; g.lineWidth = 6;
      g.beginPath(); g.moveTo(this.sx(L[0].x), this.sy(L[0].y)); g.lineTo(this.sx(L[1].x), this.sy(L[1].y)); g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.setLineDash([5, 5]);
      g.stroke(); g.setLineDash([]);
    }
    this.linePts.forEach(p => { g.fillStyle = T.fg; g.fillRect(this.sx(p.x) - 4, this.sy(p.y) - 4, 8, 8); });

    this.drawScale(g, w, h, showSat);
    if (showSat) {
      g.font = `11px ${T.font}`; g.fillStyle = 'rgba(255,255,255,.85)'; g.textAlign = 'right';
      g.fillText('Imagem: Esri World Imagery', w - 8, h - 8); g.textAlign = 'left';
    }
  }

  legend(lo: number, hi: number, dark: boolean) {
    const k = `${lo}|${hi}|${dark}`;
    if (k === this.legKey) return;
    this.legKey = k;
    const cb = this.props.onLegend;
    if (cb) queueMicrotask(() => { if (!this.dead) cb({ lo, hi, dark }); });
  }

  drawGrid(g: CanvasRenderingContext2D) {
    const T = this.th;
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(s => s * this.v.s >= 40) || 1000;
    const x0 = Math.floor(this.wx(0) / step) * step, x1 = this.wx(this.w);
    const y0 = Math.floor(this.wy(this.h) / step) * step, y1 = this.wy(0);
    g.strokeStyle = T.grid; g.lineWidth = 1; g.beginPath();
    for (let x = x0; x <= x1; x += step) { const p = Math.round(this.sx(x)) + .5; g.moveTo(p, 0); g.lineTo(p, this.h); }
    for (let y = y0; y <= y1; y += step) { const p = Math.round(this.sy(y)) + .5; g.moveTo(0, p); g.lineTo(this.w, p); }
    g.stroke();
    /* eixos pelo centro da pista */
    g.strokeStyle = T.axis; g.beginPath();
    const ox = Math.round(this.sx(0)) + .5, oy = Math.round(this.sy(0)) + .5;
    g.moveTo(ox, 0); g.lineTo(ox, this.h); g.moveTo(0, oy); g.lineTo(this.w, oy); g.stroke();
    g.fillStyle = T.text; g.font = `600 11px ${T.font}`;
    g.fillText('N ↑', ox + 5, 14);
  }

  drawScale(g: CanvasRenderingContext2D, _w: number, h: number, onSat: boolean) {
    const T = this.th;
    const m = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(s => s * this.v.s >= 60) || 1000;
    const L = m * this.v.s, x = 14, y = h - 16;
    g.strokeStyle = onSat ? '#fff' : T.fg2; g.lineWidth = 2; g.lineCap = 'butt';
    g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x, y); g.lineTo(x + L, y); g.lineTo(x + L, y - 5); g.stroke();
    g.fillStyle = onSat ? '#fff' : T.fg2; g.font = `12px ${T.font}`;
    g.fillText(m + ' m', x + L + 7, y + 1);
  }

  drawTiles(g: CanvasRenderingContext2D, c: LatLon) {
    const mpd = mPerDeg(c.lat), dpr = window.devicePixelRatio || 1;
    const mpp = 1 / this.v.s / dpr;
    const z = clamp(Math.round(Math.log2(156543.03392 * Math.cos(c.lat * Math.PI / 180) / mpp)), 1, 19);
    const N = 1 << z;
    const toLL = (x: number, y: number) => ({ lat: c.lat + y / mpd.lat, lon: c.lon + x / mpd.lon });
    const tx = (lon: number) => (lon + 180) / 360 * N;
    const ty = (lat: number) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * N; };
    const lonOf = (x: number) => x / N * 360 - 180;
    const latOf = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / N))) * 180 / Math.PI;
    const nw = toLL(this.wx(0), this.wy(0)), se = toLL(this.wx(this.w), this.wy(this.h));
    const x0 = Math.floor(tx(nw.lon)), x1 = Math.floor(tx(se.lon)), y0 = Math.floor(ty(nw.lat)), y1 = Math.floor(ty(se.lat));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 80) { this.drawGrid(g); return; }
    for (let X = x0; X <= x1; X++) for (let Y = y0; Y <= y1; Y++) {
      const img = this.tile(z, X, Y);
      if (!img.complete || !img.naturalWidth) continue;
      const ax = this.sx((lonOf(X) - c.lon) * mpd.lon), ay = this.sy((latOf(Y) - c.lat) * mpd.lat);
      const bx = this.sx((lonOf(X + 1) - c.lon) * mpd.lon), by = this.sy((latOf(Y + 1) - c.lat) * mpd.lat);
      g.drawImage(img, ax, ay, bx - ax + 0.6, by - ay + 0.6);
    }
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 0, this.w, this.h);   /* escurece um pouco para a pista aparecer */
  }

  tile(z: number, x: number, y: number) {
    const k = z + '/' + x + '/' + y;
    let img = this.tiles.get(k);
    if (!img) {
      img = new Image();
      img.onload = () => this.invalidate();
      img.src = `${ESRI}${z}/${y}/${x}`;
      this.tiles.set(k, img);
      if (this.tiles.size > 400) this.tiles.delete(this.tiles.keys().next().value!);
    }
    return img;
  }

  drawDynamic(g: CanvasRenderingContext2D) {
    const tr = this.okTrack, T = this.th;
    if (!tr) return;
    if (this.hover >= 0 && tr.valid[this.hover]) {
      g.strokeStyle = T.fg; g.lineWidth = 2;
      g.beginPath(); g.arc(this.sx(tr.x[this.hover]), this.sy(tr.y[this.hover]), 7, 0, 7); g.stroke();
    }
    const p = this.pos(this.cur);
    if (!p) return;
    const x = this.sx(p.x), y = this.sy(p.y), h = p.h || 0;
    g.save(); g.translate(x, y); g.rotate(h);
    g.beginPath(); g.moveTo(0, -16); g.lineTo(10, 11); g.lineTo(0, 5); g.lineTo(-10, 11); g.closePath();
    g.fillStyle = T.car; g.strokeStyle = T.surface; g.lineWidth = 3;
    g.stroke(); g.fill();
    g.restore();
  }

  /* ---------------------------------------------------------------- interação */
  nearest(px: number, py: number, maxPx: number) {
    const tr = this.okTrack;
    if (!tr) return -1;
    const [a, b] = this.range();
    let bi = -1, bd = maxPx * maxPx;
    for (let i = a; i <= b; i++) {
      if (!tr.valid[i]) continue;
      const dx = this.sx(tr.x[i]) - px, dy = this.sy(tr.y[i]) - py, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  }

  defaultTip(i: number) {
    const tr = this.okTrack!;
    return `<b>t ${this.src.t[i].toFixed(2)} s</b><br>${tr.speed[i].toFixed(1)} km/h`;
  }

  bind(): () => void {
    const c = this.c, tip = this.tip;
    const local = (e: { clientX: number; clientY: number }): [number, number] => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
    let pinch: { d: number } | null = null;

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const [x, y] = local(e);
      this.zoomAt(x, y, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)));
    };
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      this.ptr.set(e.pointerId, local(e));
      if (this.ptr.size === 2) {
        const [p, q] = [...this.ptr.values()];
        pinch = { d: Math.hypot(p[0] - q[0], p[1] - q[1]) }; drag = null;
      } else {
        const [x, y] = local(e);
        drag = { x, y, cx: this.v.cx, cy: this.v.cy, moved: false };
      }
    };
    const move = (e: PointerEvent) => {
      const [x, y] = local(e);
      if (this.ptr.has(e.pointerId)) this.ptr.set(e.pointerId, [x, y]);
      if (pinch && this.ptr.size === 2) {
        const [p, q] = [...this.ptr.values()], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        this.zoomAt((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, d / pinch.d); pinch.d = d;
        return;
      }
      if (drag) {
        if (Math.hypot(x - drag.x, y - drag.y) > 4) drag.moved = true;
        if (drag.moved) {
          this.v.cx = drag.cx - (x - drag.x) / this.v.s; this.v.cy = drag.cy + (y - drag.y) / this.v.s;
          this.userView = true;
          if (this.follow) { this.follow = false; this.props.onFollowChange?.(false); }
          this.invalidate();
        }
        return;
      }
      /* hover: mostra o ponto mais próximo e seus valores */
      const i = this.lineMode ? -1 : this.nearest(x, y, 18);
      if (i !== this.hover) { this.hover = i; this.requestRender(); }
      if (i >= 0) {
        tip.hidden = false;
        tip.innerHTML = this.src.tipHtml ? this.src.tipHtml(i) : this.defaultTip(i);
        const tw = tip.offsetWidth || 170;
        tip.style.left = Math.max(4, Math.min(x + 16, this.w - tw - 6)) + 'px'; tip.style.top = Math.max(y - 48, 4) + 'px';
      } else tip.hidden = true;
    };
    const up = (e: PointerEvent) => {
      this.ptr.delete(e.pointerId);
      if (pinch) { if (this.ptr.size < 2) pinch = null; drag = null; return; }
      if (drag && !drag.moved) {
        const [x, y] = local(e);
        if (this.lineMode) {
          this.linePts.push({ x: this.wx(x), y: this.wy(y) });
          if (this.linePts.length === 2) {
            const pts = this.linePts;
            this.linePts = []; this.lineMode = false;
            this.src.onLineDrawn?.(pts);
            this.props.onLineModeChange?.(false);
          }
          this.onLinePts(this.linePts.length);
          this.invalidate();
        } else {
          const i = this.nearest(x, y, 30);
          if (i >= 0) {
            this.cur = this.src.t[i];
            this.requestRender();
            this.src.onSeek?.(this.src.t[i]);
          }
        }
      }
      drag = null;
    };
    const leave = () => { if (this.hover !== -1) { this.hover = -1; this.requestRender(); } tip.hidden = true; };
    const dbl = () => { if (this.follow) { this.follow = false; this.props.onFollowChange?.(false); } this.fit(); };

    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', leave);
    c.addEventListener('dblclick', dbl);
    return () => {
      c.removeEventListener('wheel', wheel);
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
      c.removeEventListener('pointerleave', leave);
      c.removeEventListener('dblclick', dbl);
    };
  }
}

export function TrackMap(props: TrackMapProps) {
  const { source, height = 420, satellite = false, follow = false, lineMode = false, controls = true, ref } = props;
  const th = useChartTheme();
  const cvRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const ctlRef = useRef<MapCtl | null>(null);
  const [linePts, setLinePts] = useState(0);

  /* cria o controlador uma vez */
  useLayoutEffect(() => {
    const ctl = new MapCtl(cvRef.current!, tipRef.current!, props, th);
    ctl.onLinePts = setLinePts;
    ctlRef.current = ctl;
    const ro = new ResizeObserver(() => ctl.resize());
    ro.observe(cvRef.current!);
    return () => { ro.disconnect(); ctl.destroy(); ctlRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* props sempre atualizadas no controlador (callbacks) */
  useLayoutEffect(() => { if (ctlRef.current) ctlRef.current.props = props; });

  /* fonte nova: redesenha; trajetória ou trecho novos: reenquadra */
  const [r0, r1] = source.range ?? [-1, -1];
  useLayoutEffect(() => {
    const ctl = ctlRef.current;
    if (!ctl) return;
    ctl.src = source;
    ctl.invalidate();
  }, [source]);
  useLayoutEffect(() => {
    const ctl = ctlRef.current;
    if (ctl) { if (ctl.w) ctl.fit(); else ctl.fitted = false; }
  }, [source.track, r0, r1, source.selLap, source.laps]);
  useLayoutEffect(() => {
    const ctl = ctlRef.current;
    if (ctl && source.cursor !== undefined) { ctl.cur = source.cursor; ctl.requestRender(); }
  }, [source.cursor]);

  useLayoutEffect(() => { const c = ctlRef.current; if (c) { c.th = th; c.invalidate(); } }, [th]);
  useLayoutEffect(() => { const c = ctlRef.current; if (c) { c.sat = satellite; c.invalidate(); } }, [satellite]);
  useLayoutEffect(() => { const c = ctlRef.current; if (c) { c.follow = follow; if (!follow) c.invalidate(); else c.requestRender(); } }, [follow]);
  useLayoutEffect(() => {
    const c = ctlRef.current;
    if (c) { c.lineMode = lineMode; c.linePts = []; setLinePts(0); c.invalidate(); }
  }, [lineMode]);

  useImperativeHandle(ref, () => ({
    setCursor: t => { const c = ctlRef.current; if (c) { c.cur = t; c.requestRender(); } },
    fit: () => ctlRef.current?.fit(),
    invalidate: () => ctlRef.current?.invalidate(),
    zoom: f => { const c = ctlRef.current; if (c) c.zoomAt(c.w / 2, c.h / 2, f); },
  }), []);

  useEffect(() => () => { tipRef.current && (tipRef.current.hidden = true); }, []);

  const hasCenter = !!(source.track && source.track.center);
  const zoom = (f: number) => { const c = ctlRef.current; if (c) c.zoomAt(c.w / 2, c.h / 2, f); };

  return (
    <div className={lineMode ? 'bt-map bt-map--line' : 'bt-map'} style={{ height }}>
      <canvas ref={cvRef} className="bt-map-canvas" aria-label="Mapa da pista" />
      <div ref={tipRef} className="bt-map-tip" hidden />
      {lineMode && (
        <Badge className="bt-map-hint" size="lg" variant="filled" color="dark">
          Clique {2 - linePts}× no mapa para a linha de largada…
        </Badge>
      )}
      {controls && (
        <div className="bt-map-tools">
          <Tooltip label="Aproximar" position="left"><ActionIcon variant="default" aria-label="Aproximar" onClick={() => zoom(1.5)}><IconPlus size={16} /></ActionIcon></Tooltip>
          <Tooltip label="Afastar" position="left"><ActionIcon variant="default" aria-label="Afastar" onClick={() => zoom(1 / 1.5)}><IconMinus size={16} /></ActionIcon></Tooltip>
          <Tooltip label="Enquadrar (duplo clique)" position="left">
            <ActionIcon variant="default" aria-label="Enquadrar" onClick={() => { props.onFollowChange?.(false); ctlRef.current?.fit(); }}><IconFocusCentered size={16} /></ActionIcon>
          </Tooltip>
          {props.onFollowChange && (
            <Tooltip label={follow ? 'Parar de seguir o carro' : 'Seguir o carro'} position="left">
              <ActionIcon variant={follow ? 'filled' : 'default'} aria-pressed={follow} aria-label="Seguir o carro" onClick={() => props.onFollowChange!(!follow)}>
                <IconCurrentLocation size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          {props.onSatelliteChange && (
            <Tooltip label={hasCenter ? (satellite ? 'Tirar o satélite' : 'Fundo de satélite (precisa de internet)') : 'Satélite precisa do centro da pista em lat/lon'} position="left">
              <ActionIcon variant={satellite ? 'filled' : 'default'} aria-pressed={satellite} aria-label="Satélite" disabled={!hasCenter} onClick={() => props.onSatelliteChange!(!satellite)}>
                <IconWorld size={16} />
              </ActionIcon>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
