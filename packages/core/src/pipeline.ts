/* Pipeline da sessão: configuração com os padrões + recompute() do app antigo
 * (legacy/js/app.js: setSession(), recompute(), buildDerived(), lapTimeArray()), o trecho
 * analisado (Analysis.range() de legacy/js/analysisui.js), o CSV processado (exportCSV()) e
 * os textos do diálogo de Pista e GPS (cfgInfo()).
 *
 * Ordem do recompute (a mesma do app antigo, os números não mudam):
 *   trajetória → voltas → parado → dinâmica pelo GPS → veículo (roda/GPS)
 *   → parado pela velocidade (sem GPS) → acelerações → suspensão → ângulos
 *   → canais susp:pitch/rollF/rollR/rough → derivados do GPS
 *   all = derivados do GPS + veículo + suspensão + log (+ fórmulas do usuário no fim). */
import type { AnalysisConfig, CarConfig, Channel, Formula, SensorId, Session, SuspConfig, TrackConfig } from './types';
import type { Lap, Track } from './gps';
import type { Dyn, Susp } from './analysis';
import type { Acc, Angles, Veh } from './vehicle';
import { DEFAULT_CFG, guessGpsChannels, computeTrack, computeLaps, autoLine, smooth, spanOf } from './gps';
import { DEFAULT_SUSP, stoppedMask, gpsDynamics, suspPrep, deltaToBest } from './analysis';
import { DEFAULT_CAR, vehPrep, bodyAngles, roughness } from './vehicle';
import { finishChannel } from './parsers';
import { idxAt, decimalsFor } from './util';
import { applyFormulas, type FormulaIssue } from './formulas';

/** Configuração como vem da interface/armazenamento: qualquer campo pode faltar (e as
 *  antigas ainda podem trazer curso/massa/MR dentro de susp). */
export type AnalysisConfigInput = Partial<TrackConfig> & {
  susp?: Partial<SuspConfig>;
  car?: Partial<CarConfig>;
  formulas?: Formula[];
  [k: string]: unknown;
};

/** Estado da sessão depois do recompute() (o objeto A do app antigo). */
export interface SessionContext {
  S: Session;
  cfg: AnalysisConfig;             /* já normalizada (padrões, migração, canais X/Y, linha automática) */
  track: Track;
  laps: Lap[];
  stopped: Uint8Array | null;      /* 1 = carro parado (GPS; sem GPS, pela velocidade da roda) */
  dyn: Dyn | null;                 /* acelerações pela trajetória do GPS (só com track.ok) */
  veh: Veh;
  acc: Acc;                        /* acelerações usadas nos gradientes e no g-g */
  susp: Susp;                      /* channels inclui susp:pitch/rollF/rollR/rough */
  ang: Angles;
  all: Channel[];                  /* derivados do GPS, veículo, suspensão, log, fórmulas */
  formulaErrors: FormulaIssue[];   /* fórmulas que não entraram (erro de sintaxe, canal inexistente) */
}

export type RangeMode = 'session' | 'lap' | 'view';

const GPS_GROUP = 'Calculados do GPS';
const SUSP_GROUP = 'Suspensão (calculado)';

/** Padrões + migração dos dados do carro (curso, massas e relação de movimento moravam em
 *  cfg.susp) + canais X/Y adivinhados quando os salvos não existem neste log. Igual ao
 *  começo de app.js e a setSession(). Não altera `partial` nem a sessão. */
export const normalizeConfig = (S: Session, partial: AnalysisConfigInput = {}): AnalysisConfig => {
  const cfgIn = partial || {};
  const cfg = Object.assign({}, DEFAULT_CFG, cfgIn) as AnalysisConfig;
  const susp = cfg.susp = Object.assign({}, DEFAULT_SUSP, cfgIn.susp || {}) as SuspConfig;
  const car = cfg.car = Object.assign({}, DEFAULT_CAR, cfgIn.car || {}) as CarConfig;
  (['strokeF', 'strokeR', 'massF', 'massR', 'mrF', 'mrR'] as const).forEach(k => {
    if (!(+car[k] > 0) && +(susp[k] as number) > 0) car[k] = +(susp[k] as number);
    delete susp[k];
  });
  const keys = S.channels.map(c => c.key);
  /* canais X/Y: mantém a escolha salva se existir neste log; senão adivinha */
  if (!S.gps && (!keys.includes(cfg.chX) || !keys.includes(cfg.chY))) {
    const g = guessGpsChannels(keys);
    cfg.chX = g.x; cfg.chY = g.y; cfg.chStatus = g.status;
  }
  if (cfg.chStatus && !keys.includes(cfg.chStatus)) cfg.chStatus = '';
  return cfg;
};

/* tempo desde o início da volta (NaN fora das voltas) */
function lapTimeArray(S: Session, laps: Lap[]): Float64Array {
  const t = S.t, out = new Float64Array(t.length).fill(NaN);
  laps.forEach(l => { for (let i = l.i0; i <= l.i1; i++) out[i] = t[i] - l.t0; });
  return out;
}

/* canais calculados do GPS (buildDerived do app antigo) */
function buildDerived(S: Session, tr: Track, laps: Lap[], dyn: Dyn | null, veh: Veh): Channel[] {
  const out: Channel[] = [];
  if (!tr || !tr.ok) return out;
  const mk = (key: string, name: string, unit: string, data: Float64Array) => out.push(finishChannel({ key, name, unit, data, src: 'gps' }));
  mk('gps:speed', 'GPS · Velocidade', 'km/h', tr.speed);
  mk('gps:lap', 'Tempo na volta', 's', lapTimeArray(S, laps));
  mk('gps:x', 'GPS · X Leste', 'm', tr.x);
  mk('gps:y', 'GPS · Y Norte', 'm', tr.y);
  mk('gps:dist', 'GPS · Distância', 'm', tr.dist);
  if (laps.length >= 2) mk('gps:delta', 'Delta p/ melhor volta', 's', deltaToBest(S, tr, laps));
  if (dyn) dyn.channels.forEach(c => { if (!(veh && veh.wheel && /gps:a(lon|lat)g?/.test(c.key))) out.push(c); });
  if (S.gps) {
    mk('gps:cx', 'Código X (calculado)', '', tr.codeX);
    mk('gps:cy', 'Código Y (calculado)', '', tr.codeY);
  }
  return out;
}

/* recompute() do app antigo, com a configuração já normalizada */
function recompute(S: Session, cfg: AnalysisConfig): SessionContext {
  const track = computeTrack(S, cfg);
  const laps = computeLaps(S, track, cfg.line || null, +cfg.minLap || 10);
  let stopped = stoppedMask(S, track);
  const dyn = track.ok ? gpsDynamics(S, track) : null;
  const veh = vehPrep(S, track, cfg.car, dyn);
  if (!stopped && veh.v) stopped = Uint8Array.from(smooth(S.t, veh.v, 1), x => (x === x && x < 0.8 ? 1 : 0));
  /* acelerações: longitudinal pela roda (se houver), lateral = v × taxa de guinada do GPS */
  const acc: Acc = {
    lon: veh.ax || (dyn && dyn.along), lat: (veh.wheel && veh.ay) || (dyn && dyn.alat),
    src: veh.wheel ? 'longitudinal pela velocidade da roda, lateral = velocidade da roda × guinada do GPS' : 'pela trajetória do GPS'
  };
  const susp = suspPrep(S, track, cfg.susp);
  const ang = bodyAngles(susp, cfg.car);
  const sc = (key: string, name: string, unit: string, data: Float64Array) => finishChannel({ key, name, unit, data, src: 'calc', group: SUSP_GROUP });
  if (ang.pitch) susp.channels.push(sc('susp:pitch', 'Arfagem (+ = frente baixa)', '°', ang.pitch));
  if (ang.rollF) susp.channels.push(sc('susp:rollF', 'Rolagem diant. (+ = esq. comprimida)', '°', ang.rollF));
  if (ang.rollR) susp.channels.push(sc('susp:rollR', 'Rolagem tras. (+ = esq. comprimida)', '°', ang.rollR));
  const rough = roughness(S.t, susp);
  if (rough) susp.channels.push(sc('susp:rough', 'Rugosidade (vel. amortecedores, RMS 1 s)', 'mm/s', rough));
  const derived = buildDerived(S, track, laps, dyn, veh);
  const all = derived.concat(veh.channels, susp.channels, S.channels);
  all.forEach(c => { c.group = c.group || (c.src === 'gps' ? GPS_GROUP : 'Do log'); });
  const ctx: SessionContext = { S, cfg, track, laps, stopped, dyn, veh, acc, susp, ang, all, formulaErrors: [] };
  /* fórmulas do usuário: no fim, em ordem (uma pode usar a anterior) */
  if (cfg.formulas && cfg.formulas.length) ctx.all = all.concat(applyFormulas(ctx, cfg.formulas, ctx.formulaErrors));
  return ctx;
}

/** Calcula tudo da sessão, como o app antigo ao abrir um log. Com autoLine e sem linha
 *  salva, põe a linha de largada automática (arredondada a 2 casas, como A.setLine) e
 *  recalcula — é o que o botão "Automática" e o exemplo fazem. */
export const computeSession = (S: Session, partial: AnalysisConfigInput = {}, opts: { autoLine?: boolean } = {}): SessionContext => {
  const cfg = normalizeConfig(S, partial);
  let ctx = recompute(S, cfg);
  if (opts.autoLine && !cfg.line) {
    const l = autoLine(S, ctx.track);
    if (l) {
      cfg.line = l.map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) }));
      ctx = recompute(S, cfg);
    }
  }
  return ctx;
};

/** Trecho analisado [i0, i1, rótulo] (Analysis.range() do app antigo). 'view' usa a
 *  janela [t0, t1] dos gráficos (padrão: a sessão inteira). */
export const rangeOf = (ctx: Pick<SessionContext, 'S' | 'laps'>, mode: RangeMode, selLap: number, view?: [number, number]): [number, number, string] => {
  const t = ctx.S.t, n = t.length;
  if (mode === 'lap' && selLap >= 0 && ctx.laps[selLap]) { const l = ctx.laps[selLap]; return [l.i0, l.i1, `volta ${l.n}`]; }
  if (mode === 'view') {
    const v = view ? { t0: view[0], t1: view[1] } : { t0: t[0], t1: t[n - 1] };
    return [idxAt(t, v.t0), idxAt(t, v.t1), `${v.t0.toFixed(1)}–${v.t1.toFixed(1)} s`];
  }
  return [0, n - 1, mode === 'lap' ? 'sessão inteira (nenhuma volta selecionada)' : 'sessão inteira'];
};

/** Canal pela chave (A.channel do app antigo). */
export const getChannel = (ctx: Pick<SessionContext, 'all'>, key: string): Channel | undefined => ctx.all.find(c => c.key === key);

/** Textos do diálogo de Pista e GPS (cfgInfo() de legacy/js/app.js), sem HTML: vão coberto e
 *  resolução por passo do código 0–255, de onde a posição está sendo lida e a nota da
 *  calibração das entradas 7/8 na FT. */
export interface TrackConfigInfo {
  span: { x: number; y: number };    /* m, vão coberto (spanOf) */
  stepX: number;                     /* cm por passo do código em X (vão ÷ 255) */
  stepY: number;
  resolution: { text: string; explain: string; sensors: SensorId[] };
  source: string;                    /* de onde vem a posição (ou o motivo de não ter trajetória) */
  calibration: { title: string; items: string[]; explain: string; sensors: SensorId[] };
}

/** Textos de cfgInfo() para a configuração (e a sessão aberta, se houver). Passe o ctx. */
export function trackConfigInfo(ctx: { S?: Session | null; cfg: TrackConfig; track?: Track | null }): TrackConfigInfo {
  const c = ctx.cfg, sp = spanOf(c), tr = ctx.track;
  const text = `Vão coberto: ${sp.x} × ${sp.y} m → resolução ${(sp.x / 255 * 100).toFixed(1)} cm (X) e ${(sp.y / 255 * 100).toFixed(1)} cm (Y) por passo.` +
    (c.centerFixed ? '' : ' Centro automático: o vão é o dobro do tamanho (o carro pode ligar na borda da pista).');
  let source: string;
  if (ctx.S && ctx.S.gps) source = 'Log do BUSMASTER: a posição vem direto da latitude/longitude do módulo GPS (0x028).';
  else if (tr && tr.fmt) source = `Lendo ${tr.source}.` + (c.fmt === 'auto' ? ' Formato detectado automaticamente.' : '');
  else source = tr && tr.msg ? tr.msg : '';
  const half = sp.x / 2;
  return {
    span: sp, stepX: sp.x / 255 * 100, stepY: sp.y / 255 * 100,
    resolution: { text, explain: 'track.gpsPosition', sensors: ['gps'] },
    source,
    calibration: {
      title: 'Calibração na FT (FT Manager, entrada linear 0–5 V) para as entradas 7 e 8:',
      items: [
        '0,00 V = 0 e 5,00 V = 5 → o log fica em volts e o app converte (código = V × 51). É o recomendado.',
        `Evite “1 V = 1”: o PIC trava o valor no ponto mínimo da calibração, então tudo abaixo de 1 V (código < 51, mais de ~${((128 - 51) * sp.x / 255).toFixed(0)} m a Oeste/Sul do centro) vira 1,000.`,
        `Metros direto (0 V = −${half} m, 5 V = +${half} m) não cabe nesses canais: a FT guarda com 3 casas em 16 bits (máx. ±32,767).`,
      ],
      explain: 'quality.gpsCalibration', sensors: ['gps'],
    },
  };
}

/** CSV processado (botão "Exportar CSV" do app antigo, exportCSV() de legacy/js/app.js):
 *  TIME + todos os canais de ctx.all na mesma ordem (os do log pela chave; os calculados por
 *  "nome_unidade" sem acento), lat/lon do GPS (se houver) e o número da volta. Casas: as de
 *  decimalsFor (no mínimo 2 nos calculados); célula vazia = sem dado. O texto é o mesmo que o
 *  antigo baixava; a página só salva. */
export function processedCsv(ctx: Pick<SessionContext, 'S' | 'track' | 'laps' | 'all'>): { fileName: string; text: string } {
  const S = ctx.S, tr = ctx.track;
  const head = (c: Channel) => c.src === 'log' ? c.key
    : (c.name + (c.unit ? '_' + c.unit : '')).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
  const cols: [string, ArrayLike<number>, number][] = [['TIME', S.t, 3]];
  ctx.all.forEach(c => cols.push([head(c), c.data, Math.max(decimalsFor(c.lo, c.hi), c.src === 'log' ? 0 : 2)]));
  if (tr && tr.ok) {
    if (tr.lat) cols.push(['GPS_lat', tr.lat, 7], ['GPS_lon', tr.lon!, 7]);
    const ln = new Float64Array(S.t.length).fill(NaN);
    ctx.laps.forEach(l => { for (let i = l.i0; i <= l.i1; i++) ln[i] = l.n; });
    cols.push(['Lap', ln, 0]);
  }
  let o = cols.map(c => c[0]).join(',') + '\n';
  for (let i = 0; i < S.t.length; i++) o += cols.map(c => { const v = c[1][i]; return v === v ? v.toFixed(c[2]) : ''; }).join(',') + '\n';
  return { fileName: S.name.replace(/\.(csv|txt|log)$/i, '') + '_processado.csv', text: o };
}
