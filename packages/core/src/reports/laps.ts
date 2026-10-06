/* Relatório da página Voltas: porte de renderLaps + frameLaps (legacy/js/analysisui.js) e
 * da tabela de voltas buildLaps (legacy/js/app.js). Seletores, resumo, velocidade ×
 * distância, diferença acumulada e os 10 trechos, com o mapeamento distância → tempo para
 * o "clique para ir ao ponto" e a posição do marcador do cursor. */
import type { SensorId } from '../types';
import type { Lap, TrackOk } from '../gps';
import type { LapCompare, LapProfile } from '../analysis';
import type { SessionContext } from '../pipeline';
import { bestLap, lapProfile, compareLaps, interpAt } from '../analysis';
import { fmtTime } from '../util';
import type { RepPlot, RepRow, RepTable } from './powertrain';

/* voltas: posição e distância do GPS, tempo do relógio do logger */
const LAP_SENSORS: SensorId[] = ['gps', 'logger'];

export interface LapOption { value: number; label: string }

export interface LapReport {
  ok: boolean;                   /* false = menos de 2 voltas */
  empty?: string;
  options: LapOption[];          /* os dois seletores (lpCmp e lpRef) */
  best: number;                  /* índice da melhor volta */
  cmp: number;                   /* índice da volta comparada */
  ref: number;                   /* índice da volta de referência */
  lap: Lap | null;               /* volta comparada */
  refLap: Lap | null;
  summary: string;               /* lpSum */
  fin: number;                   /* s no fim (+ = comparada mais lenta) */
  compare: LapCompare | null;    /* na distância da referência */
  profileCmp: LapProfile | null;
  profileRef: LapProfile | null;
  seg: Float64Array | null;      /* Δ de cada um dos 10 trechos (s, + = perdeu) */
  speed: RepPlot | null;         /* lpSpeed */
  delta: RepPlot | null;         /* lpDelta */
  sectors: RepPlot | null;       /* lpSect */
  explain: string;
  sensors: SensorId[];
}

/* estado vazio: nada foi calculado, então nenhum sensor entrou na conta (o card diz o que falta) */
const emptyLaps = (msg: string): LapReport => ({
  ok: false, empty: msg, options: [], best: -1, cmp: -1, ref: -1, lap: null, refLap: null, summary: '', fin: NaN,
  compare: null, profileCmp: null, profileRef: null, seg: null, speed: null, delta: null, sectors: null,
  explain: 'laps.compare', sensors: [],
});

/** Comparação de duas voltas (= renderLaps). cmp/ref: índices escolhidos nos seletores
 *  (null/inválido = o padrão do antigo: referência = a melhor; comparada = a volta
 *  selecionada se não for a melhor, senão a primeira que não é a melhor). selLap = volta
 *  selecionada na sessão (-1 = nenhuma). */
export function lapReport(ctx: Pick<SessionContext, 'S' | 'track' | 'laps'>, cmp?: number | null, ref?: number | null, selLap = -1): LapReport {
  const laps = ctx.laps;
  if (laps.length < 2 || !ctx.track.ok) return emptyLaps('Precisa de pelo menos 2 voltas. Defina a linha de largada no mapa.');
  const tr = ctx.track;
  const best = bestLap(laps);
  const options = laps.map((l, k) => ({ value: k, label: `Volta ${l.n} · ${fmtTime(l.time)}${k === best ? ' (melhor)' : ''}` }));
  const has = (k: number | null | undefined): k is number => k !== null && k !== undefined && !!laps[k];
  const kr = has(ref) ? ref : best;
  /* volta selecionada que não existe: o <select> do antigo fica sem valor ('') e a conta usa
   * laps[+''] = a volta 0 */
  const k0 = selLap >= 0 && selLap !== best ? selLap : best === 0 ? 1 : 0;
  const kc = has(cmp) ? cmp : laps[k0] ? k0 : 0;
  const lr = laps[kr], lc = laps[kc];
  const pr = lapProfile(ctx.S, tr, lr), pc = lapProfile(ctx.S, tr, lc);
  const c = compareLaps(pr, pc, 1);
  const fin = c.delta[c.delta.length - 1];
  const summary = `Volta ${lc.n} ${fmtTime(lc.time)} contra volta ${lr.n} ${fmtTime(lr.time)}: ` +
    `${fin >= 0 ? '+' : ''}${fin.toFixed(2)} s no fim (${fin >= 0 ? 'mais lenta' : 'mais rápida'}).`;
  const speed: RepPlot = {
    id: 'lpSpeed', explain: 'laps.speedTrace', sensors: LAP_SENSORS,
    series: [{ id: 'ref', role: 'ref', x: c.d, y: c.vRef, label: `Volta ${lr.n} (ref.)` }, { id: 'cmp', role: 'cmp', x: c.d, y: c.vCmp, label: `Volta ${lc.n}` }],
    xLabel: 'distância na volta (m)', yLabel: 'km/h', tipX: { dec: 0, suffix: ' m' }, fmtY: { dec: 1, suffix: ' km/h' }, clickSeek: true,
  };
  const delta: RepPlot = {
    id: 'lpDelta', explain: 'laps.delta', sensors: LAP_SENSORS,
    series: [{ id: 'delta', role: 'cmp', x: c.d, y: c.delta, label: `Δ volta ${lc.n} − ${lr.n}` }], zeroY: true, legend: [],
    xLabel: 'distância na volta (m)', yLabel: 'Δ tempo (s, + = perdendo)', tipX: { dec: 0, suffix: ' m' }, fmtY: { dec: 2, suffix: ' s', sign: true }, clickSeek: true,
  };
  /* 10 trechos de mesma distância */
  const N = 10, seg = new Float64Array(N), D = pr.D;
  for (let k = 0; k < N; k++) seg[k] = interpAt(c.d, c.delta, D * (k + 1) / N) - interpAt(c.d, c.delta, D * k / N);
  const ab = seg.map(Math.abs);
  const sectors: RepPlot = {
    id: 'lpSect', explain: 'laps.sectors', sensors: LAP_SENSORS,
    bars: { x0: 0.5, w: 1, y: ab, roles: Array.from(seg, v => (v > 0 ? 'pos' : 'neg')) },
    legend: [{ label: 'perdeu tempo', role: 'pos' }, { label: 'ganhou tempo', role: 'neg' }],
    xLabel: 'trecho (1 = logo após a largada)', yLabel: '|Δ| no trecho (s)',
    barTips: Array.from(seg, (s, k) => ({ title: `Trecho ${k + 1}`, note: `(${(D * k / N).toFixed(0)}–${(D * (k + 1) / N).toFixed(0)} m)`, text: `${s > 0 ? 'perdeu' : 'ganhou'} ${Math.abs(s).toFixed(2)} s` })),
  };
  return {
    ok: true, options, best, cmp: kc, ref: kr, lap: lc, refLap: lr, summary, fin,
    compare: c, profileCmp: pc, profileRef: pr, seg, speed, delta, sectors,
    explain: 'laps.compare', sensors: LAP_SENSORS,
  };
}

/** "Clique para ir ao ponto" nos gráficos por distância: instante (s) da volta comparada na
 *  distância d (m, na escala da referência). */
export const lapSeekTime = (rep: Pick<LapReport, 'lap' | 'compare'>, d: number): number =>
  rep.lap && rep.compare ? rep.lap.t0 + interpAt(rep.compare.d, rep.compare.tCmp, d) : NaN;

/** Marcador do cursor nos gráficos por distância (= frameLaps): distância (m, escala da
 *  referência) da amostra i no instante cur, ou null fora da volta comparada. */
export const lapCursorDist = (rep: Pick<LapReport, 'lap' | 'compare' | 'profileCmp'>, track: TrackOk, i: number, cur: number): number | null => {
  const c = rep.compare, l = rep.lap, pc = rep.profileCmp;
  if (!c || !l || !pc) return null;
  if (cur < l.t0 || cur > l.t1) return null;
  const d0 = track.dist[l.i0], sc = pc.D > 0 ? c.d[c.d.length - 1] / pc.D : 1;
  return (track.dist[i] - d0) * sc;
};

/* ================================================================ tabela de voltas */
export interface LapTableRow extends RepRow {
  k: number;                     /* índice da volta */
  lap: Lap;
  best: boolean;                 /* tempo igual ao melhor */
  sel: boolean;                  /* volta selecionada */
}
export interface LapTableReport extends Omit<RepTable, 'rows'> {
  ok: boolean;
  empty?: string;
  rows: LapTableRow[];
  best: number;                  /* s, melhor tempo */
  note: string;                  /* rodapé da tabela */
}

/** Tabela de voltas da barra lateral (= buildLaps de app.js). selLap = volta selecionada. */
export function lapTable(ctx: Pick<SessionContext, 'track' | 'laps' | 'cfg'>, selLap = -1): LapTableReport {
  const base = { id: 'laps', explain: 'laps.table', sensors: LAP_SENSORS, columns: ['Volta', 'Tempo', 'Δ melhor', 'V máx', 'V média', 'Dist.'] };
  const fail = (msg: string): LapTableReport => ({ ...base, sensors: [], ok: false, empty: msg, rows: [], best: NaN, note: '' });
  if (!ctx.track || !ctx.track.ok) return fail('Sem trajetória de GPS neste log.');
  if (!ctx.cfg.line) return fail('Defina a linha de largada no mapa (“Desenhar” ou “Automática”) para separar as voltas.');
  if (!ctx.laps.length) return fail('Nenhuma volta completa cruzando a linha. Ajuste a linha ou a volta mínima.');
  const best = Math.min(...ctx.laps.map(l => l.time));
  const rows = ctx.laps.map((l, k): LapTableRow => ({
    k, lap: l, best: l.time === best, sel: k === selLap,
    cells: [`${l.n}`, fmtTime(l.time), l.time === best ? '—' : '+' + (l.time - best).toFixed(2), l.vmax.toFixed(1), l.vavg.toFixed(1), `${l.dist.toFixed(0)} m`],
    values: [l.n, l.time, l.time === best ? null : l.time - best, l.vmax, l.vavg, l.dist],
  }));
  return { ...base, ok: true, rows, best, note: 'km/h pelo GPS · clique numa volta para ver só ela' };
}
