/* Equivalência de gps.ts com legacy/js/gps.js: trajetória, voltas, posição no tempo e as
 * funções auxiliares, nos logs reais e na sessão de exemplo. */
import { describe, it, expect } from 'vitest';
import { loadLegacy, readFixture } from './legacy';
import { same } from './compare';
import { parseLog, parseCSV } from '../src/parsers';
import {
  DEFAULT_CFG, WGS84, mPerDeg, spanOf, FMT_LABEL, detectFmt, toCode, guessGpsChannels, smooth,
  computeTrack, posAt, computeLaps, autoLine,
} from '../src/gps';
import type { Session, TrackConfig } from '../src/types';

const { BT } = loadLegacy();

interface Src { label: string; old: any; neu: Session }
const SOURCES: Src[] = [];
for (const f of ['ft_log3_gps.csv', 'ft_log3_shocks_compact.csv', 'busmaster_14.log', 'Log 3_20261005-1648_20261005-1651.csv']) {
  const text = readFixture(f);
  if (text !== null) SOURCES.push({ label: f, old: BT.parseLog(text, f), neu: parseLog(text, f) });
}
{
  const text = BT.demoCSV();
  SOURCES.push({ label: 'exemplo', old: BT.parseCSV(text, 'exemplo_baja.csv'), neu: parseCSV(text, 'exemplo_baja.csv') });
}
{
  /* busmaster_14.log não tem fix: sessão BUSMASTER sintética com lat/lon (volta oval de ~60 s,
   * 3 voltas, buracos sem fix), para exercitar o caminho do módulo GPS. O mesmo objeto vai
   * para as duas versões (computeTrack só lê). */
  const n = 20 * 200, t = new Float64Array(n), lat = new Float64Array(n).fill(NaN), lon = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    t[i] = i * 0.05;
    if (t[i] < 3 || (t[i] > 70 && t[i] < 72.5) || i % 97 === 0) continue;
    const th = Math.max(0, t[i] - 3) / 60 * 2 * Math.PI;
    lat[i] = -23.6470278 + 0.0006 * Math.sin(th) + 0.00002 * Math.sin(7 * th);
    lon[i] = -46.5747069 + 0.0009 * Math.cos(th) + 0.0003;
  }
  const S: Session = { name: 'sintetico.log', kind: 'BUSMASTER', t, channels: [], gps: { lat, lon }, clock0: '10:00:00', info: '' };
  SOURCES.push({ label: 'BUSMASTER sintético com fix', old: S, neu: S });
}

/* canais X/Y como o app antigo: adivinha quando não é BUSMASTER */
function baseCfg(S: Session): TrackConfig {
  const cfg: TrackConfig = { ...DEFAULT_CFG };
  if (!S.gps) {
    const g = guessGpsChannels(S.channels.map(c => c.key));
    cfg.chX = g.x; cfg.chY = g.y; cfg.chStatus = g.status;
  }
  return cfg;
}

function variations(S: Session): [string, TrackConfig][] {
  const b = baseCfg(S), out: [string, TrackConfig][] = [];
  for (const centerFixed of [true, false])
    for (const fmt of ['auto', 'V', 'mV', 'code', 'm'] as const)
      for (const sm of [0, 0.5, 1]) out.push([`centerFixed=${centerFixed} fmt=${fmt} smooth=${sm}`, { ...b, centerFixed, fmt, smooth: sm }]);
  out.push(['área 300 m, margem 5, centro automático', { ...b, sizeX: 300, sizeY: 120, margin: 5, centerFixed: false }]);
  out.push(['outro centro', { ...b, lat0: -22.9, lon0: -47.06 }]);
  out.push(['sem canais', { ...b, chX: '', chY: '' }]);
  if (!S.gps && S.channels.length > 2) {
    /* status do GPS: qualquer canal do log (testa o filtro >= 254 nos dois formatos) */
    for (const c of S.channels.slice(0, 4)) {
      out.push([`chStatus=${c.key}`, { ...b, chStatus: c.key }]);
      out.push([`chStatus=${c.key} fmt=m`, { ...b, chStatus: c.key, fmt: 'm' }]);
      out.push([`chStatus=${c.key} fmt=code`, { ...b, chStatus: c.key, fmt: 'code' }]);
    }
  }
  return out;
}

describe('gps: constantes e auxiliares', () => {
  it('DEFAULT_CFG, WGS84, FMT_LABEL', () => {
    expect(same(BT.DEFAULT_CFG, DEFAULT_CFG)).toEqual([]);
    expect(same(BT.WGS84, WGS84)).toEqual([]);
    expect(same(BT.FMT_LABEL, FMT_LABEL)).toEqual([]);
  });

  it('mPerDeg e spanOf', () => {
    for (const lat of [-90, -45, -23.6470278, -0.001, 0, 12.5, 60, 89.9, 90, NaN])
      expect(same(BT.mPerDeg(lat), mPerDeg(lat)), String(lat)).toEqual([]);
    for (const centerFixed of [true, false]) for (const sizeX of [0, 100, 200, 333.3]) for (const margin of [0, 10, 2.5]) {
      const c = { centerFixed, sizeX, sizeY: sizeX / 2 + 7, margin };
      expect(same(BT.spanOf(c), spanOf(c))).toEqual([]);
    }
  });

  it('detectFmt e toCode', () => {
    const arrays: number[][] = [
      [], [NaN, NaN], [0, 2.5, 5], [-0.01, 5.2], [-0.02, 1], [0, 5.3], [0, 128, 255], [0, 128.5, 255], [0, 256],
      [0, 2500, 5000], [0, 5200], [0, 5201], [-1, 100], [-50, 50.5], [1.000001, 3], [2, 4.0000001, 200],
      Array.from({ length: 50 }, (_, i) => (i % 7 === 0 ? i : i + 0.5)),
      Array.from({ length: 50 }, (_, i) => (i % 7 === 3 ? i + 0.5 : i * 5)),
    ];
    for (const a of arrays) {
      expect(detectFmt(Float64Array.from(a)), JSON.stringify(a)).toBe(BT.detectFmt(Float64Array.from(a)));
      expect(detectFmt(a), JSON.stringify(a)).toBe(BT.detectFmt(a));
    }
    for (const S of SOURCES) for (const c of S.neu.channels) expect(detectFmt(c.data), `${S.label} ${c.key}`).toBe(BT.detectFmt(c.data));
    for (const v of [0, 1, 2.51, 5, 128, 254, 255, 4980, NaN, -1]) for (const f of ['V', 'mV', 'code', 'm', 'auto', 'x'])
      expect(same(BT.toCode(v, f), toCode(v, f)), `${v} ${f}`).toEqual([]);
  });

  it('guessGpsChannels', () => {
    const lists: string[][] = [
      [], ['Back_pressure', 'O2_General'], ['Back_pressure'], ['GPS_X', 'GPS_Y', 'GPS_status'], ['x', 'y'], ['X', 'Y', 'Status GPS'],
      ['Leste', 'Norte'], ['east', 'north', 'gps st'], ['gps-x', 'O2_General', 'Back_pressure'], ['Shock_-_Front_Left', 'TIME'],
      ['xx', 'yy'], ['GPSX', 'gps_y', 'gpsstat'],
    ];
    for (const S of SOURCES) lists.push(S.neu.channels.map(c => c.key));
    for (const k of lists) expect(same(BT.guessGpsChannels(k), guessGpsChannels(k)), JSON.stringify(k)).toEqual([]);
  });

  it('smooth', () => {
    const tReg = Float64Array.from({ length: 400 }, (_, i) => i * 0.04);
    const tIrr = Float64Array.from({ length: 400 }, (_, i) => i * 0.04 + (i % 5) * 0.013 + (i > 200 ? 3 : 0));
    const A1 = Float64Array.from({ length: 400 }, (_, i) => Math.sin(i * 0.1) * 10 + (i % 3));
    const A2 = Float64Array.from(A1, (v, i) => (i % 37 < 4 || (i > 100 && i < 130) ? NaN : v));
    const A3 = new Float64Array(400).fill(NaN);
    for (const t of [tReg, tIrr]) for (const A of [A1, A2, A3]) for (const w of [0, -1, NaN, 0.04, 0.1, 0.25, 0.5, 1, 3, 100])
      expect(same(BT.smooth(t, A, w), smooth(t, A, w)), `w=${w}`).toEqual([]);
    expect(same(BT.smooth([], [], 1), smooth([], [], 1))).toEqual([]);
    expect(same(BT.smooth([0], [5], 1), smooth([0], [5], 1))).toEqual([]);
  });
});

describe('gps: computeTrack / computeLaps / autoLine / posAt', () => {
  for (const S of SOURCES) {
    it(S.label, () => {
      let okCount = 0;
      for (const [label, cfg] of variations(S.neu)) {
        const at = `${S.label} · ${label}`;
        const trO = BT.computeTrack(S.old, { ...cfg });
        const trN = computeTrack(S.neu, { ...cfg });
        expect(same(trO, trN), at).toEqual([]);
        expect(same(BT.autoLine(S.old, trO), autoLine(S.neu, trN)), at).toEqual([]);
        const line = autoLine(S.neu, trN);
        const lines: [string, any][] = [['sem linha', null], ['auto', line]];
        if (line) lines.push(['auto arredondada', line.map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) }))]);
        lines.push(['manual', [{ x: -30, y: 0 }, { x: 30, y: 0.5 }]], ['manual vertical', [{ x: 0, y: -40 }, { x: 0, y: 40 }]]);
        for (const [ll, l] of lines) for (const minLap of [10, 30, 0])
          expect(same(BT.computeLaps(S.old, trO, l, minLap), computeLaps(S.neu, trN, l, minLap)), `${at} · ${ll} · minLap ${minLap}`).toEqual([]);
        if (trN.ok) {
          okCount++;
          const t = S.neu.t, t0 = t[0], t1 = t[t.length - 1];
          const ts = [t0 - 5, t0, t1, t1 + 5, NaN];
          for (let k = 0; k <= 60; k++) ts.push(t0 + (t1 - t0) * k / 60 + 0.013 * (k % 3));
          for (let i = 0; i < t.length; i += Math.max(1, Math.floor(t.length / 40))) ts.push(t[i], (t[i] + (t[i + 1] ?? t[i])) / 2);
          for (const tc of ts) expect(same(BT.posAt(S.old, trO, tc), posAt(S.neu, trN, tc)), `${at} · posAt ${tc}`).toEqual([]);
        }
      }
      if (S.label === 'busmaster_14.log') expect(okCount, S.label).toBe(0);   /* gravação sem fix 3D */
      else expect(okCount, S.label).toBeGreaterThan(0);
    });
  }

  it('laps do exemplo como o app (linha automática arredondada, minLap 10)', () => {
    const S = SOURCES.find(s => s.label === 'exemplo')!;
    const cfg = baseCfg(S.neu);
    const trN = computeTrack(S.neu, cfg);
    const l = autoLine(S.neu, trN)!.map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) }));
    const laps = computeLaps(S.neu, trN, l, 10);
    expect(laps.length).toBeGreaterThanOrEqual(3);
    expect(same(BT.computeLaps(S.old, BT.computeTrack(S.old, { ...cfg }), l, 10), laps)).toEqual([]);
  });
});
