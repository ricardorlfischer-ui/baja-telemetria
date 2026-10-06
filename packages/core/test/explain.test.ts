/* Catálogo de explicações (explain.ts) e matriz sensores × projeto (sensors.ts): todo id de
 * explicação que os relatórios, o resumo, a qualidade e o pipeline usam existe no catálogo
 * (rodando tudo no exemplo, em variações dele e nos logs reais, e procurando os ids no
 * código-fonte); os sensores que cada relatório marca estão no card; todo card está completo;
 * a matriz cobre todos os sensores; todo canal calculado tem card. */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFixture } from './legacy';
import { parseLog, parseCSV } from '../src/parsers';
import { demoCSV, DEMO_CAR } from '../src/demo';
import { computeSession, rangeOf, type SessionContext } from '../src/pipeline';
import { dataQuality, detectRoles } from '../src/quality';
import { sessionSummary } from '../src/summary';
import { SENSORS, SENSOR_IDS, sensorMatrix } from '../src/sensors';
import { EXPLAIN, EXPLAIN_AREAS, getExplain, explainSensorIds, channelExplainId } from '../src/explain';
import * as R from '../src/reports';
import { sensorsOfChannel } from '../src/reports/maps';
import type { SensorId } from '../src/types';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const BIG = 'Log 3_20261005-1648_20261005-1651.csv';

/* ---------------------------------------------------------------- sessões de teste */
const demoS = () => { const S = parseCSV(demoCSV(), 'exemplo_baja.csv'); S.demo = true; return S; };
const cases: [string, () => SessionContext][] = [
  ['exemplo', () => computeSession(demoS(), { car: DEMO_CAR }, { autoLine: true })],
  ['exemplo sem roda', () => { const S = demoS(); S.channels = S.channels.filter(c => c.key !== 'Wheel_speed'); return computeSession(S, { car: DEMO_CAR }, { autoLine: true }); }],
  ['exemplo sem GPS', () => { const S = demoS(); S.channels = S.channels.filter(c => !/Back_pressure|O2_General/.test(c.key)); return computeSession(S, { car: DEMO_CAR }); }],
  ['exemplo sem amortecedores nem CVT', () => { const S = demoS(); S.channels = S.channels.filter(c => !/Shock|CVT/.test(c.key)); return computeSession(S, { car: DEMO_CAR }, { autoLine: true }); }],
  ['exemplo roda livre, sem dados do carro', () => computeSession(demoS(), { car: { ...DEMO_CAR, wheelDriven: false, mrF: 0, mrR: 0, strokeF: 0, strokeR: 0, massF: 0, massR: 0 } }, { autoLine: true })],
  ['exemplo com fórmula', () => computeSession(demoS(), { car: DEMO_CAR, formulas: [{ id: 'dif', name: 'Dif', unit: 'mm', expr: '[Shock_-_Front_Left] - [Shock_-_Front_Right]' }] }, { autoLine: true })],
];
for (const f of ['ft_log3_gps.csv', 'ft_log3_shocks_compact.csv', 'busmaster_14.log', BIG]) {
  const text = readFixture(f);
  if (text) cases.push([f, () => computeSession(parseLog(text, f))]);
}

/* ---------------------------------------------------------------- coleta dos ids em uso */
interface Use { explain: string; sensors: SensorId[] | null; where: string }
/* percorre a saída (objetos e listas) pegando cada campo explain e os sensors do mesmo objeto */
const walk = (o: unknown, out: Use[], where: string, seen = new Set<unknown>()): void => {
  if (!o || typeof o !== 'object' || seen.has(o) || ArrayBuffer.isView(o)) return;
  seen.add(o);
  if (Array.isArray(o)) { o.forEach((x, i) => walk(x, out, `${where}[${i}]`, seen)); return; }
  const r = o as Record<string, unknown>;
  if (typeof r.explain === 'string') out.push({ explain: r.explain, sensors: Array.isArray(r.sensors) ? r.sensors as SensorId[] : null, where });
  for (const [k, v] of Object.entries(r)) if (k !== 'explain') walk(v, out, `${where}.${k}`, seen);
};

const USES: Use[] = [];
const SUMMARY_KEYS = new Set<string>();
const CTX: [string, SessionContext][] = [];
for (const [name, mk] of cases) {
  const ctx = mk();
  CTX.push([name, ctx]);
  const n = ctx.S.t.length, t = ctx.S.t;
  const ranges: [number, number][] = [rangeOf(ctx, 'session', -1).slice(0, 2) as [number, number]];
  if (ctx.laps.length) ranges.push(rangeOf(ctx, 'lap', 0).slice(0, 2) as [number, number]);
  ranges.push(rangeOf(ctx, 'view', -1, [t[0] + (t[n - 1] - t[0]) / 3, t[0] + (t[n - 1] - t[0]) * 2 / 3]).slice(0, 2) as [number, number]);
  for (const [i0, i1] of ranges) {
    const at = `${name} ${i0}–${i1}`;
    walk(R.designReport(ctx, i0, i1), USES, `${at} design`);
    walk(R.suspensionReport(ctx, i0, i1), USES, `${at} suspensão`);
    walk(R.resonanceReport(ctx, i0, i1), USES, `${at} ressonância`);
    walk(R.resonanceReport(ctx, i0, i1, { dropIndex: 'manual', manual: [t[i0] + 5, t[i0] + 15], psdMode: 'RL' }), USES, `${at} ressonância manual`);
    walk(R.powertrainReport(ctx, i0, i1), USES, `${at} trem de força`);
    walk(R.cvtReport(ctx, i0, i1), USES, `${at} CVT`);
    walk(R.dynamicsReport(ctx, i0, i1), USES, `${at} dinâmica`);
    walk(R.channelMaps(ctx, i0, i1, { includeConst: true }), USES, `${at} mapas`);
  }
  walk(R.lapReport(ctx, null, null, ctx.laps.length ? 0 : -1), USES, `${name} voltas`);
  walk(R.lapTable(ctx, ctx.laps.length ? 0 : -1), USES, `${name} tabela de voltas`);
  walk(dataQuality(ctx.S, ctx), USES, `${name} qualidade`);
  const sum = sessionSummary(ctx);
  sum.metrics.forEach(m => SUMMARY_KEYS.add(m.key));
  walk(sum, USES, `${name} resumo`);
}

/* ids citados no código-fonte (inclui os ramos que nenhuma sessão de teste exercita) */
const AREA_RE = new RegExp(`'((?:${EXPLAIN_AREAS.join('|')})\\.[A-Za-z_]+)'(?!\\.)`, 'g');
const srcFiles = ['quality.ts', 'summary.ts', 'pipeline.ts', 'sensors.ts', ...readdirSync(path.join(SRC, 'reports')).map(f => 'reports/' + f)];
const SRC_IDS = new Map<string, string>();
for (const f of srcFiles) {
  const text = readFileSync(path.join(SRC, f), 'utf8');
  for (const m of text.matchAll(AREA_RE)) {
    const before = text.slice(Math.max(0, m.index! - 6), m.index!);
    if (/\bid: *$/.test(before)) continue;                /* id de aviso da qualidade (ex.: 'susp.none') */
    if (SUMMARY_KEYS.has(m[1])) continue;                 /* chave de métrica do resumo (ex.: 'power.crr') */
    if (!SRC_IDS.has(m[1])) SRC_IDS.set(m[1], f);
  }
}

describe('todo id de explicação usado existe no catálogo', () => {
  it('coletou os ids de todas as páginas', () => {
    const ids = new Set(USES.map(u => u.explain));
    expect(ids.size).toBeGreaterThan(80);
    for (const id of ['susp.cornerTable', 'freq.dropTest', 'power.coastDown', 'cvt.enduranceProjection', 'dyn.speedHistogram', 'laps.sectors', 'track.channelMap',
      'design.sensorCoverage', 'quality.validSamples', 'sensor.wheel', 'quality.constant']) expect(ids, id).toContain(id);
  });
  it('nos relatórios, no resumo e na qualidade (todas as sessões e trechos)', () => {
    const miss = [...new Map(USES.filter(u => !getExplain(u.explain)).map(u => [u.explain, u.where])).entries()];
    expect(miss).toEqual([]);
  });
  it('no código-fonte (inclui ramos não exercitados)', () => {
    expect(SRC_IDS.size).toBeGreaterThan(80);
    const miss = [...SRC_IDS.entries()].filter(([id]) => !getExplain(id));
    expect(miss).toEqual([]);
  });
  /* cards genéricos: valem para qualquer canal/sensor (o aviso, o mapa ou a linha mostram os
   * sensores do canal); o card lista só a base (logger, gps...) */
  const GENERIC = (id: string) => /^(quality|chart)\./.test(id) ||
    ['track.channelMap', 'design.sensorCoverage', 'design.sheet', 'design.recommendations', 'design.compareSessions', 'design.metricTrend', 'channel.formula', 'channel.log'].includes(id);
  it('os sensores que os relatórios marcam estão no card (chips coerentes)', () => {
    const bad = new Map<string, string>();
    for (const u of USES) {
      if (!u.sensors) continue;
      const card = explainSensorIds(u.explain);
      for (const s of u.sensors) {
        expect(SENSOR_IDS, `${u.where}: ${s}`).toContain(s);
        if (!card.includes(s) && !GENERIC(u.explain)) bad.set(`${u.explain} ← ${s}`, u.where);
      }
    }
    expect([...bad.entries()]).toEqual([]);
  });
});

describe('cards completos', () => {
  const entries = Object.values(EXPLAIN);
  it('catálogo grande, com todas as áreas', () => {
    expect(entries.length).toBeGreaterThan(120);
    for (const a of EXPLAIN_AREAS) expect(entries.some(e => e.id.startsWith(a + '.')), a).toBe(true);
  });
  it('campos obrigatórios preenchidos, sem texto repetido entre campos', () => {
    for (const e of entries) {
      for (const f of ['title', 'what', 'how', 'design'] as const) {
        expect(typeof e[f], `${e.id}.${f}`).toBe('string');
        expect(e[f].trim().length, `${e.id}.${f}`).toBeGreaterThan(10);
      }
      expect(e.what, e.id).not.toBe(e.how);
      expect(e.design, e.id).not.toBe(e.what);
      for (const f of ['limits', 'test'] as const) if (e[f] !== undefined) expect(e[f]!.trim().length, `${e.id}.${f}`).toBeGreaterThan(5);
      expect(e.sensors.length, e.id).toBeGreaterThan(0);
      for (const s of e.sensors) {
        expect(Object.keys(SENSORS), `${e.id}: ${s.id}`).toContain(s.id);
        expect(['required', 'alternative', 'improves']).toContain(s.need);
        expect(s.why.trim().length, `${e.id}: ${s.id}`).toBeGreaterThan(3);
      }
      const sid = e.sensors.map(s => s.id);
      expect(new Set(sid).size, `${e.id}: sensor repetido`).toBe(sid.length);
      expect(e.sensors.some(s => s.need === 'required'), `${e.id}: nenhum sensor obrigatório`).toBe(true);
    }
  });
  it('“Veja também” aponta para cards que existem, sem repetir e sem apontar para si', () => {
    for (const e of entries) {
      const rel = e.related || [];
      expect(new Set(rel).size, e.id).toBe(rel.length);
      expect(rel, e.id).not.toContain(e.id);
      for (const r of rel) expect(getExplain(r), `${e.id} → ${r}`).toBeDefined();
    }
  });
  it('todo card não gerado diz como medir melhor ou os limites', () => {
    for (const e of entries) if (!e.id.startsWith('sensor.')) expect(!!(e.limits || e.test), e.id).toBe(true);
  });
  it('gráficos das páginas da interface (ARQUITETURA 4.2) têm card', () => {
    for (const id of ['chart.trackMap', 'chart.miniMap', 'chart.stackedChannels', 'chart.distanceAxis', 'chart.lapOverlay', 'chart.scatter',
      'chart.histogram2d', 'chart.shockHistOverlay', 'track.channelMap', 'laps.speedTrace', 'design.sheet', 'design.recommendations',
      'design.compareSessions', 'design.metricTrend']) expect(getExplain(id), id).toBeDefined();
  });
  it('as entradas exemplares continuam com os mesmos sensores', () => {
    expect(explainSensorIds('power.tireCalibration')).toEqual(['wheel', 'gps']);
    expect(explainSensorIds('susp.naturalFreq')).toEqual(['shock_fl', 'shock_fr', 'shock_rl', 'shock_rr', 'gps', 'wheel', 'car_data']);
    expect(explainSensorIds('cvt.thermalModel')).toEqual(['cvt_temp', 'wheel', 'gps', 'car_data']);
  });
  it('ids com dois nomes têm o mesmo conteúdo', () => {
    const body = (id: string) => { const { id: _, related: __, ...rest } = getExplain(id)!; return rest; };
    expect(body('power.tractionForce')).toEqual(body('power.tractiveForce'));
    expect(body('cvt.maxTemp')).toEqual(body('cvt.tmax'));
  });
});

describe('canais calculados', () => {
  it('todo canal de todas as sessões abre um card que existe, com os sensores do canal', () => {
    for (const [name, ctx] of CTX) {
      const roles = detectRoles(ctx.S, ctx.cfg);
      for (const c of ctx.all) {
        const sens = sensorsOfChannel(ctx, c, roles);
        const own = c.src === 'log' && sens.length === 1 && sens[0] !== 'logger' ? sens[0] : null;
        const id = channelExplainId(c.key, own);
        expect(getExplain(id), `${name}: ${c.key} → ${id}`).toBeDefined();
        if (c.src !== 'log' && c.src !== 'formula') expect(id.startsWith('channel.'), `${name}: ${c.key}`).toBe(true);
      }
    }
  });
  it('mapeamento das chaves', () => {
    expect(channelExplainId('gps:speed')).toBe('channel.gps_speed');
    expect(channelExplainId('gps:x')).toBe(channelExplainId('gps:y'));
    expect(channelExplainId('gps:cx')).toBe('channel.gps_code');
    expect(channelExplainId('veh:P')).toBe('channel.veh_P');
    expect(channelExplainId('susp:vRL')).toBe('channel.susp_vCalc');
    expect(channelExplainId('susp:rollF')).toBe('channel.susp_roll');
    expect(channelExplainId('susp:rough')).toBe('channel.roughness');
    expect(channelExplainId('f:dif')).toBe('channel.formula');
    expect(channelExplainId('Wheel_speed', 'wheel')).toBe('sensor.wheel');
    expect(channelExplainId('Qualquer')).toBe('channel.log');
    expect(channelExplainId('constructor')).toBe('channel.log');
  });
});

describe('sensorMatrix', () => {
  const M = sensorMatrix();
  it('uma linha por sensor (inclusive os sugeridos), na ordem de SENSOR_IDS', () => {
    expect(M.map(r => r.sensor)).toEqual(SENSOR_IDS);
  });
  it('todo item aponta para um card que existe e que usa o sensor da linha', () => {
    for (const r of M) {
      expect(r.items.length, r.sensor).toBeGreaterThan(SENSORS[r.sensor].planned ? 2 : 4);
      const ids = r.items.map(x => x.explain);
      expect(new Set(ids).size, `${r.sensor}: item repetido`).toBe(ids.length);
      for (const it of r.items) {
        expect(getExplain(it.explain), `${r.sensor} → ${it.explain}`).toBeDefined();
        expect(explainSensorIds(it.explain), `${r.sensor} → ${it.explain}`).toContain(r.sensor);
        expect(it.decision.trim().length, `${r.sensor} → ${it.explain}`).toBeGreaterThan(10);
      }
    }
  });
  it('cobre as análises principais de cada área de projeto', () => {
    const all = new Set(M.flatMap(r => r.items.map(x => x.explain)));
    for (const id of ['susp.travelUsed', 'susp.naturalFreq', 'susp.rollGradient', 'susp.jumps', 'freq.criticalSpeed', 'power.wheelPower', 'power.launch',
      'power.coastDown', 'cvt.thermalModel', 'cvt.coolingNeed', 'dyn.latMax', 'laps.delta', 'track.gpsPosition']) expect(all, id).toContain(id);
  });
  it('o card de cada sensor lista as análises da matriz em “Veja também”', () => {
    for (const r of M) {
      const rel = getExplain('sensor.' + r.sensor)!.related || [];
      for (const it of r.items) if (it.explain !== 'sensor.' + r.sensor) expect(rel, r.sensor).toContain(it.explain);
    }
  });
});
