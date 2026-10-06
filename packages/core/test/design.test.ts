/* Equivalência da ficha de projeto (designReport) com renderDesign do app antigo
 * (legacy/js/vehicleui.js): linhas e recomendações (an.designRows / an.designRec), o rótulo
 * do trecho (dsWin), o HTML da tabela e dos pontos de atenção (dsTable / dsRec, célula a
 * célula) e o CSV exportado (dsExport, com a coluna nova "sensores" no fim). Trechos:
 * sessão, cada volta (A.sel) e uma janela (A.charts.v). Mais: explain e sensores em cada
 * linha/recomendação. */
import { describe, it, expect } from 'vitest';
import { loadLegacy, legacyCompute, legacyAnalysis, readFixture, DEMO_CAR as LEGACY_DEMO_CAR, type LegacyState } from './legacy';
import { same } from './compare';
import { parseLog, parseCSV } from '../src/parsers';
import { demoCSV, DEMO_CAR } from '../src/demo';
import { DEFAULT_CAR } from '../src/vehicle';
import { computeSession, rangeOf, type SessionContext } from '../src/pipeline';
import { esc } from '../src/util';
import { SENSOR_IDS } from '../src/sensors';
import { EXPLAIN_AREAS, getExplain } from '../src/explain';
import { designReport, designRecTexts, designCsv, type DesignReport } from '../src/reports/design';

const L = loadLegacy({ ui: true });
const { BT } = L;

interface Case { label: string; O: LegacyState; N: SessionContext }

function makeCases(): Case[] {
  const out: Case[] = [];
  const demo = (keep: (k: string) => boolean, cfg: any, label: string) => {
    const So = BT.parseCSV(BT.demoCSV(), 'exemplo_baja.csv'); So.demo = true;
    const Sn = parseCSV(demoCSV(), 'exemplo_baja.csv'); Sn.demo = true;
    So.channels = So.channels.filter((c: any) => keep(c.key)); Sn.channels = Sn.channels.filter(c => keep(c.key));
    out.push({ label, O: legacyCompute(BT, So, JSON.parse(JSON.stringify(cfg)), { autoLine: true }), N: computeSession(Sn, JSON.parse(JSON.stringify(cfg)), { autoLine: true }) });
  };
  demo(() => true, { car: LEGACY_DEMO_CAR }, 'exemplo');
  /* variações tirando sensores / dados do carro: caminhos sem roda, sem GPS, um lado só,
   * sem curso/massa, roda livre e sem CVT */
  demo(k => k !== 'Wheel_speed', { car: DEMO_CAR }, 'exemplo sem roda');
  demo(k => k !== 'O2_General' && k !== 'Back_pressure', { car: DEMO_CAR }, 'exemplo sem GPS');
  demo(k => !/Right|velocity/.test(k), { car: { ...DEMO_CAR, mrF: 0 } }, 'exemplo só FL e RL, sem vel. da FT');
  demo(k => !/Rear|_R[LR]$/.test(k), { car: DEFAULT_CAR, susp: { compPos: false, strokeF: 120 } }, 'exemplo só a frente');
  demo(k => k !== 'CVT_temp', { car: { ...DEMO_CAR, wheelDriven: false, mass: 0, rho: 0 } }, 'exemplo roda livre, sem CVT');
  demo(() => true, {}, 'exemplo com o carro padrão');
  demo(() => true, { car: { ...DEMO_CAR, strokeF: 60, strokeR: 60, massR: 0, mrR: 0, tCvtMax: 60 } }, 'exemplo curso curto, CVT no limite');
  demo(k => !/Shock/.test(k), { car: DEMO_CAR }, 'exemplo sem amortecedores');
  demo(() => true, { car: { ...DEMO_CAR, strokeF: 300, strokeR: 300 } }, 'exemplo curso sobrando');
  for (const f of ['ft_log3_gps.csv', 'ft_log3_shocks_compact.csv', 'busmaster_14.log', 'Log 3_20261005-1648_20261005-1651.csv']) {
    const text = readFixture(f);
    if (text === null) continue;
    out.push({ label: f, O: legacyCompute(BT, BT.parseLog(text, f), {}, { autoLine: true }), N: computeSession(parseLog(text, f), {}, { autoLine: true }) });
  }
  return out;
}
const CASES = makeCases();

/* trechos: sessão, cada volta, uma janela */
type Win = { label: string; win: 'session' | 'lap' | 'view'; sel: number; view: [number, number] | null };
function windows(N: SessionContext): Win[] {
  const t = N.S.t, n = t.length;
  const out: Win[] = [{ label: 'sessão', win: 'session', sel: -1, view: null }];
  N.laps.forEach((l, k) => out.push({ label: `volta ${l.n}`, win: 'lap', sel: k, view: null }));
  out.push({ label: 'volta sem seleção', win: 'lap', sel: -1, view: null });
  const t0 = t[0] + (t[n - 1] - t[0]) * 0.25, t1 = t[0] + (t[n - 1] - t[0]) * 0.7;
  out.push({ label: 'janela', win: 'view', sel: -1, view: [t0, t1] });
  return out;
}

/* roda o renderDesign antigo e devolve o que ele escreveu */
function legacyDesign(O: LegacyState, w: Win) {
  O.sel = w.sel;
  const t = O.S.t;
  (O as any).charts = { v: w.view ? { t0: w.view[0], t1: w.view[1] } : { t0: t[0], t1: t[t.length - 1] } };
  const an = legacyAnalysis(L, O, w.win);
  an.renderDesign();
  let csv: { name: string; text: string } | null = null;
  const dl = BT.download;
  BT.download = (name: string, text: string) => { csv = { name, text }; };
  try { (L.el('dsExport') as any).onclick(); } finally { BT.download = dl; }
  return {
    rows: an.designRows as any[], rec: an.designRec as string[],
    win: L.el('dsWin').textContent, table: L.el('dsTable').innerHTML, recHtml: L.el('dsRec').innerHTML, csv: csv!,
  };
}

/* HTML da tabela como o app antigo monta, a partir das linhas do relatório novo */
function tableHtml(r: DesignReport): string {
  return '<table class="ana-table design"><tr><th>Grandeza</th><th>Valor</th><th>Como foi medido</th><th>Leitura para o projeto</th></tr>' +
    r.groups.map(g => `<tr class="grp"><td colspan="4">${esc(g)}</td></tr>` + r.rows.filter(x => x.grp === g).map(x =>
      `<tr><td>${esc(x.item)}</td><td><b>${esc(x.val)}</b></td><td class="mut">${esc(x.how)}</td><td>${esc(x.read)}</td></tr>`).join('')).join('') + '</table>';
}
const recHtml = (r: DesignReport) => {
  const rec = designRecTexts(r);
  return rec.length ? `<div class="note"><b>Pontos de atenção para o projeto</b><ul>${rec.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
};
/* células de texto de uma tabela HTML (tags removidas, entidades desfeitas) */
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const cells = (html: string) => [...html.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(m => unesc(m[1].replace(/<[^>]+>/g, '')));

/* CSV novo sem a última coluna (sensores) = CSV antigo */
function stripSensors(text: string): string {
  return text.split('\n').map(l => {
    if (l === '﻿grupo,grandeza,valor,como,leitura,sensores') return '﻿grupo,grandeza,valor,como,leitura';
    if (l.startsWith('"')) return l.replace(/,"[^"]*"$/, '');
    return l;
  }).join('\n');
}

const allIds = new Set<string>();

describe('designReport × renderDesign', () => {
  it('há casos (exemplo, variações, fixtures)', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(12);
  });
  for (const c of CASES) {
    it(`${c.label}: linhas, recomendações, HTML e CSV iguais em todos os trechos`, () => {
      const ws = windows(c.N);
      expect(c.O.laps.length).toBe(c.N.laps.length);
      for (const w of ws) {
        const old = legacyDesign(c.O, w);
        const [i0, i1, label] = rangeOf(c.N, w.win, w.sel, w.view ?? undefined);
        const r = designReport(c.N, i0, i1);
        const at = `${c.label} · ${w.label}`;
        expect(label, at).toBe(old.win);
        /* linhas e recomendações: strings idênticas */
        expect(same(old.rows, r.rows.map(({ grp, item, val, how, read }) => ({ grp, item, val, how, read }))), at).toEqual([]);
        expect(designRecTexts(r), at).toEqual([...old.rec]);
        /* HTML da tabela e dos pontos de atenção, e o texto célula a célula */
        expect(tableHtml(r), at).toBe(old.table);
        expect(recHtml(r), at).toBe(old.recHtml);
        const oc = cells(old.table), nc = ['Grandeza', 'Valor', 'Como foi medido', 'Leitura para o projeto'];
        r.groups.forEach(g => { nc.push(g); r.rows.filter(x => x.grp === g).forEach(x => nc.push(x.item, x.val, x.how, x.read)); });
        expect(nc, at).toEqual(oc);
        /* CSV: o antigo + a coluna sensores no fim */
        const csv = designCsv(r, c.N.S.name);
        expect(csv.fileName, at).toBe(old.csv.name);
        expect(stripSensors(csv.text), at).toBe(old.csv.text);
        /* explain e sensores bem formados */
        for (const x of [...r.rows, ...r.recs]) {
          expect(x.explain, at).toMatch(/^[a-z]+\.[A-Za-z_]+$/);
          expect((EXPLAIN_AREAS as readonly string[]).includes(x.explain.split('.')[0]), `${at}: ${x.explain}`).toBe(true);
          for (const s of x.sensors) expect(SENSOR_IDS, `${at}: ${s}`).toContain(s);
          expect(new Set(x.sensors).size, at).toBe(x.sensors.length);
          allIds.add(x.explain);
        }
      }
    });
  }
  it('ids de explicação usados (os que faltam no catálogo vão para o agente do catálogo)', () => {
    const missing = [...allIds].filter(id => !getExplain(id)).sort();
    /* só informativo: o catálogo é escrito depois, varrendo estes ids */
    if (missing.length) console.info('[design] ids sem card ainda:', missing.join(', '));
    expect(allIds.size).toBeGreaterThan(15);
  });
});

describe('sensores de cada linha (o que entrou na conta nesta sessão)', () => {
  const row = (r: DesignReport, item: string) => r.rows.find(x => x.item === item);
  const byLabel = (l: string) => CASES.find(c => c.label === l)!.N;
  const full = (N: SessionContext) => designReport(N, 0, N.S.t.length - 1);

  it('exemplo: roda calibrada pelo GPS, 4 amortecedores, CVT, carro', () => {
    const r = full(byLabel('exemplo'));
    expect(row(r, 'Amortecedores com sinal')!.sensors).toEqual(['shock_fl', 'shock_fr', 'shock_rl', 'shock_rr']);
    expect(row(r, 'Frequência natural diant. / tras.')!.sensors).toEqual(['gps', 'shock_fl', 'shock_fr', 'shock_rl', 'shock_rr']);
    expect(row(r, 'Rigidez equivalente na roda diant. / tras.')!.sensors).toContain('car_data');
    expect(row(r, 'Calibração da velocidade da roda')!.sensors).toEqual(['gps', 'wheel']);
    expect(row(r, 'Velocidade máxima')!.sensors).toEqual(['gps', 'wheel']);
    expect(row(r, 'Potência máxima na roda')!.sensors).toEqual(['gps', 'wheel', 'car_data']);
    expect(row(r, 'Gradiente de rolagem')!.sensors).toEqual(['gps', 'shock_fl', 'shock_fr', 'shock_rl', 'shock_rr', 'wheel', 'car_data']);
    expect(row(r, 'Curso usado diant.')!.sensors).toEqual(['shock_fl', 'shock_fr', 'car_data']);
    expect(row(r, 'Velocidade do amortecedor tras.')!.sensors).toEqual(['gps', 'shock_rl', 'shock_rr']);
    expect(row(r, 'Temperatura máxima medida')!.sensors).toEqual(['cvt_temp']);
    expect(row(r, 'Regime previsto no enduro')!.sensors).toEqual(['gps', 'wheel', 'cvt_temp', 'car_data']);
    expect(row(r, 'Regime previsto no enduro')!.explain).toBe('cvt.thermalModel');
    expect(r.recs.every(x => x.sensors.length > 0)).toBe(true);
  });
  it('recomendações de cada tipo aparecem em algum caso (cobertura dos ramos)', () => {
    const texts = CASES.flatMap(c => designRecTexts(full(c.N)));
    for (const re of [/bateu no fim de curso/, /usou só \d+ % do curso/, /Nos pousos/, /Corrija a circunferência/, /escorregou/, /A CVT deve passar/, /CVT: regime previsto/])
      expect(texts.some(x => re.test(x)), String(re)).toBe(true);
  });
  it('sem roda: velocidade e acelerações só do GPS', () => {
    const r = full(byLabel('exemplo sem roda'));
    expect(row(r, 'Velocidade da roda')!.sensors).toEqual(['gps']);
    expect(row(r, 'Velocidade máxima')!.sensors).toEqual(['gps']);
    expect(row(r, 'Frenagem máx. / lateral máx.')!.sensors).toEqual(['gps']);
  });
  it('sem GPS: velocidade da roda (sem calibração), parado pela roda', () => {
    const r = full(byLabel('exemplo sem GPS'));
    expect(row(r, 'Calibração da velocidade da roda')!.sensors).toEqual(['wheel']);
    expect(row(r, 'Velocidade máxima')!.sensors).toEqual(['wheel']);
    expect(row(r, 'Velocidade do amortecedor diant.')!.sensors).toEqual(['shock_fl', 'shock_fr', 'wheel']);
    expect(r.rows.flatMap(x => x.sensors)).not.toContain('gps');
  });
  it('um lado só: rolagem só com o eixo que tem os dois lados', () => {
    const r = full(byLabel('exemplo só FL e RL, sem vel. da FT'));
    expect(row(r, 'Amortecedores com sinal')!.val).toBe('FL, RL (faltam FR, RR)');
    expect(row(r, 'Amortecedores com sinal')!.sensors).toEqual(['shock_fl', 'shock_rl']);
    expect(row(r, 'Gradiente de rolagem')).toBeUndefined();
  });
  it('fixture só com GPS: nenhum amortecedor, sem CVT', () => {
    const c = CASES.find(x => x.label === 'ft_log3_gps.csv');
    if (!c) return;
    const r = full(c.N);
    expect(row(r, 'Amortecedores')!.sensors).toEqual([]);
    expect(row(r, 'Temperatura')!.explain).toBe('sensor.cvt_temp');
  });
});
