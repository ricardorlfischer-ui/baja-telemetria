/* Gráficos empilhados: um painel por canal, todos no mesmo eixo de tempo.
 *   clicar/arrastar   = mover o cursor (o mapa e a tabela acompanham)
 *   Shift + arrastar  = selecionar um trecho para dar zoom
 *   Ctrl + roda/pinça = zoom no tempo        Shift + roda = andar no tempo
 *   duplo clique      = ver tudo
 * Os dados só são redesenhados quando a janela de tempo muda; o cursor fica numa camada
 * por cima. */
'use strict';

BT.Charts = class {
  constructor(root, app) {
    this.root = root; this.app = app;
    this.panels = [];
    this.v = { t0: 0, t1: 1 };
    this.hoverT = null; this.hoverP = null; this.sel = null;
    this.dirty = true;
    root.innerHTML = '<div class="panels"></div>' +
      '<div class="axisrow"><div class="plabel axislabel">tempo (s)</div><canvas class="axis"></canvas></div>' +
      '<canvas class="overlay"></canvas><div class="ctip" hidden></div>';
    this.list = root.querySelector('.panels');
    this.axis = root.querySelector('.axis');
    this.ov = root.querySelector('.overlay');
    this.tip = root.querySelector('.ctip');
    root.classList.add('nodata');
    this.list.innerHTML = '<p class="mut empty">Os gráficos aparecem aqui, um por canal do log, todos no mesmo eixo de tempo.</p>';
    this.bind();
  }

  setChannels(chs) {
    this.root.classList.toggle('nodata', !chs.length);
    this.list.innerHTML = chs.length ? '' : '<p class="mut empty">Nenhum canal selecionado — abra “Escolher canais”.</p>';
    this.panels = chs.map(ch => {
      const el = document.createElement('div');
      el.className = 'panel';
      el.innerHTML = `<div class="plabel"><div class="pname" title="${BT.esc(ch.name)}">${BT.esc(ch.name)}</div>` +
        `<div class="pval"><b>—</b> <span class="unit">${BT.esc(ch.unit || '')}</span></div><div class="prange"></div></div><canvas class="pcv"></canvas>`;
      this.list.appendChild(el);
      return { ch, el, cv: el.querySelector('.pcv'), val: el.querySelector('.pval b'), rng: el.querySelector('.prange'), dec: BT.decimalsFor(ch.lo, ch.hi) };
    });
    this.layout();
  }

  layout() {
    const rr = this.root.getBoundingClientRect();
    this.panels.forEach(p => {
      const r = p.cv.getBoundingClientRect();
      p.w = r.width; p.h = r.height; p.top = r.top - rr.top; p.left = r.left - rr.left;
    });
    const a = this.axis.getBoundingClientRect();
    this.ax = { left: a.left - rr.left, top: a.top - rr.top, w: a.width, h: a.height };
    this.rootW = rr.width; this.rootH = rr.height;
    this.dirty = true;
  }

  full() {
    const t = this.app.S.t;
    return [t[0], t[t.length - 1]];
  }

  setView(t0, t1) {
    const [a, b] = this.full();
    let w = Math.max(t1 - t0, Math.min(0.2, b - a));
    if (w > b - a) w = b - a;
    t0 = BT.clamp(t0, a, b - w);
    this.v = { t0, t1: t0 + w };
    this.dirty = true;
    if (this.app.onView) this.app.onView();
    this.app.requestRender();
  }

  zoom(f, tc) {
    const { t0, t1 } = this.v;
    tc = tc ?? (t0 + t1) / 2;
    this.setView(tc - (tc - t0) * f, tc + (t1 - tc) * f);
  }

  /* durante o play, mantém o cursor na tela */
  followCursor(tc) {
    const { t0, t1 } = this.v, w = t1 - t0;
    if (tc > t1 - 0.15 * w) this.setView(tc - 0.85 * w, tc + 0.15 * w);
    else if (tc < t0) this.setView(tc - 0.1 * w, tc + 0.9 * w);
  }

  tAtX(x) { return this.v.t0 + (x - this.ax.left) / this.ax.w * (this.v.t1 - this.v.t0); }
  xAtT(t) { return this.ax.left + (t - this.v.t0) / (this.v.t1 - this.v.t0) * this.ax.w; }

  /* ---------------------------------------------------------------- desenho */
  draw() {
    if (!this.app.S) return;
    if (this.dirty) {
      this.ticks = BT.niceTicks(this.v.t0, this.v.t1, Math.max(2, this.ax.w / 90));
      this.panels.forEach(p => this.drawPanel(p));
      this.drawAxis();
      this.dirty = false;
    }
    this.drawOverlay();
  }

  drawPanel(p) {
    const [g, w, h] = BT.setupCanvas(p.cv, p.w, p.h);
    const S = this.app.S, t = S.t, d = p.ch.data, { t0, t1 } = this.v;
    const i0 = Math.max(0, BT.idxAt(t, t0) - 1), i1 = Math.min(t.length - 1, BT.idxAt(t, t1) + 1);
    const r = BT.range(d, i0, i1);
    let lo = r.lo, hi = r.hi;
    if (!r.n) { lo = 0; hi = 1; }
    else if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    else { const pad = (hi - lo) * 0.08; lo -= pad; hi += pad; }
    const T = 5, B = 5, Y = v => T + (hi - v) / (hi - lo) * (h - T - B), X = tt => (tt - t0) / (t1 - t0) * w;

    /* grade: tempo + 3 níveis de valor */
    g.strokeStyle = BT.css('--grid'); g.lineWidth = 1; g.beginPath();
    this.ticks.forEach(tk => { const x = Math.round(X(tk)) + .5; g.moveTo(x, 0); g.lineTo(x, h); });
    const yt = BT.niceTicks(lo, hi, 3);
    yt.forEach(v => { const y = Math.round(Y(v)) + .5; g.moveTo(0, y); g.lineTo(w, y); });
    g.stroke();

    /* voltas */
    const laps = this.app.laps;
    if (laps.length) {
      g.strokeStyle = BT.css('--axis'); g.beginPath();
      laps.forEach(l => { if (l.t0 >= t0 && l.t0 <= t1) { const x = Math.round(X(l.t0)) + .5; g.moveTo(x, 0); g.lineTo(x, h); } });
      const last = laps[laps.length - 1];
      if (last.t1 >= t0 && last.t1 <= t1) { const x = Math.round(X(last.t1)) + .5; g.moveTo(x, 0); g.lineTo(x, h); }
      g.stroke();
    }

    /* série: min/máx por coluna de pixel (aguenta logs longos) */
    g.strokeStyle = BT.css('--series'); g.lineWidth = 1.5; g.lineJoin = 'round';
    g.beginPath();
    let pen = false, col = -1, mn = 0, mx = 0, first = 0, last = 0;
    const flush = () => {
      if (col < 0) return;
      if (pen) g.lineTo(col, Y(first)); else { g.moveTo(col, Y(first)); pen = true; }
      if (mx !== mn) { g.lineTo(col, Y(mn)); g.lineTo(col, Y(mx)); }
      g.lineTo(col, Y(last));
    };
    for (let i = i0; i <= i1; i++) {
      const v = d[i];
      if (v !== v) { flush(); col = -1; pen = false; continue; }
      const c = Math.round(X(t[i]));
      if (c !== col) { flush(); col = c; mn = mx = first = last = v; }
      else { if (v < mn) mn = v; if (v > mx) mx = v; last = v; }
    }
    flush();
    g.stroke();

    /* rótulos do eixo Y, discretos, dentro do gráfico */
    g.font = '10px system-ui'; g.fillStyle = BT.css('--muted');
    const dec = BT.decimalsFor(lo, hi);
    yt.forEach(v => { const y = Y(v); if (y > 10 && y < h - 2) g.fillText(v.toFixed(Math.max(0, dec - 1)), 4, y - 2); });
    if (!r.n) { g.fillStyle = BT.css('--muted'); g.fillText('sem dados neste trecho', 8, h / 2 + 4); }
    p.rng.textContent = r.n ? `${r.lo.toFixed(p.dec)} … ${r.hi.toFixed(p.dec)}` : '';
  }

  drawAxis() {
    const [g, w, h] = BT.setupCanvas(this.axis, this.ax.w, this.ax.h);
    const { t0, t1 } = this.v, X = tt => (tt - t0) / (t1 - t0) * w;
    const step = this.ticks.length > 1 ? this.ticks[1] - this.ticks[0] : 1;
    const dec = step < 0.1 ? 2 : step < 1 ? 1 : 0;
    g.strokeStyle = BT.css('--axis'); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, .5); g.lineTo(w, .5); g.stroke();
    g.font = '11px system-ui'; g.fillStyle = BT.css('--muted'); g.textAlign = 'center';
    this.ticks.forEach(tk => { const x = X(tk); if (x > 12 && x < w - 12) g.fillText(tk.toFixed(dec), x, 14); });
    g.fillStyle = BT.css('--fg2'); g.font = '600 10px system-ui';
    this.app.laps.forEach(l => { const x = X(l.t0); if (x >= 0 && x <= w) g.fillText('V' + l.n, x, 27); });
    g.textAlign = 'left';
  }

  drawOverlay() {
    const [g] = BT.setupCanvas(this.ov, this.rootW, this.rootH);
    const A = this.app, S = A.S, t = S.t;
    const top = this.panels.length ? this.panels[0].top : this.ax.top, bot = this.ax.top + 4;
    /* seleção para zoom */
    if (this.sel) {
      const a = Math.min(this.sel.x0, this.sel.x1), b = Math.max(this.sel.x0, this.sel.x1);
      g.fillStyle = BT.css('--sel'); g.fillRect(a, top, b - a, bot - top);
    }
    /* hover */
    if (this.hoverT !== null && !this.sel) {
      const x = Math.round(this.xAtT(this.hoverT)) + .5;
      g.strokeStyle = BT.css('--muted'); g.lineWidth = 1; g.beginPath(); g.moveTo(x, top); g.lineTo(x, bot); g.stroke();
    }
    /* cursor */
    const cx = this.xAtT(A.cur);
    if (cx >= this.ax.left - 1 && cx <= this.ax.left + this.ax.w + 1) {
      const x = Math.round(cx) + .5;
      g.strokeStyle = BT.css('--fg'); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, top); g.lineTo(x, bot); g.stroke();
      g.fillStyle = BT.css('--fg');
      g.beginPath(); g.moveTo(x - 5, top - 1); g.lineTo(x + 5, top - 1); g.lineTo(x, top + 5); g.fill();
    }
    /* valores no cursor */
    const i = BT.idxAt(t, A.cur);
    this.panels.forEach(p => { p.val.textContent = BT.fmtVal(p.ch.data[i], p.dec); });
  }

  /* ---------------------------------------------------------------- interação */
  bind() {
    const root = this.root;
    const pos = e => { const r = root.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const inPlot = x => x >= this.ax.left && x <= this.ax.left + this.ax.w;
    let scrub = false;

    root.addEventListener('pointerdown', e => {
      if (!this.app.S || !e.target.matches('.pcv,.axis')) return;
      const [x] = pos(e);
      e.target.setPointerCapture(e.pointerId);
      if (e.shiftKey) this.sel = { x0: x, x1: x };
      else { scrub = true; this.app.seek(this.tAtX(x)); }
      e.preventDefault();
    });
    root.addEventListener('pointermove', e => {
      if (!this.app.S) return;
      const [x, y] = pos(e);
      const xc = BT.clamp(x, this.ax.left, this.ax.left + this.ax.w);
      if (this.sel) { this.sel.x1 = xc; this.app.requestRender(); return; }
      if (scrub) { this.app.seek(this.tAtX(xc)); return; }
      if (!inPlot(x) || !e.target.matches('.pcv,.axis')) { this.hideHover(); return; }
      this.hoverT = this.tAtX(x);
      const p = this.panels.find(q => y >= q.top && y <= q.top + q.h);
      if (p) {
        const i = BT.idxAt(this.app.S.t, this.hoverT);
        this.tip.hidden = false;
        this.tip.innerHTML = `<b>${BT.esc(p.ch.name)}</b> ${BT.fmtVal(p.ch.data[i], p.dec)} ${BT.esc(p.ch.unit || '')}<br><span>t ${this.app.S.t[i].toFixed(2)} s</span>`;
        const tw = this.tip.offsetWidth;
        this.tip.style.left = (x + 12 + tw > this.rootW ? x - tw - 12 : x + 12) + 'px';
        this.tip.style.top = (p.top + 4) + 'px';
      } else this.tip.hidden = true;
      this.app.requestRender();
    });
    const end = () => {
      if (this.sel) {
        const a = Math.min(this.sel.x0, this.sel.x1), b = Math.max(this.sel.x0, this.sel.x1);
        this.sel = null;
        if (b - a > 6) this.setView(this.tAtX(a), this.tAtX(b)); else this.app.requestRender();
      }
      scrub = false;
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('pointerleave', () => this.hideHover());
    root.addEventListener('wheel', e => {
      if (!this.app.S) return;
      const [x] = pos(e);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.zoom(Math.exp(e.deltaY * (e.deltaMode ? 0.05 : 0.002)), inPlot(x) ? this.tAtX(x) : undefined);
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const d = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * (e.deltaMode ? 20 : 1);
        const dt = d / this.ax.w * (this.v.t1 - this.v.t0);
        this.setView(this.v.t0 + dt, this.v.t1 + dt);
      }
    }, { passive: false });
    root.addEventListener('dblclick', e => { if (this.app.S && e.target.matches('.pcv,.axis')) this.app.resetChartView(); });
  }

  hideHover() {
    if (this.hoverT !== null) { this.hoverT = null; this.app.requestRender(); }
    this.tip.hidden = true;
  }
};
