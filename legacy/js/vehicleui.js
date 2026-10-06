/* Abas Projeto, Trem de força e CVT, mais as seções de rolagem/arfagem/saltos (Suspensão)
 * e pista × ressonância (Ressonância). Os cálculos estão em vehicle.js. */
'use strict';
(() => {
const $ = BT.$;
const ok = v => v !== null && v !== undefined && v === v && isFinite(v);
const fx = (v, d = 1) => (ok(v) ? v.toFixed(d) : '—');
const tile = (k, v, u) => `<div class="tile"><span>${k}</span><b>${v}</b><small>${u}</small></div>`;
const cc = id => BT.cornerColor(id);
const movingMask = A => (A.stopped ? Uint8Array.from(A.stopped, x => 1 - x) : null);
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

/* resultado do teste de queda por eixo (média dos dois lados) */
function axleDrop(ev, axle) {
  const ids = axle === 'F' ? ['FL', 'FR'] : ['RL', 'RR'];
  const r = ev ? ev.res.filter(x => ids.includes(x.id) && x.ok && !x.over) : [];
  return { fn: mean(r.map(x => x.fn)), zeta: mean(r.map(x => x.zeta)), n: r.length };
}

Object.assign(BT.Analysis.prototype, {
  /* ================================================================ trem de força */
  renderPower() {
    const A = this.A, veh = A.veh, car = A.cfg.car, t = A.S.t;
    const [i0, i1, label] = this.range();
    $('pwWin').textContent = label;
    $('pwContent').hidden = !(veh && veh.v);
    if (!veh || !veh.v) {
      $('pwTiles').innerHTML = '<p class="mut pad">Sem velocidade: o log não tem velocidade da roda nem GPS.</p>';
      $('pwSrc').textContent = '';
      return;
    }
    $('pwSrc').innerHTML = veh.wheel
      ? `Velocidade da roda: <b>${BT.esc(veh.wheel.name)}</b> (${car.wheelDriven ? 'roda de tração' : 'roda livre'})` +
        (veh.kN ? `, corrigida pelo GPS (fator ${veh.k.toFixed(4)}).` : ' — sem GPS para calibrar.')
      : 'Sem canal de velocidade da roda: usando o GPS (aceleração bem menos precisa).';
    let vmax = 0, amax = 0, bmax = 0;
    for (let i = i0; i <= i1; i++) {
      if (veh.v[i] > vmax) vmax = veh.v[i];
      if (veh.ax[i] > amax) amax = veh.ax[i];
      if (-veh.ax[i] > bmax) bmax = -veh.ax[i];
    }
    const pc = BT.powerCurve(veh.v, veh.P, veh.ax, i0, i1, 2, veh.slip);
    let pmax = 0, pv = NaN;
    pc.y.forEach((y, k) => { if (y > pmax) { pmax = y; pv = pc.x[k]; } });
    /* tração: P = F·v; um percentil alto da aceleração evita picos do sensor */
    const accs = [];
    for (let i = i0; i <= i1; i++) if (veh.ax[i] > 0.05) accs.push(veh.ax[i]);
    accs.sort((a, b) => a - b);
    const aTr = BT.quant(accs, 0.98), Ftr = (+car.mass) * aTr * 9.81;
    const dist = car.wheelDriven && A.track && A.track.ok ? A.track.dist : veh.dist;
    const L = this.launchList = BT.launches(t, veh.v, dist, veh.slip, veh.ax).filter(l => l.t0 >= t[i0] && l.t0 <= t[i1]);
    const best30 = Math.min(...L.map(l => l.d30).filter(ok));
    $('pwTiles').innerHTML =
      tile('A roda marca', veh.kN ? `${veh.k < 1 ? '+' : ''}${((1 / veh.k - 1) * 100).toFixed(1)} %` : '—',
        veh.kN ? `em relação ao GPS · circunferência na FT × ${veh.k.toFixed(4)}` : 'precisa de GPS e roda') +
      tile('Velocidade máx.', fx(vmax * 3.6, 1), 'km/h') +
      tile('Potência máx. na roda', fx(pmax, 2), ok(pv) ? `kW a ${pv.toFixed(0)} km/h · ${(pmax / car.power * 100).toFixed(0)} % de ${car.power} kW` : 'kW') +
      tile('Força trativa máx.', fx(Ftr, 0), `N (${fx(aTr, 2)} g, percentil 98)`) +
      tile('Melhor 0–30 m', isFinite(best30) ? best30.toFixed(2) : '—', 's') +
      tile('Frenagem máx.', fx(bmax, 2), 'g') +
      tile('Resistências usadas', `${car.crr} · ${car.cda}`, 'Crr · CdA (m²)');

    /* curva de potência */
    const sc = [], sp = [];
    for (let i = i0; i <= i1; i += 2) if (veh.v[i] > 1.5 && veh.ax[i] > 0.03 && ok(veh.P[i]) && !(veh.slip && veh.slip[i] > 0.12)) { sc.push(veh.v[i] * 3.6); sp.push(veh.P[i]); }
    const series = [{ x: pc.x, y: pc.y, color: BT.css('--c1'), label: 'P na roda (percentil 90)', width: 2.5 }];
    if (Ftr > 0 && pmax > 0) {
      const vlim = pmax * 1000 / Ftr;                           /* onde tração e potência se encontram */
      series.push({ x: Float64Array.from([0, vlim * 3.6]), y: Float64Array.from([0, pmax]), color: BT.css('--muted'), label: 'limite de tração (F·v)' });
    }
    this.plot('pwCurve').set(pc.x.length ? {
      series, points: { x: Float64Array.from(sc), y: Float64Array.from(sp), alpha: 0.12 },
      hlines: [{ y: +car.power, color: BT.css('--muted'), label: `motor ${car.power} kW` }],
      xLabel: 'km/h', yLabel: 'kW', yRange: [0, Math.max(pmax, +car.power) * 1.1],
      tipX: x => `<b>${x.toFixed(0)} km/h</b>`, fmtY: y => y.toFixed(2) + ' kW'
    } : { empty: 'sem trechos acelerando' });

    /* largadas */
    $('pwLaunch').innerHTML = L.length
      ? '<table class="ana-table"><tr><th>#</th><th>t</th><th>0–10 m</th><th>0–20 m</th><th>0–30 m</th><th>0–20 km/h</th><th>0–40 km/h</th><th>Acel. máx.</th><th>Escorreg. 10 m</th></tr>' +
        L.map((l, k) => `<tr class="lap" data-t="${l.t0}"><td><i class="sw" style="background:${BT.css('--c' + (k % 4 + 1))}"></i>${k + 1}</td><td>${l.t0.toFixed(1)} s</td>` +
          `<td>${fx(l.d10, 2)}</td><td>${fx(l.d20, 2)}</td><td><b>${fx(l.d30, 2)}</b></td><td>${fx(l.v20, 2)}</td><td>${fx(l.v40, 2)}</td>` +
          `<td>${fx(l.amax, 2)} g</td><td>${ok(l.slip10) ? (l.slip10 * 100).toFixed(0) + ' %' : '—'}</td></tr>`).join('') + '</table>'
      : '<p class="mut small">Nenhuma largada do carro parado neste trecho (parado ≥ 0,8 s e depois acelerando até 10 m).</p>';
    $('pwLaunch').querySelectorAll('tr[data-t]').forEach(r => { r.onclick = () => A.seek(+r.dataset.t - 0.5); });
    if (veh.slip && L.length) {
      const ser = L.slice(0, 4).map((l, k) => {
        const xs = [], ys = [], d0 = dist[l.i0];
        for (let i = l.i0; i < t.length && dist[i] - d0 <= 30; i++) if (ok(veh.slip[i])) { xs.push(dist[i] - d0); ys.push(veh.slip[i] * 100); }
        return { x: Float64Array.from(xs), y: Float64Array.from(ys), color: BT.css('--c' + (k + 1)), label: `largada ${k + 1}` };
      });
      this.plot('pwSlip').set({ series: ser, xLabel: 'm desde a largada', yLabel: '% (roda × GPS)', zeroY: true, tipX: x => `<b>${x.toFixed(1)} m</b>`, fmtY: y => y.toFixed(0) + ' %' });
    } else this.plot('pwSlip').set({ empty: car.wheelDriven ? 'precisa de largadas e GPS' : 'sensor na roda livre: não mede escorregamento' });

    this.renderCoast(i0, i1);
  },

  renderCoast(i0, i1) {
    const A = this.A, veh = A.veh, t = A.S.t, sel = $('cdSel'), keep = sel.value;
    this.coasts = BT.findCoasts(t, veh.v, veh.ax, i0, i1);
    sel.innerHTML = this.coasts.map((c, k) => `<option value="${k}">Trecho ${k + 1} · ${c.t0.toFixed(1)}–${c.t1.toFixed(1)} s · ${(c.v0 * 3.6).toFixed(0)} → ${(c.v1 * 3.6).toFixed(0)} km/h</option>`).join('') +
      (this.coastManual ? `<option value="m">Trecho dos gráficos · ${this.coastManual.t0.toFixed(1)}–${this.coastManual.t1.toFixed(1)} s</option>` : '');
    if (!sel.options.length) sel.innerHTML = '<option value="">nenhum trecho de coast-down achado</option>';
    if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
    if (!this.coastBound) {
      this.coastBound = true;
      sel.onchange = () => this.showCoast();
      $('cdManual').onclick = () => {
        const v = A.charts.v;
        this.coastManual = { i0: BT.idxAt(t, v.t0), i1: BT.idxAt(t, v.t1), t0: v.t0, t1: v.t1 };
        this.dirty.add('power'); this.render(); $('cdSel').value = 'm'; this.showCoast();
      };
      $('cdApply').onclick = () => {
        const f = this.coastRes;
        if (!f) return;
        A.cfg.car.crr = +f.crr.toFixed(4);
        if (f.cda > 0) A.cfg.car.cda = +f.cda.toFixed(3);
        A.saveCfg(); A.recompute();
      };
    }
    this.showCoast();
  },

  showCoast() {
    const A = this.A, veh = A.veh, car = A.cfg.car, v = $('cdSel').value;
    const seg = v === 'm' ? this.coastManual : this.coasts && this.coasts[+v];
    const f = this.coastRes = seg && v !== '' ? BT.coastFit(veh.v, veh.a, seg.i0, seg.i1, +car.mass, +car.rho) : null;
    $('cdApply').disabled = !f;
    if (!f) {
      $('cdRes').innerHTML = '<p class="mut small">Sem trecho de coast-down. Faça o teste: embale a ~40 km/h numa reta plana e deixe o carro desacelerar sozinho até ~10 km/h, sem frear. Repita nos dois sentidos para cancelar vento e inclinação.</p>';
      this.plot('cdPlot').set({ empty: 'sem trecho' });
      return;
    }
    const F30 = f.A + f.B * (30 / 3.6) ** 2;
    const warn = [];
    if (f.r2 < 0.5) warn.push('ajuste ruidoso (R² baixo): repita o teste mais longo, em reta plana');
    if (!(f.cda > 0)) warn.push('CdA não confiável: velocidade baixa demais para separar o arrasto do rolamento');
    $('cdRes').innerHTML = '<table class="ana-table">' +
      `<tr><td>Resistência ao rolamento Crr</td><td><b>${f.crr.toFixed(3)}</b></td></tr>` +
      `<tr><td>Área de arrasto CdA</td><td><b>${f.cda > 0 ? f.cda.toFixed(2) + ' m²' : '—'}</b></td></tr>` +
      `<tr><td>Força para rolar a 30 km/h</td><td>${F30.toFixed(0)} N · ${(F30 * 30 / 3.6 / 1000).toFixed(2)} kW</td></tr>` +
      `<tr><td>Ajuste</td><td>R² ${f.r2.toFixed(2)} · ${f.n} amostras</td></tr></table>` +
      (warn.length ? `<p class="mut small">⚠ ${warn.join('; ')}.</p>` : '') +
      `<p class="mut small">Massa usada: ${car.mass} kg. “Usar estes Crr e CdA no carro” atualiza a potência na roda e o modelo da CVT.</p>`;
    let vm = 0;
    for (const x of f.v) if (x > vm) vm = x;
    const xs = Float64Array.from({ length: 30 }, (_, k) => vm * 3.6 * k / 29);
    this.plot('cdPlot').set({
      points: { x: Float64Array.from(f.v, x => x * 3.6), y: f.F, alpha: 0.35 },
      series: [{ x: xs, y: Float64Array.from(xs, x => f.A + f.B * (x / 3.6) ** 2), color: BT.css('--c2'), label: 'ajuste Crr·m·g + ½ρCdA·v²', width: 2.5 }],
      xLabel: 'km/h', yLabel: 'força de resistência (N)', yRange: [0, BT.range(f.F).hi * 1.1],
      tipX: x => `<b>${x.toFixed(0)} km/h</b>`, fmtY: y => y.toFixed(0) + ' N'
    });
  },

  /* ================================================================ CVT */
  renderCvt() {
    const A = this.A, veh = A.veh, car = A.cfg.car, t = A.S.t;
    const [i0, i1, label] = this.range();
    $('cvWin').textContent = label;
    if (!veh || !veh.cvt) {
      $('cvTiles').innerHTML = ''; $('cvPlots').hidden = true; $('cvSrc').textContent = ''; $('cvNote').textContent = '';
      $('cvBody').innerHTML = `<p class="mut pad">Nenhum canal de temperatura da CVT com sinal${veh && veh.cvtAny ? ` (o canal ${BT.esc(veh.cvtAny.name)} está constante)` : ''}. Escolha o canal em “Dados do carro”.</p>`;
      return;
    }
    $('cvPlots').hidden = false;
    const T = veh.cvt.data;
    let tmax = -Infinity, tmin = Infinity;
    for (let i = i0; i <= i1; i++) { if (T[i] > tmax) tmax = T[i]; if (T[i] < tmin) tmin = T[i]; }
    $('cvSrc').innerHTML = `Canal <b>${BT.esc(veh.cvt.name)}</b> · ambiente ${car.tAmb} °C · limite ${car.tCvtMax} °C · enduro ${car.endurance} min (em “Dados do carro”).`;
    const r = veh.v ? BT.cvtFit(t, T, veh.v, veh.P, car, i0, i1) : { ok: false, msg: 'precisa de velocidade (roda ou GPS) para o modelo' };
    const tx = [], ty = [];
    for (let i = i0; i <= i1; i += 5) { tx.push(t[i]); ty.push(T[i]); }
    const meas = { x: Float64Array.from(tx), y: Float64Array.from(ty), color: BT.css('--c1'), label: 'medida' };
    if (!r.ok) {
      $('cvTiles').innerHTML = tile('Máxima medida', fx(tmax, 1), '°C') + tile('Mínima medida', fx(tmin, 1), '°C');
      $('cvBody').innerHTML = `<p class="mut small">Modelo térmico: ${BT.esc(r.msg)}.</p>`;
      this.plot('cvFit').set({ series: [meas], xLabel: 's', yLabel: '°C', hlines: [{ y: +car.tCvtMax, color: BT.css('--crit'), label: 'limite' }] });
      this.plot('cvProj').set({ empty: 'sem modelo' });
      $('cvNote').textContent = '';
      return;
    }
    const th = r.th;
    $('cvTiles').innerHTML =
      tile('Máxima medida', fx(tmax, 1), '°C') +
      tile('Aquece andando', fx(r.heatRate, 1), '°C/min (média)') +
      tile('Esfria parado', fx(r.coolRate, 1), '°C/min (média)') +
      tile('Regime no enduro', fx(r.Tss, 0), `°C com ${fx(r.Pm, 1)} kW a ${fx(r.vm * 3.6, 0)} km/h`) +
      tile('Constante de tempo', fx(r.tauMove / 60, 1), `min andando · ${isFinite(r.tauStop) ? fx(r.tauStop / 60, 0) + ' min parado' : '—'}`) +
      tile(`Após ${car.endurance} min`, fx(r.Tend, 0), '°C repetindo este trecho') +
      tile('Chega no limite', ok(r.tReach) ? r.tReach.toFixed(0) : 'não', ok(r.tReach) ? 'min de enduro' : `chega (limite ${car.tCvtMax} °C)`) +
      tile('Troca de calor', r.coolNeed > 1 ? `+${((r.coolNeed - 1) * 100).toFixed(0)} %` : 'ok', r.coolNeed > 1 ? `necessária para ficar em ${car.tCvtMax} °C` : `margem de ${fx(r.Tlim - r.Tss, 0)} °C no regime`);
    const each10 = (r.Tss - r.Ta) * (1 - 1 / 1.1);
    $('cvBody').innerHTML = `<p class="small">Modelo ajustado (R² ${r.r2.toFixed(2)}, erro RMS ${r.rmse.toFixed(1)} °C):<br>` +
      `<code>dT/dt = ${th[0].toExponential(2)}·P − (${th[1].toExponential(2)} + ${th[2].toExponential(2)}·v)·(T − ${r.Ta})</code> ` +
      `<span class="mut">(°C/s, P em kW na roda, v em m/s)</span></p>` +
      `<p class="mut small">Leitura: o ar em movimento ${ok(r.vGain) && isFinite(r.vGain) ? `dobra a troca de calor a partir de ${(r.vGain * 3.6).toFixed(0)} km/h` : 'pouco muda a troca de calor'}; ` +
      `cada +10 % de troca de calor (duto, abertura, ventoinha) baixa o regime em ~${each10.toFixed(0)} °C. O regime supõe o enduro com o mesmo ritmo deste trecho.</p>`;
    const Tm = [];
    for (let i = i0; i <= i1; i += 5) Tm.push(r.Tm[i]);
    this.plot('cvFit').set({
      series: [meas, { x: meas.x, y: Float64Array.from(Tm), color: BT.css('--c2'), label: 'modelo' }],
      xLabel: 's', yLabel: '°C', hlines: [{ y: +car.tCvtMax, color: BT.css('--crit'), label: 'limite' }],
      tipX: x => `<b>${x.toFixed(0)} s</b>`, fmtY: y => y.toFixed(1) + ' °C'
    });
    this.plot('cvProj').set({
      series: [{ x: r.proj.x, y: r.proj.y, color: BT.css('--c1'), label: 'projeção' }],
      hlines: [{ y: +car.tCvtMax, color: BT.css('--crit'), label: `limite ${car.tCvtMax} °C` }, { y: r.Tss, color: BT.css('--muted'), label: `regime ${r.Tss.toFixed(0)} °C` }],
      xLabel: 'min de enduro (começando na temperatura ambiente)', yLabel: '°C', yRange: [Math.min(+car.tAmb, tmin) - 5, Math.max(+car.tCvtMax, r.Tss, tmax) + 8],
      tipX: x => `<b>${x.toFixed(0)} min</b>`, fmtY: y => y.toFixed(1) + ' °C'
    });
    $('cvNote').textContent = 'Modelo de 1ª ordem: o calor gerado na correia é proporcional à potência transmitida e a troca de calor cresce com a velocidade do carro. Não vê patinação da correia em baixa nem sol direto; confira com logs longos.';
  },

  /* ================================================================ suspensão: rolagem, arfagem, saltos */
  renderSuspExtra(i0, i1) {
    const A = this.A, car = A.cfg.car, ang = A.ang || {}, acc = A.acc || {}, t = A.S.t;
    const mv = movingMask(A);
    const gr = this.grad = BT.gradients(ang, acc, mv, i0, i1);
    $('grNote').textContent = (ang.mrKnown ? '' : 'Relação roda/amortecedor não informada: os ângulos saem com o curso do amortecedor (ficam menores que os reais). ') +
      `Acelerações ${acc.src || '—'}. Bitola ${car.trackF}/${car.trackR} mm, entre-eixos ${car.wb} mm.`;
    const sample = (xa, ya, m) => {
      const x = [], y = [];
      for (let i = i0; i <= i1; i += 2) if (ok(xa[i]) && ok(ya[i]) && (!m || m(i))) { x.push(xa[i]); y.push(ya[i]); }
      return { x: Float64Array.from(x), y: Float64Array.from(y) };
    };
    const line = (f, a, b, color, label) => ({ x: Float64Array.from([a, b]), y: Float64Array.from([f.slope * a + f.icpt, f.slope * b + f.icpt]), color, label, width: 2.5 });
    if (ang.roll && acc.lat) {
      const p = sample(acc.lat, ang.roll, i => !mv || mv[i]);
      const lim = Math.max(0.3, ...Array.from(p.x).map(Math.abs).filter(ok).sort((a, b) => b - a).slice(0, Math.ceil(p.x.length * 0.01) + 1));
      $('grRollT').innerHTML = gr.roll ? `Rolagem × aceleração lateral: <b>${gr.roll.slope.toFixed(2)} °/g</b> <span class="mut">(R² ${gr.roll.r2.toFixed(2)})</span>` : 'Rolagem × aceleração lateral';
      this.plot('grRoll').set({
        points: { x: p.x, y: p.y, alpha: 0.2 }, series: gr.roll ? [line(gr.roll, -lim, lim, BT.css('--c2'), `${gr.roll.slope.toFixed(2)} °/g`)] : [],
        xLabel: 'aceleração lateral (g, + direita)', yLabel: 'rolagem (°, + esq. comprimida)', xRange: [-lim, lim], legend: []
      });
    } else {
      $('grRollT').textContent = 'Rolagem × aceleração lateral';
      this.plot('grRoll').set({ empty: 'precisa dos dois amortecedores de um eixo e de aceleração lateral' });
    }
    if (ang.pitch && acc.lon) {
      const p = sample(acc.lon, ang.pitch, i => !mv || mv[i]);
      let lo = -0.3, hi = 0.3;
      for (const x of p.x) { if (x < lo) lo = x; if (x > hi) hi = x; }
      const s = [];
      if (gr.pitchBrake) s.push(line(gr.pitchBrake, lo, 0, BT.css('--c2'), 'frenagem'));
      if (gr.pitchAccel) s.push(line(gr.pitchAccel, 0, hi, BT.css('--c3'), 'aceleração'));
      $('grPitchT').innerHTML = 'Arfagem × aceleração longitudinal: ' +
        (gr.pitchBrake ? `frenagem <b>${Math.abs(gr.pitchBrake.slope).toFixed(2)} °/g</b> ` : '') +
        (gr.pitchAccel ? `· aceleração <b>${Math.abs(gr.pitchAccel.slope).toFixed(2)} °/g</b>` : '');
      this.plot('grPitch').set({ points: { x: p.x, y: p.y, alpha: 0.2 }, series: s, xLabel: 'aceleração longitudinal (g, + acelerando)', yLabel: 'arfagem (°, + frente baixa)' });
    } else {
      $('grPitchT').textContent = 'Arfagem × aceleração longitudinal';
      this.plot('grPitch').set({ empty: 'precisa de amortecedor na frente e atrás e de aceleração longitudinal' });
    }

    /* saltos e fim de curso */
    const J = this.jumpList = A.veh ? BT.jumps(t, A.susp, A.veh, car, i0, i1) : [];
    const B = BT.bottomOuts(t, A.susp, car, i0, i1);
    const act = A.susp.shocks.filter(k => k.active);
    let h = '';
    if (J.length) {
      h += '<table class="ana-table"><tr><th>#</th><th>t</th><th>Vel.</th><th>No ar</th><th>Altura</th><th>V pouso</th>' +
        act.map(k => `<th>${k.id}: vel. / curso</th>`).join('') + '<th>Roda disparou</th></tr>';
      J.forEach((j, n) => {
        h += `<tr class="lap" data-t="${j.t0}"><td>${n + 1}</td><td>${j.t0.toFixed(1)} s</td><td>${j.v.toFixed(0)} km/h</td><td>${(j.T * 1000).toFixed(0)} ms</td>` +
          `<td>${(j.h * 100).toFixed(0)} cm</td><td>${j.vland.toFixed(2)} m/s</td>` +
          act.map(k => { const s = j.shock[k.id]; return `<td>${s.vmax.toFixed(0)} mm/s · ${s.travel.toFixed(0)} mm${s.bottom ? ' <b title="passou de 95 % do curso">⚠ fim</b>' : ''}</td>`; }).join('') +
          `<td>${ok(j.over) ? '+' + (j.over * 100).toFixed(0) + ' %' : '—'}</td></tr>`;
      });
      h += '</table>';
    } else h += '<p class="mut small">Nenhum salto detectado neste trecho.</p>';
    const strokeKnown = +car.strokeF > 0 || +car.strokeR > 0;
    h += `<p class="small">${strokeKnown
      ? `Fim de curso (≥ 95 % do curso total): ${act.map(k => `${k.id} ${B.filter(b => b.id === k.id).length}×`).join(' · ')}.`
      : '<span class="mut">Informe o curso total dos amortecedores em “Dados do carro” para contar as batidas no fim de curso.</span>'}</p>`;
    $('jpTable').innerHTML = h;
    $('jpTable').querySelectorAll('tr[data-t]').forEach(r => { r.onclick = () => A.seek(+r.dataset.t - 0.5); });
  },

  /* ================================================================ pista × ressonância */
  renderRoadRes(i0, i1) {
    const A = this.A, act = A.susp.shocks.filter(k => k.active), box = $('rrTable');
    const dist = A.veh && A.veh.dist ? A.veh.dist : A.track && A.track.ok ? A.track.dist : null;
    const mv = movingMask(A);
    const r = dist && mv && act.length ? BT.roadSpectrum(act.map(k => k.disp), dist, mv, i0, i1) : null;
    if (!r) {
      box.innerHTML = '<p class="mut small">Precisa de distância (roda ou GPS), amortecedores com sinal e trechos andando de pelo menos ~70 m.</p>';
      this.plot('rrPlot').set({ empty: 'sem dados' });
      return;
    }
    const ev = this.events && this.events[0];
    const F = axleDrop(ev, 'F'), R = axleDrop(ev, 'R');
    const sp = [];
    for (let i = i0; i <= i1; i++) if (mv[i] && A.veh && A.veh.v && A.veh.v[i] > 1) sp.push(A.veh.v[i] * 3.6);
    sp.sort((a, b) => a - b);
    const v10 = BT.quant(sp, 0.1), v50 = BT.quant(sp, 0.5), v90 = BT.quant(sp, 0.9);
    const peaks = BT.localPeaks(r.f, r.p, 1 / 16, 1 / 0.8, 5);
    const crit = (fn, lam) => (ok(fn) ? fn * lam * 3.6 : NaN);
    let h = `<table class="ana-table"><tr><th>Ondulação λ</th><th>Excita a dianteira a</th><th>Excita a traseira a</th><th>Leitura</th></tr>`;
    peaks.forEach(p => {
      const lam = 1 / p.f, vf = crit(F.fn, lam), vr = crit(R.fn, lam);
      let obs = '';
      const self = [F.fn, R.fn].some(fn => ok(fn) && Math.abs(lam - v50 / 3.6 / fn) / lam < 0.15);
      if (self) obs = 'provável a própria ressonância (λ ≈ v típica ÷ fₙ)';
      else if ([vf, vr].some(v => ok(v) && v >= v10 && v <= v90)) obs = '⚠ cai na faixa de velocidade usual';
      h += `<tr><td><b>${lam.toFixed(1)} m</b></td><td>${ok(vf) ? vf.toFixed(0) + ' km/h' : '—'}</td><td>${ok(vr) ? vr.toFixed(0) + ' km/h' : '—'}</td><td class="mut">${obs}</td></tr>`;
    });
    h += '</table><p class="mut small">' + (ok(F.fn) || ok(R.fn)
      ? `Com f<sub>n</sub> do teste de queda: diant. ${fx(F.fn, 2)} Hz, tras. ${fx(R.fn, 2)} Hz. Faixa de velocidade usual (10–90 %): ${fx(v10, 0)}–${fx(v90, 0)} km/h.`
      : 'Faça um teste de queda (aba Ressonância) para calcular as velocidades críticas.') + '</p>';
    box.innerHTML = h;
    this.plot('rrPlot').set({
      series: [{ x: r.f, y: r.p, color: BT.css('--c1'), label: 'curso (média dos amortecedores)' }],
      logY: true, legend: [], xRange: [0, 1.25],
      markers: peaks.map((p, k) => ({ x: p.f, color: BT.css('--muted'), label: `${(1 / p.f).toFixed(1)} m`, row: k % 3 })),
      xLabel: 'ciclos por metro (1/λ)', yLabel: 'mm²·m', tipX: x => `<b>${x > 0 ? (1 / x).toFixed(2) : '∞'} m</b> (${x.toFixed(2)} ciclos/m)`, fmtY: y => y.toPrecision(2)
    });
  },

  /* ================================================================ projeto (ficha) */
  renderDesign() {
    const A = this.A, car = A.cfg.car, t = A.S.t, n = t.length;
    const [i0, i1, label] = this.range();
    $('dsWin').textContent = label;
    const rows = [], rec = [];
    const row = (grp, item, val, how, read) => rows.push({ grp, item, val, how: how || '', read: read || '' });
    const act = A.susp ? A.susp.shocks.filter(k => k.active) : [];
    const mv = movingMask(A);
    const veh = A.veh || {};

    /* ---------- suspensão ---------- */
    const ev = act.length ? BT.dropTests(t, A.susp.shocks, A.stopped, 0, n - 1)[0] : null;
    const F = axleDrop(ev, 'F'), R = axleDrop(ev, 'R');
    if (act.length) {
      row('Suspensão', 'Amortecedores com sinal', act.map(k => k.id).join(', ') + (act.length < 4 ? ` (faltam ${BT.CORNERS.filter(c => !act.some(k => k.id === c.id)).map(c => c.id).join(', ')})` : ''), 'canais Shock do log');
      if (ev) {
        row('Suspensão', 'Frequência natural diant. / tras.', `${fx(F.fn, 2)} / ${fx(R.fn, 2)} Hz`, `teste de queda em t = ${ev.t.toFixed(1)} s`,
          ok(F.fn) && ok(R.fn) ? `tras./diant. = ${(R.fn / F.fn).toFixed(2)}` : '');
        row('Suspensão', 'Amortecimento ζ diant. / tras.', `${fx(F.zeta, 2)} / ${fx(R.zeta, 2)}`, 'decremento logarítmico');
        if (ok(F.fn) && ok(R.fn)) {
          const ratio = R.fn / F.fn;
          if (ratio < 1) rec.push(`A traseira está com frequência menor que a dianteira (${ratio.toFixed(2)}×). A regra do “flat ride” (Olley) sugere a traseira 10–20 % acima da dianteira, para o carro não “galopar” em lombadas.`);
          else if (ratio > 1.3) rec.push(`A traseira está ${((ratio - 1) * 100).toFixed(0)} % acima da dianteira em frequência; a referência do “flat ride” é 10–20 %.`);
        }
        [['dianteira', F], ['traseira', R]].forEach(([nm, x]) => {
          if (!ok(x.zeta)) return;
          if (x.zeta < 0.2) rec.push(`ζ da ${nm} = ${x.zeta.toFixed(2)}: pouco amortecida (oscila depois de cada obstáculo). Referência comum em fora-de-estrada: ~0,25–0,5.`);
          if (x.zeta > 0.6) rec.push(`ζ da ${nm} = ${x.zeta.toFixed(2)}: muito amortecida (dura em impactos). Referência comum: ~0,25–0,5.`);
        });
        const rF = BT.rideRates(F.fn, F.zeta, +car.massF, +car.mrF), rR = BT.rideRates(R.fn, R.zeta, +car.massR, +car.mrR);
        if (rF || rR) row('Suspensão', 'Rigidez equivalente na roda diant. / tras.', `${rF ? (rF.k / 1000).toFixed(1) : '—'} / ${rR ? (rR.k / 1000).toFixed(1) : '—'} N/mm`, 'k = m·(2π·fₙ)², com a massa suspensa por roda',
          'inclui o pneu em série; mola na roda ≈ um pouco maior');
        if (rF || rR) row('Suspensão', 'Amortecimento na roda diant. / tras.', `${rF ? rF.c.toFixed(0) : '—'} / ${rR ? rR.c.toFixed(0) : '—'} N·s/m`, 'c = 2ζ·√(k·m)',
          (rF && ok(rF.cShock)) || (rR && ok(rR.cShock)) ? `no amortecedor: ${rF && ok(rF.cShock) ? rF.cShock.toFixed(0) : '—'} / ${rR && ok(rR.cShock) ? rR.cShock.toFixed(0) : '—'} N·s/m (× MR²)` : 'informe a relação roda/amortecedor para ter no amortecedor');
        if (!rF && !rR) row('Suspensão', 'Rigidez e amortecimento', '—', 'precisa da massa suspensa por roda (Dados do carro)');
      } else row('Suspensão', 'Frequência natural e ζ', '—', 'faça um teste de queda com o carro parado e o log gravando');
      /* curso e velocidade */
      ['F', 'R'].forEach(ax => {
        const ks = act.filter(k => k.axle === ax);
        if (!ks.length) return;
        const stroke = ax === 'F' ? +car.strokeF : +car.strokeR, nm = ax === 'F' ? 'diant.' : 'tras.';
        let used = 0, vc = [], vr = [], vmaxC = 0;
        ks.forEach(k => {
          let mn = Infinity, mx = -Infinity;
          for (let i = i0; i <= i1; i++) { const p = k.static + k.disp[i]; if (p < mn) mn = p; if (p > mx) mx = p; if (k.v[i] > vmaxC) vmaxC = k.v[i]; }
          used = Math.max(used, mx - mn);
          const s = BT.velStats(k.v, i0, i1, mv, +A.cfg.susp.knee || 100);
          if (s) { vc.push(s.p95C); vr.push(s.p95R); }
        });
        const sug = Math.ceil(used * 1.15 / 5) * 5;
        row('Suspensão', `Curso usado ${nm}`, `${used.toFixed(0)} mm${stroke > 0 ? ` (${(used / stroke * 100).toFixed(0)} % de ${stroke})` : ''}`, 'máx. − mín. da posição no trecho', `curso mínimo sugerido: ${sug} mm (+15 %)`);
        if (stroke > 0) {
          const nb = BT.bottomOuts(t, A.susp, car, i0, i1).filter(b => ks.some(k => k.id === b.id)).length;
          if (nb) rec.push(`A ${nm === 'diant.' ? 'dianteira' : 'traseira'} bateu no fim de curso ${nb} vez(es): aumentar o curso, a rigidez ou usar batente progressivo. Curso usado ${used.toFixed(0)} de ${stroke} mm.`);
          else if (used / stroke < 0.6) rec.push(`A ${nm === 'diant.' ? 'dianteira' : 'traseira'} usou só ${(used / stroke * 100).toFixed(0)} % do curso: dá para amaciar a mola ou baixar o carro (se a pista do log for representativa).`);
        }
        row('Suspensão', `Velocidade do amortecedor ${nm}`, `${fx(mean(vc), 0)} comp. / ${fx(mean(vr), 0)} ext. mm/s (p95)`, `máx. compressão ${vmaxC.toFixed(0)} mm/s`, 'faixa de trabalho das válvulas');
      });
      const gr = BT.gradients(A.ang || {}, A.acc || {}, mv, i0, i1);
      if (gr.roll) row('Suspensão', 'Gradiente de rolagem', `${gr.roll.slope.toFixed(2)} °/g`, `rolagem × acel. lateral (R² ${gr.roll.r2.toFixed(2)})`, A.ang.mrKnown ? '' : 'sem a relação roda/amortecedor: subestimado');
      if (gr.pitchBrake || gr.pitchAccel) row('Suspensão', 'Gradiente de arfagem frenagem / aceleração',
        `${gr.pitchBrake ? Math.abs(gr.pitchBrake.slope).toFixed(2) : '—'} / ${gr.pitchAccel ? Math.abs(gr.pitchAccel.slope).toFixed(2) : '—'} °/g`, 'arfagem × acel. longitudinal', 'compare para avaliar anti-mergulho / anti-agachamento');
      const J = A.veh ? BT.jumps(t, A.susp, A.veh, car, i0, i1) : [];
      if (J.length) {
        const top = J.reduce((a, b) => (b.T > a.T ? b : a));
        let vl = 0;
        J.forEach(j => Object.values(j.shock).forEach(s => { if (s.vmax > vl) vl = s.vmax; }));
        row('Suspensão', 'Saltos', `${J.length} · maior ${(top.T * 1000).toFixed(0)} ms no ar, ${(top.h * 100).toFixed(0)} cm`, 'todos os amortecedores estendidos ao mesmo tempo', `pouso a ${top.vland.toFixed(1)} m/s; amortecedor até ${vl.toFixed(0)} mm/s`);
        rec.push(`Nos pousos o amortecedor chega a ~${vl.toFixed(0)} mm/s em compressão: a válvula de alta velocidade e o batente precisam trabalhar até aí.`);
      }
      const rough = A.channel('susp:rough');
      if (rough) {
        const a = [];
        for (let i = i0; i <= i1; i++) if ((!mv || mv[i]) && ok(rough.data[i])) a.push(rough.data[i]);
        a.sort((x, y) => x - y);
        row('Pista', 'Rugosidade (vel. amortecedores RMS)', `${fx(BT.quant(a, 0.5), 0)} mediana · ${fx(BT.quant(a, 0.95), 0)} p95 mm/s`, 'canal “Rugosidade” — pinte o mapa com ele para ver os trechos duros');
      }
      const dist = veh.dist || (A.track && A.track.ok ? A.track.dist : null);
      const rs = dist && mv ? BT.roadSpectrum(act.map(k => k.disp), dist, mv, i0, i1) : null;
      if (rs) {
        const pk = BT.localPeaks(rs.f, rs.p, 1 / 16, 1 / 0.8, 3).map(p => 1 / p.f);
        row('Pista', 'Ondulações dominantes', pk.map(l => l.toFixed(1) + ' m').join(' · '), 'espectro do curso por distância',
          ok(F.fn) ? `excitam a dianteira a ${pk.map(l => (F.fn * l * 3.6).toFixed(0)).join(' / ')} km/h` : 'teste de queda dá as velocidades críticas');
      }
    } else row('Suspensão', 'Amortecedores', 'nenhum com sinal', 'ligue/configure os potenciômetros');

    /* ---------- trem de força ---------- */
    if (veh.v) {
      if (veh.wheel) {
        row('Trem de força', 'Calibração da velocidade da roda', veh.kN ? `fator ${veh.k.toFixed(4)} (a roda marca ${veh.k < 1 ? '+' : ''}${((1 / veh.k - 1) * 100).toFixed(1)} %)` : '—', 'distância roda × GPS em trechos sem aceleração',
          veh.kN ? `circunferência certa = atual × ${veh.k.toFixed(4)}` : 'precisa de GPS');
        if (veh.kN && Math.abs(veh.k - 1) > 0.01) rec.push(`Corrija a circunferência do pneu na FT: multiplique o valor atual por ${veh.k.toFixed(4)} (a roda marca ${((1 / veh.k - 1) * 100).toFixed(1)} % ${veh.k < 1 ? 'a mais' : 'a menos'} que o GPS).`);
      } else row('Trem de força', 'Velocidade da roda', 'sem canal', 'usando o GPS (aceleração pouco precisa)');
      let vmax = 0, bmax = 0, lat = 0;
      for (let i = i0; i <= i1; i++) {
        if (veh.v[i] > vmax) vmax = veh.v[i];
        if (-veh.ax[i] > bmax) bmax = -veh.ax[i];
        if (A.acc && A.acc.lat && Math.abs(A.acc.lat[i]) > lat) lat = Math.abs(A.acc.lat[i]);
      }
      const pc = BT.powerCurve(veh.v, veh.P, veh.ax, i0, i1, 2, veh.slip);
      let pmax = 0, pv = NaN;
      pc.y.forEach((y, k) => { if (y > pmax) { pmax = y; pv = pc.x[k]; } });
      row('Trem de força', 'Velocidade máxima', `${(vmax * 3.6).toFixed(1)} km/h`, veh.wheel ? 'roda corrigida' : 'GPS');
      row('Trem de força', 'Potência máxima na roda', `${pmax.toFixed(2)} kW a ${fx(pv, 0)} km/h`, `(m·a + F_res)·v com m = ${car.mass} kg, Crr ${car.crr}, CdA ${car.cda}`,
        `${(pmax / car.power * 100).toFixed(0)} % dos ${car.power} kW do motor chegam à roda`);
      const dist = car.wheelDriven && A.track && A.track.ok ? A.track.dist : veh.dist;
      const L = BT.launches(t, veh.v, dist, veh.slip, veh.ax).filter(l => l.t0 >= t[i0] && l.t0 <= t[i1]);
      if (L.length) {
        const b = L.reduce((a, c) => (ok(c.d30) && (!ok(a.d30) || c.d30 < a.d30) ? c : a));
        const sl = mean(L.map(l => l.slip10).filter(ok));
        row('Trem de força', 'Melhor largada', `0–30 m ${fx(b.d30, 2)} s · 0–20 km/h ${fx(b.v20, 2)} s`, `${L.length} largada(s) do carro parado`,
          ok(sl) ? `escorregamento médio nos 10 m: ${(sl * 100).toFixed(0)} %` : '');
        if (ok(sl) && sl > 0.2) rec.push(`Na largada a roda de tração escorregou ${(sl * 100).toFixed(0)} % nos primeiros 10 m: a largada está limitada por tração. Vale rever o engate da CVT, o pneu/pressão e a distribuição de peso.`);
      }
      row('Trem de força', 'Frenagem máx. / lateral máx.', `${bmax.toFixed(2)} g / ${lat.toFixed(2)} g`, A.acc ? A.acc.src : '');
      const co = BT.findCoasts(t, veh.v, veh.ax, i0, i1);
      const f = co.length ? BT.coastFit(veh.v, veh.a, co[0].i0, co[0].i1, +car.mass, +car.rho) : null;
      row('Trem de força', 'Resistência ao rolamento e arrasto', f ? `Crr ${f.crr.toFixed(3)} · CdA ${f.cda > 0 ? f.cda.toFixed(2) + ' m²' : '—'}` : '—',
        f ? `coast-down ${co[0].t0.toFixed(0)}–${co[0].t1.toFixed(0)} s (R² ${f.r2.toFixed(2)})` : 'faça um coast-down (aba Trem de força)',
        f ? `rolar a 30 km/h custa ${((f.A + f.B * 69.4) * 8.33 / 1000).toFixed(2)} kW` : '');
    }

    /* ---------- CVT ---------- */
    if (veh.cvt && veh.v) {
      const r = BT.cvtFit(t, veh.cvt.data, veh.v, veh.P, car, i0, i1);
      let tmax = -Infinity;
      for (let i = i0; i <= i1; i++) if (veh.cvt.data[i] > tmax) tmax = veh.cvt.data[i];
      row('CVT', 'Temperatura máxima medida', `${tmax.toFixed(1)} °C`, `canal ${veh.cvt.name}`);
      if (r.ok) {
        row('CVT', 'Regime previsto no enduro', `${r.Tss.toFixed(0)} °C`, `modelo térmico ajustado (R² ${r.r2.toFixed(2)}), ambiente ${car.tAmb} °C`, `após ${car.endurance} min: ${r.Tend.toFixed(0)} °C`);
        row('CVT', 'Constante de tempo', `${(r.tauMove / 60).toFixed(1)} min andando`, 'quanto demora para chegar a 63 % do regime');
        if (r.coolNeed > 1) rec.push(`A CVT deve passar de ${car.tCvtMax} °C no enduro (regime ${r.Tss.toFixed(0)} °C${ok(r.tReach) ? `, aos ${r.tReach.toFixed(0)} min` : ''}): precisa de ~${((r.coolNeed - 1) * 100).toFixed(0)} % a mais de troca de calor (duto de ar, aberturas, aletas).`);
        else rec.push(`CVT: regime previsto ${r.Tss.toFixed(0)} °C, margem de ${(r.Tlim - r.Tss).toFixed(0)} °C até o limite de ${car.tCvtMax} °C.`);
      } else row('CVT', 'Modelo térmico', '—', r.msg);
    } else row('CVT', 'Temperatura', 'sem canal', 'escolha o canal em Dados do carro');

    const groups = [...new Set(rows.map(r => r.grp))];
    $('dsTable').innerHTML = '<table class="ana-table design"><tr><th>Grandeza</th><th>Valor</th><th>Como foi medido</th><th>Leitura para o projeto</th></tr>' +
      groups.map(g => `<tr class="grp"><td colspan="4">${BT.esc(g)}</td></tr>` + rows.filter(r => r.grp === g).map(r =>
        `<tr><td>${BT.esc(r.item)}</td><td><b>${BT.esc(r.val)}</b></td><td class="mut">${BT.esc(r.how)}</td><td>${BT.esc(r.read)}</td></tr>`).join('')).join('') + '</table>';
    $('dsRec').innerHTML = rec.length ? `<div class="note"><b>Pontos de atenção para o projeto</b><ul>${rec.map(r => `<li>${BT.esc(r)}</li>`).join('')}</ul></div>` : '';
    this.designRows = rows; this.designRec = rec;
    $('dsExport').onclick = () => {
      const q = s => `"${String(s).replace(/"/g, '""')}"`;
      const o = ['grupo,grandeza,valor,como,leitura'].concat(rows.map(r => [r.grp, r.item, r.val, r.how, r.read].map(q).join(',')))
        .concat(['', 'pontos de atenção'], rec.map(q)).join('\n');
      BT.download(A.S.name.replace(/\.(csv|txt|log)$/i, '') + '_ficha_projeto.csv', '﻿' + o);
    };
  }
});
})();
