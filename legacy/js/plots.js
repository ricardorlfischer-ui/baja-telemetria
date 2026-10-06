/* Gráfico XY genérico em canvas para as análises: linhas, barras e dispersão, com eixos,
 * grade discreta, marcadores verticais, legenda e cruz de leitura no hover.
 *
 *   const p = new BT.Plot(div);
 *   p.set({ series: [{ x, y, color, label, width, alpha }], bars: { x0, w, y, colors },
 *           points: { x, y, color }, xLabel, yLabel, logY, equal, xRange, yRange,
 *           zeroY, circles: [r...], markers: [{ x, color, label }], hi: { x, y },
 *           onClick: x => ..., tipX: x => 'texto', empty: 'mensagem' });
 */
'use strict';

BT.Plot = class {
  constructor(host) {
    this.host = host;
    host.classList.add('plot');
    host.innerHTML = '<div class="plegend"></div><div class="pbox"><canvas></canvas><div class="ptip" hidden></div></div>';
    this.leg = host.querySelector('.plegend');
    this.box = host.querySelector('.pbox');
    this.c = host.querySelector('canvas');
    this.tip = host.querySelector('.ptip');
    this.hx = null;
    this.c.addEventListener('pointermove', e => this.move(e));
    this.c.addEventListener('pointerleave', () => { this.hx = null; this.tip.hidden = true; this.draw(); });
    this.c.addEventListener('click', e => {
      if (!this.geo || !this.spec.onClick) return;
      const r = this.c.getBoundingClientRect();
      this.spec.onClick(this.geo.ix(e.clientX - r.left));
    });
  }

  set(spec) {
    this.spec = spec;
    const L = spec.legend || (spec.series && spec.series.length > 1 ? spec.series.filter(s => s.label) : []);
    this.leg.innerHTML = L.map(s => `<span><i style="background:${s.color}"></i>${BT.esc(s.label)}</span>`).join('');
    this.leg.hidden = !L.length;
    this.draw();
  }

  /* posição do ponto atual (cursor do log) sem recalcular o resto */
  setHi(hi) { if (this.spec) { this.spec.hi = hi; this.draw(); } }

  draw() {
    const s = this.spec;
    const [g, w, h] = BT.setupCanvas(this.c);
    if (!s || !w) return;
    const ink = BT.css('--fg'), mut = BT.css('--muted'), grid = BT.css('--grid'), axis = BT.css('--axis');
    g.font = '11px system-ui';
    if (s.empty) { g.fillStyle = mut; g.fillText(s.empty, 12, 24); this.geo = null; return; }

    /* faixas */
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const acc = (xs, ys) => {
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i], y = ys[i];
        if (x !== x || y !== y || (s.logY && !(y > 0))) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    };
    (s.series || []).forEach(q => acc(q.x, q.y));
    if (s.points) acc(s.points.x, s.points.y);
    if (s.bars) { const b = s.bars; x0 = Math.min(x0, b.x0); x1 = Math.max(x1, b.x0 + b.w * b.y.length); for (const v of b.y) { if (v > y1) y1 = v; } y0 = Math.min(y0, 0); }
    (s.hlines || []).forEach(l => { if (l.y > y1) y1 = l.y; if (l.y < y0) y0 = l.y; });
    if (s.xRange) [x0, x1] = s.xRange;
    if (s.yRange) [y0, y1] = s.yRange;
    if (!isFinite(x0) || !isFinite(y0)) { g.fillStyle = mut; g.fillText('sem dados', 12, 24); this.geo = null; return; }
    if (x1 <= x0) x1 = x0 + 1;
    if (y1 <= y0) { y1 = y0 + (Math.abs(y0) || 1); }
    if (s.zeroY) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
    if (!s.yRange && !s.logY && !s.bars) { const p = (y1 - y0) * 0.06; y0 -= p; y1 += p; }
    if (s.bars && !s.yRange) y1 *= 1.08;
    if (s.logY) { y0 = Math.pow(10, Math.floor(Math.log10(y0))); y1 = Math.pow(10, Math.ceil(Math.log10(y1))); }

    const P = { l: 48, r: 12, t: 8, b: s.xLabel ? 36 : 22 };
    let pw = w - P.l - P.r, ph = h - P.t - P.b;
    if (s.equal) {                        /* mesma escala nos dois eixos (diagrama g-g) */
      const u = Math.min(pw / (x1 - x0), ph / (y1 - y0)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      x0 = cx - pw / u / 2; x1 = cx + pw / u / 2; y0 = cy - ph / u / 2; y1 = cy + ph / u / 2;
    }
    const ty = v => (s.logY ? Math.log10(v) : v), Y0 = ty(y0), Y1 = ty(y1);
    const X = x => P.l + (x - x0) / (x1 - x0) * pw;
    const Y = y => P.t + (Y1 - ty(y)) / (Y1 - Y0) * ph;
    this.geo = { X, Y, P, pw, ph, x0, x1, ix: px => x0 + (px - P.l) / pw * (x1 - x0) };

    /* grade e eixos */
    const xt = BT.niceTicks(x0, x1, Math.max(2, pw / 80));
    let yt;
    if (s.logY) { yt = []; for (let e = Math.round(Math.log10(y0)); e <= Math.round(Math.log10(y1)); e++) yt.push(Math.pow(10, e)); }
    else yt = BT.niceTicks(y0, y1, Math.max(2, ph / 42));
    g.strokeStyle = grid; g.lineWidth = 1; g.beginPath();
    xt.forEach(v => { const x = Math.round(X(v)) + .5; g.moveTo(x, P.t); g.lineTo(x, P.t + ph); });
    yt.forEach(v => { const y = Math.round(Y(v)) + .5; g.moveTo(P.l, y); g.lineTo(P.l + pw, y); });
    g.stroke();
    if (s.circles) {
      g.strokeStyle = axis;
      s.circles.forEach(r => { g.beginPath(); g.ellipse(X(0), Y(0), Math.abs(X(r) - X(0)), Math.abs(Y(r) - Y(0)), 0, 0, 7); g.stroke(); });
      g.fillStyle = mut; s.circles.forEach(r => g.fillText(r + ' g', X(0) + 3, Y(r) - 3));
    }
    g.strokeStyle = axis; g.beginPath();
    const yb = s.zeroY || s.circles ? Math.round(Y(0)) + .5 : P.t + ph + .5;
    g.moveTo(P.l, yb); g.lineTo(P.l + pw, yb);
    if (s.circles) { const xz = Math.round(X(0)) + .5; g.moveTo(xz, P.t); g.lineTo(xz, P.t + ph); }
    g.stroke();
    g.fillStyle = mut; g.textAlign = 'center';
    const xd = xt.length > 1 ? Math.max(0, -Math.floor(Math.log10(xt[1] - xt[0]))) : 0;
    xt.forEach(v => g.fillText(v.toFixed(xd), X(v), P.t + ph + 14));
    g.textAlign = 'right';
    const yd = s.logY ? 0 : yt.length > 1 ? Math.max(0, -Math.floor(Math.log10(yt[1] - yt[0]))) : 0;
    yt.forEach(v => g.fillText(s.logY ? fmtLog(v) : v.toFixed(yd), P.l - 5, Y(v) + 4));
    g.textAlign = 'left';
    if (s.xLabel) { g.textAlign = 'center'; g.fillText(s.xLabel, P.l + pw / 2, h - 4); g.textAlign = 'left'; }
    if (s.yLabel) { g.save(); g.translate(11, P.t + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(s.yLabel, 0, 0); g.restore(); }

    g.save();
    g.beginPath(); g.rect(P.l, P.t - 1, pw, ph + 2); g.clip();
    /* barras com 2 px de folga entre elas */
    if (s.bars) {
      const b = s.bars;
      for (let k = 0; k < b.y.length; k++) {
        if (!(b.y[k] > 0)) continue;
        const xa = X(b.x0 + k * b.w) + 1, xb = X(b.x0 + (k + 1) * b.w) - 1, ya = Y(b.y[k]), yz = Y(0);
        g.fillStyle = b.colors ? b.colors[k] : BT.css('--series');
        roundTop(g, xa, ya, Math.max(1, xb - xa), yz - ya, Math.min(3, (xb - xa) / 2));
      }
    }
    /* dispersão */
    if (s.points) {
      const p = s.points;
      g.fillStyle = p.color || BT.css('--series'); g.globalAlpha = p.alpha ?? 0.35;
      for (let i = 0; i < p.x.length; i++) { const x = p.x[i], y = p.y[i]; if (x === x && y === y) g.fillRect(X(x) - 1.5, Y(y) - 1.5, 3, 3); }
      g.globalAlpha = 1;
    }
    /* linhas */
    (s.series || []).forEach(q => {
      g.strokeStyle = q.color; g.lineWidth = q.width || 1.75; g.globalAlpha = q.alpha ?? 1; g.lineJoin = 'round';
      g.beginPath();
      let pen = false;
      for (let i = 0; i < q.x.length; i++) {
        const x = q.x[i], y = q.y[i];
        if (x !== x || y !== y || (s.logY && !(y > 0))) { pen = false; continue; }
        if (pen) g.lineTo(X(x), Y(y)); else { g.moveTo(X(x), Y(y)); pen = true; }
      }
      g.stroke(); g.globalAlpha = 1;
      if (q.dots) { g.fillStyle = q.color; q.dots.forEach(d => { g.beginPath(); g.arc(X(d.x), Y(d.y), 4, 0, 7); g.fill(); }); }
    });
    /* marcadores verticais */
    (s.markers || []).forEach(m => {
      const x = Math.round(X(m.x)) + .5;
      g.strokeStyle = m.color || ink; g.lineWidth = m.width || 1.25;
      g.beginPath(); g.moveTo(x, P.t); g.lineTo(x, P.t + ph); g.stroke();
      if (m.label) { g.fillStyle = m.color || ink; g.font = '600 10px system-ui'; g.fillText(m.label, x + 3, P.t + 10 + (m.row || 0) * 12); g.font = '11px system-ui'; }
    });
    /* linhas horizontais de referência (limites) */
    (s.hlines || []).forEach(l => {
      const y = Math.round(Y(l.y)) + .5;
      g.strokeStyle = l.color || ink; g.lineWidth = 1.25;
      g.beginPath(); g.moveTo(P.l, y); g.lineTo(P.l + pw, y); g.stroke();
      if (l.label) { g.fillStyle = l.color || ink; g.font = '600 10px system-ui'; g.textAlign = 'right'; g.fillText(l.label, P.l + pw - 4, y - 4); g.textAlign = 'left'; g.font = '11px system-ui'; }
    });
    /* ponto atual */
    if (s.hi && s.hi.x === s.hi.x && s.hi.y === s.hi.y) {
      g.fillStyle = ink; g.strokeStyle = BT.css('--card'); g.lineWidth = 2;
      g.beginPath(); g.arc(X(s.hi.x), Y(s.hi.y), 5.5, 0, 7); g.stroke(); g.fill();
    }
    /* cruz de leitura */
    if (this.hx !== null && !s.equal) {
      const x = Math.round(X(this.hx)) + .5;
      g.strokeStyle = mut; g.lineWidth = 1; g.beginPath(); g.moveTo(x, P.t); g.lineTo(x, P.t + ph); g.stroke();
      (s.series || []).forEach(q => {
        const v = valAt(q, this.hx);
        if (v === v && (!s.logY || v > 0)) { g.fillStyle = q.color; g.strokeStyle = BT.css('--card'); g.lineWidth = 2; g.beginPath(); g.arc(X(this.hx), Y(v), 4, 0, 7); g.stroke(); g.fill(); }
      });
    }
    g.restore();
  }

  move(e) {
    if (!this.geo || this.spec.equal) return;
    const r = this.c.getBoundingClientRect(), px = e.clientX - r.left;
    const G = this.geo;
    if (px < G.P.l || px > G.P.l + G.pw) { this.hx = null; this.tip.hidden = true; this.draw(); return; }
    this.hx = G.ix(px);
    const s = this.spec;
    let html = s.tipX ? s.tipX(this.hx) : `<b>${this.hx.toFixed(2)}</b>`;
    if (s.bars && s.tipBar) { const k = Math.floor((this.hx - s.bars.x0) / s.bars.w); if (k >= 0 && k < s.bars.y.length) html = s.tipBar(k); }
    (s.series || []).forEach(q => {
      if (!q.label) return;
      const v = valAt(q, this.hx);
      html += `<br><i style="background:${q.color}"></i>${BT.esc(q.label)} <b>${v === v ? (s.fmtY ? s.fmtY(v) : v.toFixed(2)) : '—'}</b>`;
    });
    this.tip.innerHTML = html;
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth;
    this.tip.style.left = (px + 14 + tw > r.width ? px - tw - 14 : px + 14) + 'px';
    this.tip.style.top = '6px';
    this.draw();
  }
};

function valAt(q, x) {
  const xs = q.x, n = xs.length;
  if (!n || x < xs[0] || x > xs[n - 1]) return NaN;
  return BT.interpAt(xs, q.y, x);
}
function fmtLog(v) {
  if (v >= 0.01 && v < 1e4) return String(+v.toPrecision(1));
  return v.toExponential(0).replace('e', 'e');
}
function roundTop(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x, y + h); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h);
  g.closePath(); g.fill();
}
