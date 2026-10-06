/* Painel "Análises": mapas por canal, suspensão, ressonância, dinâmica e comparação de
 * voltas. Só a aba visível é calculada; as outras ficam marcadas para recalcular. */
'use strict';
(() => {
const $ = BT.$;
const fx = (v, d = 1) => (v === v && v !== null && isFinite(v) ? v.toFixed(d) : '—');
const pct = v => (v === v ? (v * 100).toFixed(0) + ' %' : '—');
const cornerColor = id => BT.css({ FL: '--c1', FR: '--c2', RL: '--c3', RR: '--c4' }[id]);
const TABS = { design: 'renderDesign', maps: 'renderMaps', susp: 'renderSusp', freq: 'renderFreq', power: 'renderPower', cvt: 'renderCvt', dyn: 'renderDyn', laps: 'renderLaps' };
BT.cornerColor = cornerColor;

BT.Analysis = class {
  constructor(app) {
    this.A = app;
    this.tab = BT.store.get('anaTab', 'maps');
    this.win = BT.store.get('anaWin', 'session');
    this.dirty = new Set(Object.keys(TABS));
    this.plots = {};
    this.minis = [];
    this.visible = true;
    this.drop = null;            /* resultado do teste de queda selecionado */
    $('anaWin').value = this.win;
    document.querySelectorAll('#anaTabs [data-tab]').forEach(b => {
      b.onclick = () => { this.tab = b.dataset.tab; BT.store.set('anaTab', this.tab); this.showTab(); };
    });
    $('anaWin').onchange = e => { this.win = e.target.value; BT.store.set('anaWin', this.win); this.invalidate(['design', 'susp', 'freq', 'power', 'cvt', 'dyn']); };
    new IntersectionObserver(es => { this.visible = es[0].isIntersecting; if (this.visible) this.render(); }).observe($('anaCard'));
    this.bindSettings();
    this.showTab();
  }

  plot(id) { return this.plots[id] || (this.plots[id] = new BT.Plot($(id))); }

  showTab() {
    document.querySelectorAll('#anaTabs [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === this.tab));
    document.querySelectorAll('.ana-panel').forEach(p => { p.hidden = p.id !== 'ana-' + this.tab; });
    $('anaWinBox').hidden = ['maps', 'laps'].includes(this.tab);
    this.render();
  }

  invalidate(tabs) {
    (tabs || Object.keys(TABS)).forEach(t => this.dirty.add(t));
    clearTimeout(this.tm);
    this.tm = setTimeout(() => this.render(), 30);
  }

  /* zoom/arrasto nos gráficos: só importa se o trecho for "janela do gráfico" */
  onView() { if (this.win === 'view') this.invalidate(['design', 'susp', 'freq', 'power', 'cvt', 'dyn']); }

  /* trecho analisado */
  range() {
    const A = this.A, t = A.S.t, n = t.length;
    if (this.win === 'lap' && A.sel >= 0) { const l = A.laps[A.sel]; return [l.i0, l.i1, `volta ${l.n}`]; }
    if (this.win === 'view') {
      const v = A.charts.v;
      return [BT.idxAt(t, v.t0), BT.idxAt(t, v.t1), `${v.t0.toFixed(1)}–${v.t1.toFixed(1)} s`];
    }
    return [0, n - 1, this.win === 'lap' ? 'sessão inteira (nenhuma volta selecionada)' : 'sessão inteira'];
  }

  render() {
    const A = this.A;
    if (!this.visible || !this.dirty.has(this.tab)) return;
    this.dirty.delete(this.tab);
    const panel = $('ana-' + this.tab), empty = panel.querySelector('.ana-empty'), body = panel.querySelector('.ana-body');
    empty.hidden = !!A.S; body.hidden = !A.S;
    if (!A.S) { empty.textContent = 'Abra um log para ver as análises.'; return; }
    try {
      this[TABS[this.tab]]();
    } catch (e) {
      console.error(e);
      empty.hidden = false; empty.textContent = 'Erro na análise: ' + e.message;
    }
    this.frame(true);
  }

  /* coisas que dependem do cursor (chamado a cada quadro) */
  frame(force) {
    const A = this.A;
    if (!A.S || !this.visible) return;
    const now = performance.now();
    if (!force && now - (this.lastFrame || 0) < 40) return;
    this.lastFrame = now;
    const i = BT.idxAt(A.S.t, A.cur);
    if (this.tab === 'maps') this.frameMaps(i);
    else if (this.tab === 'dyn' && this.acc && this.plots.dyGG) {
      this.plots.dyGG.setHi({ x: this.acc.lat[i], y: this.acc.lon[i] });
    } else if (this.tab === 'laps' && this.cmp) this.frameLaps(i);
  }

  /* ---------------------------------------------------------------- mapas por canal */
  renderMaps() {
    const A = this.A, tr = A.track, body = $('mmGrid');
    if (!tr || !tr.ok) { body.innerHTML = `<p class="mut pad">${BT.esc(tr ? tr.msg : 'Sem GPS')}</p>`; this.minis = []; return; }
    const inc = $('mmConst').checked;
    const list = A.all.filter(c => inc || !c.constant);
    body.innerHTML = list.map(c => `<figure class="mm" data-k="${BT.esc(c.key)}" title="Clique para colorir o mapa principal por este canal">` +
      `<figcaption><b>${BT.esc(c.name)}</b><span class="mm-r"></span></figcaption><canvas></canvas>` +
      `<div class="mm-f"><i class="mm-bar"></i><span class="mm-v">—</span></div></figure>`).join('');
    const [a, b] = A.range();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = a; i <= b; i++) if (tr.valid[i]) {
      if (tr.x[i] < x0) x0 = tr.x[i]; if (tr.x[i] > x1) x1 = tr.x[i];
      if (tr.y[i] < y0) y0 = tr.y[i]; if (tr.y[i] > y1) y1 = tr.y[i];
    }
    const dark = BT.isDark();
    this.minis = [...body.querySelectorAll('.mm')].map(fig => {
      const c = A.channel(fig.dataset.k), cv = fig.querySelector('canvas');
      const r = cv.getBoundingClientRect(), w = r.width, h = r.height, pad = 10;
      const s = Math.min((w - 2 * pad) / Math.max(x1 - x0, 5), (h - 2 * pad) / Math.max(y1 - y0, 5));
      const ox = (w - (x1 - x0) * s) / 2, oy = (h - (y1 - y0) * s) / 2;
      const X = x => ox + (x - x0) * s, Y = y => h - oy - (y - y0) * s;
      const off = document.createElement('canvas');
      const [g] = BT.setupCanvas(off, w, h);
      const q = BT.pctRange(c.data, a, b, 0.02);
      const lo = q.lo, hi = q.hi > q.lo ? q.hi : q.lo + 1;
      g.lineJoin = 'round'; g.lineCap = 'round';
      const full = new Path2D();
      let pen = false;
      for (let i = a; i <= b; i++) {
        if (!tr.valid[i]) { pen = false; continue; }
        if (pen) full.lineTo(X(tr.x[i]), Y(tr.y[i])); else { full.moveTo(X(tr.x[i]), Y(tr.y[i])); pen = true; }
      }
      g.strokeStyle = 'rgba(12,12,12,.55)'; g.lineWidth = 4.5; g.stroke(full);
      const NB = 16, P = Array.from({ length: NB }, () => new Path2D());
      let any = false;
      for (let i = a + 1; i <= b; i++) {
        if (!tr.valid[i] || !tr.valid[i - 1]) continue;
        const v = c.data[i];
        if (v !== v) continue;
        any = true;
        const k = BT.clamp(Math.floor((v - lo) / (hi - lo) * NB), 0, NB - 1);
        P[k].moveTo(X(tr.x[i - 1]), Y(tr.y[i - 1])); P[k].lineTo(X(tr.x[i]), Y(tr.y[i]));
      }
      g.lineWidth = 2.5;
      if (!any) { g.strokeStyle = BT.css('--muted-line'); g.stroke(full); }
      P.forEach((p, k) => { g.strokeStyle = BT.heat((k + 0.5) / NB, dark); g.stroke(p); });
      const dec = BT.decimalsFor(c.lo, c.hi);
      fig.querySelector('.mm-r').textContent = q.n ? `${lo.toFixed(Math.max(0, dec - 1))} … ${hi.toFixed(Math.max(0, dec - 1))} ${c.unit || ''}` : 'sem dados';
      fig.querySelector('.mm-bar').style.background = BT.heatGradientCss(dark);
      fig.classList.toggle('on', c.key === A.colorKey);
      fig.onclick = () => { A.setColorKey(c.key); body.querySelectorAll('.mm').forEach(f => f.classList.toggle('on', f === fig)); };
      return { c, cv, off, w, h, X, Y, dec, val: fig.querySelector('.mm-v') };
    });
  }

  frameMaps(i) {
    const A = this.A, p = A.track && A.track.ok ? BT.posAt(A.S, A.track, A.cur) : null;
    for (const m of this.minis) {
      const [g] = BT.setupCanvas(m.cv, m.w, m.h);
      g.drawImage(m.off, 0, 0, m.w, m.h);
      if (p) {
        g.fillStyle = BT.css('--car'); g.strokeStyle = BT.css('--surface'); g.lineWidth = 2;
        g.beginPath(); g.arc(m.X(p.x), m.Y(p.y), 4.5, 0, 7); g.stroke(); g.fill();
      }
      m.val.textContent = `${BT.fmtVal(m.c.data[i], m.dec)} ${m.c.unit || ''}`;
    }
  }

  /* ---------------------------------------------------------------- suspensão */
  susp() { return this.A.susp || { shocks: [] }; }

  noShocks(el) {
    const sh = this.susp().shocks;
    const found = sh.filter(k => k.pos).map(k => `${k.id}: ${k.pos.name}${k.active ? '' : ' (constante = sem sinal)'}`);
    el.innerHTML = `<p class="mut pad">Nenhum amortecedor com sinal neste trecho/log.` +
      (found.length ? ` Canais encontrados: ${BT.esc(found.join(' · '))}.` : ' Nenhum canal com “Shock”, “amort” ou “susp” no nome.') + '</p>';
  }

  renderSusp() {
    const A = this.A, sp = A.cfg.susp, sh = this.susp().shocks, act = sh.filter(k => k.active);
    const [i0, i1, label] = this.range();
    $('spWin').textContent = label;
    const body = $('spBody');
    $('spPlots').hidden = $('spExtra').hidden = !act.length;
    if (!act.length) { this.noShocks(body); return; }
    const moving = sp.moving && A.stopped ? Uint8Array.from(A.stopped, v => 1 - v) : null;
    let h = '<table class="ana-table"><tr><th>Canto</th><th>Estático</th><th>Mín … máx</th><th>Curso usado</th><th>% do curso</th>' +
      '<th>Comp. p95</th><th>Ext. p95</th><th>Comp. lenta</th><th>Comp. rápida</th><th>Ext. lenta</th><th>Ext. rápida</th><th>Ext./comp. média</th></tr>';
    const stats = {};
    sh.forEach(k => {
      if (!k.active) {
        h += `<tr class="dim"><td><i class="sw" style="background:${cornerColor(k.id)}"></i>${k.id} · ${k.label}</td><td colspan="11">${k.pos ? 'canal constante (sensor sem sinal?)' : 'sem canal no log'}</td></tr>`;
        return;
      }
      const pos = k.pos.data;
      let mn = Infinity, mx = -Infinity;
      for (let i = i0; i <= i1; i++) { const v = pos[i]; if (v === v) { if (v < mn) mn = v; if (v > mx) mx = v; } }
      const stroke = k.axle === 'F' ? +A.cfg.car.strokeF : +A.cfg.car.strokeR;
      const vs = BT.velStats(k.v, i0, i1, moving, +sp.knee || 100);
      stats[k.id] = vs;
      const used = mx - mn;
      h += `<tr><td><i class="sw" style="background:${cornerColor(k.id)}"></i>${k.id} · ${k.label}</td>` +
        `<td>${fx(k.static)} mm${k.staticFromStop ? '' : '<sup title="mediana do trecho todo (não achou o carro parado)">*</sup>'}</td>` +
        `<td>${fx(mn)} … ${fx(mx)}</td><td>${fx(used)} mm</td><td>${stroke > 0 ? pct(used / stroke) : '<span class="mut">informe o curso</span>'}</td>` +
        (vs ? `<td>${fx(vs.p95C, 0)}</td><td>${fx(vs.p95R, 0)}</td><td>${pct(vs.lsC)}</td><td>${pct(vs.hsC)}</td><td>${pct(vs.lsR)}</td><td>${pct(vs.hsR)}</td><td>${fx(vs.meanR / vs.meanC, 2)}</td>`
          : '<td colspan="7" class="mut">sem amostras andando</td>') + '</tr>';
    });
    body.innerHTML = h + '</table>' +
      `<p class="mut small">${A.cfg.car.strokeF > 0 ? '' : 'Informe o curso total dos amortecedores em “Dados do carro” para ver a % usada e as batidas no fim de curso. '}Velocidades em mm/s${act.some(k => k.vCalc) ? ' (derivada da posição onde não há canal de velocidade)' : ''}. ` +
      `Lenta/rápida: abaixo/acima de ${+sp.knee || 100} mm/s, em % do tempo${moving ? ' com o carro andando' : ''}.` +
      (act.some(k => !k.staticFromStop) ? ' * estático pela mediana do log (não achou o carro parado).' : '') + '</p>';

    /* histogramas (pequenos múltiplos, mesma escala em todos) */
    let R = 0;
    act.forEach(k => {
      const a = [];
      for (let i = i0; i <= i1; i++) { const v = k.v[i]; if (v === v && (!moving || moving[i])) a.push(Math.abs(v)); }
      a.sort((x, y) => x - y);
      R = Math.max(R, BT.quant(a, 0.995) || 0);
    });
    const step = BT.niceTicks(0, Math.max(R, 10), 12);
    const bw = step.length > 1 ? step[1] - step[0] : 10, nb = Math.ceil(Math.max(R, 10) / bw);
    let dl = 0, dh = 0;
    act.forEach(k => {
      const a = [];
      for (let i = i0; i <= i1; i++) { const v = k.disp[i]; if (v === v) a.push(v); }
      a.sort((x, y) => x - y);
      dl = Math.min(dl, BT.quant(a, 0.003)); dh = Math.max(dh, BT.quant(a, 0.997));
    });
    const pstep = BT.niceTicks(0, Math.max(dh - dl, 4), 24), pw = pstep.length > 1 ? pstep[1] - pstep[0] : 1;
    const plo = Math.floor(dl / pw) * pw, pnb = Math.max(1, Math.ceil((dh - plo) / pw));
    const vel = $('spVel'), posEl = $('spPos');
    vel.innerHTML = act.map(k => `<div><h4>${k.id} · ${k.label}</h4><div id="spv${k.id}" class="plot-s"></div></div>`).join('');
    posEl.innerHTML = act.map(k => `<div><h4>${k.id} · ${k.label}</h4><div id="spp${k.id}" class="plot-s"></div></div>`).join('');
    const knee = +sp.knee || 100, cpos = BT.css('--pos'), cneg = BT.css('--neg');
    act.forEach(k => {
      delete this.plots['spv' + k.id]; delete this.plots['spp' + k.id];
      const hv = BT.hist(k.v, i0, i1, moving, -nb * bw, nb * bw, 2 * nb);
      this.plot('spv' + k.id).set({
        bars: { x0: hv.lo, w: hv.w, y: hv.y, colors: Array.from(hv.y, (_, j) => (hv.lo + (j + 0.5) * hv.w >= 0 ? cpos : cneg)) },
        legend: [{ label: 'Compressão', color: cpos }, { label: 'Extensão', color: cneg }],
        markers: [{ x: -knee, color: BT.css('--muted') }, { x: knee, color: BT.css('--muted') }],
        xLabel: 'mm/s', yLabel: '% do tempo',
        tipBar: j => `<b>${(hv.lo + j * hv.w).toFixed(0)} … ${(hv.lo + (j + 1) * hv.w).toFixed(0)} mm/s</b><br>${hv.y[j].toFixed(1)} % do tempo`
      });
      const hp = BT.hist(k.disp, i0, i1, null, plo, plo + pnb * pw, pnb);
      this.plot('spp' + k.id).set({
        bars: { x0: hp.lo, w: hp.w, y: hp.y, colors: Array.from(hp.y, () => cornerColor(k.id)) },
        markers: [{ x: 0, color: BT.css('--fg'), label: 'estático' }],
        xLabel: 'mm (+ = comprimido)', yLabel: '% do tempo',
        tipBar: j => `<b>${(hp.lo + j * hp.w).toFixed(1)} … ${(hp.lo + (j + 1) * hp.w).toFixed(1)} mm</b><br>${hp.y[j].toFixed(1)} % do tempo`
      });
    });    this.renderSuspExtra(i0, i1);
  }

  /* ---------------------------------------------------------------- ressonância */
  renderFreq() {
    const A = this.A, S = A.S, t = S.t, sp = A.cfg.susp, sh = this.susp().shocks, act = sh.filter(k => k.active);
    const [i0, i1, label] = this.range();
    $('frWin').textContent = label;
    $('frContent').hidden = $('rrBox').hidden = !act.length;
    if (!act.length) { this.noShocks($('frBody')); return; }
    $('frBody').innerHTML = '';

    /* testes de queda achados no trecho */
    this.events = BT.dropTests(t, sh, A.stopped, i0, i1);
    const sel = $('frEvent');
    const keep = sel.value;
    sel.innerHTML = this.events.map((e, k) => `<option value="${k}">Evento ${k + 1} · t = ${e.t.toFixed(2)} s</option>`).join('') +
      (this.manual ? `<option value="m">Trecho do gráfico · ${this.manual.t0.toFixed(1)}–${this.manual.t1.toFixed(1)} s</option>` : '');
    if (!sel.options.length) sel.innerHTML = '<option value="">nenhum evento achado</option>';
    if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
    this.showDrop();

    /* espectro andando */
    const fmin = +sp.fmin || 0.6, fmax = +sp.fmax || 4.5;
    const mv = A.stopped ? Uint8Array.from(A.stopped, v => 1 - v) : null;
    const speeds = [];
    if (A.track && A.track.ok) for (let i = i0; i <= i1; i++) if (mv && mv[i] && A.track.speed[i] === A.track.speed[i]) speeds.push(A.track.speed[i]);
    speeds.sort((a, b) => a - b);
    /* devagar × rápido: a excitação da pista muda de frequência com a velocidade, a
     * ressonância não. Separa o mais possível (terços) mas precisa de trechos de ~5 s
     * seguidos em cada faixa; se não der, aproxima os cortes até a mediana. */
    this.psd = {};
    act.forEach(k => { this.psd[k.id] = { all: BT.psdMask(t, k.disp, i0, i1, mv, 2, 256) || BT.psdMask(t, k.disp, i0, i1, mv, 2, 128) }; });
    let vlo = NaN, vhi = NaN;
    for (const [ql, qh] of [[1 / 3, 2 / 3], [0.4, 0.6], [0.5, 0.5]]) {
      if (!speeds.length) break;
      const a = BT.quant(speeds, ql), b = BT.quant(speeds, qh);
      const slow = Uint8Array.from(A.track.speed, (v, i) => (mv[i] && v < a ? 1 : 0));
      const fast = Uint8Array.from(A.track.speed, (v, i) => (mv[i] && v >= b ? 1 : 0));
      const r = act.map(k => [BT.psdMask(t, k.disp, i0, i1, slow, 2, 128), BT.psdMask(t, k.disp, i0, i1, fast, 2, 128)]);
      if (r.every(([s, f]) => s && f && s.nseg >= 2 && f.nseg >= 2) || ql === 0.5) {
        act.forEach((k, j) => { this.psd[k.id].slow = r[j][0]; this.psd[k.id].fast = r[j][1]; });
        vlo = a; vhi = b;
        break;
      }
    }
    const mode = $('frPsdMode');
    const mk = mode.value;
    mode.innerHTML = '<option value="all">todos os amortecedores</option>' +
      act.map(k => `<option value="${k.id}">${k.id}: devagar × rápido</option>`).join('');
    mode.value = [...mode.options].some(o => o.value === mk) ? mk : 'all';
    this.vlo = vlo; this.vhi = vhi;
    this.showPsd();

    /* tabela de picos */
    let h = `<table class="ana-table"><tr><th>Canto</th><th>Picos andando (Hz)</th><th>Devagar (&lt; ${fx(vlo, 0)} km/h)</th><th>Rápido (≥ ${fx(vhi, 0)} km/h)</th><th>Teste de queda</th></tr>`;
    const ev0 = this.events && this.events[0];
    act.forEach(k => {
      const P = this.psd[k.id], pk = r => (r ? BT.localPeaks(r.f, r.p, fmin, fmax, 3) : []);
      const a = pk(P.all), s = pk(P.slow), f = pk(P.fast);
      const d = ev0 && ev0.res.find(r => r.id === k.id);
      h += `<tr><td><i class="sw" style="background:${cornerColor(k.id)}"></i>${k.id}</td><td>${a.map(x => x.f.toFixed(2)).join(' · ') || '—'}</td>` +
        `<td>${s.map(x => x.f.toFixed(2)).join(' · ') || '—'}</td><td>${f.map(x => x.f.toFixed(2)).join(' · ') || '—'}</td>` +
        `<td><b>${d && d.ok && !d.over ? d.fn.toFixed(2) : '—'}</b></td></tr>`;
    });
    $('frPeaks').innerHTML = h + '</table>';
    const fs = (i1 - i0) / (t[i1] - t[i0]);
    $('frNote').innerHTML = `Log a ${fs.toFixed(0)} Hz → só enxerga até ${(fs / 2).toFixed(1)} Hz. ` +
      `A frequência da roda (massa não suspensa, ~8–15 Hz) fica no limite ou acima disso. Para vê-la, grave os amortecedores a 100 Hz ou mais, se a FT permitir.`;    this.renderRoadRes(i0, i1);
  }

  showDrop() {
    const A = this.A, sp = A.cfg.susp, v = $('frEvent').value;
    const ev = v === 'm' ? this.manual : this.events && this.events[+v];
    const tbl = $('frDrop');
    if (!ev) {
      tbl.innerHTML = '<p class="mut small">Nenhum teste de queda achado com o carro parado neste trecho. Dê zoom no trecho do evento nos gráficos (Shift + arrastar) e clique em “Analisar trecho do gráfico”.</p>';
      this.plot('frDropPlot').set({ empty: 'sem evento' });
      return;
    }
    let h = '<table class="ana-table"><tr><th>Canto</th><th>f natural</th><th>ζ</th><th>f amortecida</th><th>Medido com</th>' +
      '<th>Rigidez na roda</th><th>c na roda</th><th>c no amortecedor</th></tr>';
    const series = [];
    ev.res.forEach(r => {
      const k = BT.CORNERS.find(c => c.id === r.id), F = k.axle === 'F';
      const car = A.cfg.car;
      const rr = r.ok && !r.over ? BT.rideRates(r.fn, r.zeta, +(F ? car.massF : car.massR), +(F ? car.mrF : car.mrR)) : null;
      h += `<tr><td><i class="sw" style="background:${cornerColor(r.id)}"></i>${r.id}</td>` +
        (r.ok && !r.over
          ? `<td><b>${fx(r.fn, 2)} Hz</b></td><td><b>${fx(r.zeta, 2)}</b></td><td>${fx(r.fd, 2)} Hz</td><td class="mut">${r.used}</td>` +
            `<td>${rr ? fx(rr.k / 1000, 1) + ' N/mm' : '<span class="mut">informe a massa</span>'}</td><td>${rr ? fx(rr.c, 0) + ' N·s/m' : '—'}</td><td>${rr && rr.cShock === rr.cShock ? fx(rr.cShock, 0) + ' N·s/m' : '—'}</td>`
          : `<td colspan="7" class="mut">${BT.esc(r.msg || 'sem resultado')}</td>`) + '</tr>';
      if (r.ts) {
        const t0 = r.E ? r.E[0].t : r.ts[0];
        series.push({ x: Float64Array.from(r.ts, x => x - t0), y: r.d, color: cornerColor(r.id), label: r.id, dots: (r.E || []).map(e => ({ x: e.t - t0, y: e.a })) });
      }
    });
    tbl.innerHTML = h + '</table>';
    this.plot('frDropPlot').set({
      series, xLabel: 's depois do pico', yLabel: 'mm (em relação à base)', zeroY: true, xRange: [-0.2, 1.6],
      tipX: x => `<b>${x.toFixed(2)} s</b>`, fmtY: y => y.toFixed(1) + ' mm'
    });
  }

  analyzeManual() {
    const A = this.A, t = A.S.t, v = A.charts.v;
    const i0 = BT.idxAt(t, v.t0), i1 = BT.idxAt(t, v.t1);
    const act = this.susp().shocks.filter(k => k.active);
    if (!act.length) return;
    this.manual = { t0: v.t0, t1: v.t1, res: act.map(k => Object.assign({ id: k.id }, BT.freeDecay(t, k.disp, i0, i1))) };
    this.dirty.add('freq'); this.render();
    $('frEvent').value = 'm';
    this.showDrop();
  }

  showPsd() {
    const A = this.A, sp = A.cfg.susp, mode = $('frPsdMode').value, act = this.susp().shocks.filter(k => k.active);
    const fmin = +sp.fmin || 0.6, fmax = +sp.fmax || 4.5;
    const sv = $('frEvent').value, drop = sv === 'm' ? this.manual : this.events && this.events[+sv];
    const markers = [{ x: fmin, color: BT.css('--axis') }, { x: fmax, color: BT.css('--axis') }];
    let series = [];
    if (mode === 'all') {
      act.forEach((k, j) => {
        const r = this.psd[k.id] && this.psd[k.id].all;
        if (r) series.push({ x: r.f, y: r.p, color: cornerColor(k.id), label: k.id });
        const d = drop && drop.res.find(q => q.id === k.id);
        if (d && d.ok && !d.over) markers.push({ x: d.fn, color: cornerColor(k.id), label: `queda ${k.id}`, row: j });
      });
    } else {
      const P = this.psd[mode] || {};
      if (P.slow) series.push({ x: P.slow.f, y: P.slow.p, color: BT.css('--c1'), label: `devagar (< ${fx(this.vlo, 0)} km/h)` });
      if (P.fast) series.push({ x: P.fast.f, y: P.fast.p, color: BT.css('--c2'), label: `rápido (≥ ${fx(this.vhi, 0)} km/h)` });
      const d = drop && drop.res.find(q => q.id === mode);
      if (d && d.ok && !d.over) markers.push({ x: d.fn, color: BT.css('--fg'), label: `queda ${fx(d.fn, 2)} Hz` });
    }
    this.plot('frPsd').set(series.length ? {
      series, logY: true, xLabel: 'Hz', yLabel: 'mm²/Hz', markers, xRange: [0, series[0].x[series[0].x.length - 1]],
      tipX: x => `<b>${x.toFixed(2)} Hz</b>`, fmtY: y => y.toPrecision(2)
    } : { empty: 'trecho andando curto demais para o espectro (precisa de ≥ 5 s seguidos)' });
  }

  /* ---------------------------------------------------------------- dinâmica */
  renderDyn() {
    const A = this.A, tr = A.track;
    const [i0, i1, label] = this.range();
    $('dyWin').textContent = label;
    if (!tr || !tr.ok || !A.dyn) { $('dyTiles').innerHTML = '<p class="mut pad">Sem trajetória de GPS.</p>'; $('dyPlots').hidden = true; this.acc = null; return; }
    $('dyPlots').hidden = false;
    const d = { along: A.acc.lon, alat: A.acc.lat, radius: A.dyn.radius }, t = A.S.t;
    this.acc = A.acc;
    $('dySrc').textContent = A.acc.src;
    let vmax = 0, vs = 0, vn = 0, tMove = 0, amax = 0, bmax = 0, lr = 0, ll = 0;
    const radii = [];
    for (let i = i0; i <= i1; i++) {
      const v = tr.speed[i];
      if (v === v && v > vmax) vmax = v;
      if (A.stopped && !A.stopped[i] && v === v) { vs += v; vn++; if (i > i0) tMove += t[i] - t[i - 1]; }
      const al = d.along[i], at = d.alat[i];
      if (al > amax) amax = al; if (-al > bmax) bmax = -al;
      if (at > lr) lr = at; if (-at > ll) ll = -at;
      if (tr.speed[i] > 10 && d.radius[i] === d.radius[i]) radii.push(d.radius[i]);
    }
    radii.sort((a, b) => a - b);
    const rmin = BT.quant(radii, 0.05);              /* 5 %: o mínimo puro é ruído do GPS */
    const dist = tr.dist[i1] - tr.dist[i0];
    const tile = (k, v, u) => `<div class="tile"><span>${k}</span><b>${v}</b><small>${u}</small></div>`;
    $('dyTiles').innerHTML =
      tile('Velocidade máx.', fx(vmax, 1), 'km/h') + tile('Média andando', fx(vn ? vs / vn : NaN, 1), 'km/h') +
      tile('Distância', fx(dist, 0), 'm') + tile('Tempo andando', BT.fmtTime(tMove), 'min:s') +
      tile('Aceleração máx.', fx(amax, 2), 'g') + tile('Frenagem máx.', fx(bmax, 2), 'g') +
      tile('Lateral máx. dir.', fx(lr, 2), 'g') + tile('Lateral máx. esq.', fx(ll, 2), 'g') +
      tile('Curva mais fechada', fx(rmin, 1), 'm de raio (5 % menores, > 10 km/h)');
    const n = i1 - i0 + 1;
    let gx = d.alat.subarray(i0, i1 + 1), gy = d.along.subarray(i0, i1 + 1);
    let lim = 0.5;
    for (let i = 0; i < n; i++) { const a = Math.abs(gx[i]), b = Math.abs(gy[i]); if (a === a && a > lim) lim = a; if (b === b && b > lim) lim = b; }
    lim = Math.min(2, Math.ceil(lim * 4) / 4 + 0.1);
    this.plot('dyGG').set({
      points: { x: gx, y: gy, alpha: 0.3 }, equal: true, xRange: [-lim, lim], yRange: [-lim, lim],
      circles: [0.25, 0.5, 0.75, 1, 1.5].filter(r => r < lim), xLabel: 'lateral (g, + direita)', yLabel: 'longitudinal (g, + acelerando)'
    });
    /* tempo por faixa de velocidade */
    const bw = vmax > 40 ? 5 : vmax > 15 ? 2 : 1, nb = Math.max(1, Math.ceil(vmax / bw));
    const hv = BT.hist(tr.speed, i0, i1, A.stopped ? Uint8Array.from(A.stopped, x => 1 - x) : null, 0, nb * bw, nb);
    this.plot('dySpd').set({
      bars: { x0: 0, w: bw, y: hv.y }, xLabel: 'km/h', yLabel: '% do tempo andando',
      tipBar: j => `<b>${j * bw}–${(j + 1) * bw} km/h</b><br>${hv.y[j].toFixed(1)} % do tempo`
    });
  }

  /* ---------------------------------------------------------------- voltas */
  renderLaps() {
    const A = this.A, laps = A.laps, body = $('lpBody');
    this.cmp = null;
    if (laps.length < 2) {
      body.innerHTML = '<p class="mut pad">Precisa de pelo menos 2 voltas. Defina a linha de largada no mapa.</p>';
      $('lpContent').hidden = true; return;
    }
    body.innerHTML = ''; $('lpContent').hidden = false;
    const best = BT.bestLap(laps);
    const opts = laps.map((l, k) => `<option value="${k}">Volta ${l.n} · ${BT.fmtTime(l.time)}${k === best ? ' (melhor)' : ''}</option>`).join('');
    const sc = $('lpCmp'), sr = $('lpRef'), kc = sc.value, kr = sr.value;
    sc.innerHTML = opts; sr.innerHTML = opts;
    sr.value = kr !== '' && laps[+kr] ? kr : String(best);
    sc.value = kc !== '' && laps[+kc] ? kc : String(A.sel >= 0 && A.sel !== best ? A.sel : best === 0 ? 1 : 0);
    const lr = laps[+sr.value], lc = laps[+sc.value];
    const pr = BT.lapProfile(A.S, A.track, lr), pc = BT.lapProfile(A.S, A.track, lc);
    const c = this.cmp = BT.compareLaps(pr, pc, 1);
    c.lap = lc; c.ref = lr; c.pc = pc;
    const cRef = BT.css('--muted'), cCmp = BT.css('--c1');
    const fin = c.delta[c.delta.length - 1];
    $('lpSum').innerHTML = `Volta ${lc.n} <b>${BT.fmtTime(lc.time)}</b> contra volta ${lr.n} <b>${BT.fmtTime(lr.time)}</b>: ` +
      `<b>${fin >= 0 ? '+' : ''}${fin.toFixed(2)} s</b> no fim (${fin >= 0 ? 'mais lenta' : 'mais rápida'}).`;
    const seek = d => A.seek(lc.t0 + BT.interpAt(c.d, c.tCmp, d));
    this.plot('lpSpeed').set({
      series: [{ x: c.d, y: c.vRef, color: cRef, label: `Volta ${lr.n} (ref.)` }, { x: c.d, y: c.vCmp, color: cCmp, label: `Volta ${lc.n}` }],
      xLabel: 'distância na volta (m)', yLabel: 'km/h', tipX: x => `<b>${x.toFixed(0)} m</b>`, fmtY: y => y.toFixed(1) + ' km/h', onClick: seek
    });
    this.plot('lpDelta').set({
      series: [{ x: c.d, y: c.delta, color: cCmp, label: `Δ volta ${lc.n} − ${lr.n}` }], zeroY: true, legend: [],
      xLabel: 'distância na volta (m)', yLabel: 'Δ tempo (s, + = perdendo)', tipX: x => `<b>${x.toFixed(0)} m</b>`, fmtY: y => (y >= 0 ? '+' : '') + y.toFixed(2) + ' s', onClick: seek
    });
    /* 10 trechos de mesma distância */
    const N = 10, seg = new Float64Array(N), D = pr.D;
    for (let k = 0; k < N; k++) seg[k] = BT.interpAt(c.d, c.delta, D * (k + 1) / N) - BT.interpAt(c.d, c.delta, D * k / N);
    const ab = seg.map(Math.abs), cpos = BT.css('--pos'), cneg = BT.css('--neg');
    this.plot('lpSect').set({
      bars: { x0: 0.5, w: 1, y: ab, colors: Array.from(seg, v => (v > 0 ? cpos : cneg)) },
      legend: [{ label: 'perdeu tempo', color: cpos }, { label: 'ganhou tempo', color: cneg }],
      xLabel: 'trecho (1 = logo após a largada)', yLabel: '|Δ| no trecho (s)',
      tipBar: k => `<b>Trecho ${k + 1}</b> (${(D * k / N).toFixed(0)}–${(D * (k + 1) / N).toFixed(0)} m)<br>${seg[k] > 0 ? 'perdeu' : 'ganhou'} ${Math.abs(seg[k]).toFixed(2)} s`
    });
  }

  frameLaps(i) {
    const A = this.A, c = this.cmp, l = c.lap;
    if (A.cur < l.t0 || A.cur > l.t1) { this.setLapMarker(null); return; }
    const d0 = A.track.dist[l.i0], sc = c.pc.D > 0 ? c.d[c.d.length - 1] / c.pc.D : 1;
    this.setLapMarker((A.track.dist[i] - d0) * sc);
  }
  setLapMarker(d) {
    if (d === this.lapMarker) return;
    this.lapMarker = d;
    ['lpSpeed', 'lpDelta'].forEach(id => {
      const p = this.plots[id];
      if (p && p.spec) { p.spec.markers = d === null ? [] : [{ x: d, color: BT.css('--fg') }]; p.draw(); }
    });
  }

  /* ---------------------------------------------------------------- configurações */
  bindSettings() {
    const A = this.A, sp = () => A.cfg.susp;
    const num = (id, key, tabs, recompute) => {
      const el = $(id);
      el.value = sp()[key] || '';
      el.onchange = () => {
        const v = parseFloat(String(el.value).replace(',', '.'));
        sp()[key] = isFinite(v) ? v : 0;
        A.saveCfg();
        if (recompute) A.recompute(); else this.invalidate(tabs);
      };
    };
    num('spKnee', 'knee', ['susp']);
    num('frFmin', 'fmin', ['freq']); num('frFmax', 'fmax', ['freq']);
    document.addEventListener('click', e => { if (e.target.closest('[data-car]')) A.openCar(); });
    $('spComp').value = sp().compPos ? '1' : '0';
    $('spComp').onchange = e => { sp().compPos = e.target.value === '1'; A.saveCfg(); A.recompute(); };
    $('spMoving').checked = sp().moving;
    $('spMoving').onchange = e => { sp().moving = e.target.checked; A.saveCfg(); this.invalidate(['susp']); };
    $('mmConst').onchange = () => this.invalidate(['maps']);
    $('frEvent').onchange = () => { this.showDrop(); this.showPsd(); };
    $('frPsdMode').onchange = () => this.showPsd();
    $('frManual').onclick = () => this.analyzeManual();
    $('lpCmp').onchange = () => { this.dirty.add('laps'); this.render(); };
    $('lpRef').onchange = () => { this.dirty.add('laps'); this.render(); };
  }

  /* depois de mudar a configuração da suspensão fora daqui */
  syncSettings() {
    const sp = this.A.cfg.susp;
    $('spComp').value = sp.compPos ? '1' : '0';
    $('spMoving').checked = sp.moving;
  }
};
})();
