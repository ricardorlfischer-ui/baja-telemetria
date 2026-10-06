/* Resumo da sessão (sessionSummary): no exemplo os números batem com a ficha de projeto do
 * app antigo (renderDesign, mesmos textos) e com a tabela de validação do legacy/README.md;
 * a força trativa bate com o bloco do renderPower antigo; nos fixtures não quebra e marca
 * null o que falta. Chaves estáveis, explain e sensores em todas as métricas. */
import { describe, it, expect } from 'vitest';
import { loadLegacy, legacyDemo, legacyAnalysis, readFixture } from './legacy';
import { parseLog, parseCSV } from '../src/parsers';
import { demoCSV, DEMO_CAR } from '../src/demo';
import { computeSession, type SessionContext } from '../src/pipeline';
import { SENSOR_IDS } from '../src/sensors';
import { EXPLAIN_AREAS } from '../src/explain';
import { designReport } from '../src/reports/design';
import { sessionSummary, summaryMetric, SUMMARY_VERSION, type SessionSummary } from '../src/summary';

const L = loadLegacy({ ui: true });
const { BT } = L;

const demoCtx = (): SessionContext => {
  const S = parseCSV(demoCSV(), 'exemplo_baja.csv'); S.demo = true;
  return computeSession(S, { car: DEMO_CAR }, { autoLine: true });
};
const N = demoCtx();
const SUM = sessionSummary(N);
const val = (s: SessionSummary, k: string) => { const x = summaryMetric(s, k); if (!x) throw new Error('sem a chave ' + k); return x.value; };
const txt = (s: SessionSummary, k: string) => summaryMetric(s, k)!.text;

/* ficha antiga do exemplo, sessão inteira */
const O = legacyDemo(BT);
const an = legacyAnalysis(L, O, 'session');
an.renderDesign();
const OLD: { grp: string; item: string; val: string; how: string; read: string }[] = an.designRows;
const oldRow = (item: string) => { const r = OLD.find(x => x.item === item); if (!r) throw new Error('sem a linha ' + item); return r; };
/* os blocos (pwTiles) saem antes do renderCoast, que precisa de um <select> de verdade */
try { an.renderPower(); } catch { /* renderCoast no DOM falso */ }
const PW_TILES = L.el('pwTiles').innerHTML;

const KEYS = SUM.metrics.map(x => x.key);

function checkShape(s: SessionSummary, label: string) {
  expect(s.version).toBe(SUMMARY_VERSION);
  expect(s.metrics.map(x => x.key), label).toEqual(KEYS);               /* chaves estáveis, mesma ordem */
  expect(new Set(s.metrics.map(x => x.key)).size).toBe(s.metrics.length);
  for (const x of s.metrics) {
    const at = `${label} · ${x.key}`;
    expect(x.value === null || Number.isFinite(x.value), at).toBe(true);
    expect(x.explain, at).toMatch(/^[a-z]+\.[A-Za-z_]+$/);
    expect((EXPLAIN_AREAS as readonly string[]).includes(x.explain.split('.')[0]), at).toBe(true);
    for (const id of x.sensors) expect(SENSOR_IDS, at).toContain(id);
    if (x.value !== null) expect(x.sensors.length, at).toBeGreaterThan(0);
    if (x.value === null && x.text === undefined) expect(x.sensors, at).toEqual([]);
  }
  expect(JSON.parse(JSON.stringify(s))).toEqual(s);                       /* vai para o servidor como JSON */
}

describe('sessionSummary no exemplo', () => {
  it('formato, chaves estáveis, explain e sensores', () => {
    expect(SUMMARY_VERSION).toBe(1);
    checkShape(SUM, 'exemplo');
    expect(KEYS).toContain('susp.travel.FL');
    expect(KEYS).toContain('cvt.tmax');
    expect(KEYS.length).toBeGreaterThan(60);
  });

  it('mesmos números da ficha do app antigo (renderDesign)', () => {
    const t = (k: string) => txt(SUM, k)!;
    expect(oldRow('Frequência natural diant. / tras.').val).toBe(`${t('susp.fn.F')} / ${t('susp.fn.R')} Hz`);
    expect(oldRow('Amortecimento ζ diant. / tras.').val).toBe(`${t('susp.zeta.F')} / ${t('susp.zeta.R')}`);
    expect(oldRow('Rigidez equivalente na roda diant. / tras.').val).toBe(`${t('susp.k.F')} / ${t('susp.k.R')} N/mm`);
    expect(oldRow('Amortecimento na roda diant. / tras.').val).toBe(`${t('susp.c.F')} / ${t('susp.c.R')} N·s/m`);
    for (const [ax, nm] of [['F', 'diant.'], ['R', 'tras.']]) {
      expect(oldRow(`Curso usado ${nm}`).val).toBe(`${t('susp.travel.' + ax)} mm (${t('susp.travelPct.' + ax)} % de 150)`);
      expect(oldRow(`Curso usado ${nm}`).read).toBe(`curso mínimo sugerido: ${t('susp.strokeSuggested.' + ax)} mm (+15 %)`);
      expect(oldRow(`Velocidade do amortecedor ${nm}`).val).toBe(`${t('susp.velComp95.' + ax)} comp. / ${t('susp.velExt95.' + ax)} ext. mm/s (p95)`);
      expect(oldRow(`Velocidade do amortecedor ${nm}`).how).toBe(`máx. compressão ${t('susp.velCompMax.' + ax)} mm/s`);
    }
    /* curso por canto: o do eixo é o maior dos dois lados */
    expect(val(SUM, 'susp.travel.F')).toBe(Math.max(val(SUM, 'susp.travel.FL')!, val(SUM, 'susp.travel.FR')!));
    expect(val(SUM, 'susp.travel.R')).toBe(Math.max(val(SUM, 'susp.travel.RL')!, val(SUM, 'susp.travel.RR')!));
    expect(oldRow('Gradiente de rolagem').val).toBe(`${t('susp.rollGradient')} °/g`);
    expect(oldRow('Gradiente de arfagem frenagem / aceleração').val).toBe(`${t('susp.pitchBrake')} / ${t('susp.pitchAccel')} °/g`);
    expect(oldRow('Saltos').val).toBe(`${t('susp.jumps')} · maior ${t('susp.jumpAirMax')} ms no ar, ${t('susp.jumpHeightMax')} cm`);
    expect(oldRow('Saltos').read).toBe(`pouso a ${t('susp.landingSpeed')} m/s; amortecedor até ${t('susp.jumpShockVel')} mm/s`);
    expect(oldRow('Rugosidade (vel. amortecedores RMS)').val).toBe(`${t('susp.roughMedian')} mediana · ${t('susp.roughP95')} p95 mm/s`);
    expect(oldRow('Ondulações dominantes').val).toBe(t('susp.wavelength'));
    expect(oldRow('Calibração da velocidade da roda').val).toBe(`fator ${t('power.tireFactor')} (a roda marca +${t('power.tireError')} %)`);
    expect(oldRow('Velocidade máxima').val).toBe(`${t('power.vmax')} km/h`);
    expect(t('session.vmax')).toBe(t('power.vmax'));
    expect(oldRow('Potência máxima na roda').val).toBe(`${t('power.pmax')} kW a ${t('power.pmaxSpeed')} km/h`);
    expect(oldRow('Melhor largada').val).toBe(`0–30 m ${t('power.launch30')} s · 0–20 km/h ${t('power.launch20kmh')} s`);
    expect(oldRow('Melhor largada').how).toBe(`${t('power.launches')} largada(s) do carro parado`);
    expect(oldRow('Melhor largada').read).toBe(`escorregamento médio nos 10 m: ${t('power.launchSlip')} %`);
    expect(oldRow('Frenagem máx. / lateral máx.').val).toBe(`${t('power.brakeMax')} g / ${t('power.latMax')} g`);
    expect(oldRow('Resistência ao rolamento e arrasto').val).toBe(`Crr ${t('power.crr')} · CdA ${t('power.cda')} m²`);
    expect(oldRow('Temperatura máxima medida').val).toBe(`${t('cvt.tmax')} °C`);
    expect(oldRow('Regime previsto no enduro').val).toBe(`${t('cvt.steady')} °C`);
    expect(oldRow('Regime previsto no enduro').read).toBe(`após 240 min: ${t('cvt.endTemp')} °C`);
    expect(oldRow('Constante de tempo').val).toBe(`${t('cvt.tau')} min andando`);
    /* força trativa: o bloco "Força trativa máx." do renderPower antigo */
    expect(PW_TILES).toContain(`<span>Força trativa máx.</span><b>${t('power.traction')}</b>`);
    /* com a ficha já calculada dá o mesmo */
    expect(sessionSummary(N, designReport(N, 0, N.S.t.length - 1))).toEqual(SUM);
  });

  it('bate com a tabela de validação do legacy/README.md', () => {
    expect(txt(SUM, 'susp.fn.F')).toBe('1.61');                                     /* ~1,6 Hz → 1,61 Hz */
    expect(Math.abs(val(SUM, 'susp.zeta.F')! - 0.34)).toBeLessThan(0.02);           /* 0,33 → 0,34 */
    expect(txt(SUM, 'power.tireError')).toBe('2.8');                                /* +3 % → +2,8 % */
    expect(val(SUM, 'power.pmax')!).toBeGreaterThan(5.3);                            /* 5,5 kW → 5,4–5,9 kW */
    expect(val(SUM, 'power.pmax')!).toBeLessThan(6.0);
    expect(Math.abs(val(SUM, 'power.traction')! - 1230)).toBeLessThan(25);          /* 1222 N → 1230 N */
    expect(txt(SUM, 'power.crr')).toBe('0.062');                                    /* 0,06 → 0,062 */
    expect(txt(SUM, 'susp.wavelength')).toContain('3.2 m');                          /* 3,2 m entre as ondulações */
    expect(designReport(N, 0, N.S.t.length - 1).facts.cvt!.fit!.r2).toBeGreaterThan(0.5);
  });

  it('sessão: duração, distância, voltas, melhor volta e qualidade', () => {
    const t = N.S.t;
    expect(val(SUM, 'session.duration')).toBeCloseTo(t[t.length - 1] - t[0], 9);
    expect(val(SUM, 'session.laps')).toBe(N.laps.length);
    expect(N.laps.length).toBeGreaterThan(0);
    expect(val(SUM, 'session.bestLap')).toBe(Math.min(...N.laps.map(l => l.time)));
    expect(val(SUM, 'session.distance')!).toBeGreaterThan(N.laps.reduce((s, l) => s + l.dist, 0) - 1);
    expect(val(SUM, 'quality.gpsValid')!).toBeGreaterThan(90);
    const sens = summaryMetric(SUM, 'quality.sensors')!;
    expect(sens.sensors).toEqual(expect.arrayContaining(['gps', 'shock_fl', 'shock_fr', 'shock_rl', 'shock_rr', 'wheel', 'cvt_temp', 'logger', 'car_data']));
    expect(sens.text).toContain('GPS');
    /* sensores de algumas contas */
    expect(summaryMetric(SUM, 'susp.travel.RL')!.sensors).toEqual(['shock_rl']);
    expect(summaryMetric(SUM, 'power.pmax')!.sensors).toEqual(['gps', 'wheel', 'car_data']);
    expect(summaryMetric(SUM, 'cvt.steady')!.sensors).toEqual(['gps', 'wheel', 'cvt_temp', 'car_data']);
    expect(summaryMetric(SUM, 'susp.k.F')!.sensors).toEqual(['gps', 'shock_fl', 'shock_fr', 'car_data']);
    expect(summaryMetric(SUM, 'session.duration')!.sensors).toEqual(['logger']);
  });
});

describe('sessionSummary sem sensores / nos fixtures', () => {
  it('exemplo sem roda e sem CVT: calibração e CVT null, velocidade pelo GPS', () => {
    const S = parseCSV(demoCSV(), 'exemplo_baja.csv'); S.demo = true;
    S.channels = S.channels.filter(c => c.key !== 'Wheel_speed' && c.key !== 'CVT_temp');
    const s = sessionSummary(computeSession(S, { car: DEMO_CAR }, { autoLine: true }));
    checkShape(s, 'sem roda/CVT');
    expect(val(s, 'power.tireFactor')).toBeNull();
    expect(val(s, 'cvt.tmax')).toBeNull();
    expect(val(s, 'cvt.steady')).toBeNull();
    expect(summaryMetric(s, 'power.vmax')!.sensors).toEqual(['gps']);
    expect(summaryMetric(s, 'power.launchSlip')!.value).toBeNull();
  });
  it('exemplo com o carro padrão: sem curso/massa → % do curso, fim de curso e rigidez null', () => {
    const S = parseCSV(demoCSV(), 'exemplo_baja.csv'); S.demo = true;
    const s = sessionSummary(computeSession(S, {}, { autoLine: true }));
    checkShape(s, 'carro padrão');
    expect(val(s, 'susp.travel.F')).not.toBeNull();
    expect(val(s, 'susp.travelPct.F')).toBeNull();
    expect(val(s, 'susp.bottomOuts.F')).toBeNull();
    expect(val(s, 'susp.k.F')).toBeNull();
    expect(val(s, 'susp.fn.F')).not.toBeNull();
  });
  for (const f of ['ft_log3_gps.csv', 'ft_log3_shocks_compact.csv', 'busmaster_14.log', 'Log 3_20261005-1648_20261005-1651.csv']) {
    it(`${f}: não quebra e marca null o que falta`, () => {
      const text = readFixture(f);
      if (text === null) return;
      const ctx = computeSession(parseLog(text, f), {}, { autoLine: true });
      const s = sessionSummary(ctx);
      checkShape(s, f);
      expect(val(s, 'session.duration')).not.toBeNull();
      /* nenhum fixture tem roda nem CVT */
      for (const k of ['power.tireFactor', 'cvt.tmax', 'cvt.steady', 'cvt.tau']) expect(val(s, k), k).toBeNull();
      if (f === 'ft_log3_gps.csv') {
        for (const k of ['susp.travel.FL', 'susp.travel.F', 'susp.fn.F', 'susp.roughMedian', 'susp.jumps']) expect(val(s, k), k).toBeNull();
        expect(val(s, 'session.distance')).not.toBeNull();
        expect(summaryMetric(s, 'session.distance')!.sensors).toEqual(['gps']);
      }
      if (f === 'ft_log3_shocks_compact.csv' || f.startsWith('Log 3')) {
        /* só o RL tem sinal (os outros potenciômetros ficaram em 0) */
        expect(val(s, 'susp.travel.RL')).not.toBeNull();
        for (const k of ['susp.travel.FL', 'susp.travel.FR', 'susp.travel.RR', 'susp.travel.F', 'susp.rollGradient']) expect(val(s, k), k).toBeNull();
        expect(summaryMetric(s, 'quality.sensors')!.sensors).toContain('shock_rl');
        expect(summaryMetric(s, 'quality.sensors')!.sensors).not.toContain('shock_fl');
      }
      if (f === 'busmaster_14.log') {
        /* sem fix 3D: nada de trajetória, voltas nem velocidade */
        expect(ctx.track.ok).toBe(false);
        for (const k of ['session.distance', 'session.laps', 'session.bestLap', 'session.vmax', 'power.pmax']) expect(val(s, k), k).toBeNull();
        expect(val(s, 'quality.gpsValid')).toBe(0);
      }
    });
  }
});
