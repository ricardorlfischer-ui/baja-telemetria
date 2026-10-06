/* Relatório "Mapas por canal": porte da parte de conta de renderMaps
 * (legacy/js/analysisui.js). Para cada canal: a faixa de cor 2–98 % (pctRange), as casas
 * decimais, o texto da faixa e, para cada pedaço da pista, em qual das 16 cores ele cai —
 * tudo o que o mini-mapa precisa para ser desenhado sem refazer contas. Também os sensores
 * de onde cada canal sai (sensorsOfChannel), usados nos chips dos mapas e de outras páginas. */
import type { Channel, SensorId } from '../types';
import type { SessionContext } from '../pipeline';
import { clamp, decimalsFor, pctRange } from '../util';
import { detectRoles, ROLE_SENSOR, type ChannelRole } from '../quality';
import { parseFormula, formulaRefs } from '../formulas';
import { mergeSensors, vehSpeedSensors } from './powertrain';

/** Número de faixas de cor do mini-mapa (como no antigo). */
export const MINI_MAP_BINS = 16;

const shockSensor = (id: string): SensorId => ('shock_' + id.toLowerCase()) as SensorId;

/** Sensores de onde sai um canal desta sessão: os do log pelo papel detectado (roda, CVT,
 *  amortecedor, GPS...; sem papel = o próprio logger), os calculados pelo que entrou na
 *  conta (ex.: veh:P = velocidade (roda/GPS) + dados do carro) e as fórmulas pelos canais que
 *  elas usam. */
export function sensorsOfChannel(ctx: Pick<SessionContext, 'S' | 'cfg' | 'veh' | 'susp' | 'all'>, ch: Channel | string, roles?: Partial<Record<ChannelRole, string>>, seen: string[] = []): SensorId[] {
  const key = typeof ch === 'string' ? ch : ch.key;
  if (seen.includes(key)) return [];
  const active = ctx.susp.shocks.filter(k => k.active);
  const act = (ids?: string[]) => active.filter(k => !ids || ids.includes(k.id)).map(k => shockSensor(k.id));
  if (key.startsWith('gps:')) return ['gps'];
  if (key.startsWith('veh:')) {
    const spd = vehSpeedSensors(ctx.veh);
    if (key === 'veh:ay' || key === 'veh:slip') return ['wheel', 'gps'];
    if (key === 'veh:P') return mergeSensors(spd, 'car_data');
    return spd;
  }
  if (key.startsWith('susp:')) {
    const m = /^susp:v(FL|FR|RL|RR)$/.exec(key);
    if (m) return [shockSensor(m[1])];
    if (key === 'susp:pitch') return mergeSensors(act(), 'car_data');
    if (key === 'susp:rollF') return mergeSensors(act(['FL', 'FR']), 'car_data');
    if (key === 'susp:rollR') return mergeSensors(act(['RL', 'RR']), 'car_data');
    return act();                                        /* heave, warp, rough */
  }
  if (key.startsWith('f:')) {
    const f = (ctx.cfg.formulas || []).find(x => 'f:' + x.id === key);
    if (!f) return [];
    let refs: string[] = [];
    try { refs = formulaRefs(parseFormula(f.expr)); } catch { return []; }
    const R = roles || detectRoles(ctx.S, ctx.cfg);
    return mergeSensors(...refs.map(r => sensorsOfChannel(ctx, r, R, [...seen, key])));
  }
  const R = roles || detectRoles(ctx.S, ctx.cfg);
  const role = (Object.keys(R) as ChannelRole[]).find(r => R[r] === key);
  return role ? [ROLE_SENSOR[role]] : ['logger'];
}

/** Retângulo da pista no trecho (m). Sem ponto válido fica ±Infinity, como no antigo. */
export interface MapBounds { x0: number; x1: number; y0: number; y1: number }

/** Escala do mini-mapa num canvas w × h (= renderMaps): px = ox + (x − x0)·s,
 *  py = h − oy − (y − y0)·s. */
export const miniMapTransform = (b: MapBounds, w: number, h: number, pad = 10): { s: number; ox: number; oy: number } => {
  const s = Math.min((w - 2 * pad) / Math.max(b.x1 - b.x0, 5), (h - 2 * pad) / Math.max(b.y1 - b.y0, 5));
  return { s, ox: (w - (b.x1 - b.x0) * s) / 2, oy: (h - (b.y1 - b.y0) * s) / 2 };
};

export interface ChannelMap {
  key: string;
  name: string;
  unit: string;
  constant: boolean;
  lo: number;                    /* faixa de cor: percentil 2 % */
  hi: number;                    /* percentil 98 % (lo + 1 se a faixa for nula) */
  n: number;                     /* amostras válidas usadas na faixa */
  dec: number;                   /* casas do valor no cursor (fmtVal(v, dec)) */
  rangeText: string;             /* 'lo … hi unidade' ou 'sem dados' */
  /** cor de cada pedaço da pista: bins[i] = faixa (0…15) do pedaço (i−1 → i), −1 = não
   *  desenhado (GPS inválido ou valor NaN). Fora do trecho também −1. */
  bins: Int8Array;
  any: boolean;                  /* algum pedaço colorido (senão a pista vai cinza) */
  explain: string;
  sensors: SensorId[];           /* GPS (posição) + os sensores do canal */
}

export interface ChannelMapsReport {
  ok: boolean;                   /* false = sem trajetória */
  empty?: string;                /* mensagem da trajetória (tr.msg) */
  i0: number;
  i1: number;
  bounds: MapBounds;
  nb: number;                    /* faixas de cor (16) */
  items: ChannelMap[];
}

/** Mapas por canal no trecho [i0, i1] (= renderMaps; no antigo o trecho é A.range(): a
 *  volta selecionada ou a sessão inteira, ou seja rangeOf(ctx, 'lap', sel)). includeConst =
 *  "incluir canais constantes". */
export function channelMaps(ctx: Pick<SessionContext, 'S' | 'cfg' | 'track' | 'veh' | 'susp' | 'all'>, i0: number, i1: number, opts: { includeConst?: boolean } = {}): ChannelMapsReport {
  const tr = ctx.track, a = i0, b = i1;
  const bounds: MapBounds = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  if (!tr || !tr.ok) return { ok: false, empty: tr ? tr.msg : 'Sem GPS', i0, i1, bounds, nb: MINI_MAP_BINS, items: [] };
  const list = ctx.all.filter(c => opts.includeConst || !c.constant);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = a; i <= b; i++) if (tr.valid[i]) {
    if (tr.x[i] < x0) x0 = tr.x[i]; if (tr.x[i] > x1) x1 = tr.x[i];
    if (tr.y[i] < y0) y0 = tr.y[i]; if (tr.y[i] > y1) y1 = tr.y[i];
  }
  Object.assign(bounds, { x0, x1, y0, y1 });
  const roles = detectRoles(ctx.S, ctx.cfg);
  const NB = MINI_MAP_BINS;
  const items = list.map((c): ChannelMap => {
    const q = pctRange(c.data, a, b, 0.02);
    const lo = q.lo, hi = q.hi > q.lo ? q.hi : q.lo + 1;
    const bins = new Int8Array(c.data.length).fill(-1);
    let any = false;
    for (let i = a + 1; i <= b; i++) {
      if (!tr.valid[i] || !tr.valid[i - 1]) continue;
      const v = c.data[i];
      if (v !== v) continue;
      any = true;
      const k = clamp(Math.floor((v - lo) / (hi - lo) * NB), 0, NB - 1);
      bins[i] = k === k ? k : -1;            /* NaN só se a faixa não tiver amostra (o antigo quebrava aqui) */
    }
    const dec = decimalsFor(c.lo, c.hi);
    return {
      key: c.key, name: c.name, unit: c.unit, constant: c.constant, lo, hi, n: q.n, dec,
      rangeText: q.n ? `${lo.toFixed(Math.max(0, dec - 1))} … ${hi.toFixed(Math.max(0, dec - 1))} ${c.unit || ''}` : 'sem dados',
      bins, any, explain: 'track.channelMap', sensors: mergeSensors('gps', sensorsOfChannel(ctx, c, roles)),
    };
  });
  return { ok: true, i0, i1, bounds, nb: NB, items };
}
