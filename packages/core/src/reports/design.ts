/* Ficha de projeto do carro (porte de renderDesign em legacy/js/vehicleui.js): uma tabela
 * com os números que dimensionam o carro do ano que vem (frequência natural, curso usado,
 * gradientes, saltos, rugosidade, ondulações, calibração do pneu, potência, largada,
 * resistências, CVT) e os pontos de atenção (recomendações).
 *
 * As linhas (grp, item, val, how, read) e os textos das recomendações são IDÊNTICOS aos do
 * app antigo (an.designRows / an.designRec). Acrescentado: em cada linha e recomendação o id
 * do card de explicação (explain) e os sensores que de fato entraram na conta nesta sessão
 * (sensors), e os números crus (facts) que o resumo da sessão (summary.ts) reaproveita, para
 * a conta existir num lugar só.
 *
 * Ids de explicação usados aqui (catálogo em explain.ts):
 *   susp.shocksActive    quais amortecedores têm sinal (e quais faltam)
 *   susp.naturalFreq     fₙ e ζ do teste de queda; recomendações de flat ride e de ζ
 *   susp.rideRates       rigidez e amortecimento equivalentes na roda (e no amortecedor)
 *   susp.travelUsed      curso usado por eixo, curso sugerido; recomendação de curso sobrando
 *   susp.bottomOut       batidas no fim de curso (recomendação)
 *   susp.shockVelocity   velocidade do amortecedor p95 compressão/extensão (faixa das válvulas)
 *   susp.rollGradient    gradiente de rolagem °/g
 *   susp.pitchGradient   gradiente de arfagem em frenagem / aceleração °/g
 *   susp.jumps           saltos: tempo no ar, altura, velocidade de pouso e do amortecedor
 *   channel.roughness    rugosidade da pista (RMS da velocidade dos amortecedores)
 *   freq.roadWavelength  ondulações dominantes da pista e velocidades que excitam a dianteira
 *   power.tireCalibration fator do pneu (roda × GPS) e recomendação de circunferência
 *   power.vmax           velocidade máxima (roda corrigida ou GPS)
 *   power.wheelPower     potência máxima na roda e a que velocidade
 *   power.launch         melhor largada 0–30 m / 0–20 km/h e escorregamento na largada
 *   power.coastDown      Crr e CdA pelo coast-down
 *   dyn.gg               frenagem máx. e lateral máx. (g)
 *   cvt.maxTemp          temperatura máxima medida da CVT
 *   cvt.thermalModel     modelo térmico: regime previsto no enduro e recomendação de troca de calor
 *   cvt.timeConstant     constante de tempo térmica da CVT andando
 *   sensor.wheel         linha "sem canal" da roda (o card do sensor diz o que ele destrava)
 *   sensor.cvt_temp      linha "sem canal" da CVT */
import type { CarConfig, Channel, SensorId } from '../types';
import type { SessionContext } from '../pipeline';
import { getChannel } from '../pipeline';
import { CORNERS, dropTests, velStats, quant, localPeaks, rideRates } from '../analysis';
import type { ActiveShock, CornerId, DecayOk, DropTest } from '../analysis';
import { bottomOuts, gradients, jumps, powerCurve, launches, findCoasts, coastFit, cvtFit, roadSpectrum } from '../vehicle';
import { SENSOR_IDS, SENSORS } from '../sensors';

/* ---------------------------------------------------------------- tipos */

/** Linha da ficha: grupo, grandeza, valor, como foi medido, leitura para o projeto (textos
 *  iguais aos do app antigo) + card de explicação e sensores usados. */
export interface DesignRow {
  grp: string;
  item: string;
  val: string;
  how: string;
  read: string;
  explain: string;
  sensors: SensorId[];
}

/** Ponto de atenção para o projeto (texto igual ao do app antigo). */
export interface DesignRec {
  text: string;
  explain: string;
  sensors: SensorId[];
}

/** Números de um eixo (curso, velocidade do amortecedor, fim de curso). */
export interface DesignAxleFacts {
  used: number;                  /* mm, curso usado (maior dos dois lados) */
  stroke: number;                /* mm, curso total informado (0 = não informado) */
  pct: number | null;            /* % do curso total (null sem curso) */
  suggested: number;             /* mm, curso mínimo sugerido (+15 %, múltiplo de 5) */
  bottomOuts: number | null;     /* batidas no fim de curso (null sem curso) */
  p95C: number;                  /* mm/s, média dos p95 de compressão (NaN sem dados) */
  p95R: number;                  /* mm/s, média dos p95 de extensão */
  vmaxC: number;                 /* mm/s, máx. compressão */
  sensors: SensorId[];           /* do curso usado */
  bottomSensors: SensorId[];     /* das batidas no fim de curso ([] sem curso) */
}

/** Números crus da ficha (NaN/null = não deu para calcular). Reaproveitados pelo resumo. */
export interface DesignFacts {
  shocks: CornerId[];                                  /* amortecedores com sinal */
  cornerTravel: Partial<Record<CornerId, number>>;     /* mm, curso usado por canto */
  drop: { t: number; F: { fn: number; zeta: number; n: number; ids: CornerId[] }; R: { fn: number; zeta: number; n: number; ids: CornerId[] } } | null;
  rates: { F: { k: number; c: number; cShock: number } | null; R: { k: number; c: number; cShock: number } | null };
  axle: Partial<Record<'F' | 'R', DesignAxleFacts>>;
  rollGrad: number | null;       /* °/g */
  rollR2: number | null;
  pitchBrake: number | null;     /* °/g (módulo) */
  pitchAccel: number | null;
  jumps: { n: number; T: number; h: number; vland: number; vShock: number } | null;   /* T s, h m, vland m/s, vShock mm/s */
  roughMed: number | null;       /* mm/s */
  roughP95: number | null;
  wavelengths: number[] | null;  /* m, ondulações dominantes (até 3) */
  tireK: number | null;          /* fator roda → GPS (null sem calibração) */
  tireErr: number | null;        /* %, quanto a roda marca a mais */
  vmax: number | null;           /* km/h */
  pmax: number | null;           /* kW na roda */
  pmaxSpeed: number | null;      /* km/h */
  launches: number | null;       /* nº de largadas no trecho (null sem velocidade) */
  launch30: number | null;       /* s, melhor 0–30 m */
  launch20kmh: number | null;    /* s, 0–20 km/h da mesma largada */
  launchSlip: number | null;     /* fração, escorregamento médio nos 10 m */
  brakeMax: number | null;       /* g */
  latMax: number | null;         /* g */
  coast: { crr: number; cda: number; r2: number; t0: number; t1: number } | null;
  cvt: { tmax: number; fit: { Tss: number; Tend: number; tauMove: number; tReach: number; coolNeed: number; Tlim: number; r2: number } | null } | null;
}

export interface DesignReport {
  rows: DesignRow[];
  recs: DesignRec[];
  groups: string[];              /* grupos na ordem em que aparecem */
  facts: DesignFacts;
}

/* ---------------------------------------------------------------- auxiliares (iguais ao vehicleui.js) */
const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && v === v && isFinite(v);
const fx = (v: number | null | undefined, d = 1) => (ok(v) ? v.toFixed(d) : '—');
const movingMask = (ctx: Pick<SessionContext, 'stopped'>) => (ctx.stopped ? Uint8Array.from(ctx.stopped, x => 1 - x) : null);
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

/* resultado do teste de queda por eixo (média dos dois lados) */
function axleDrop(ev: DropTest | null | undefined, axle: 'F' | 'R') {
  const ids: CornerId[] = axle === 'F' ? ['FL', 'FR'] : ['RL', 'RR'];
  const r = ev ? ev.res.filter((x): x is DecayOk & { id: CornerId } => ids.includes(x.id) && x.ok && !x.over) : [];
  return { fn: mean(r.map(x => x.fn)), zeta: mean(r.map(x => x.zeta)), n: r.length, ids: r.map(x => x.id) };
}

/* sensores sem repetição, na ordem do catálogo */
const sens = (...lists: (SensorId | SensorId[] | null | undefined | false)[]): SensorId[] => {
  const set = new Set<SensorId>();
  for (const l of lists) { if (!l) continue; (Array.isArray(l) ? l : [l]).forEach(x => set.add(x)); }
  return SENSOR_IDS.filter(id => set.has(id));
};
const WG: SensorId[] = ['wheel', 'gps'];
const shockSensor = (id: CornerId): SensorId => ('shock_' + id.toLowerCase()) as SensorId;

/** Sensores por trás de cada sinal intermediário da sessão (para marcar as contas). */
function signalSensors(ctx: SessionContext) {
  const { track, veh, acc, dyn, stopped } = ctx;
  /* velocidade do carro: roda (corrigida pelo GPS quando houve calibração) ou GPS */
  const vel: SensorId[] = veh.src === 'roda' ? (veh.kN ? ['wheel', 'gps'] : ['wheel']) : veh.src === 'GPS' ? ['gps'] : [];
  /* parado/andando: GPS (andou < 3 m em 3 s) ou, sem GPS, a velocidade da roda */
  const stop: SensorId[] = stopped ? (track.ok ? ['gps'] : vel) : [];
  /* acelerações dos gradientes e do g-g (mesma escolha de A.acc) */
  const lon: SensorId[] = veh.ax ? vel : acc.lon && dyn ? ['gps'] : [];
  const lat: SensorId[] = veh.wheel && veh.ay ? ['wheel', 'gps'] : acc.lat ? ['gps'] : [];
  return { vel, stop, lon, lat };
}

/* ---------------------------------------------------------------- relatório */

/** Ficha de projeto no trecho [i0, i1] (renderDesign do app antigo). */
export function designReport(ctx: SessionContext, i0: number, i1: number): DesignReport {
  const A = ctx, car: CarConfig = A.cfg.car, t = A.S.t, n = t.length;
  const rows: DesignRow[] = [], recs: DesignRec[] = [];
  const row = (grp: string, item: string, val: string, how: string | undefined, read: string | undefined, explain: string, sensors: SensorId[]) =>
    rows.push({ grp, item, val, how: how || '', read: read || '', explain, sensors });
  const rec = (text: string, explain: string, sensors: SensorId[]) => recs.push({ text, explain, sensors });
  const act = A.susp ? A.susp.shocks.filter((k): k is ActiveShock => k.active) : [];
  const mv = movingMask(A);
  const veh = A.veh;
  const sg = signalSensors(ctx);
  const actS = act.map(k => shockSensor(k.id));
  const facts: DesignFacts = {
    shocks: act.map(k => k.id), cornerTravel: {}, drop: null, rates: { F: null, R: null }, axle: {},
    rollGrad: null, rollR2: null, pitchBrake: null, pitchAccel: null, jumps: null, roughMed: null, roughP95: null, wavelengths: null,
    tireK: null, tireErr: null, vmax: null, pmax: null, pmaxSpeed: null, launches: null, launch30: null, launch20kmh: null, launchSlip: null,
    brakeMax: null, latMax: null, coast: null, cvt: null,
  };

  /* ---------- suspensão ---------- */
  const ev = act.length ? dropTests(t, A.susp.shocks, A.stopped, 0, n - 1)[0] : null;
  const F = axleDrop(ev, 'F'), R = axleDrop(ev, 'R');
  const dropS = (x: { ids: CornerId[] }) => sens(x.ids.map(shockSensor), sg.stop);
  if (act.length) {
    row('Suspensão', 'Amortecedores com sinal', act.map(k => k.id).join(', ') + (act.length < 4 ? ` (faltam ${CORNERS.filter(c => !act.some(k => k.id === c.id)).map(c => c.id).join(', ')})` : ''), 'canais Shock do log', '',
      'susp.shocksActive', sens(actS));
    if (ev) {
      facts.drop = { t: ev.t, F, R };
      const dS = sens(dropS(F), dropS(R));
      row('Suspensão', 'Frequência natural diant. / tras.', `${fx(F.fn, 2)} / ${fx(R.fn, 2)} Hz`, `teste de queda em t = ${ev.t.toFixed(1)} s`,
        ok(F.fn) && ok(R.fn) ? `tras./diant. = ${(R.fn / F.fn).toFixed(2)}` : '', 'susp.naturalFreq', dS);
      row('Suspensão', 'Amortecimento ζ diant. / tras.', `${fx(F.zeta, 2)} / ${fx(R.zeta, 2)}`, 'decremento logarítmico', '', 'susp.naturalFreq', dS);
      if (ok(F.fn) && ok(R.fn)) {
        const ratio = R.fn / F.fn;
        if (ratio < 1) rec(`A traseira está com frequência menor que a dianteira (${ratio.toFixed(2)}×). A regra do “flat ride” (Olley) sugere a traseira 10–20 % acima da dianteira, para o carro não “galopar” em lombadas.`, 'susp.naturalFreq', dS);
        else if (ratio > 1.3) rec(`A traseira está ${((ratio - 1) * 100).toFixed(0)} % acima da dianteira em frequência; a referência do “flat ride” é 10–20 %.`, 'susp.naturalFreq', dS);
      }
      ([['dianteira', F], ['traseira', R]] as const).forEach(([nm, x]) => {
        if (!ok(x.zeta)) return;
        if (x.zeta < 0.2) rec(`ζ da ${nm} = ${x.zeta.toFixed(2)}: pouco amortecida (oscila depois de cada obstáculo). Referência comum em fora-de-estrada: ~0,25–0,5.`, 'susp.naturalFreq', dropS(x));
        if (x.zeta > 0.6) rec(`ζ da ${nm} = ${x.zeta.toFixed(2)}: muito amortecida (dura em impactos). Referência comum: ~0,25–0,5.`, 'susp.naturalFreq', dropS(x));
      });
      const rF = rideRates(F.fn, F.zeta, +car.massF, +car.mrF), rR = rideRates(R.fn, R.zeta, +car.massR, +car.mrR);
      facts.rates = { F: rF && { k: rF.k, c: rF.c, cShock: rF.cShock }, R: rR && { k: rR.k, c: rR.c, cShock: rR.cShock } };
      const rS = sens(rF && dropS(F), rR && dropS(R), 'car_data');
      if (rF || rR) row('Suspensão', 'Rigidez equivalente na roda diant. / tras.', `${rF ? (rF.k / 1000).toFixed(1) : '—'} / ${rR ? (rR.k / 1000).toFixed(1) : '—'} N/mm`, 'k = m·(2π·fₙ)², com a massa suspensa por roda',
        'inclui o pneu em série; mola na roda ≈ um pouco maior', 'susp.rideRates', rS);
      if (rF || rR) row('Suspensão', 'Amortecimento na roda diant. / tras.', `${rF ? rF.c.toFixed(0) : '—'} / ${rR ? rR.c.toFixed(0) : '—'} N·s/m`, 'c = 2ζ·√(k·m)',
        (rF && ok(rF.cShock)) || (rR && ok(rR.cShock)) ? `no amortecedor: ${rF && ok(rF.cShock) ? rF.cShock.toFixed(0) : '—'} / ${rR && ok(rR.cShock) ? rR.cShock.toFixed(0) : '—'} N·s/m (× MR²)` : 'informe a relação roda/amortecedor para ter no amortecedor',
        'susp.rideRates', rS);
      if (!rF && !rR) row('Suspensão', 'Rigidez e amortecimento', '—', 'precisa da massa suspensa por roda (Dados do carro)', '', 'susp.rideRates', dS);
    } else row('Suspensão', 'Frequência natural e ζ', '—', 'faça um teste de queda com o carro parado e o log gravando', '', 'susp.naturalFreq', sens(actS, sg.stop));
    /* curso e velocidade */
    (['F', 'R'] as const).forEach(ax => {
      const ks = act.filter(k => k.axle === ax);
      if (!ks.length) return;
      const stroke = ax === 'F' ? +car.strokeF : +car.strokeR, nm = ax === 'F' ? 'diant.' : 'tras.';
      const kS = ks.map(k => shockSensor(k.id));
      let used = 0, vmaxC = 0;
      const vc: number[] = [], vr: number[] = [];
      ks.forEach(k => {
        let mn = Infinity, mx = -Infinity;
        for (let i = i0; i <= i1; i++) { const p = k.static + k.disp[i]; if (p < mn) mn = p; if (p > mx) mx = p; if (k.v[i] > vmaxC) vmaxC = k.v[i]; }
        used = Math.max(used, mx - mn);
        facts.cornerTravel[k.id] = mx - mn;
        const s = velStats(k.v, i0, i1, mv, +A.cfg.susp.knee || 100);
        if (s) { vc.push(s.p95C); vr.push(s.p95R); }
      });
      const sug = Math.ceil(used * 1.15 / 5) * 5;
      const tS = sens(kS, stroke > 0 && 'car_data');
      row('Suspensão', `Curso usado ${nm}`, `${used.toFixed(0)} mm${stroke > 0 ? ` (${(used / stroke * 100).toFixed(0)} % de ${stroke})` : ''}`, 'máx. − mín. da posição no trecho', `curso mínimo sugerido: ${sug} mm (+15 %)`,
        'susp.travelUsed', tS);
      let nbOut: number | null = null, bS: SensorId[] = [];
      if (stroke > 0) {
        const nb = nbOut = bottomOuts(t, A.susp, car, i0, i1).filter(b => ks.some(k => k.id === b.id)).length;
        /* o fim de curso usa a posição absoluta = estático + deslocamento: com compPos o
         * estático cancela (é a própria posição); com a compressão invertida vale
         * 2·estático − posição e o estático medido parado (GPS) entra na conta */
        bS = sens(tS, !A.cfg.susp.compPos && ks.some(k => k.staticFromStop) && sg.stop);
        if (nb) rec(`A ${nm === 'diant.' ? 'dianteira' : 'traseira'} bateu no fim de curso ${nb} vez(es): aumentar o curso, a rigidez ou usar batente progressivo. Curso usado ${used.toFixed(0)} de ${stroke} mm.`, 'susp.bottomOut', bS);
        else if (used / stroke < 0.6) rec(`A ${nm === 'diant.' ? 'dianteira' : 'traseira'} usou só ${(used / stroke * 100).toFixed(0)} % do curso: dá para amaciar a mola ou baixar o carro (se a pista do log for representativa).`, 'susp.travelUsed', tS);
      }
      const vS = sens(kS, mv && sg.stop);
      row('Suspensão', `Velocidade do amortecedor ${nm}`, `${fx(mean(vc), 0)} comp. / ${fx(mean(vr), 0)} ext. mm/s (p95)`, `máx. compressão ${vmaxC.toFixed(0)} mm/s`, 'faixa de trabalho das válvulas',
        'susp.shockVelocity', vS);
      facts.axle[ax] = { used, stroke, pct: stroke > 0 ? used / stroke * 100 : null, suggested: sug, bottomOuts: nbOut, p95C: mean(vc), p95R: mean(vr), vmaxC, sensors: tS, bottomSensors: bS };
    });
    const gr = gradients(A.ang || {}, A.acc || {}, mv, i0, i1);
    if (gr.roll) {
      const rollIds: CornerId[] = [...(A.ang.rollF ? ['FL', 'FR'] as const : []), ...(A.ang.rollR ? ['RL', 'RR'] as const : [])];
      facts.rollGrad = gr.roll.slope; facts.rollR2 = gr.roll.r2;
      row('Suspensão', 'Gradiente de rolagem', `${gr.roll.slope.toFixed(2)} °/g`, `rolagem × acel. lateral (R² ${gr.roll.r2.toFixed(2)})`, A.ang.mrKnown ? '' : 'sem a relação roda/amortecedor: subestimado',
        'susp.rollGradient', sens(rollIds.map(shockSensor), sg.lat, mv && sg.stop, 'car_data'));
    }
    if (gr.pitchBrake || gr.pitchAccel) {
      facts.pitchBrake = gr.pitchBrake ? Math.abs(gr.pitchBrake.slope) : null;
      facts.pitchAccel = gr.pitchAccel ? Math.abs(gr.pitchAccel.slope) : null;
      row('Suspensão', 'Gradiente de arfagem frenagem / aceleração',
        `${gr.pitchBrake ? Math.abs(gr.pitchBrake.slope).toFixed(2) : '—'} / ${gr.pitchAccel ? Math.abs(gr.pitchAccel.slope).toFixed(2) : '—'} °/g`, 'arfagem × acel. longitudinal', 'compare para avaliar anti-mergulho / anti-agachamento',
        'susp.pitchGradient', sens(actS, sg.lon, mv && sg.stop, 'car_data'));
    }
    const J = A.veh ? jumps(t, A.susp, A.veh, car, i0, i1) : [];
    if (A.veh && A.veh.v) facts.jumps = { n: 0, T: NaN, h: NaN, vland: NaN, vShock: NaN };
    if (J.length) {
      const top = J.reduce((a, b) => (b.T > a.T ? b : a));
      let vl = 0;
      J.forEach(j => Object.values(j.shock).forEach(s => { if (s.vmax > vl) vl = s.vmax; }));
      /* o limiar de "no ar" é relativo ao estático (medido parado pelo GPS, se deu) */
      const jS = sens(actS, sg.vel, act.some(k => k.staticFromStop) && 'gps');
      facts.jumps = { n: J.length, T: top.T, h: top.h, vland: top.vland, vShock: vl };
      row('Suspensão', 'Saltos', `${J.length} · maior ${(top.T * 1000).toFixed(0)} ms no ar, ${(top.h * 100).toFixed(0)} cm`, 'todos os amortecedores estendidos ao mesmo tempo', `pouso a ${top.vland.toFixed(1)} m/s; amortecedor até ${vl.toFixed(0)} mm/s`,
        'susp.jumps', jS);
      rec(`Nos pousos o amortecedor chega a ~${vl.toFixed(0)} mm/s em compressão: a válvula de alta velocidade e o batente precisam trabalhar até aí.`, 'susp.jumps', jS);
    }
    const rough = getChannel(A, 'susp:rough');
    if (rough) {
      const a: number[] = [];
      for (let i = i0; i <= i1; i++) if ((!mv || mv[i]) && ok(rough.data[i])) a.push(rough.data[i]);
      a.sort((x, y) => x - y);
      const q50 = quant(a, 0.5), q95 = quant(a, 0.95);
      facts.roughMed = ok(q50) ? q50 : null; facts.roughP95 = ok(q95) ? q95 : null;
      row('Pista', 'Rugosidade (vel. amortecedores RMS)', `${fx(q50, 0)} mediana · ${fx(q95, 0)} p95 mm/s`, 'canal “Rugosidade” — pinte o mapa com ele para ver os trechos duros', '',
        'channel.roughness', sens(actS, mv && sg.stop));
    }
    const dist = veh.dist || (A.track && A.track.ok ? A.track.dist : null);
    const distS: SensorId[] = veh.dist ? sg.vel : A.track.ok ? ['gps'] : [];
    const rs = dist && mv ? roadSpectrum(act.map(k => k.disp), dist, mv, i0, i1) : null;
    if (rs) {
      const pk = localPeaks(rs.f, rs.p, 1 / 16, 1 / 0.8, 3).map(p => 1 / p.f);
      facts.wavelengths = pk;
      row('Pista', 'Ondulações dominantes', pk.map(l => l.toFixed(1) + ' m').join(' · '), 'espectro do curso por distância',
        ok(F.fn) ? `excitam a dianteira a ${pk.map(l => (F.fn * l * 3.6).toFixed(0)).join(' / ')} km/h` : 'teste de queda dá as velocidades críticas',
        'freq.roadWavelength', sens(actS, distS, sg.stop, ok(F.fn) && dropS(F)));
    }
  } else row('Suspensão', 'Amortecedores', 'nenhum com sinal', 'ligue/configure os potenciômetros', '', 'susp.shocksActive', []);

  /* ---------- trem de força ---------- */
  if (veh.v) {
    const v = veh.v, axv = veh.ax!, P = veh.P!;
    if (veh.wheel) {
      const cS = sens(veh.kN ? WG : 'wheel');
      if (veh.kN) { facts.tireK = veh.k; facts.tireErr = (1 / veh.k - 1) * 100; }
      row('Trem de força', 'Calibração da velocidade da roda', veh.kN ? `fator ${veh.k.toFixed(4)} (a roda marca ${veh.k < 1 ? '+' : ''}${((1 / veh.k - 1) * 100).toFixed(1)} %)` : '—', 'distância roda × GPS em trechos sem aceleração',
        veh.kN ? `circunferência certa = atual × ${veh.k.toFixed(4)}` : 'precisa de GPS', 'power.tireCalibration', cS);
      if (veh.kN && Math.abs(veh.k - 1) > 0.01) rec(`Corrija a circunferência do pneu na FT: multiplique o valor atual por ${veh.k.toFixed(4)} (a roda marca ${((1 / veh.k - 1) * 100).toFixed(1)} % ${veh.k < 1 ? 'a mais' : 'a menos'} que o GPS).`, 'power.tireCalibration', cS);
    } else row('Trem de força', 'Velocidade da roda', 'sem canal', 'usando o GPS (aceleração pouco precisa)', '', 'sensor.wheel', ['gps']);
    let vmax = 0, bmax = 0, lat = 0;
    for (let i = i0; i <= i1; i++) {
      if (v[i] > vmax) vmax = v[i];
      if (-axv[i] > bmax) bmax = -axv[i];
      if (A.acc && A.acc.lat && Math.abs(A.acc.lat[i]) > lat) lat = Math.abs(A.acc.lat[i]);
    }
    const pc = powerCurve(v, P, axv, i0, i1, 2, veh.slip);
    let pmax = 0, pv = NaN;
    pc.y.forEach((y, k) => { if (y > pmax) { pmax = y; pv = pc.x[k]; } });
    facts.vmax = vmax * 3.6; facts.pmax = pmax; facts.pmaxSpeed = ok(pv) ? pv : null;
    row('Trem de força', 'Velocidade máxima', `${(vmax * 3.6).toFixed(1)} km/h`, veh.wheel ? 'roda corrigida' : 'GPS', '', 'power.vmax', sens(sg.vel));
    row('Trem de força', 'Potência máxima na roda', `${pmax.toFixed(2)} kW a ${fx(pv, 0)} km/h`, `(m·a + F_res)·v com m = ${car.mass} kg, Crr ${car.crr}, CdA ${car.cda}`,
      `${(pmax / car.power * 100).toFixed(0)} % dos ${car.power} kW do motor chegam à roda`, 'power.wheelPower', sens(sg.vel, veh.slip && WG, 'car_data'));
    const tr = A.track, ld = !!(car.wheelDriven && tr && tr.ok);
    const dist = car.wheelDriven && tr && tr.ok ? tr.dist : veh.dist!;
    const L = launches(t, v, dist, veh.slip, axv).filter(l => l.t0 >= t[i0] && l.t0 <= t[i1]);
    facts.launches = L.length;
    if (L.length) {
      const b = L.reduce((a, c) => (ok(c.d30) && (!ok(a.d30) || c.d30 < a.d30) ? c : a));
      const sl = mean(L.map(l => l.slip10).filter(ok));
      facts.launch30 = ok(b.d30) ? b.d30 : null; facts.launch20kmh = ok(b.v20) ? b.v20 : null; facts.launchSlip = ok(sl) ? sl : null;
      row('Trem de força', 'Melhor largada', `0–30 m ${fx(b.d30, 2)} s · 0–20 km/h ${fx(b.v20, 2)} s`, `${L.length} largada(s) do carro parado`,
        ok(sl) ? `escorregamento médio nos 10 m: ${(sl * 100).toFixed(0)} %` : '', 'power.launch', sens(sg.vel, ld ? 'gps' : sg.vel, veh.slip && WG));
      if (ok(sl) && sl > 0.2) rec(`Na largada a roda de tração escorregou ${(sl * 100).toFixed(0)} % nos primeiros 10 m: a largada está limitada por tração. Vale rever o engate da CVT, o pneu/pressão e a distribuição de peso.`, 'power.launch', sens(WG));
    }
    facts.brakeMax = bmax; facts.latMax = lat;
    row('Trem de força', 'Frenagem máx. / lateral máx.', `${bmax.toFixed(2)} g / ${lat.toFixed(2)} g`, A.acc ? A.acc.src : '', '', 'dyn.gg', sens(sg.vel, sg.lat));
    const co = findCoasts(t, v, axv, i0, i1);
    const f = co.length ? coastFit(v, veh.a!, co[0].i0, co[0].i1, +car.mass, +car.rho) : null;
    if (f) facts.coast = { crr: f.crr, cda: f.cda, r2: f.r2, t0: co[0].t0, t1: co[0].t1 };
    row('Trem de força', 'Resistência ao rolamento e arrasto', f ? `Crr ${f.crr.toFixed(3)} · CdA ${f.cda > 0 ? f.cda.toFixed(2) + ' m²' : '—'}` : '—',
      f ? `coast-down ${co[0].t0.toFixed(0)}–${co[0].t1.toFixed(0)} s (R² ${f.r2.toFixed(2)})` : 'faça um coast-down (aba Trem de força)',
      f ? `rolar a 30 km/h custa ${((f.A + f.B * 69.4) * 8.33 / 1000).toFixed(2)} kW` : '', 'power.coastDown', sens(sg.vel, f && 'car_data'));
  }

  /* ---------- CVT ---------- */
  if (veh.cvt && veh.v) {
    const cvt: Channel = veh.cvt;
    const r = cvtFit(t, cvt.data, veh.v, veh.P!, car, i0, i1);
    let tmax = -Infinity;
    for (let i = i0; i <= i1; i++) if (cvt.data[i] > tmax) tmax = cvt.data[i];
    facts.cvt = { tmax, fit: null };
    row('CVT', 'Temperatura máxima medida', `${tmax.toFixed(1)} °C`, `canal ${cvt.name}`, '', 'cvt.maxTemp', ['cvt_temp']);
    const mS = sens('cvt_temp', sg.vel, 'car_data');
    if (r.ok) {
      facts.cvt.fit = { Tss: r.Tss, Tend: r.Tend, tauMove: r.tauMove, tReach: r.tReach, coolNeed: r.coolNeed, Tlim: r.Tlim, r2: r.r2 };
      row('CVT', 'Regime previsto no enduro', `${r.Tss.toFixed(0)} °C`, `modelo térmico ajustado (R² ${r.r2.toFixed(2)}), ambiente ${car.tAmb} °C`, `após ${car.endurance} min: ${r.Tend.toFixed(0)} °C`,
        'cvt.thermalModel', mS);
      row('CVT', 'Constante de tempo', `${(r.tauMove / 60).toFixed(1)} min andando`, 'quanto demora para chegar a 63 % do regime', '', 'cvt.timeConstant', mS);
      if (r.coolNeed > 1) rec(`A CVT deve passar de ${car.tCvtMax} °C no enduro (regime ${r.Tss.toFixed(0)} °C${ok(r.tReach) ? `, aos ${r.tReach.toFixed(0)} min` : ''}): precisa de ~${((r.coolNeed - 1) * 100).toFixed(0)} % a mais de troca de calor (duto de ar, aberturas, aletas).`, 'cvt.thermalModel', mS);
      else rec(`CVT: regime previsto ${r.Tss.toFixed(0)} °C, margem de ${(r.Tlim - r.Tss).toFixed(0)} °C até o limite de ${car.tCvtMax} °C.`, 'cvt.thermalModel', mS);
    } else row('CVT', 'Modelo térmico', '—', r.msg, '', 'cvt.thermalModel', sens('cvt_temp', sg.vel));
  } else row('CVT', 'Temperatura', 'sem canal', 'escolha o canal em Dados do carro', '', 'sensor.cvt_temp', veh.cvt ? ['cvt_temp'] : []);

  const groups = [...new Set(rows.map(r => r.grp))];
  return { rows, recs, groups, facts };
}

/** Só os textos das recomendações (= an.designRec do app antigo). */
export const designRecTexts = (r: Pick<DesignReport, 'recs'>): string[] => r.recs.map(x => x.text);

/** Nomes curtos dos sensores para mostrar/exportar ("GPS, Roda"). */
export const designSensorNames = (ids: SensorId[]): string => ids.map(id => SENSORS[id].short).join(', ');

/** CSV da ficha (botão "Exportar ficha (CSV)" do app antigo) com a coluna nova "sensores" no
 *  fim. Nome do arquivo e BOM iguais ao antigo. */
export function designCsv(report: Pick<DesignReport, 'rows' | 'recs'>, sessionName: string): { fileName: string; text: string } {
  const q = (s: unknown) => `"${String(s).replace(/"/g, '""')}"`;
  const o = ['grupo,grandeza,valor,como,leitura,sensores'].concat(report.rows.map(r => [r.grp, r.item, r.val, r.how, r.read, designSensorNames(r.sensors)].map(q).join(',')))
    .concat(['', 'pontos de atenção'], report.recs.map(r => [r.text, designSensorNames(r.sensors)].map(q).join(','))).join('\n');
  return { fileName: sessionName.replace(/\.(csv|txt|log)$/i, '') + '_ficha_projeto.csv', text: '﻿' + o };
}
