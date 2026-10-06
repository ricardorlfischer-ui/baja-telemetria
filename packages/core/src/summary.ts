/* Resumo da sessão (docs/ARQUITETURA.md 3.6): os números de projeto de uma sessão inteira,
 * com chaves estáveis, para a biblioteca (lista de sessões), a página "Comparar sessões" e o
 * servidor (que guarda o resumo junto com SUMMARY_VERSION e recalcula quando a versão muda).
 *
 * As contas são as da ficha de projeto (reports/design.ts, = renderDesign do app antigo) no
 * trecho "sessão inteira": o resumo lê os números crus (facts) da ficha e não repete fórmula.
 * A única conta vinda de outra aba é a força trativa (renderPower: percentil 98 da aceleração
 * positiva × massa × g). Cada métrica tem o card de explicação (explain) e os sensores que de
 * fato entraram na conta nesta sessão (sensors). value = null quando não dá para calcular
 * (sensor ausente, teste não feito, dado do carro não informado).
 *
 * Trecho (range = [i0, i1]): sem trecho é a sessão inteira (o que o servidor e a biblioteca
 * guardam). Com trecho, as métricas marcadas scope 'range' seguem o trecho (a ficha é a do
 * trecho, como na página Ficha do carro) e as marcadas scope 'session' continuam sendo da
 * sessão inteira: duração, voltas, melhor volta, calibração do pneu (fator único da sessão),
 * frequência natural / ζ / rigidez / amortecimento (a ficha usa o 1º teste de queda da sessão
 * inteira) e os sensores presentes. better: direção que é melhor para o projeto, só quando é
 * óbvia ('up' = maior é melhor, 'down' = menor é melhor). digits: casas do texto.
 *
 * Mudou alguma conta, chave ou unidade? Aumente SUMMARY_VERSION.
 *
 * Tabela de chaves (unidade · casas do texto = digits · explain); escopo e direção melhor
 * nas listas SUMMARY_SESSION_SCOPE e SUMMARY_BETTER abaixo:
 *
 *   Sessão
 *   session.duration          s      1  design.duration         duração do log
 *   session.distance          m      0  track.distance          distância (GPS; sem GPS, integrando a roda)
 *   session.laps              —      0  laps.lapTimes           número de voltas (null sem GPS)
 *   session.bestLap           s      2  laps.lapTimes           melhor volta
 *   session.vmax              km/h   1  power.vmax              velocidade máxima (roda corrigida ou GPS)
 *   Suspensão
 *   susp.travel.FL|FR|RL|RR   mm     0  susp.travelUsed         curso usado por canto (máx − mín da posição)
 *   susp.travel.F|R           mm     0  susp.travelUsed         curso usado por eixo (maior dos dois lados)
 *   susp.travelPct.F|R        %      0  susp.travelUsed         % do curso total (precisa do curso em Carro)
 *   susp.strokeSuggested.F|R  mm     0  susp.travelUsed         curso mínimo sugerido (+15 %, múltiplo de 5)
 *   susp.velComp95.F|R        mm/s   0  susp.shockVelocity      velocidade do amortecedor p95 em compressão
 *   susp.velExt95.F|R         mm/s   0  susp.shockVelocity      velocidade do amortecedor p95 em extensão
 *   susp.velCompMax.F|R       mm/s   0  susp.shockVelocity      velocidade máxima de compressão
 *   susp.bottomOuts.F|R       —      0  susp.bottomOut          batidas no fim de curso (precisa do curso)
 *   susp.jumps                —      0  susp.jumps              número de saltos
 *   susp.jumpAirMax           ms     0  susp.jumps              maior tempo no ar
 *   susp.jumpHeightMax        cm     0  susp.jumps              altura do maior salto (g·T²/8)
 *   susp.landingSpeed         m/s    1  susp.jumps              velocidade vertical de pouso do maior salto
 *   susp.jumpShockVel         mm/s   0  susp.jumps              maior velocidade do amortecedor nos pousos
 *   susp.fn.F|R               Hz     2  susp.naturalFreq        frequência natural (teste de queda)
 *   susp.zeta.F|R             —      2  susp.naturalFreq        fração do amortecimento crítico
 *   susp.k.F|R                N/mm   1  susp.rideRates          rigidez equivalente na roda
 *   susp.c.F|R                N·s/m  0  susp.rideRates          amortecimento equivalente na roda
 *   susp.rollGradient         °/g    2  susp.rollGradient       gradiente de rolagem
 *   susp.pitchBrake           °/g    2  susp.pitchGradient      gradiente de arfagem em frenagem (módulo)
 *   susp.pitchAccel           °/g    2  susp.pitchGradient      gradiente de arfagem em aceleração (módulo)
 *   susp.roughMedian          mm/s   0  channel.roughness       rugosidade mediana (carro andando)
 *   susp.roughP95             mm/s   0  channel.roughness       rugosidade p95
 *   susp.wavelength           m      1  freq.roadWavelength     ondulação dominante (texto: as até 3 maiores)
 *   Trem de força
 *   power.tireFactor          —      4  power.tireCalibration   fator da circunferência (roda × GPS)
 *   power.tireError           %      1  power.tireCalibration   quanto a roda marca a mais que o GPS
 *   power.vmax                km/h   1  power.vmax              velocidade máxima
 *   power.pmax                kW     2  power.wheelPower        potência máxima na roda
 *   power.pmaxSpeed           km/h   0  power.wheelPower        velocidade da potência máxima
 *   power.traction            N      0  power.tractionForce     força trativa máx. (percentil 98 da aceleração)
 *   power.launches            —      0  power.launch            largadas do carro parado
 *   power.launch30            s      2  power.launch            melhor 0–30 m
 *   power.launch20kmh         s      2  power.launch            0–20 km/h da mesma largada
 *   power.launchSlip          %      0  power.launch            escorregamento médio nos 10 m
 *   power.brakeMax            g      2  dyn.gg                  frenagem máxima
 *   power.latMax              g      2  dyn.gg                  aceleração lateral máxima (null sem GPS)
 *   power.crr                 —      3  power.coastDown         coeficiente de resistência ao rolamento
 *   power.cda                 m²     2  power.coastDown         área de arrasto (null se o ajuste deu ≤ 0)
 *   CVT
 *   cvt.tmax                  °C     1  cvt.maxTemp             temperatura máxima medida
 *   cvt.steady                °C     0  cvt.thermalModel        regime previsto no enduro
 *   cvt.endTemp               °C     0  cvt.thermalModel        temperatura no fim do enduro (car.endurance)
 *   cvt.tau                   min    1  cvt.timeConstant        constante de tempo andando
 *   cvt.timeToLimit           min    0  cvt.thermalModel        minutos até o limite (null + texto se não chega)
 *   cvt.coolingExtra          %      0  cvt.thermalModel        troca de calor a mais necessária (0 = não precisa)
 *   cvt.margin                °C     0  cvt.thermalModel        limite − regime previsto
 *   Qualidade
 *   quality.gpsValid          %      0  quality.validSamples    amostras com posição GPS válida
 *   quality.sensors           —      0  design.sensorCoverage   sensores presentes (texto: os nomes curtos) */
import type { SensorId } from './types';
import type { SessionContext } from './pipeline';
import { quant } from './analysis';
import { SENSORS, SENSOR_IDS, sensorAvailability } from './sensors';
import { designReport, type DesignReport } from './reports/design';

/** Versão das contas do resumo (o servidor recalcula resumos com versão antiga).
 *  2: power.latMax = null sem aceleração lateral (antes 0); sensores das largadas (distância
 *     do GPS com roda de tração), dos saltos (estático medido parado) e do fim de curso.
 *  3: cada métrica ganhou scope, digits e (quando óbvio) better; valores iguais aos da 2. */
export const SUMMARY_VERSION = 3;

export type SummaryGroup = 'Sessão' | 'Suspensão' | 'Trem de força' | 'CVT' | 'Qualidade';

export interface SummaryMetric {
  key: string;                   /* chave estável (tabela no topo deste arquivo) */
  group: SummaryGroup;
  label: string;
  value: number | null;          /* null = não deu para calcular nesta sessão */
  unit: string;
  text?: string;                 /* valor formatado como na ficha (toFixed) */
  explain: string;               /* id do card de explicação */
  sensors: SensorId[];           /* sensores que entraram na conta nesta sessão */
  /** 'range' = segue o trecho pedido (sem trecho, a sessão inteira); 'session' = sempre da
   *  sessão inteira (duração, voltas, melhor volta, fator do pneu, teste de queda, sensores). */
  scope: SummaryScope;
  /** Direção melhor para o projeto quando é óbvia ('up' = maior é melhor); sem = não óbvio. */
  better?: 'up' | 'down';
  /** Casas decimais para exibir (as do text; a diferença entre sessões usa as mesmas). */
  digits: number;
}

export type SummaryScope = 'session' | 'range';

export interface SessionSummary {
  version: number;
  metrics: SummaryMetric[];
  /** Só com trecho: índices e tempos (s) do trecho usado nas métricas scope 'range'. */
  range?: { i0: number; i1: number; t0: number; t1: number };
}

/** Métricas que são sempre da sessão inteira, mesmo com trecho. */
export const SUMMARY_SESSION_SCOPE: readonly string[] = [
  'session.duration', 'session.laps', 'session.bestLap',
  'susp.fn.F', 'susp.fn.R', 'susp.zeta.F', 'susp.zeta.R', 'susp.k.F', 'susp.k.R', 'susp.c.F', 'susp.c.R',
  'power.tireFactor', 'power.tireError', 'quality.sensors',
];

/** Direção melhor para o projeto (só as óbvias). */
export const SUMMARY_BETTER: Readonly<Record<string, 'up' | 'down'>> = {
  'session.bestLap': 'down', 'session.vmax': 'up', 'power.vmax': 'up',
  'power.pmax': 'up', 'power.traction': 'up',
  'power.launch30': 'down', 'power.launch20kmh': 'down', 'power.launchSlip': 'down',
  'power.crr': 'down', 'power.cda': 'down',
  'susp.bottomOuts.F': 'down', 'susp.bottomOuts.R': 'down',
  'cvt.tmax': 'down', 'cvt.steady': 'down', 'cvt.endTemp': 'down', 'cvt.coolingExtra': 'down',
  'cvt.margin': 'up', 'cvt.timeToLimit': 'up',
  'quality.gpsValid': 'up', 'quality.sensors': 'up',
};

const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && v === v && isFinite(v);

/* sensores sem repetição, na ordem do catálogo */
const sens = (...lists: (SensorId | SensorId[] | null | undefined | false)[]): SensorId[] => {
  const set = new Set<SensorId>();
  for (const l of lists) { if (!l) continue; (Array.isArray(l) ? l : [l]).forEach(x => set.add(x)); }
  return SENSOR_IDS.filter(id => set.has(id));
};

/** Resumo da sessão. Sem `range`: a sessão inteira (o que o servidor guarda). Com
 *  `range` = [i0, i1]: as métricas scope 'range' seguem o trecho e as scope 'session' ficam
 *  da sessão inteira. Reaproveita a ficha de projeto do trecho (passe uma já calculada em
 *  `design` — do MESMO trecho — para não recalcular). */
export function sessionSummary(ctx: SessionContext, design?: DesignReport, range?: [number, number]): SessionSummary {
  const { S, track, laps, veh } = ctx, t = S.t, n = t.length, car = ctx.cfg.car;
  let i0 = 0, i1 = n - 1;
  if (range) {
    i0 = Math.max(0, Math.min(n - 1, Math.floor(+range[0]) || 0));
    i1 = Math.max(i0, Math.min(n - 1, Math.floor(+range[1]) || 0));
  }
  const r = design || designReport(ctx, i0, i1), f = r.facts;
  const metrics: SummaryMetric[] = [];
  /* sensores de uma linha da ficha (a ficha já decide o que entrou em cada conta) */
  const rowS = (item: string): SensorId[] => r.rows.find(x => x.item === item)?.sensors ?? [];
  const m = (group: SummaryGroup, key: string, label: string, value: number | null | undefined, unit: string, digits: number,
    explain: string, sensors: SensorId[], text?: string) => {
    const v = ok(value) ? value : null, better = SUMMARY_BETTER[key];
    metrics.push({ key, group, label, value: v, unit, ...(text !== undefined ? { text } : v !== null ? { text: v.toFixed(digits) } : {}), explain, sensors: v !== null || text !== undefined ? sensors : [],
      scope: SUMMARY_SESSION_SCOPE.includes(key) ? 'session' : 'range', ...(better ? { better } : {}), digits });
  };
  const velS: SensorId[] = veh.src === 'roda' ? (veh.kN ? ['gps', 'wheel'] : ['wheel']) : veh.src === 'GPS' ? ['gps'] : [];

  /* ---------- sessão ---------- */
  m('Sessão', 'session.duration', 'Duração', n ? t[n - 1] - t[0] : null, 's', 1, 'design.duration', ['logger']);
  let dist: number | null = null, distS: SensorId[] = [];
  if (track.ok) {
    let mx = -Infinity, mn = Infinity;
    for (let i = i0; i <= i1; i++) { if (track.dist[i] > mx) mx = track.dist[i]; if (track.dist[i] < mn) mn = track.dist[i]; }
    /* sessão inteira: o máximo da distância acumulada (como sempre); trecho: máx − mín nele */
    dist = range ? mx - mn : mx; distS = ['gps'];
  } else if (veh.dist) { dist = range ? veh.dist[i1] - veh.dist[i0] : veh.dist[n - 1]; distS = velS; }
  m('Sessão', 'session.distance', 'Distância', dist, 'm', 0, 'track.distance', distS);
  m('Sessão', 'session.laps', 'Voltas', track.ok ? laps.length : null, '', 0, 'laps.lapTimes', ['gps']);
  let best: number | null = null;
  laps.forEach(l => { if (best === null || l.time < best) best = l.time; });
  m('Sessão', 'session.bestLap', 'Melhor volta', best, 's', 2, 'laps.lapTimes', ['gps']);
  m('Sessão', 'session.vmax', 'Velocidade máxima', f.vmax, 'km/h', 1, 'power.vmax', rowS('Velocidade máxima'));

  /* ---------- suspensão ---------- */
  const SU = 'Suspensão';
  (['FL', 'FR', 'RL', 'RR'] as const).forEach(id =>
    m(SU, `susp.travel.${id}`, `Curso usado ${id}`, f.cornerTravel[id], 'mm', 0, 'susp.travelUsed', ['shock_' + id.toLowerCase() as SensorId]));
  (['F', 'R'] as const).forEach(ax => {
    const a = f.axle[ax], nm = ax === 'F' ? 'diant.' : 'tras.';
    const tS = rowS(`Curso usado ${nm}`), vS = rowS(`Velocidade do amortecedor ${nm}`);
    m(SU, `susp.travel.${ax}`, `Curso usado ${nm}`, a?.used, 'mm', 0, 'susp.travelUsed', tS);
    m(SU, `susp.travelPct.${ax}`, `% do curso usado ${nm}`, a?.pct, '%', 0, 'susp.travelUsed', tS);
    m(SU, `susp.strokeSuggested.${ax}`, `Curso mínimo sugerido ${nm}`, a?.suggested, 'mm', 0, 'susp.travelUsed', tS);
    m(SU, `susp.velComp95.${ax}`, `Vel. amortecedor p95 compressão ${nm}`, a?.p95C, 'mm/s', 0, 'susp.shockVelocity', vS);
    m(SU, `susp.velExt95.${ax}`, `Vel. amortecedor p95 extensão ${nm}`, a?.p95R, 'mm/s', 0, 'susp.shockVelocity', vS);
    m(SU, `susp.velCompMax.${ax}`, `Vel. máx. de compressão ${nm}`, a?.vmaxC, 'mm/s', 0, 'susp.shockVelocity', vS);
    m(SU, `susp.bottomOuts.${ax}`, `Batidas no fim de curso ${nm}`, a?.bottomOuts, '', 0, 'susp.bottomOut', a ? a.bottomSensors : []);
  });
  /* saltos: amortecedores (o limiar de "no ar" é relativo ao estático, medido parado pelo GPS
   * se deu) + velocidade do carro */
  const J = f.jumps, jS = sens(f.shocks.map(id => 'shock_' + id.toLowerCase() as SensorId), velS,
    ctx.susp.shocks.some(k => k.active && k.staticFromStop) && 'gps');
  m(SU, 'susp.jumps', 'Saltos', J?.n, '', 0, 'susp.jumps', jS);
  m(SU, 'susp.jumpAirMax', 'Maior tempo no ar', J && J.T * 1000, 'ms', 0, 'susp.jumps', jS);
  m(SU, 'susp.jumpHeightMax', 'Altura do maior salto', J && J.h * 100, 'cm', 0, 'susp.jumps', jS);
  m(SU, 'susp.landingSpeed', 'Velocidade de pouso', J?.vland, 'm/s', 1, 'susp.jumps', jS);
  m(SU, 'susp.jumpShockVel', 'Vel. do amortecedor no pouso', J?.vShock, 'mm/s', 0, 'susp.jumps', jS);
  const fnS = rowS('Frequência natural diant. / tras.');
  const dropAx = (ax: 'F' | 'R') => (f.drop ? f.drop[ax] : null);
  (['F', 'R'] as const).forEach(ax => {
    const nm = ax === 'F' ? 'diant.' : 'tras.', d = dropAx(ax);
    const dS = sens(fnS.filter(s => !s.startsWith('shock_')), d ? d.ids.map(id => 'shock_' + id.toLowerCase() as SensorId) : []);
    m(SU, `susp.fn.${ax}`, `Frequência natural ${nm}`, d?.fn, 'Hz', 2, 'susp.naturalFreq', dS);
    m(SU, `susp.zeta.${ax}`, `Amortecimento ζ ${nm}`, d?.zeta, '', 2, 'susp.naturalFreq', dS);
    const rr = f.rates[ax];
    m(SU, `susp.k.${ax}`, `Rigidez na roda ${nm}`, rr && rr.k / 1000, 'N/mm', 1, 'susp.rideRates', sens(dS, 'car_data'));
    m(SU, `susp.c.${ax}`, `Amortecimento na roda ${nm}`, rr?.c, 'N·s/m', 0, 'susp.rideRates', sens(dS, 'car_data'));
  });
  m(SU, 'susp.rollGradient', 'Gradiente de rolagem', f.rollGrad, '°/g', 2, 'susp.rollGradient', rowS('Gradiente de rolagem'));
  const pS = rowS('Gradiente de arfagem frenagem / aceleração');
  m(SU, 'susp.pitchBrake', 'Gradiente de arfagem na frenagem', f.pitchBrake, '°/g', 2, 'susp.pitchGradient', pS);
  m(SU, 'susp.pitchAccel', 'Gradiente de arfagem na aceleração', f.pitchAccel, '°/g', 2, 'susp.pitchGradient', pS);
  const rS = rowS('Rugosidade (vel. amortecedores RMS)');
  m(SU, 'susp.roughMedian', 'Rugosidade mediana', f.roughMed, 'mm/s', 0, 'channel.roughness', rS);
  m(SU, 'susp.roughP95', 'Rugosidade p95', f.roughP95, 'mm/s', 0, 'channel.roughness', rS);
  const wl = f.wavelengths;
  m(SU, 'susp.wavelength', 'Ondulação dominante da pista', wl && wl.length ? wl[0] : null, 'm', 1, 'freq.roadWavelength', rowS('Ondulações dominantes'),
    wl && wl.length ? wl.map(l => l.toFixed(1) + ' m').join(' · ') : undefined);

  /* ---------- trem de força ---------- */
  const PT = 'Trem de força';
  const cS = rowS('Calibração da velocidade da roda');
  m(PT, 'power.tireFactor', 'Fator do pneu (roda × GPS)', f.tireK, '', 4, 'power.tireCalibration', cS);
  m(PT, 'power.tireError', 'A roda marca a mais', f.tireErr, '%', 1, 'power.tireCalibration', cS);
  m(PT, 'power.vmax', 'Velocidade máxima', f.vmax, 'km/h', 1, 'power.vmax', rowS('Velocidade máxima'));
  const wS = rowS('Potência máxima na roda');
  m(PT, 'power.pmax', 'Potência máxima na roda', f.pmax, 'kW', 2, 'power.wheelPower', wS);
  m(PT, 'power.pmaxSpeed', 'Velocidade da potência máxima', f.pmaxSpeed, 'km/h', 0, 'power.wheelPower', wS);
  /* força trativa (renderPower do app antigo): um percentil alto da aceleração evita picos do sensor */
  let Ftr: number | null = null;
  if (veh.v && veh.ax) {
    const accs: number[] = [];
    for (let i = i0; i <= i1; i++) if (veh.ax[i] > 0.05) accs.push(veh.ax[i]);
    accs.sort((a, b) => a - b);
    const aTr = quant(accs, 0.98);
    Ftr = (+car.mass) * aTr * 9.81;
  }
  m(PT, 'power.traction', 'Força trativa máx.', Ftr, 'N', 0, 'power.tractionForce', sens(velS, 'car_data'));
  const lS = rowS('Melhor largada');
  /* a largada só conta quando chega a 10 m: a distância é a do GPS com roda de tração e GPS ok
   * (como na ficha), senão a integral da velocidade */
  m(PT, 'power.launches', 'Largadas', f.launches, '', 0, 'power.launch', sens(velS, car.wheelDriven && track.ok && 'gps'));
  m(PT, 'power.launch30', 'Melhor 0–30 m', f.launch30, 's', 2, 'power.launch', lS);
  m(PT, 'power.launch20kmh', '0–20 km/h (melhor largada)', f.launch20kmh, 's', 2, 'power.launch', lS);
  m(PT, 'power.launchSlip', 'Escorregamento na largada (10 m)', f.launchSlip !== null ? f.launchSlip * 100 : null, '%', 0, 'power.launch', sens('wheel', 'gps'));
  /* lateral: roda × guinada do GPS quando há roda, senão a trajetória do GPS (A.acc.lat). Sem
   * aceleração lateral nenhuma (sem GPS) a ficha antiga escreve "0.00 g"; aqui é null (não medido) */
  const latS: SensorId[] = veh.wheel && veh.ay ? ['gps', 'wheel'] : ctx.acc.lat ? ['gps'] : [];
  m(PT, 'power.brakeMax', 'Frenagem máx.', f.brakeMax, 'g', 2, 'dyn.gg', sens(velS));
  m(PT, 'power.latMax', 'Aceleração lateral máx.', ctx.acc.lat ? f.latMax : null, 'g', 2, 'dyn.gg', latS);
  const kS = rowS('Resistência ao rolamento e arrasto');
  m(PT, 'power.crr', 'Crr (resistência ao rolamento)', f.coast?.crr, '', 3, 'power.coastDown', kS);
  m(PT, 'power.cda', 'CdA (área de arrasto)', f.coast && f.coast.cda > 0 ? f.coast.cda : null, 'm²', 2, 'power.coastDown', kS);

  /* ---------- CVT ---------- */
  const cv = f.cvt, fit = cv && cv.fit, mS = rowS('Regime previsto no enduro');
  m('CVT', 'cvt.tmax', 'Temperatura máx. da CVT', cv?.tmax, '°C', 1, 'cvt.maxTemp', ['cvt_temp']);
  m('CVT', 'cvt.steady', 'Regime previsto no enduro', fit?.Tss, '°C', 0, 'cvt.thermalModel', mS);
  m('CVT', 'cvt.endTemp', `Temperatura após ${car.endurance} min`, fit?.Tend, '°C', 0, 'cvt.thermalModel', mS);
  m('CVT', 'cvt.tau', 'Constante de tempo (andando)', fit && fit.tauMove / 60, 'min', 1, 'cvt.timeConstant', mS);
  m('CVT', 'cvt.timeToLimit', 'Minutos até o limite', fit?.tReach, 'min', 0, 'cvt.thermalModel', mS,
    fit && !ok(fit.tReach) ? 'não chega ao limite' : undefined);
  m('CVT', 'cvt.coolingExtra', 'Troca de calor a mais necessária', fit ? (fit.coolNeed > 1 ? (fit.coolNeed - 1) * 100 : 0) : null, '%', 0, 'cvt.thermalModel', mS);
  m('CVT', 'cvt.margin', 'Margem até o limite', fit ? fit.Tlim - fit.Tss : null, '°C', 0, 'cvt.thermalModel', mS);

  /* ---------- qualidade ---------- */
  let gpsValid: number | null = null;
  if (track.ok) {
    let c = 0;
    for (let i = i0; i <= i1; i++) if (track.valid[i]) c++;
    gpsValid = n ? c / (i1 - i0 + 1) * 100 : null;
  } else if (S.gps || ctx.cfg.chX) gpsValid = 0;
  m('Qualidade', 'quality.gpsValid', 'GPS válido', gpsValid, '%', 0, 'quality.validSamples', ['gps']);
  const av = sensorAvailability(ctx), present = SENSOR_IDS.filter(id => av[id] === 'present');
  m('Qualidade', 'quality.sensors', 'Sensores presentes', present.length, '', 0, 'design.sensorCoverage', present,
    present.map(id => SENSORS[id].short).join(', '));

  return { version: SUMMARY_VERSION, metrics, ...(range && n ? { range: { i0, i1, t0: t[i0], t1: t[i1] } } : {}) };
}

/** Métrica pela chave (ou undefined). */
export const summaryMetric = (s: SessionSummary, key: string): SummaryMetric | undefined => s.metrics.find(x => x.key === key);
