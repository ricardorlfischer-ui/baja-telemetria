/* Aplicação: estado, carregamento de arquivos, play em tempo real e ligação da interface. */
'use strict';
(() => {
const $ = BT.$;

const A = BT.app = {
  S: null,                 /* sessão carregada (parsers.js) */
  track: null,             /* trajetória calculada (gps.js) */
  laps: [],
  all: [],                 /* canais: calculados do GPS + do log */
  cfg: Object.assign({}, BT.DEFAULT_CFG, BT.store.get('cfg', {})),
  susp: null,              /* amortecedores (analysis.js) */
  dyn: null,               /* acelerações pelo GPS */
  stopped: null,           /* 1 = carro parado */
  cur: 0,                  /* tempo do cursor (s) */
  playing: false, speed: 1, loop: false,
  sel: -1,                 /* volta selecionada (-1 = sessão inteira) */
  colorKey: 'gps:speed',
  hidden: new Set(BT.store.get('hidden', [])),
  showConst: false,
  followChart: true,
};

/* ---------------------------------------------------------------- canais */
const GPS_GROUP = 'Calculados do GPS';
function buildDerived() {
  const tr = A.track, S = A.S, out = [];
  if (!tr || !tr.ok) return out;
  const mk = (key, name, unit, data) => out.push(BT.finishChannel({ key, name, unit, data, src: 'gps' }));
  mk('gps:speed', 'GPS · Velocidade', 'km/h', tr.speed);
  mk('gps:lap', 'Tempo na volta', 's', lapTimeArray());
  mk('gps:x', 'GPS · X Leste', 'm', tr.x);
  mk('gps:y', 'GPS · Y Norte', 'm', tr.y);
  mk('gps:dist', 'GPS · Distância', 'm', tr.dist);
  if (A.laps.length >= 2) mk('gps:delta', 'Delta p/ melhor volta', 's', BT.deltaToBest(S, tr, A.laps));
  if (A.dyn) A.dyn.channels.forEach(c => { if (!(A.veh && A.veh.wheel && /gps:a(lon|lat)g?/.test(c.key))) out.push(c); });
  if (S.gps) {
    mk('gps:cx', 'Código X (calculado)', '', tr.codeX);
    mk('gps:cy', 'Código Y (calculado)', '', tr.codeY);
  }
  return out;
}
function lapTimeArray() {
  const t = A.S.t, out = new Float64Array(t.length).fill(NaN);
  A.laps.forEach(l => { for (let i = l.i0; i <= l.i1; i++) out[i] = t[i] - l.t0; });
  return out;
}
A.channel = key => A.all.find(c => c.key === key);
A.colorValues = () => (A.channel(A.colorKey) || A.channel('gps:speed') || { data: new Float64Array(A.S.t.length) }).data;

/* trecho ativo: a volta selecionada ou a sessão inteira */
A.range = () => {
  if (A.sel >= 0 && A.laps[A.sel]) return [A.laps[A.sel].i0, A.laps[A.sel].i1];
  return [0, A.S.t.length - 1];
};
const playBounds = () => {
  const t = A.S.t;
  if (A.sel >= 0 && A.laps[A.sel]) return [A.laps[A.sel].t0, A.laps[A.sel].t1];
  return [t[0], t[t.length - 1]];
};

/* ---------------------------------------------------------------- carregar */
function toast(msg, ms = 4000) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, ms);
}

async function loadFile(file) {
  if (!file) return;
  $('fileInfo').innerHTML = `<b>${BT.esc(file.name)}</b><span>lendo…</span>`;
  await new Promise(r => setTimeout(r, 20));
  try {
    const text = await file.text();
    setSession(BT.parseLog(text, file.name));
  } catch (e) {
    console.error(e);
    $('fileInfo').innerHTML = `<b>${BT.esc(file.name)}</b><span>Erro: ${BT.esc(e.message)}</span>`;
    toast('Não consegui ler o arquivo: ' + e.message);
  }
}

/* O exemplo usa os dados do carro simulado; os do carro real ficam guardados e voltam
 * ao abrir um log de verdade (e são eles que vão para o armazenamento). */
const DEMO_CAR = { mass: 260, wb: 1600, trackF: 1300, trackR: 1250, mrF: 1.6, mrR: 1.6, strokeF: 150, strokeR: 150,
  massF: 62, massR: 62, wheelCh: '', cvtCh: '', wheelDriven: true, tAmb: 28, tCvtMax: 100 };
function setSession(S) {
  pause();
  if (S.demo && !(A.S && A.S.demo)) { A.realCar = A.cfg.car; A.cfg.car = Object.assign({}, BT.DEFAULT_CAR, A.demoCar || DEMO_CAR); }
  else if (!S.demo && A.S && A.S.demo) { A.demoCar = A.cfg.car; A.cfg.car = A.realCar; }
  A.S = S; A.sel = -1;
  const keys = S.channels.map(c => c.key);
  /* canais X/Y: mantém a escolha salva se existir neste log; senão adivinha */
  if (!S.gps && (!keys.includes(A.cfg.chX) || !keys.includes(A.cfg.chY))) {
    const g = BT.guessGpsChannels(keys);
    A.cfg.chX = g.x; A.cfg.chY = g.y; A.cfg.chStatus = g.status;
  }
  if (A.cfg.chStatus && !keys.includes(A.cfg.chStatus)) A.cfg.chStatus = '';
  saveCfg();
  $('fileInfo').innerHTML = `<b>${BT.esc(S.name)}</b><span>${BT.esc(S.info)}</span>`;
  $('btnExport').disabled = false;
  $('player').classList.remove('off');
  recompute(true);
  A.cur = A.S.t[0];
  A.charts.setView(...A.charts.full());
  A.map.resize(); A.map.fit();
  requestAnimationFrame(() => { A.charts.layout(); A.requestRender(); });
}

/* recalcula GPS + voltas + canais (fresh = sessão nova, quem chama desenha) */
function recompute(fresh) {
  if (!A.S) return;
  A.track = BT.computeTrack(A.S, A.cfg);
  A.laps = BT.computeLaps(A.S, A.track, A.getLine(), +A.cfg.minLap || 10);
  if (A.sel >= A.laps.length) A.sel = -1;
  A.stopped = BT.stoppedMask(A.S, A.track);
  A.dyn = A.track.ok ? BT.gpsDynamics(A.S, A.track) : null;
  A.veh = BT.vehPrep(A.S, A.track, A.cfg.car, A.dyn);
  if (!A.stopped && A.veh.v) A.stopped = Uint8Array.from(BT.smooth(A.S.t, A.veh.v, 1), x => (x === x && x < 0.8 ? 1 : 0));
  /* acelerações: longitudinal pela roda (se houver), lateral = v × taxa de guinada do GPS */
  A.acc = {
    lon: A.veh.ax || (A.dyn && A.dyn.along), lat: (A.veh.wheel && A.veh.ay) || (A.dyn && A.dyn.alat),
    src: A.veh.wheel ? 'longitudinal pela velocidade da roda, lateral = velocidade da roda × guinada do GPS' : 'pela trajetória do GPS'
  };
  A.susp = BT.suspPrep(A.S, A.track, A.cfg.susp);
  A.ang = BT.bodyAngles(A.susp, A.cfg.car);
  const SG = 'Suspensão (calculado)', sc = (key, name, unit, data) => BT.finishChannel({ key, name, unit, data, src: 'calc', group: SG });
  if (A.ang.pitch) A.susp.channels.push(sc('susp:pitch', 'Arfagem (+ = frente baixa)', '°', A.ang.pitch));
  if (A.ang.rollF) A.susp.channels.push(sc('susp:rollF', 'Rolagem diant. (+ = esq. comprimida)', '°', A.ang.rollF));
  if (A.ang.rollR) A.susp.channels.push(sc('susp:rollR', 'Rolagem tras. (+ = esq. comprimida)', '°', A.ang.rollR));
  const rough = BT.roughness(A.S.t, A.susp);
  if (rough) A.susp.channels.push(sc('susp:rough', 'Rugosidade (vel. amortecedores, RMS 1 s)', 'mm/s', rough));
  const derived = buildDerived();
  A.all = derived.concat(A.veh.channels, A.susp.channels, A.S.channels);
  A.all.forEach(c => { c.group = c.group || (c.src === 'gps' ? GPS_GROUP : 'Do log'); });
  if (!A.channel(A.colorKey)) A.colorKey = A.channel('gps:speed') ? 'gps:speed' : (A.all.find(c => !c.constant) || A.all[0] || {}).key;
  $('mapMsg').hidden = A.track.ok;
  if (!A.track.ok) $('mapMsg').innerHTML = `<b>Sem trajetória</b><span>${BT.esc(A.track.msg)}</span>`;
  $('btnSat').disabled = !(A.track.center);
  fillColorBy();
  buildChips();
  buildNowTable();
  buildLaps();
  A.charts.setChannels(visibleChannels());
  A.map.invalidate();
  if (A.analysis) A.analysis.invalidate();
  if (!fresh) A.requestRender();
}
A.recompute = () => recompute();

/* ---------------------------------------------------------------- seletores */
/* todos os canais, por grupo; os constantes no fim (pintam a pista de uma cor só) */
function fillColorBy() {
  const opt = c => `<option value="${BT.esc(c.key)}">${BT.esc(c.name)}${c.unit ? ' (' + BT.esc(c.unit) + ')' : ''}${c.constant ? ' · constante' : ''}</option>`;
  const groups = [];
  A.all.forEach(c => {
    const g = c.constant ? 'Constantes' : c.group;
    let G = groups.find(x => x.g === g);
    if (!G) groups.push(G = { g, l: [] });
    G.l.push(c);
  });
  groups.sort((a, b) => (a.g === 'Constantes') - (b.g === 'Constantes'));
  $('colorBy').innerHTML = groups.map(G => `<optgroup label="${BT.esc(G.g)}">${G.l.map(opt).join('')}</optgroup>`).join('');
  $('colorBy').value = A.colorKey;
}
A.setColorKey = k => {
  A.colorKey = k;
  $('colorBy').value = k;
  A.map.invalidate();
  A.requestRender();
};

function visibleChannels() {
  return A.all.filter(c => !A.hidden.has(c.key) && (A.showConst || !c.constant));
}

function buildChips() {
  const box = $('chips');
  let html = '', grp = '';
  A.all.forEach(c => {
    if (c.group !== grp) { grp = c.group; html += `<div class="grp">${BT.esc(grp)}</div>`; }
    const on = !A.hidden.has(c.key) && (A.showConst || !c.constant);
    html += `<button class="chip${c.constant ? ' const' : ''}" data-k="${BT.esc(c.key)}" aria-pressed="${on}" title="${c.constant ? 'constante: ' + BT.fmtVal(c.lo, 3) : ''}">${BT.esc(c.name)}</button>`;
  });
  box.innerHTML = html;
  const vis = visibleChannels().length;
  $('chipsCount').textContent = `· ${vis} de ${A.all.length} visíveis` + (A.showConst ? '' : ` · ${A.all.filter(c => c.constant).length} constantes ocultos`);
}

function refreshCharts() {
  BT.store.set('hidden', [...A.hidden]);
  buildChips();
  A.charts.setChannels(visibleChannels());
  A.requestRender();
}

/* ---------------------------------------------------------------- painel "Agora" */
let nowRows = [];
function buildNowTable() {
  let html = '', grp = '';
  nowRows = [];
  const list = A.all.filter(c => !c.constant).concat(A.all.filter(c => c.constant));
  list.forEach((c, k) => {
    const g = c.constant ? 'Constantes' : c.group;
    if (g !== grp) { grp = g; html += `<tr class="grp"><td colspan="2">${BT.esc(g)}</td></tr>`; }
    html += `<tr data-k="${BT.esc(c.key)}" class="${c.constant ? 'dim' : ''}"><td>${BT.esc(c.name)}</td><td><span class="v">—</span><span class="u">${BT.esc(c.unit || '')}</span></td></tr>`;
  });
  $('nowTable').innerHTML = html;
  $('nowTable').querySelectorAll('tr[data-k]').forEach(tr => {
    const c = A.channel(tr.dataset.k);
    nowRows.push({ c, tr, v: tr.querySelector('.v'), dec: BT.decimalsFor(c.lo, c.hi) });
  });
}

const fmt0 = v => (v === v ? v.toFixed(0) : '—');
function updateNow() {
  const S = A.S, tr = A.track;
  if (!S) return;
  const i = BT.idxAt(S.t, A.cur);
  $('nowTime').textContent = BT.fmtTime(A.cur) + (S.clock0 ? ' · ' + clockAt(A.cur) : '');
  const L = lapAt(A.cur);
  $('nowLap').textContent = L ? `${L.n} · ${BT.fmtTime(A.cur - L.t0)}` : '—';
  if (tr && tr.ok) {
    const p = BT.posAt(S, tr, A.cur);
    $('heroSpeed').textContent = A.veh && A.veh.wheel ? fmt0(A.veh.v[i] * 3.6) : tr.valid[i] && isFinite(tr.speed[i]) ? tr.speed[i].toFixed(0) : '—';
    $('nowXY').textContent = p ? `${p.x.toFixed(1)} / ${p.y.toFixed(1)} m` : '—';
    $('nowLL').textContent = tr.lat && tr.valid[i] ? `${tr.lat[i].toFixed(6)}, ${tr.lon[i].toFixed(6)}` : '—';
    const b = $('gpsBadge');
    if (!tr.valid[i]) { b.className = 'badge serious'; b.textContent = 'Sem posição'; }
    else if (tr.sat[i]) { b.className = 'badge warn'; b.textContent = 'Na borda da área'; }
    else { b.className = 'badge good'; b.textContent = 'GPS ok'; }
  } else {
    $('heroSpeed').textContent = A.veh && A.veh.wheel ? fmt0(A.veh.v[i] * 3.6) : '—'; $('nowXY').textContent = '—'; $('nowLL').textContent = '—';
    const b = $('gpsBadge'); b.className = 'badge none'; b.textContent = 'Sem GPS';
  }
  nowRows.forEach(r => {
    r.v.textContent = BT.fmtVal(r.c.data[i], r.dec);
    r.tr.classList.toggle('hl', r.c.key === A.colorKey);
  });
  /* volta atual na tabela */
  const cur = L ? L.n - 1 : -1;
  if (cur !== updateNow.lastLap) {
    updateNow.lastLap = cur;
    document.querySelectorAll('#laps tr.lap').forEach(r => r.classList.toggle('cur', +r.dataset.k === cur));
  }
}

/* BUSMASTER: hora do relógio do PC */
const clockAt = tc => {
  const [h, m, s] = A.S.clock0.split(':').map(Number);
  const x = Math.floor(h * 3600 + m * 60 + s + tc) % 86400;
  return [x / 3600 | 0, (x % 3600) / 60 | 0, x % 60].map(v => String(v).padStart(2, '0')).join(':');
};
const lapAt = tc => A.laps.find(l => tc >= l.t0 && tc < l.t1) || null;

A.tipHtml = i => {
  const S = A.S, tr = A.track, c = A.channel(A.colorKey);
  const L = lapAt(S.t[i]);
  let h = `<b>t ${S.t[i].toFixed(2)} s</b>${L ? ` · volta ${L.n}` : ''}<br>`;
  h += `${tr.speed[i].toFixed(1)} km/h<br>`;
  if (c && c.key !== 'gps:speed') h += `<span>${BT.esc(c.name)}</span> ${BT.fmtVal(c.data[i], BT.decimalsFor(c.lo, c.hi))} ${BT.esc(c.unit || '')}`;
  return h;
};

A.setLegend = (lo, hi, dark) => {
  const c = A.channel(A.colorKey), dec = c ? BT.decimalsFor(c.lo, c.hi) : 1;
  if (dark !== A.legDark) { A.legDark = dark; $('legBar').style.background = BT.heatGradientCss(dark); }
  $('legLo').textContent = BT.fmtVal(lo, Math.max(0, dec - 1));
  $('legHi').textContent = BT.fmtVal(hi, Math.max(0, dec - 1)) + (c && c.unit ? ' ' + c.unit : '');
};

/* ---------------------------------------------------------------- voltas */
function buildLaps() {
  const box = $('laps');
  updateNow.lastLap = undefined;
  if (!A.track || !A.track.ok) { box.innerHTML = '<p class="mut">Sem trajetória de GPS neste log.</p>'; return; }
  if (!A.getLine()) { box.innerHTML = '<p class="mut">Defina a linha de largada no mapa (“Desenhar” ou “Automática”) para separar as voltas.</p>'; return; }
  if (!A.laps.length) { box.innerHTML = '<p class="mut">Nenhuma volta completa cruzando a linha. Ajuste a linha ou a volta mínima.</p>'; return; }
  const best = Math.min(...A.laps.map(l => l.time));
  let h = '<table><tr><th>Volta</th><th>Tempo</th><th>Δ melhor</th><th>V máx</th><th>V média</th><th>Dist.</th></tr>';
  A.laps.forEach((l, k) => {
    h += `<tr class="lap${k === A.sel ? ' sel' : ''}" data-k="${k}"><td>${l.n}</td><td class="${l.time === best ? 'best' : ''}">${BT.fmtTime(l.time)}</td>` +
      `<td>${l.time === best ? '—' : '+' + (l.time - best).toFixed(2)}</td><td>${l.vmax.toFixed(1)}</td><td>${l.vavg.toFixed(1)}</td><td>${l.dist.toFixed(0)} m</td></tr>`;
  });
  box.innerHTML = h + '</table><p class="mut" style="padding:8px 12px">km/h pelo GPS · clique numa volta para ver só ela</p>';
  box.querySelectorAll('tr.lap').forEach(r => r.onclick = () => selectLap(+r.dataset.k));
}

function selectLap(k) {
  A.sel = k;
  document.querySelectorAll('#laps tr.lap').forEach(r => r.classList.toggle('sel', +r.dataset.k === k));
  if (k >= 0) {
    const l = A.laps[k], pad = l.time * 0.02;
    A.charts.setView(l.t0 - pad, l.t1 + pad);
    A.seek(l.t0);
  } else A.charts.setView(...A.charts.full());
  A.map.invalidate();
  A.map.fit();
  if (A.analysis) A.analysis.invalidate(['maps', 'susp', 'freq', 'dyn']);
}

/* A linha fica salva junto com a pista (metros em torno do centro). A do exemplo fica só
 * na memória para não apagar a linha da pista real. */
A.getLine = () => (A.S && A.S.demo ? A.demoLine : A.cfg.line) || null;
A.setLine = pts => {
  const l = pts ? pts.map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) })) : null;
  if (A.S && A.S.demo) A.demoLine = l; else { A.cfg.line = l; saveCfg(); }
  A.sel = -1;
  recompute();
};
A.syncLineButton = () => {
  $('btnLine').classList.toggle('on', A.map.lineMode);
  $('mapWrap').classList.toggle('line-mode', A.map.lineMode);
  $('btnLine').textContent = A.map.lineMode ? `Clique ${2 - A.map.linePts.length}× no mapa…` : 'Desenhar (2 cliques)';
};

/* ---------------------------------------------------------------- play */
A.seek = tc => {
  if (!A.S) return;
  const t = A.S.t;
  A.cur = BT.clamp(tc, t[0], t[t.length - 1]);
  if (A.playing) lastWall = performance.now();
  A.requestRender();
};

let lastWall = 0, raf = 0;
function play() {
  if (!A.S) return;
  const [a, b] = playBounds();
  if (A.cur >= b - 1e-6 || A.cur < a) A.cur = a;
  A.playing = true; lastWall = performance.now();
  $('btnPlay').textContent = '❚❚'; $('btnPlay').setAttribute('aria-label', 'Pausar');
  A.requestRender();
}
function pause() {
  A.playing = false;
  $('btnPlay').textContent = '▶'; $('btnPlay').setAttribute('aria-label', 'Play');
}
A.requestRender = () => { if (!raf) raf = requestAnimationFrame(frame); };

function frame(now) {
  raf = 0;
  if (A.playing && A.S) {
    const dt = Math.min(0.25, (now - lastWall) / 1000);
    lastWall = now;
    const [a, b] = playBounds();
    A.cur += dt * A.speed;
    if (A.cur >= b) {
      if (A.loop) A.cur = a + (A.cur - b);
      else { A.cur = b; pause(); }
    }
    if (A.followChart) A.charts.followCursor(A.cur);
  }
  render();
  if (A.analysis) A.analysis.frame();
  if (A.playing) A.requestRender();
}

let lastNow = 0;
function render() {
  A.map.draw();
  if (!A.S) return;
  A.charts.draw();
  /* tabela e textos: até ~20×/s durante o play */
  const t = performance.now();
  if (!A.playing || t - lastNow > 50) { updateNow(); lastNow = t; }
  const [a, b] = [A.S.t[0], A.S.t[A.S.t.length - 1]];
  const sc = $('scrub');
  if (+sc.min !== a || +sc.max !== b) { sc.min = a; sc.max = b; }
  if (document.activeElement !== sc || A.playing) sc.value = A.cur;
  $('tDisp').textContent = `${BT.fmtTime(A.cur)} / ${BT.fmtTime(b)}`;
}

/* ---------------------------------------------------------------- configuração */
function saveCfg() { BT.store.set('cfg', A.S && A.S.demo && A.realCar ? Object.assign({}, A.cfg, { car: A.realCar }) : A.cfg); }
A.saveCfg = saveCfg;
A.cfg.susp = Object.assign({}, BT.DEFAULT_SUSP, A.cfg.susp || {});
/* dados do carro; curso, massas e relação de movimento moravam em cfg.susp */
A.cfg.car = Object.assign({}, BT.DEFAULT_CAR, A.cfg.car || {});
['strokeF', 'strokeR', 'massF', 'massR', 'mrF', 'mrR'].forEach(k => {
  if (!(+A.cfg.car[k] > 0) && +A.cfg.susp[k] > 0) A.cfg.car[k] = +A.cfg.susp[k];
  delete A.cfg.susp[k];
});

/* ---------------------------------------------------------------- dados do carro */
const CAR_NUM = { carMass: 'mass', carWb: 'wb', carTrackF: 'trackF', carTrackR: 'trackR', carMrF: 'mrF', carMrR: 'mrR',
  carStrokeF: 'strokeF', carStrokeR: 'strokeR', carMassF: 'massF', carMassR: 'massR', carTAmb: 'tAmb', carTMax: 'tCvtMax',
  carEndur: 'endurance', carCrr: 'crr', carCda: 'cda', carRho: 'rho', carPower: 'power' };
function carFill() {
  const c = A.cfg.car;
  Object.entries(CAR_NUM).forEach(([id, k]) => { $(id).value = c[k]; });
  const opts = (find, key) => {
    const auto = A.S ? find(A.S.channels) : null;
    return `<option value="">automático${auto ? ' (' + BT.esc(auto.name) + ')' : ''}</option>` +
      (A.S ? A.S.channels.map(ch => `<option value="${BT.esc(ch.key)}">${BT.esc(ch.name)}</option>`).join('') : '');
  };
  $('carWheelCh').innerHTML = opts(BT.findWheelCh); $('carWheelCh').value = c.wheelCh || '';
  $('carCvtCh').innerHTML = opts(BT.findCvtCh); $('carCvtCh').value = c.cvtCh || '';
  $('carWheelDriven').value = c.wheelDriven ? '1' : '0';
}
function carRead() {
  const c = A.cfg.car;
  Object.entries(CAR_NUM).forEach(([id, k]) => { const v = parseFloat(String($(id).value).replace(',', '.')); if (isFinite(v)) c[k] = v; });
  c.wheelCh = $('carWheelCh').value; c.cvtCh = $('carCvtCh').value; c.wheelDriven = $('carWheelDriven').value === '1';
  saveCfg();
  recompute();
}
A.openCar = () => { carFill(); $('carDlg').showModal(); };

function cfgFill() {
  const c = A.cfg;
  $('cLat').value = c.lat0; $('cLon').value = c.lon0; $('cFixed').checked = c.centerFixed;
  $('cSX').value = c.sizeX; $('cSY').value = c.sizeY; $('cMg').value = c.margin;
  $('cSm').value = c.smooth; $('cMl').value = c.minLap; $('cFmt').value = c.fmt;
  const opts = (none) => (none ? '<option value="">— nenhum —</option>' : '<option value="">— escolha —</option>') +
    (A.S ? A.S.channels.map(ch => `<option value="${BT.esc(ch.key)}">${BT.esc(ch.name)}</option>`).join('') : '');
  $('cChX').innerHTML = opts(); $('cChY').innerHTML = opts(); $('cChS').innerHTML = opts(true);
  $('cChX').value = c.chX; $('cChY').value = c.chY; $('cChS').value = c.chStatus;
  const bm = A.S && A.S.gps;
  ['cChX', 'cChY', 'cChS', 'cFmt', 'cSwap'].forEach(id => { $(id).disabled = !!bm; });
  cfgInfo();
}

function cfgInfo() {
  const c = A.cfg, sp = BT.spanOf(c);
  $('cRes').innerHTML = `Vão coberto: ${sp.x} × ${sp.y} m → resolução <b>${(sp.x / 255 * 100).toFixed(1)} cm</b> (X) e <b>${(sp.y / 255 * 100).toFixed(1)} cm</b> (Y) por passo.` +
    (c.centerFixed ? '' : ' Centro automático: o vão é o dobro do tamanho (o carro pode ligar na borda da pista).');
  const tr = A.track;
  if (A.S && A.S.gps) $('cDet').textContent = 'Log do BUSMASTER: a posição vem direto da latitude/longitude do módulo GPS (0x028).';
  else if (tr && tr.fmt) $('cDet').textContent = `Lendo ${tr.source}.` + (c.fmt === 'auto' ? ' Formato detectado automaticamente.' : '');
  else $('cDet').textContent = tr && tr.msg ? tr.msg : '';
  const half = sp.x / 2;
  $('cNote').innerHTML =
    `<b>Calibração na FT (FT Manager, entrada linear 0–5 V) para as entradas 7 e 8:</b>` +
    `<ul><li><b>0,00 V = 0</b> e <b>5,00 V = 5</b> → o log fica em volts e o app converte (código = V × 51). É o recomendado.</li>` +
    `<li>Evite “1 V = 1”: o PIC trava o valor no ponto mínimo da calibração, então tudo abaixo de 1 V (código &lt; 51, mais de ~${((128 - 51) * sp.x / 255).toFixed(0)} m a Oeste/Sul do centro) vira 1,000.</li>` +
    `<li>Metros direto (0 V = −${half} m, 5 V = +${half} m) não cabe nesses canais: a FT guarda com 3 casas em 16 bits (máx. ±32,767).</li></ul>`;
}

function cfgRead() {
  const c = A.cfg, num = (id, d) => { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) ? v : d; };
  c.lat0 = num('cLat', c.lat0); c.lon0 = num('cLon', c.lon0); c.centerFixed = $('cFixed').checked;
  c.sizeX = Math.max(1, num('cSX', c.sizeX)); c.sizeY = Math.max(1, num('cSY', c.sizeY)); c.margin = Math.max(0, num('cMg', c.margin));
  c.smooth = BT.clamp(num('cSm', c.smooth), 0, 3); c.minLap = Math.max(1, num('cMl', c.minLap));
  if (!(A.S && A.S.gps)) { c.chX = $('cChX').value; c.chY = $('cChY').value; c.chStatus = $('cChS').value; c.fmt = $('cFmt').value; }
  saveCfg();
  recompute();
  cfgInfo();
}

/* ---------------------------------------------------------------- exportar */
function exportCSV() {
  const S = A.S, tr = A.track;
  if (!S) return;
  const head = c => c.src === 'log' ? c.key
    : (c.name + (c.unit ? '_' + c.unit : '')).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
  const cols = [['TIME', S.t, 3]];
  A.all.forEach(c => cols.push([head(c), c.data, Math.max(BT.decimalsFor(c.lo, c.hi), c.src === 'log' ? 0 : 2)]));
  if (tr && tr.ok) {
    if (tr.lat) cols.push(['GPS_lat', tr.lat, 7], ['GPS_lon', tr.lon, 7]);
    const ln = new Float64Array(S.t.length).fill(NaN);
    A.laps.forEach(l => { for (let i = l.i0; i <= l.i1; i++) ln[i] = l.n; });
    cols.push(['Lap', ln, 0]);
  }
  let o = cols.map(c => c[0]).join(',') + '\n';
  for (let i = 0; i < S.t.length; i++) o += cols.map(c => { const v = c[1][i]; return v === v ? v.toFixed(c[2]) : ''; }).join(',') + '\n';
  BT.download(S.name.replace(/\.(csv|txt|log)$/i, '') + '_processado.csv', o);
}

/* ---------------------------------------------------------------- tema */
function applyTheme(m) {
  if (m === 'light' || m === 'dark') document.documentElement.dataset.theme = m;
  else delete document.documentElement.dataset.theme;
  $('btnTheme').title = 'Tema: ' + ({ light: 'claro', dark: 'escuro' }[m] || 'automático');
  A.map.invalidate(); A.charts.dirty = true;
  if (A.analysis) A.analysis.invalidate();
  A.requestRender();
}

/* ---------------------------------------------------------------- ligar a interface */
function init() {
  A.map = new BT.MapView($('map'), A);
  A.charts = new BT.Charts($('charts'), A);
  A.analysis = new BT.Analysis(A);
  A.onView = () => A.analysis.onView();
  $('player').classList.add('off');
  $('legBar').style.background = BT.heatGradientCss(BT.isDark());
  $('btnSat').setAttribute('aria-pressed', A.map.sat);
  $('btnFollowChart').setAttribute('aria-pressed', A.followChart);

  let theme = BT.store.get('theme', 'auto');
  applyTheme(theme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(theme));
  $('btnTheme').onclick = () => { theme = { auto: 'dark', dark: 'light', light: 'auto' }[theme]; BT.store.set('theme', theme); applyTheme(theme); };

  $('file').onchange = e => { loadFile(e.target.files[0]); e.target.value = ''; };
  $('btnDemo').onclick = () => {
    const S = BT.parseCSV(BT.demoCSV(), 'exemplo_baja.csv');
    S.demo = true;
    setSession(S);
    if (!A.demoLine) { const l = BT.autoLine(A.S, A.track); if (l) A.setLine(l); }
    toast('Sessão de exemplo carregada — aperte ▶ (ou espaço) para reproduzir');
  };
  $('btnExport').onclick = exportCSV;

  /* arrastar e soltar */
  let dragN = 0;
  addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragN++; $('drop').hidden = false; } });
  addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('drop').hidden = true; } });
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('drop').hidden = true; if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

  /* mapa */
  $('colorBy').onchange = e => { A.setColorKey(e.target.value); A.analysis.invalidate(['maps']); };
  $('btnSat').onclick = () => { A.map.sat = !A.map.sat; BT.store.set('sat', A.map.sat); $('btnSat').setAttribute('aria-pressed', A.map.sat); A.map.invalidate(); };
  A.setFollowMap = on => { A.map.follow = on; $('btnFollow').setAttribute('aria-pressed', on); if (!on) A.map.invalidate(); };
  $('btnFollow').onclick = () => A.setFollowMap(!A.map.follow);
  $('btnFit').onclick = () => { A.setFollowMap(false); A.map.fit(); };
  $('btnLine').onclick = () => { if (!A.S) return; A.map.lineMode = !A.map.lineMode; A.map.linePts = []; A.syncLineButton(); A.map.invalidate(); };
  $('btnAutoLine').onclick = () => {
    if (!A.S) return;
    const l = BT.autoLine(A.S, A.track);
    if (l) A.setLine(l); else toast('Não achei um trecho com o carro andando para pôr a linha');
  };
  $('btnClearLine').onclick = () => A.S && A.setLine(null);
  $('map').addEventListener('pointerup', () => { if (A.map.lineMode) A.syncLineButton(); });

  /* voltas */
  $('btnAllLaps').onclick = () => selectLap(-1);

  /* gráficos */
  $('btnZoomIn').onclick = () => A.S && A.charts.zoom(0.5, A.cur);
  $('btnZoomOut').onclick = () => A.S && A.charts.zoom(2, A.cur);
  $('btnZoomAll').onclick = () => A.S && A.resetChartView();
  A.resetChartView = () => {
    if (A.sel >= 0) { const l = A.laps[A.sel]; A.charts.setView(l.t0 - l.time * 0.02, l.t1 + l.time * 0.02); }
    else A.charts.setView(...A.charts.full());
  };
  $('btnFollowChart').onclick = () => { A.followChart = !A.followChart; $('btnFollowChart').setAttribute('aria-pressed', A.followChart); };
  $('chips').onclick = e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const k = b.dataset.k, c = A.channel(k);
    const on = b.getAttribute('aria-pressed') === 'true';
    if (on) A.hidden.add(k);
    else { A.hidden.delete(k); if (c.constant && !A.showConst) { A.showConst = true; $('showConst').checked = true; } }
    refreshCharts();
  };
  $('btnChipsAll').onclick = () => { A.all.forEach(c => A.hidden.delete(c.key)); refreshCharts(); };
  $('btnChipsNone').onclick = () => { A.all.forEach(c => A.hidden.add(c.key)); refreshCharts(); };
  $('showConst').onchange = e => { A.showConst = e.target.checked; refreshCharts(); };

  /* player */
  $('btnPlay').onclick = () => (A.playing ? pause() : play());
  $('btnStart').onclick = () => A.S && A.seek(playBounds()[0]);
  $('btnBack').onclick = () => A.seek(A.cur - 1);
  $('btnFwd').onclick = () => A.seek(A.cur + 1);
  $('speed').onchange = e => { A.speed = +e.target.value; };
  $('loop').onchange = e => { A.loop = e.target.checked; };
  $('scrub').oninput = e => A.seek(+e.target.value);

  addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea,dialog') || !A.S) return;
    const dt = A.S.t.length > 1 ? A.S.t[1] - A.S.t[0] : 0.04;
    if (e.code === 'Space') { e.preventDefault(); A.playing ? pause() : play(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); A.seek(A.cur + (e.shiftKey ? 1 : dt)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); A.seek(A.cur - (e.shiftKey ? 1 : dt)); }
    else if (e.key === 'Home') { e.preventDefault(); A.seek(playBounds()[0]); }
    else if (e.key === 'End') { e.preventDefault(); A.seek(playBounds()[1]); }
  });
  /* espaço num botão focado não deve "clicar" de novo depois do play/pausa */
  addEventListener('keyup', e => { if (e.code === 'Space' && e.target.tagName === 'BUTTON' && A.S) e.preventDefault(); });

  /* configuração */
  $('btnCfg').onclick = () => { cfgFill(); $('cfgDlg').showModal(); };
  $('btnCar').onclick = () => A.openCar();
  [...Object.keys(CAR_NUM), 'carWheelCh', 'carCvtCh', 'carWheelDriven'].forEach(id => { $(id).onchange = carRead; });
  $('carReset').onclick = () => { A.cfg.car = Object.assign({}, BT.DEFAULT_CAR, A.S && A.S.demo ? DEMO_CAR : {}); carFill(); saveCfg(); recompute(); };
  ['cLat', 'cLon', 'cFixed', 'cSX', 'cSY', 'cMg', 'cSm', 'cMl', 'cChX', 'cChY', 'cChS', 'cFmt'].forEach(id => { $(id).onchange = cfgRead; });
  $('cSwap').onclick = () => { const x = $('cChX').value; $('cChX').value = $('cChY').value; $('cChY').value = x; cfgRead(); };
  $('cReset').onclick = () => {
    const keep = { chX: A.cfg.chX, chY: A.cfg.chY, chStatus: A.cfg.chStatus, line: A.cfg.line, susp: A.cfg.susp };  /* só os números da pista */
    A.cfg = Object.assign({}, BT.DEFAULT_CFG, keep);
    cfgFill(); cfgRead();
  };

  /* tamanho */
  const ro = new ResizeObserver(() => {
    A.map.resize();
    if (A.S) A.charts.layout();
    A.requestRender();
  });
  ro.observe($('mapWrap')); ro.observe($('charts'));

  A.requestRender();
}

init();
})();
