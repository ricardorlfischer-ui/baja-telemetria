/* Relatório da página Dinâmica: porte de renderDyn (legacy/js/analysisui.js). Blocos de
 * velocidade, acelerações e raio, diagrama g-g (com os círculos) e tempo por faixa de
 * velocidade, com os sensores de cada número. */
import type { SensorId } from '../types';
import type { SessionContext } from '../pipeline';
import { quant, hist } from '../analysis';
import { fmtTime } from '../util';
import { mergeSensors, vehSpeedSensors, type RepPlot, type RepText, type RepTile } from './powertrain';

/* mesmo helper de analysisui.js */
const fx = (v: number, d = 1) => (v === v && v !== null && isFinite(v) ? v.toFixed(d) : '—');
const num = (v: number): number | null => (v === v && isFinite(v) ? v : null);

export interface DynamicsReport {
  ok: boolean;                   /* false = sem trajetória de GPS (gráficos escondidos) */
  empty?: string;
  src: RepText;                  /* de onde vêm as acelerações (dySrc) */
  tiles: RepTile[];
  gg: RepPlot | null;            /* diagrama g-g (dyGG) */
  speed: RepPlot | null;         /* tempo por faixa de velocidade (dySpd) */
  /** ponto atual do g-g: (lat[i], lon[i]) no cursor (frame() do antigo) */
  cursor: { lat: Float64Array; lon: Float64Array } | null;
}

/** Dinâmica no trecho [i0, i1] (= renderDyn). */
export function dynamicsReport(ctx: Pick<SessionContext, 'S' | 'track' | 'dyn' | 'acc' | 'stopped' | 'veh'>, i0: number, i1: number): DynamicsReport {
  const tr = ctx.track;
  if (!tr || !tr.ok || !ctx.dyn) {
    return { ok: false, empty: 'Sem trajetória de GPS.', src: { text: '', explain: 'dyn.accelSource', sensors: [] }, tiles: [], gg: null, speed: null, cursor: null };
  }
  /* sensores: longitudinal = veh.ax (roda ou GPS) ou a do GPS; lateral = roda × guinada do GPS ou só GPS */
  const veh = ctx.veh;
  const lonS: SensorId[] = veh.ax ? vehSpeedSensors(veh) : ['gps'];
  const latS: SensorId[] = veh.wheel && veh.ay ? ['wheel', 'gps'] : ['gps'];
  const accS = mergeSensors(lonS, latS);
  const gpsS: SensorId[] = ['gps'];
  const d = { along: ctx.acc.lon!, alat: ctx.acc.lat!, radius: ctx.dyn.radius }, t = ctx.S.t;
  const stopped = ctx.stopped;
  let vmax = 0, vs = 0, vn = 0, tMove = 0, amax = 0, bmax = 0, lr = 0, ll = 0;
  const radii: number[] = [];
  for (let i = i0; i <= i1; i++) {
    const v = tr.speed[i];
    if (v === v && v > vmax) vmax = v;
    if (stopped && !stopped[i] && v === v) { vs += v; vn++; if (i > i0) tMove += t[i] - t[i - 1]; }
    const al = d.along[i], at = d.alat[i];
    if (al > amax) amax = al; if (-al > bmax) bmax = -al;
    if (at > lr) lr = at; if (-at > ll) ll = -at;
    if (tr.speed[i] > 10 && d.radius[i] === d.radius[i]) radii.push(d.radius[i]);
  }
  radii.sort((a, b) => a - b);
  const rmin = quant(radii, 0.05);              /* 5 %: o mínimo puro é ruído do GPS */
  const dist = tr.dist[i1] - tr.dist[i0];
  const vavg = vn ? vs / vn : NaN;
  const tile = (key: string, label: string, value: number, text: string, unit: string, explain: string, sensors: SensorId[]): RepTile =>
    ({ key, label, value: num(value), text, unit, explain, sensors });
  const tiles: RepTile[] = [
    tile('vmax', 'Velocidade máx.', vmax, fx(vmax, 1), 'km/h', 'dyn.vmax', gpsS),
    tile('vavg', 'Média andando', vavg, fx(vavg, 1), 'km/h', 'dyn.vavg', gpsS),
    tile('dist', 'Distância', dist, fx(dist, 0), 'm', 'dyn.distance', gpsS),
    tile('tMove', 'Tempo andando', tMove, fmtTime(tMove), 'min:s', 'dyn.movingTime', mergeSensors(gpsS, 'logger')),
    tile('amax', 'Aceleração máx.', amax, fx(amax, 2), 'g', 'dyn.accelMax', lonS),
    tile('bmax', 'Frenagem máx.', bmax, fx(bmax, 2), 'g', 'dyn.brakeMax', lonS),
    tile('latR', 'Lateral máx. dir.', lr, fx(lr, 2), 'g', 'dyn.latMax', latS),
    tile('latL', 'Lateral máx. esq.', ll, fx(ll, 2), 'g', 'dyn.latMax', latS),
    tile('rmin', 'Curva mais fechada', rmin, fx(rmin, 1), 'm de raio (5 % menores, > 10 km/h)', 'dyn.minRadius', gpsS),
  ];
  const n = i1 - i0 + 1;
  const gx = d.alat.subarray(i0, i1 + 1), gy = d.along.subarray(i0, i1 + 1);
  let lim = 0.5;
  for (let i = 0; i < n; i++) { const a = Math.abs(gx[i]), b = Math.abs(gy[i]); if (a === a && a > lim) lim = a; if (b === b && b > lim) lim = b; }
  lim = Math.min(2, Math.ceil(lim * 4) / 4 + 0.1);
  const gg: RepPlot = {
    id: 'dyGG', explain: 'dyn.gg', sensors: accS,
    points: { id: 'samples', x: gx, y: gy, alpha: 0.3 }, equal: true, xRange: [-lim, lim], yRange: [-lim, lim],
    circles: [0.25, 0.5, 0.75, 1, 1.5].filter(r => r < lim), xLabel: 'lateral (g, + direita)', yLabel: 'longitudinal (g, + acelerando)',
  };
  /* tempo por faixa de velocidade */
  const bw = vmax > 40 ? 5 : vmax > 15 ? 2 : 1, nb = Math.max(1, Math.ceil(vmax / bw));
  const hv = hist(tr.speed, i0, i1, stopped ? Uint8Array.from(stopped, x => 1 - x) : null, 0, nb * bw, nb);
  const speed: RepPlot = {
    id: 'dySpd', explain: 'dyn.speedHistogram', sensors: gpsS,
    bars: { x0: 0, w: bw, y: hv.y }, xLabel: 'km/h', yLabel: '% do tempo andando',
    barTips: Array.from(hv.y, (y, j) => ({ title: `${j * bw}–${(j + 1) * bw} km/h`, text: `${y.toFixed(1)} % do tempo` })),
  };
  return {
    ok: true, src: { text: ctx.acc.src || '', explain: 'dyn.accelSource', sensors: accS },
    tiles, gg, speed, cursor: { lat: d.alat, lon: d.along },
  };
}
