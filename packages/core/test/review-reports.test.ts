/* Revisão adversarial do porte (pipeline + relatórios) contra o app antigo, com ENTRADAS
 * SINTÉTICAS que os outros testes não exercitam: canais com buracos (NaN) no meio, log
 * curto (3 s e 12 amostras), um amortecedor só, frente/traseira trocadas (flat ride
 * invertido), teste de queda gerado (ζ baixo na frente, ζ alto atrás, traseira > 1,3×) sem
 * GPS, sem roda nem GPS, configurações estranhas (joelho 0, dados do carro em texto), trechos
 * de 0, 1 e 2 amostras e fora do log. Para cada sessão e trecho roda o render* antigo no DOM
 * falso e o relatório novo e compara texto a texto, os gráficos e os tooltips. Se o antigo
 * lança erro, o novo tem que lançar também (a aba antiga mostrava "Erro na análise").
 * Também: exportCSV e cfgInfo de app.js (processedCsv / trackConfigInfo), os sensores marcados
 * em todos os relatórios × os sensores que a sessão tem, todo explain no catálogo, e o resumo
 * e a qualidade dos dados nessas sessões. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { L, BT, runLegacy, selectify, strip, tilesOf, tableOf, normLegacyPlot, normRepPlot, type Win } from './reports-helpers';
import { legacyCompute, readFixture, LEGACY_DIR, type LegacyState } from './legacy';
import { same } from './compare';
import { parseCSV, parseLog } from '../src/parsers';
import { demoCSV, DEMO_CAR } from '../src/demo';
import { DEFAULT_CAR } from '../src/vehicle';
import { computeSession, rangeOf, processedCsv, trackConfigInfo, type SessionContext } from '../src/pipeline';
import { designReport, designRecTexts } from '../src/reports/design';
import { suspensionReport, type SuspPlot } from '../src/reports/suspension';
import { resonanceReport, resRoadTip, type ResEventValue, type ResonanceOptions } from '../src/reports/resonance';
import { powertrainReport, fmtRep } from '../src/reports/powertrain';
import { cvtReport } from '../src/reports/cvt';
import { dynamicsReport } from '../src/reports/dynamics';
import { lapReport, lapTable } from '../src/reports/laps';
import { channelMaps } from '../src/reports/maps';
import { sessionSummary } from '../src/summary';
import { dataQuality } from '../src/quality';
import { sensorAvailability, SENSORS } from '../src/sensors';
import { getExplain } from '../src/explain';

/* ------------------------------------------------------------------ CSV sintéticos */
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
type Grid = { head: string[]; rows: string[][] };
const grid = (csv: string): Grid => { const l = csv.split('\n').filter(x => x.trim()); return { head: l[0].split(','), rows: l.slice(1).map(x => x.split(',')) }; };
const text = (g: Grid) => [g.head.join(','), ...g.rows.map(r => r.join(','))].join('\n') + '\n';
/** apaga (vira NaN) as células da coluna nas linhas [a, b), a cada `every` */
function blank(g: Grid, col: string, a: number, b: number, every = 1): Grid {
  const j = g.head.indexOf(col);
  g.rows.forEach((r, i) => { if (i >= a && i < b && (i - a) % every === 0) r[j] = ''; });
  return g;
}
const headRows = (g: Grid, n: number): Grid => ({ head: g.head, rows: g.rows.slice(0, n) });
function dropCols(g: Grid, re: RegExp): Grid {
  const keep = g.head.map((h, j) => (j === 0 || !re.test(h) ? j : -1)).filter(j => j >= 0);
  return { head: keep.map(j => g.head[j]), rows: g.rows.map(r => keep.map(j => r[j])) };
}
const rename = (g: Grid, f: (h: string) => string): Grid => ({ head: g.head.map((h, j) => (j ? f(h) : h)), rows: g.rows });

/** Teste de queda gerado: carro parado (roda = 0) por 8 s com uma queda em t = 2 s
 *  (decaimento livre com fₙ e ζ de cada eixo), depois andando com ondulação; sem GPS. */
function synthDrop(o: { fnF: number; zF: number; fnR: number; zR: number }): string {
  const fs = 25, n = 60 * fs;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  const decay = (fn: number, z: number, tau: number) => {
    if (tau < 0) return 0;
    const wn = 2 * Math.PI * fn, wd = wn * Math.sqrt(1 - z * z);
    return 25 * Math.exp(-z * wn * tau) * Math.cos(wd * tau);
  };
  const out = ['TIME,Wheel_speed,Shock_-_Front_Left,Shock_-_Front_Right,Shock_-_Rear_Left,Shock_-_Rear_Right'];
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const stop = t < 8 || (t >= 35 && t < 41);
    const v = stop ? 0 : Math.min(32, (t < 35 ? t - 8 : t - 41) * 7) + 3 * Math.sin(t / 3);
    const road = (ph: number) => (stop ? 0 : 6 * Math.sin(2 * Math.PI * 1.7 * t + ph) + 3 * Math.sin(2 * Math.PI * 3.3 * t + 2 * ph) + 2 * rnd());
    const f = decay(o.fnF, o.zF, t - 2), r = decay(o.fnR, o.zR, t - 2);
    out.push([t.toFixed(3), Math.max(0, v).toFixed(1), (70 + f + road(0)).toFixed(1), (70.4 + f + road(0.5)).toFixed(1),
      (75 + r + road(1)).toFixed(1), (74.6 + r + road(1.5)).toFixed(1)].join(','));
  }
  return out.join('\n') + '\n';
}

/* ------------------------------------------------------------------ sessões */
interface Case { label: string; O: LegacyState | null; N: SessionContext | null; errO?: string; errN?: string }
const ROUGH_NAME = 'Rugosidade (vel. amortecedores, RMS 1 s)';   /* nome do app.js (a réplica perdeu a vírgula) */
function mkCase(label: string, csv: string, cfg: any, demo = true): Case {
  const c: Case = { label, O: null, N: null };
  try {
    const So = BT.parseCSV(csv, 'sintetico.csv'); So.demo = demo;
    c.O = legacyCompute(BT, So, clone(cfg), { autoLine: true });
    for (const ch of c.O.all) if (ch.key === 'susp:rough') ch.name = ROUGH_NAME;
  } catch (e) { c.errO = String((e as Error).message); }
  try {
    const Sn = parseCSV(csv, 'sintetico.csv'); Sn.demo = demo;
    c.N = computeSession(Sn, clone(cfg), { autoLine: true });
  } catch (e) { c.errN = String((e as Error).message); }
  return c;
}

const DEMO = () => grid(demoCSV());
function makeCases(): Case[] {
  const car = { car: DEMO_CAR };
  const out: Case[] = [];
  {
    const g = DEMO();
    blank(g, 'Wheel_speed', 1000, 1100); blank(g, 'CVT_temp', 2000, 2050); blank(g, 'O2_General', 3000, 3040); blank(g, 'Back_pressure', 3000, 3040);
    blank(g, 'Shock_-_Front_Left', 1500, 1560); blank(g, 'Shock_velocity_FR', 2500, 2700, 7); blank(g, 'Shock_-_Rear_Right', 600, 4000, 9);
    out.push(mkCase('exemplo com buracos (NaN)', text(g), car));
  }
  out.push(mkCase('exemplo, 3 s', text(headRows(DEMO(), 75)), car));
  out.push(mkCase('exemplo, 12 amostras', text(headRows(DEMO(), 12)), car));
  out.push(mkCase('exemplo, 2 amostras', text(headRows(DEMO(), 2)), car));
  out.push(mkCase('exemplo, 1 amostra', text(headRows(DEMO(), 1)), car));
  out.push(mkCase('exemplo só FL', text(dropCols(DEMO(), /Shock.*(Right|Rear)|_(FR|RL|RR)$/)), car));
  out.push(mkCase('exemplo só FL, sem roda nem GPS', text(dropCols(DEMO(), /Shock.*(Right|Rear)|_(FR|RL|RR)$|Wheel|O2_|Back_/)), car));
  out.push(mkCase('exemplo frente × traseira trocadas', text(rename(DEMO(), h => h.replace('Front', 'XX').replace('Rear', 'Front').replace('XX', 'Rear')
    .replace(/_F([LR])$/, '_Q$1').replace(/_R([LR])$/, '_F$1').replace(/_Q([LR])$/, '_R$1'))), car));
  out.push(mkCase('exemplo sem roda nem GPS', text(dropCols(DEMO(), /Wheel|O2_|Back_/)), car));
  out.push(mkCase('exemplo sem GPS, carro padrão', text(dropCols(DEMO(), /O2_|Back_/)), {}));
  out.push(mkCase('exemplo, joelho 0, banda 0, todas as amostras, compressão invertida', demoCSV(),
    { car: DEMO_CAR, susp: { knee: 0, fmin: 0, fmax: 0, moving: false, compPos: false } }));
  out.push(mkCase('exemplo, dados do carro em texto', demoCSV(), {
    car: { ...DEMO_CAR, mass: '250', strokeF: '150', strokeR: '0', massF: '60', massR: '', mrF: '1.5', crr: '0.05', cda: '0.8', rho: '1.2', power: '7', tAmb: '30', tCvtMax: '95', endurance: '200' },
    susp: { knee: '80', fmin: '0.8', fmax: '4' }, minLap: '20',
  }));
  out.push(mkCase('exemplo tempo × 0,5', text((g => { g.rows.forEach(r => { r[0] = (+r[0] * 0.5).toFixed(3); }); return g; })(DEMO())), car));
  out.push(mkCase('queda gerada: ζ diant. baixo, ζ tras. alto, tras. 1,57×', synthDrop({ fnF: 1.4, zF: 0.1, fnR: 2.2, zR: 0.65 }), car, false));
  out.push(mkCase('queda gerada: tras. abaixo da diant.', synthDrop({ fnF: 2.0, zF: 0.3, fnR: 1.6, zR: 0.35 }), { car: { ...DEFAULT_CAR, massF: 60, massR: 70 } }, false));
  return out;
}
const CASES = makeCases();

function wins(N: SessionContext): Win[] {
  const t = N.S.t, n = t.length, T0 = t[0], T1 = t[n - 1], tm = t[n >> 1];
  const out: Win[] = [{ label: 'sessão', win: 'session', sel: -1, view: null }, { label: 'volta (nenhuma)', win: 'lap', sel: -1, view: null }];
  N.laps.slice(0, 2).forEach((l, k) => out.push({ label: `volta ${l.n}`, win: 'lap', sel: k, view: null }));
  out.push({ label: 'janela do meio', win: 'view', sel: -1, view: [T0 + (T1 - T0) / 3, T0 + 2 * (T1 - T0) / 3] });
  out.push({ label: 'janela de 0 s (1 amostra)', win: 'view', sel: -1, view: [tm, tm] });
  if (n > 2) out.push({ label: 'janela de 2 amostras', win: 'view', sel: -1, view: [t[n >> 1], t[(n >> 1) + 1]] });
  out.push({ label: 'janela depois do fim do log', win: 'view', sel: -1, view: [T1 + 5, T1 + 10] });
  out.push({ label: 'janela pegando o começo', win: 'view', sel: -1, view: [T0 - 3, T0 + (T1 - T0) / 4] });
  return out;
}

/* ------------------------------------------------------------------ comparação */
const decode = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const tableRows = (html: string): string[][] =>
  [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => decode(c[1])));
const afterTable = (html: string) => decode(html.includes('</table>') ? html.slice(html.lastIndexOf('</table>') + 8) : html);
const IGN = ['color', 'colors', 'id', 'role', 'roles', 'key', 'title', 'explain', 'sensors', 'tipX', 'fmtY', 'barTips'];

/* tooltips: os callbacks do antigo (tipX, fmtY, tipBar) × os formatos do relatório */
const XS = [0, 0.37, 1, 1.234, 12.345, -3.5, 100.05, 1e-4];
function tipDiffs(spec: any, p: { empty?: string; tipX?: any; fmtY?: any; barTips?: { title: string; note?: string; text: string }[] } | null, roadTip = false): string[] {
  const out: string[] = [];
  if (!spec || !p || p.empty) return out;
  for (const x of XS) {
    if (spec.tipX) {
      const n = roadTip ? (t => `<b>${t.title}</b> ${t.note}`)(resRoadTip(x)) : p.tipX ? `<b>${fmtRep(p.tipX, x)}</b>` : '(sem tipX)';
      if (spec.tipX(x) !== n) out.push(`tipX(${x}): ${spec.tipX(x)} ≠ ${n}`);
    } else if (p.tipX) out.push('tipX sobrando');
    if (spec.fmtY) { const n = p.fmtY ? fmtRep(p.fmtY, x) : '(sem fmtY)'; if (spec.fmtY(x) !== n) out.push(`fmtY(${x}): ${spec.fmtY(x)} ≠ ${n}`); }
    else if (p.fmtY) out.push('fmtY sobrando');
  }
  if (!!spec.tipBar !== !!p.barTips) out.push('tipBar × barTips');
  if (spec.tipBar && p.barTips) p.barTips.forEach((b, j) => { const n = `<b>${b.title}</b>${b.note ? ' ' + b.note : ''}<br>${b.text}`; if (spec.tipBar(j) !== n) out.push(`tipBar(${j}): ${spec.tipBar(j)} ≠ ${n}`); });
  return out;
}

type Diffs = string[];
const mkChk = (d: Diffs) => ({
  chk: (what: string, a: unknown, b: unknown) => { const r = same(a, b); if (r.length) d.push(`${what}: ${r.slice(0, 4).join(' | ')}`); },
  rep: (what: string, spec: unknown, p: any) => {
    const r = same(normLegacyPlot(spec), normRepPlot(p)); if (r.length) d.push(`${what}: ${r.slice(0, 4).join(' | ')}`);
    const t = tipDiffs(spec, p); if (t.length) d.push(`${what} tooltips: ${t.slice(0, 3).join(' | ')}`);
  },
  susp: (what: string, spec: unknown, p: SuspPlot) => {
    const r = same(spec, p, { ignore: IGN }); if (r.length) d.push(`${what}: ${r.slice(0, 4).join(' | ')}`);
    const t = tipDiffs(spec, p, what === 'rrPlot'); if (t.length) d.push(`${what} tooltips: ${t.slice(0, 3).join(' | ')}`);
  },
});

/** Roda antigo e novo; se só um lança erro, é diferença. */
function both(d: Diffs, what: string, old: () => void, neu: () => void): void {
  let eo: string | null = null, en: string | null = null;
  try { old(); } catch (e) { eo = (e as Error).message; }
  if (eo !== null) { try { neu(); } catch (e) { en = (e as Error).message; } if (en === null) d.push(`${what}: o antigo lança "${eo}" e o novo não`); return; }
  try { neu(); } catch (e) { d.push(`${what}: o novo lança "${(e as Error).message}" e o antigo não`); }
}

function pageDesign(O: LegacyState, N: SessionContext, w: Win, d: Diffs): void {
  const { chk } = mkChk(d);
  let an: any;
  both(d, 'ficha', () => { an = runLegacy(O, 'renderDesign', w); }, () => {
    const [i0, i1, label] = rangeOf(N, w.win, w.sel, w.view ?? undefined);
    const r = designReport(N, i0, i1);
    chk('ficha: trecho', L.el('dsWin').textContent, label);
    chk('ficha: linhas', an.designRows, r.rows.map(({ grp, item, val, how, read }) => ({ grp, item, val, how, read })));
    chk('ficha: recomendações', [...an.designRec], designRecTexts(r));
  });
}

function pageSusp(O: LegacyState, N: SessionContext, w: Win, d: Diffs): void {
  const { chk, susp } = mkChk(d);
  let an: any;
  both(d, 'suspensão', () => { an = runLegacy(O, 'renderSusp', w); }, () => {
    const [i0, i1] = rangeOf(N, w.win, w.sel, w.view ?? undefined);
    const rep = suspensionReport(N, i0, i1);
    chk('susp: escondido', L.el('spPlots').hidden, !rep.hasShocks);
    const body = L.el('spBody').innerHTML;
    if (!rep.hasShocks) { chk('susp: vazio', decode(body), rep.empty); return; }
    const rows = tableRows(body);
    chk('susp: cabeçalho', rows[0], rep.table.columns.map(c => c.label));
    chk('susp: linhas', rows.slice(1), rep.table.rows.map(r => r.cells));
    chk('susp: nota', afterTable(body), rep.table.note);
    rep.velHist.forEach(p => susp(p.key, L.el(p.key).plot, p));
    rep.posHist.forEach(p => susp(p.key, L.el(p.key).plot, p));
    chk('susp: grNote', L.el('grNote').textContent, rep.body.note);
    chk('susp: grRollT', L.el('grRollT').innerHTML ? decode(L.el('grRollT').innerHTML) : L.el('grRollT').textContent, rep.body.rollTitle);
    chk('susp: grPitchT', L.el('grPitchT').innerHTML ? decode(L.el('grPitchT').innerHTML) : L.el('grPitchT').textContent, rep.body.pitchTitle);
    susp('grRoll', L.el('grRoll').plot, rep.body.rollPlot);
    susp('grPitch', L.el('grPitch').plot, rep.body.pitchPlot);
    const jp = L.el('jpTable').innerHTML, jr = tableRows(jp);
    if (rep.jumps.rows.length) {
      chk('saltos: cabeçalho', jr[0], rep.jumps.columns.map(c => c.label));
      chk('saltos: linhas', jr.slice(1), rep.jumps.rows.map(r => r.cells));
      chk('fim de curso', afterTable(jp), rep.bottom.text);
    } else chk('sem saltos', decode(jp), (rep.jumps.none ?? '') + rep.bottom.text);
  });
}

const evValue = (v: ResEventValue) => (v === null ? '' : v === 'manual' ? 'm' : String(v));
function pageFreq(O: LegacyState, N: SessionContext, w: Win, o: ResonanceOptions, d: Diffs): void {
  const { chk, susp } = mkChk(d);
  let an: any;
  both(d, 'ressonância ' + JSON.stringify(o), () => {
    an = runLegacy(O, 'renderFreq', w, a => {
      selectify(L.el('frEvent')); selectify(L.el('frPsdMode'));
      const t = O.S.t, v = w.view ? { t0: w.view[0], t1: w.view[1] } : { t0: t[0], t1: t[t.length - 1] };
      if (o.manual) {
        (O as any).charts = { v: { t0: o.manual[0], t1: o.manual[1] } };
        a.render = () => undefined;                /* analyzeManual chama render(); aqui o renderFreq vem depois */
        a.analyzeManual();
        (O as any).charts = { v };
      }
      /* o valor escolhido antes de o renderFreq trocar as opções (keep = sel.value) */
      selectify(L.el('frEvent'), o.dropIndex === undefined ? '' : evValue(o.dropIndex));
      selectify(L.el('frPsdMode'), o.psdMode ?? '');
    });
  }, () => {
    const [i0, i1] = rangeOf(N, w.win, w.sel, w.view ?? undefined);
    const rep = resonanceReport(N, i0, i1, o);
    if (!rep.hasShocks) { chk('freq: vazio', decode(L.el('frBody').innerHTML), rep.empty); return; }
    chk('freq: eventos', an.events, rep.events);
    chk('freq: opções', (L.el('frEvent') as any).options.map((x: any) => [x.value, decode(x.text)]), rep.eventOptions.map(x => [evValue(x.value), x.label]));
    chk('freq: selecionado', L.el('frEvent').value, evValue(rep.selected));
    const dh = L.el('frDrop').innerHTML;
    if (rep.drop.message) chk('freq: sem evento', decode(dh), rep.drop.message);
    else chk('freq: queda', tableRows(dh).slice(1), rep.drop.rows.map(r => r.cells));
    susp('frDropPlot', L.el('frDropPlot').plot, rep.drop.plot);
    chk('freq: modo', L.el('frPsdMode').value, rep.psd.mode);
    chk('freq: vlo/vhi', [an.vlo, an.vhi], [rep.psd.vlo, rep.psd.vhi]);
    susp('frPsd', L.el('frPsd').plot, rep.psd.plot);
    const pr = tableRows(L.el('frPeaks').innerHTML);
    chk('freq: picos (cab.)', pr[0], rep.peaks.columns.map(c => c.label));
    chk('freq: picos', pr.slice(1), rep.peaks.rows.map(r => r.cells));
    chk('freq: nota', decode(L.el('frNote').innerHTML), rep.note.text);
    const rr = L.el('rrTable').innerHTML;
    if (rep.road.message) chk('pista: sem dados', decode(rr), rep.road.message);
    else {
      chk('pista: linhas', tableRows(rr).slice(1), rep.road.rows.map(r => r.cells));
      chk('pista: nota', afterTable(rr), rep.road.note);
    }
    susp('rrPlot', L.el('rrPlot').plot, rep.road.plot);
  });
}

function pagePower(O: LegacyState, N: SessionContext, w: Win, d: Diffs): void {
  const { chk, rep } = mkChk(d);
  both(d, 'trem de força', () => { runLegacy(O, 'renderPower', w, () => selectify(L.el('cdSel'))); }, () => {
    const [i0, i1] = rangeOf(N, w.win, w.sel, w.view ?? undefined);
    const r = powertrainReport(N, i0, i1);
    const el = L.el;
    chk('pw: escondido', el('pwContent').hidden, !r.ok);
    if (!r.ok) { chk('pw: vazio', strip(el('pwTiles').innerHTML), r.empty); return; }
    chk('pw: fonte', strip(el('pwSrc').innerHTML), r.src.text);
    chk('pw: blocos', tilesOf(el('pwTiles').innerHTML), r.tiles.map(x => [x.label, x.text, x.unit]));
    rep('pwCurve', el('pwCurve').plot, r.curve);
    if (r.launchTable) chk('pw: largadas', tableOf(el('pwLaunch').innerHTML).slice(1), r.launchTable.rows.map(x => x.cells));
    else chk('pw: sem largadas', strip(el('pwLaunch').innerHTML), r.launchEmpty);
    rep('pwSlip', el('pwSlip').plot, r.slip);
    const c = r.coast!;
    chk('cd: opções', (el('cdSel') as any).options.map((x: any) => [x.value, x.text]), c.options.map(x => [x.value, x.label]));
    if (!c.fit) chk('cd: vazio', strip(el('cdRes').innerHTML), c.empty);
    else chk('cd: tabela', tableOf(el('cdRes').innerHTML), c.rows.map(x => x.cells));
    rep('cdPlot', el('cdPlot').plot, c.plot);
  });
}

function pageCvt(O: LegacyState, N: SessionContext, w: Win, d: Diffs): void {
  const { chk, rep } = mkChk(d);
  both(d, 'CVT', () => { runLegacy(O, 'renderCvt', w); }, () => {
    const [i0, i1] = rangeOf(N, w.win, w.sel, w.view ?? undefined);
    const r = cvtReport(N, i0, i1), el = L.el;
    chk('cvt: escondido', el('cvPlots').hidden, !r.ok);
    chk('cvt: blocos', tilesOf(el('cvTiles').innerHTML), r.tiles.map(x => [x.label, x.text, x.unit]));
    chk('cvt: nota', el('cvNote').textContent, r.note);
    if (!r.ok) { chk('cvt: vazio', strip(el('cvBody').innerHTML), r.empty); return; }
    chk('cvt: fonte', strip(el('cvSrc').innerHTML), r.src.text);
    if (r.modelMsg) chk('cvt: corpo', strip(el('cvBody').innerHTML), r.modelMsg);
    else chk('cvt: corpo', strip(el('cvBody').innerHTML), r.fitText! + r.equation! + ' ' + r.unitsText! + r.reading!);
    rep('cvFit', el('cvFit').plot, r.fitPlot);
    rep('cvProj', el('cvProj').plot, r.projPlot);
  });
}

function pageDyn(O: LegacyState, N: SessionContext, w: Win, d: Diffs): void {
  const { chk, rep } = mkChk(d);
  both(d, 'dinâmica', () => { runLegacy(O, 'renderDyn', w); }, () => {
    const [i0, i1] = rangeOf(N, w.win, w.sel, w.view ?? undefined);
    const r = dynamicsReport(N, i0, i1), el = L.el;
    chk('dyn: escondido', el('dyPlots').hidden, !r.ok);
    if (!r.ok) { chk('dyn: vazio', strip(el('dyTiles').innerHTML), r.empty); return; }
    chk('dyn: fonte', el('dySrc').textContent, r.src.text);
    chk('dyn: blocos', tilesOf(el('dyTiles').innerHTML), r.tiles.map(x => [x.label, x.text, x.unit]));
    rep('dyGG', el('dyGG').plot, r.gg);
    rep('dySpd', el('dySpd').plot, r.speed);
  });
}

function pageLaps(O: LegacyState, N: SessionContext, sel: number, d: Diffs): void {
  const { chk, rep } = mkChk(d);
  O.sel = sel;
  both(d, `voltas sel ${sel}`, () => {
    runLegacy(O, 'renderLaps', { label: 'voltas', win: 'session', sel, view: null }, () => { selectify(L.el('lpCmp')); selectify(L.el('lpRef')); });
  }, () => {
    const r = lapReport(N, null, null, sel), el = L.el;
    chk('voltas: escondido', el('lpContent').hidden, !r.ok);
    if (!r.ok) { chk('voltas: vazio', strip(el('lpBody').innerHTML), r.empty); return; }
    chk('voltas: escolhidas', [+el('lpCmp').value, +el('lpRef').value], [r.cmp, r.ref]);
    chk('voltas: resumo', strip(el('lpSum').innerHTML), r.summary);
    rep('lpSpeed', el('lpSpeed').plot, r.speed);
    rep('lpDelta', el('lpDelta').plot, r.delta);
    rep('lpSect', el('lpSect').plot, r.sectors);
  });
}

/* buildLaps de legacy/js/app.js (a mesma extração de laps.test.ts) */
const APP = readFileSync(path.join(LEGACY_DIR, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const BUILD_LAPS = new Function('A', '$', 'BT', 'updateNow', 'selectLap', `${/\nfunction buildLaps\(\) \{[\s\S]*?\n\}\n/.exec(APP)![0]}; return buildLaps;`);

/* ------------------------------------------------------------------ testes */
describe('revisão: sessões sintéticas montam igual ao antigo', () => {
  it.each(CASES.map(c => [c.label, c] as const))('%s', (_l, c) => {
    if (c.errO !== undefined || c.errN !== undefined) {
      expect(c.errN, `antigo: ${c.errO}`).toBe(c.errO);
      return;
    }
    const O = c.O!, N = c.N!;
    expect(same(O.all.map(x => [x.key, x.name, x.group]), N.all.map(x => [x.key, x.name, x.group]))).toEqual([]);
    expect(same(O.all, N.all)).toEqual([]);
    expect(same(O.cfg, N.cfg)).toEqual([]);
    expect(same([O.track, O.laps, O.stopped, O.acc, O.ang, O.dyn], [N.track, N.laps, N.stopped, N.acc, N.ang, N.dyn])).toEqual([]);
    expect(same(O.veh, N.veh)).toEqual([]);
    expect(same(O.susp, N.susp)).toEqual([]);
  });
});

describe.each(CASES.filter(c => c.O && c.N).map(c => [c.label, c] as const))('revisão: páginas × render* antigos: %s', (_l, c) => {
  const O = c.O!, N = c.N!;
  for (const w of wins(N)) {
    it(`trecho ${w.label}`, () => {
      const d: Diffs = [];
      pageDesign(O, N, w, d);
      pageSusp(O, N, w, d);
      pageFreq(O, N, w, {}, d);
      pagePower(O, N, w, d);
      pageCvt(O, N, w, d);
      pageDyn(O, N, w, d);
      expect(d).toEqual([]);
    });
  }
  it('ressonância: cada evento, trecho manual e cada modo do espectro', () => {
    const d: Diffs = [];
    const w: Win = { label: 'sessão', win: 'session', sel: -1, view: null };
    const t = N.S.t, n = t.length;
    const sets: ResonanceOptions[] = [{ dropIndex: 0 }, { dropIndex: 1 }, { dropIndex: 'manual' }, { manual: [t[0] + 1.6, t[0] + 4.5] },
      { manual: [t[0] + 1.6, t[0] + 4.5], dropIndex: 'manual' }, { manual: [t[n >> 1], t[n >> 1]] , dropIndex: 'manual' }];
    for (const m of ['FL', 'FR', 'RL', 'RR']) sets.push({ psdMode: m }, { psdMode: m, dropIndex: 0 });
    for (const o of sets) pageFreq(O, N, w, o, d);
    expect(d).toEqual([]);
  });
  it('voltas e tabela de voltas (também com uma volta selecionada que não existe)', () => {
    const d: Diffs = [];
    for (const sel of [-1, 0, 1, 2, 99].filter(k => k < N.laps.length || k === 99)) {
      pageLaps(O, N, sel, d);
      L.els.clear();
      const A: any = Object.assign(Object.create(null), O, { sel, getLine: () => O.cfg.line || null });
      BUILD_LAPS(A, L.el, BT, {}, () => undefined)();
      const html = L.el('laps').innerHTML, r = lapTable(N, sel);
      if (!r.ok) { if (strip(html) !== r.empty) d.push(`lapTable vazio: ${strip(html)} ≠ ${r.empty}`); continue; }
      const tb = tableOf(html);
      if (same(tb.slice(1), r.rows.map(x => x.cells)).length) d.push(`lapTable sel ${sel}`);
    }
    expect(d).toEqual([]);
  });
});


/* ------------------------------------------------------------------ app.js: exportCSV e cfgInfo */
const fromApp = (fn: string, args: string[]) => {
  const i = APP.indexOf(`\nfunction ${fn}() {`), j = APP.indexOf('\n}\n', i);
  return new Function(...args, `${APP.slice(i, j + 3)}; return ${fn};`);
};
const EXPORT_CSV = fromApp('exportCSV', ['A', 'BT']);
const CFG_INFO = fromApp('cfgInfo', ['A', '$', 'BT']);
const APP_CASES = [mkCase('exemplo', demoCSV(), { car: DEMO_CAR }), ...CASES.filter(c => c.O && c.N)];
for (const [f, cfg] of [['ft_log3_gps.csv', {}], ['ft_log3_gps.csv', { centerFixed: false, margin: 15 }], ['busmaster_14.log', {}]] as const) {
  const txt = readFixture(f);
  if (txt === null) continue;
  const So = BT.parseLog(txt, f), Sn = parseLog(txt, f);
  APP_CASES.push({ label: `${f} ${JSON.stringify(cfg)}`, O: legacyCompute(BT, So, clone(cfg), { autoLine: true }), N: computeSession(Sn, clone(cfg), { autoLine: true }) });
}

describe('revisão: exportCSV e cfgInfo de app.js', () => {
  it.each(APP_CASES.map(c => [c.label, c] as const))('%s: CSV processado igual ao antigo', (_l, c) => {
    const O = c.O!, N = c.N!;
    for (const ch of O.all) if (ch.key === 'susp:rough') ch.name = ROUGH_NAME;
    let got: { name: string; text: string } | null = null;
    const bt = Object.assign(Object.create(BT), { download: (name: string, text: string) => { got = { name, text }; } });
    EXPORT_CSV(O, bt)();
    const r = processedCsv(N);
    expect(r.fileName).toBe(got!.name);
    expect(r.text === got!.text, 'texto do CSV').toBe(true);
  });
  it.each(APP_CASES.map(c => [c.label, c] as const))('%s: textos de Pista e GPS iguais ao antigo', (_l, c) => {
    const O = c.O!, N = c.N!;
    L.els.clear();
    CFG_INFO(O, L.el, BT)();
    const info = trackConfigInfo(N);
    expect(decode(L.el('cRes').innerHTML)).toBe(info.resolution.text);
    expect(L.el('cDet').textContent).toBe(info.source);
    const note = L.el('cNote').innerHTML;
    expect(decode(/^<b>([\s\S]*?)<\/b>/.exec(note)![1])).toBe(info.calibration.title);
    expect([...note.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => decode(m[1]))).toEqual(info.calibration.items);
    expect(info.stepX).toBeCloseTo(info.span.x / 2.55, 12);
  });
});

/* ------------------------------------------------------------------ sensores e explicações */
/** Relatórios da sessão inteira (os mesmos que as páginas mostram). */
function allReports(N: SessionContext): [string, unknown][] {
  const n = N.S.t.length;
  return [
    ['ficha', designReport(N, 0, n - 1)], ['suspensão', suspensionReport(N, 0, n - 1)], ['ressonância', resonanceReport(N, 0, n - 1)],
    ['trem de força', powertrainReport(N, 0, n - 1)], ['CVT', cvtReport(N, 0, n - 1)], ['dinâmica', dynamicsReport(N, 0, n - 1)],
    ['voltas', lapReport(N)], ['tabela de voltas', lapTable(N)], ['mapas', channelMaps(N, 0, n - 1)], ['resumo', sessionSummary(N)],
    ['pista e GPS', trackConfigInfo(N)],
  ];
}

describe('revisão: sensores marcados = sensores que esta sessão tem', () => {
  it.each(APP_CASES.map(c => [c.label, c] as const))('%s', (_l, c) => {
    const N = c.N!, av = sensorAvailability(N);
    /* car_data e logger entram sempre (padrões do carro, relógio); o GPS parado o tempo todo
     * tem X/Y constantes (sensorAvailability diz 'absent') mas a trajetória existe */
    const has = (s: string) => av[s as keyof typeof av] === 'present' || s === 'car_data' || s === 'logger' || (s === 'gps' && N.track.ok);
    const bad: string[] = [];
    for (const [name, r] of allReports(N)) {
      const walk = (x: any, at: string) => {
        if (!x || typeof x !== 'object' || ArrayBuffer.isView(x)) return;
        if (Array.isArray(x)) { x.forEach((y, j) => walk(y, `${at}[${j}]`)); return; }
        if (x.active === false) return;                          /* linha "sem canal" de um canto */
        if (typeof x.explain === 'string' && !getExplain(x.explain)) bad.push(`${name}${at}: explain ${x.explain} não existe no catálogo`);
        for (const k of ['sensors', 'noteSensors']) {
          if (!Array.isArray(x[k])) continue;
          for (const s of x[k]) if (!Object.hasOwn(SENSORS, s)) bad.push(`${name}${at}.${k}: sensor ${s} não existe`);
          /* as linhas "sem canal" (card sensor.<id>) citam o que falta; as métricas de qualidade
           * (ex.: 0 % de GPS válido) e os textos da configuração do GPS falam do sensor mesmo
           * quando ele não mandou dado */
          const miss = x[k].filter((s: string) => !has(s));
          const about = typeof x.explain === 'string' && /^(sensor|quality)\./.test(x.explain) || name === 'pista e GPS';
          if (miss.length && !about) bad.push(`${name}${at}.${k} (${x.explain ?? ''}): ${miss.join(', ')} não está neste log`);
        }
        for (const k of Object.keys(x)) if (!['lap', 'refLap', 'events', 'list', 'emptySensors'].includes(k)) walk(x[k], `${at}.${k}`);
      };
      walk(r, '');
    }
    expect(bad).toEqual([]);
  });
});

describe('revisão: resumo e qualidade nas sessões sintéticas', () => {
  it.each(APP_CASES.map(c => [c.label, c] as const))('%s', (_l, c) => {
    const N = c.N!, s = sessionSummary(N);
    for (const x of s.metrics) {
      if (x.value !== null) expect(x.sensors.length, x.key).toBeGreaterThan(0);
      if (x.value === null && x.text === undefined) expect(x.sensors, x.key).toEqual([]);
    }
    /* sem aceleração lateral (sem GPS) não há lateral máxima: null, não 0 */
    const lat = s.metrics.find(x => x.key === 'power.latMax')!;
    if (!N.acc.lat) expect(lat.value).toBeNull();
    /* largadas: a distância (GPS com roda de tração) entra nos sensores */
    const la = s.metrics.find(x => x.key === 'power.launches')!;
    if (la.value !== null && N.cfg.car.wheelDriven && N.track.ok) expect(la.sensors).toContain('gps');
    const q = dataQuality(N.S, N);
    expect(new Set(q.issues.map(x => x.id)).size).toBe(q.issues.length);
    for (const x of q.issues) {
      expect(getExplain(x.explain), x.id).toBeTruthy();
      for (const id of x.sensors) expect(Object.hasOwn(SENSORS, id), `${x.id}: ${id}`).toBe(true);
    }
    for (const ch of q.channels) expect(getExplain(ch.explain), ch.key).toBeTruthy();
  });
});

describe('revisão: as sessões sintéticas cobrem os ramos que os dados reais não cobrem', () => {
  it('flat ride (traseira < diant. e > 1,3×), ζ < 0,2 e ζ > 0,6, log de 1 amostra', () => {
    const recs = CASES.filter(c => c.N).flatMap(c => designRecTexts(designReport(c.N!, 0, c.N!.S.t.length - 1)));
    for (const re of [/frequência menor que a dianteira/, /% acima da dianteira em frequência/, /pouco amortecida/, /muito amortecida/])
      expect(recs.some(x => re.test(x)), String(re)).toBe(true);
    const one = CASES.find(c => c.label === 'exemplo, 1 amostra')!;
    expect(one.N && one.O && one.N.S.t.length).toBe(1);
  });
});

describe('revisão: qualidade dos dados', () => {
  it('estático pela mediana sem GPS: o motivo é a falta do GPS (suspPrep não usa a roda)', () => {
    const c = CASES.find(x => x.label === 'exemplo sem GPS, carro padrão')!;
    const N = c.N!;
    expect(N.stopped).not.toBeNull();                               /* há "parado" pela roda... */
    expect(N.susp.shocks.every(k => !k.active || k.staticFromStop === false)).toBe(true);   /* ...mas o estático não usa */
    const q = dataQuality(N.S, N), iss = q.issues.find(x => x.id === 'susp.static')!;
    expect(iss.text).toContain('sem trajetória do GPS');
    expect(iss.sensors).toEqual(['shock_fl', 'shock_fr', 'shock_rl', 'shock_rr', 'gps']);
  });
});
