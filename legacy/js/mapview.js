/* Mapa da pista em canvas: metros Leste/Norte em torno do centro da pista.
 * Roda/pinça = zoom, arrastar = mover, clique = ir para aquele ponto do log,
 * duplo clique = enquadrar. Fundo de satélite opcional (Esri World Imagery, precisa de
 * internet e do centro em lat/lon). Camada estática em cache; por quadro só o carro. */
'use strict';

BT.MapView = class {
  constructor(canvas, app) {
    this.c = canvas; this.app = app;
    this.v = { cx: 0, cy: 0, s: 2 };            /* centro (m) e escala (px/m) */
    this.w = 0; this.h = 0;
    this.sat = !!BT.store.get('sat', false);
    this.follow = false;
    this.lineMode = false; this.linePts = [];
    this.hover = -1;
    this.tiles = new Map();
    this.off = document.createElement('canvas');
    this.dirty = true;
    this.ptr = new Map();
    this.bind();
  }

  invalidate() { this.dirty = true; this.app.requestRender(); }

  resize() {
    const r = this.c.getBoundingClientRect();
    const changed = Math.abs(r.width - this.w) > 1 || Math.abs(r.height - this.h) > 1;
    this.w = r.width; this.h = r.height;
    this.dirty = true;
    if (changed && !this.userView && this.app.S) this.fit();     /* sem zoom manual: reenquadra */
  }

  /* enquadra os pontos (do trecho selecionado, ou tudo) */
  fit() {
    const A = this.app, tr = A.track;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    if (tr && tr.ok) {
      const [a, b] = A.range();
      for (let i = a; i <= b; i++) if (tr.valid[i]) {
        const x = tr.x[i], y = tr.y[i];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (!isFinite(x0)) { const sp = BT.spanOf(A.cfg); x0 = -sp.x / 2; x1 = sp.x / 2; y0 = -sp.y / 2; y1 = sp.y / 2; }
    const pad = 36, dw = Math.max(x1 - x0, 10), dh = Math.max(y1 - y0, 10);
    this.v.s = Math.min((this.w - 2 * pad) / dw, (this.h - 2 * pad) / dh);
    this.v.cx = (x0 + x1) / 2; this.v.cy = (y0 + y1) / 2;
    this.userView = false;
    this.invalidate();
  }

  sx(x) { return this.w / 2 + (x - this.v.cx) * this.v.s; }
  sy(y) { return this.h / 2 - (y - this.v.cy) * this.v.s; }
  wx(px) { return (px - this.w / 2) / this.v.s + this.v.cx; }
  wy(py) { return -(py - this.h / 2) / this.v.s + this.v.cy; }

  zoomAt(px, py, f) {
    const x = this.wx(px), y = this.wy(py);
    this.v.s = BT.clamp(this.v.s * f, 0.05, 200);
    this.v.cx = x - (px - this.w / 2) / this.v.s;
    this.v.cy = y + (py - this.h / 2) / this.v.s;
    this.userView = true;
    this.invalidate();
  }

  /* ---------------------------------------------------------------- desenho */
  draw() {
    const A = this.app;
    if (!this.w) this.resize();
    if (this.follow && A.track && A.track.ok) {
      const p = BT.posAt(A.S, A.track, A.cur);
      if (p) { this.v.cx = p.x; this.v.cy = p.y; this.dirty = true; }
    }
    if (this.dirty) { this.drawStatic(); this.dirty = false; }
    const [g, w, h] = BT.setupCanvas(this.c, this.w, this.h);
    g.drawImage(this.off, 0, 0, w, h);
    this.drawDynamic(g);
  }

  drawStatic() {
    const A = this.app, tr = A.track;
    const [g, w, h] = BT.setupCanvas(this.off, this.w, this.h);
    g.fillStyle = BT.css('--surface'); g.fillRect(0, 0, w, h);
    const showSat = this.sat && tr && tr.center;
    if (showSat) this.drawTiles(g, tr.center);
    else this.drawGrid(g);

    /* área coberta pelos códigos 0..255 (fora disso o valor trava na borda) */
    if (A.S && !A.S.gps) {
      const sp = tr ? tr.span : BT.spanOf(A.cfg);
      g.strokeStyle = showSat ? 'rgba(255,255,255,.55)' : BT.css('--axis'); g.lineWidth = 1;
      g.strokeRect(this.sx(-sp.x / 2), this.sy(sp.y / 2), sp.x * this.v.s, sp.y * this.v.s);
    }

    if (tr && tr.ok) {
      const X = tr.x, Y = tr.y, V = tr.valid, n = X.length;
      const [a, b] = A.range();
      const path = (i0, i1) => {
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
      g.strokeStyle = showSat ? 'rgba(255,255,255,.35)' : BT.css('--muted-line'); g.lineWidth = 2; g.stroke();
      /* trecho selecionado colorido pelo canal escolhido: contorno + 24 faixas de cor */
      const val = A.colorValues();
      const r = BT.pctRange(val, a, b, 0.02);
      const lo = r.lo, hi = r.hi > r.lo ? r.hi : r.lo + 1;
      const dark = showSat || BT.isDark();
      path(a, b);
      g.strokeStyle = 'rgba(12,12,12,.70)'; g.lineWidth = 6; g.stroke();
      const NB = 24, paths = Array.from({ length: NB }, () => new Path2D());
      for (let i = a + 1; i <= b; i++) {
        if (!V[i] || !V[i - 1]) continue;
        const v = val[i];
        const k = v === v ? BT.clamp(Math.floor((v - lo) / (hi - lo) * NB), 0, NB - 1) : 0;
        paths[k].moveTo(this.sx(X[i - 1]), this.sy(Y[i - 1]));
        paths[k].lineTo(this.sx(X[i]), this.sy(Y[i]));
      }
      g.lineWidth = 3.5;
      paths.forEach((p, k) => { g.strokeStyle = BT.heat((k + 0.5) / NB, dark); g.stroke(p); });
      A.setLegend(r.n ? lo : NaN, r.n ? hi : NaN, dark);
    } else if (A.S) A.setLegend(NaN, NaN, BT.isDark());

    /* linha de largada */
    const L = A.getLine();
    if (L) {
      g.lineCap = 'butt';
      g.strokeStyle = 'rgba(12,12,12,.8)'; g.lineWidth = 6;
      g.beginPath(); g.moveTo(this.sx(L[0].x), this.sy(L[0].y)); g.lineTo(this.sx(L[1].x), this.sy(L[1].y)); g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.setLineDash([5, 5]);
      g.stroke(); g.setLineDash([]);
    }
    this.linePts.forEach(p => { g.fillStyle = BT.css('--fg'); g.fillRect(this.sx(p.x) - 4, this.sy(p.y) - 4, 8, 8); });

    this.drawScale(g, w, h, showSat);
    if (showSat) {
      g.font = '10px system-ui'; g.fillStyle = 'rgba(255,255,255,.85)'; g.textAlign = 'right';
      g.fillText('Imagem: Esri World Imagery', w - 6, h - 6); g.textAlign = 'left';
    }
  }

  drawGrid(g) {
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(s => s * this.v.s >= 40) || 1000;
    const x0 = Math.floor(this.wx(0) / step) * step, x1 = this.wx(this.w);
    const y0 = Math.floor(this.wy(this.h) / step) * step, y1 = this.wy(0);
    g.strokeStyle = BT.css('--grid'); g.lineWidth = 1; g.beginPath();
    for (let x = x0; x <= x1; x += step) { const p = Math.round(this.sx(x)) + .5; g.moveTo(p, 0); g.lineTo(p, this.h); }
    for (let y = y0; y <= y1; y += step) { const p = Math.round(this.sy(y)) + .5; g.moveTo(0, p); g.lineTo(this.w, p); }
    g.stroke();
    /* eixos pelo centro da pista */
    g.strokeStyle = BT.css('--axis'); g.beginPath();
    const ox = Math.round(this.sx(0)) + .5, oy = Math.round(this.sy(0)) + .5;
    g.moveTo(ox, 0); g.lineTo(ox, this.h); g.moveTo(0, oy); g.lineTo(this.w, oy); g.stroke();
    g.fillStyle = BT.css('--muted'); g.font = '10px system-ui';
    g.fillText('N ↑', ox + 4, 12);
  }

  drawScale(g, w, h, onSat) {
    const m = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(s => s * this.v.s >= 60) || 1000;
    const L = m * this.v.s, x = 12, y = h - 14;
    g.strokeStyle = onSat ? '#fff' : BT.css('--fg2'); g.lineWidth = 2; g.lineCap = 'butt';
    g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x, y); g.lineTo(x + L, y); g.lineTo(x + L, y - 4); g.stroke();
    g.fillStyle = onSat ? '#fff' : BT.css('--fg2'); g.font = '11px system-ui';
    g.fillText(m + ' m', x + L + 6, y + 1);
  }

  drawTiles(g, c) {
    const mpd = BT.mPerDeg(c.lat), dpr = window.devicePixelRatio || 1;
    const mpp = 1 / this.v.s / dpr;
    const z = BT.clamp(Math.round(Math.log2(156543.03392 * Math.cos(c.lat * Math.PI / 180) / mpp)), 1, 19);
    const N = 1 << z;
    const toLL = (x, y) => ({ lat: c.lat + y / mpd.lat, lon: c.lon + x / mpd.lon });
    const tx = lon => (lon + 180) / 360 * N;
    const ty = lat => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * N; };
    const lonOf = x => x / N * 360 - 180;
    const latOf = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / N))) * 180 / Math.PI;
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

  tile(z, x, y) {
    const k = z + '/' + x + '/' + y;
    let img = this.tiles.get(k);
    if (!img) {
      img = new Image();
      img.onload = () => this.invalidate();
      img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
      this.tiles.set(k, img);
      if (this.tiles.size > 400) this.tiles.delete(this.tiles.keys().next().value);
    }
    return img;
  }

  drawDynamic(g) {
    const A = this.app, tr = A.track;
    if (!tr || !tr.ok) return;
    if (this.hover >= 0 && tr.valid[this.hover]) {
      g.strokeStyle = BT.css('--fg'); g.lineWidth = 2;
      g.beginPath(); g.arc(this.sx(tr.x[this.hover]), this.sy(tr.y[this.hover]), 7, 0, 7); g.stroke();
    }
    const p = BT.posAt(A.S, tr, A.cur);
    if (!p) return;
    const x = this.sx(p.x), y = this.sy(p.y), h = p.h || 0;
    g.save(); g.translate(x, y); g.rotate(h);
    g.beginPath(); g.moveTo(0, -16); g.lineTo(10, 11); g.lineTo(0, 5); g.lineTo(-10, 11); g.closePath();
    g.fillStyle = BT.css('--car'); g.strokeStyle = BT.css('--surface'); g.lineWidth = 3;
    g.stroke(); g.fill();
    g.restore();
  }

  /* ---------------------------------------------------------------- interação */
  nearest(px, py, maxPx) {
    const A = this.app, tr = A.track;
    if (!tr || !tr.ok) return -1;
    const [a, b] = A.range();
    let bi = -1, bd = maxPx * maxPx;
    for (let i = a; i <= b; i++) {
      if (!tr.valid[i]) continue;
      const dx = this.sx(tr.x[i]) - px, dy = this.sy(tr.y[i]) - py, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  }

  bind() {
    const c = this.c, tip = BT.$('mapTip');
    const local = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    let drag = null, pinch = null;

    c.addEventListener('wheel', e => {
      e.preventDefault();
      const [x, y] = local(e);
      this.zoomAt(x, y, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)));
    }, { passive: false });

    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      this.ptr.set(e.pointerId, local(e));
      if (this.ptr.size === 2) {
        const [p, q] = [...this.ptr.values()];
        pinch = { d: Math.hypot(p[0] - q[0], p[1] - q[1]) }; drag = null;
      } else {
        const [x, y] = local(e);
        drag = { x, y, cx: this.v.cx, cy: this.v.cy, moved: false };
      }
    });
    c.addEventListener('pointermove', e => {
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
          if (this.follow) this.app.setFollowMap(false);
          this.invalidate();
        }
        return;
      }
      /* hover: mostra o ponto mais próximo e seus valores */
      const i = this.lineMode ? -1 : this.nearest(x, y, 18);
      if (i !== this.hover) { this.hover = i; this.app.requestRender(); }
      if (i >= 0) {
        tip.hidden = false;
        tip.style.left = Math.min(x + 14, this.w - 170) + 'px'; tip.style.top = Math.max(y - 44, 4) + 'px';
        tip.innerHTML = this.app.tipHtml(i);
      } else tip.hidden = true;
    });
    const up = e => {
      this.ptr.delete(e.pointerId);
      if (pinch) { if (this.ptr.size < 2) pinch = null; drag = null; return; }
      if (drag && !drag.moved) {
        const [x, y] = local(e);
        if (this.lineMode) {
          this.linePts.push({ x: this.wx(x), y: this.wy(y) });
          if (this.linePts.length === 2) { this.app.setLine(this.linePts); this.linePts = []; this.lineMode = false; this.app.syncLineButton(); }
          this.invalidate();
        } else {
          const i = this.nearest(x, y, 30);
          if (i >= 0) this.app.seek(this.app.S.t[i]);
        }
      }
      drag = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { if (this.hover !== -1) { this.hover = -1; this.app.requestRender(); } tip.hidden = true; });
    c.addEventListener('dblclick', () => this.fit());
  }
};
