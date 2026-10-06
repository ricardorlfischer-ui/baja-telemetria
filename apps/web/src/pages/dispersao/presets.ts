/* Atalhos da dispersão para o projeto: pares de canais que respondem perguntas do carro novo.
 * Cada atalho escolhe os canais pelos papéis/canais que existem NESTA sessão e, quando falta
 * algo, diz qual sensor falta e o que medir (estado vazio honesto). */
import type { Channel, SessionContext } from '@baja/core';

export type ScatterMode = 'points' | 'heat';
export type ColorBy = 'none' | 'lap' | 'z';
export type HeatValue = 'count' | 'mean';

export interface Preset {
  id: string;
  title: string;
  why: string;
  /** card de explicação da análise de projeto ligada ao atalho */
  explain: string;
  x?: string; y?: string; z?: string;
  mode: ScatterMode;
  color: ColorBy;
  heat: HeatValue;
  grid?: number;
  /** o que falta neste log (sensor e o que medir); undefined = disponível */
  missing?: string;
}

const live = (c: Channel | undefined): c is Channel => !!c && !c.constant && c.count > 1;

export function buildPresets(ctx: SessionContext): Preset[] {
  const ch = (k: string) => ctx.all.find(c => c.key === k);
  const first = (...keys: string[]) => keys.find(k => live(ch(k)));
  const speed = first('veh:v', 'gps:speed');
  const act = ctx.susp.shocks.filter(k => k.active);
  const shockVel = act.map(k => (k.vCalc ? 'susp:v' + k.id : k.vel?.key)).find(k => !!k && live(ch(k)));
  const shockPos = act.map(k => k.pos?.key).find(k => !!k && live(ch(k)));
  const cvt = ctx.all.find(c => c.src === 'log' && live(c) && (c.key === ctx.cfg.car.cvtCh || /cvt/i.test(c.key)))?.key;
  const lat = first('veh:ay', 'gps:alat');
  const lon = first('veh:ax', 'gps:along');
  const roll = first('susp:rollF', 'susp:rollR');
  const dist = first('gps:dist');
  const power = first('veh:P');
  const noSpeed = 'Falta velocidade do carro: grave o GPS (entradas 7/8 com fix) ou o sensor de roda.';
  const miss = (...m: (string | false)[]) => m.filter(Boolean).join(' ') || undefined;

  return [
    {
      id: 'shockVsSpeed', title: 'Vel. do amortecedor × velocidade do carro',
      why: 'A que velocidade o amortecedor trabalha em cada velocidade do carro: a faixa em que a curva força × velocidade do amortecedor novo precisa ser acertada.',
      explain: 'susp.velocityHistogram', x: speed, y: shockVel, mode: 'heat', color: 'none', heat: 'count', grid: 48,
      missing: miss(!speed && noSpeed, !shockVel && 'Falta um amortecedor com sinal: confira o potenciômetro (cabo, 5 V, calibração na FT).'),
    },
    {
      id: 'cvtVsSpeed', title: 'Temperatura da CVT × velocidade',
      why: 'Em que velocidades a CVT esquenta: devagar e com carga = pouca ventilação. Com a potência na roda como Z, mostra o regime que mais aquece. Orienta o duto de ar do carro novo.',
      explain: 'cvt.thermalModel', x: speed, y: cvt, z: power, mode: power ? 'heat' : 'points', color: power ? 'z' : 'lap', heat: power ? 'mean' : 'count', grid: 32,
      missing: miss(!speed && noSpeed, !cvt && 'Falta a temperatura da CVT: instale/grave o termopar na carcaça da CVT numa entrada analógica da FT.'),
    },
    {
      id: 'rollVsLat', title: 'Rolagem × aceleração lateral',
      why: 'A inclinação da nuvem é o gradiente de rolagem (°/g): rigidez de rolagem do carro, para escolher molas e barra estabilizadora.',
      explain: 'susp.rollGradient', x: lat, y: roll, mode: 'points', color: 'lap', heat: 'count',
      missing: miss(!lat && 'Falta aceleração lateral: precisa do GPS com trajetória (velocidade × guinada).', !roll && 'Falta rolagem: precisa dos dois amortecedores de um eixo com sinal (e bitola + relação roda/amortecedor em Carro para sair em graus).'),
    },
    {
      id: 'travelVsDist', title: 'Curso × distância',
      why: 'Onde na pista o amortecedor usa mais curso; colorindo por volta, dá para ver se os picos se repetem no mesmo ponto (obstáculo) ou são de uma volta só.',
      explain: 'susp.travelUsed', x: dist, y: shockPos, mode: 'points', color: 'lap', heat: 'count',
      missing: miss(!dist && 'Falta distância: precisa do GPS com trajetória.', !shockPos && 'Falta um amortecedor com sinal: confira o potenciômetro.'),
    },
    {
      id: 'gg', title: 'Diagrama g-g (lateral × longitudinal)',
      why: 'Quanto de aderência o carro usa combinando curva com frenagem/tração: envelope para bitola, CG e pneu.',
      explain: 'dyn.gg', x: lat, y: lon, mode: 'heat', color: 'none', heat: 'count', grid: 40,
      missing: miss(!lat && 'Falta aceleração lateral: precisa do GPS com trajetória.', !lon && 'Falta aceleração longitudinal: precisa do GPS ou do sensor de roda.'),
    },
    {
      id: 'powerVsSpeed', title: 'Potência na roda × velocidade',
      why: 'A curva de potência que chega na roda em cada velocidade: redução final e calibração da CVT para a faixa de velocidade da prova.',
      explain: 'power.powerCurve', x: speed, y: power, mode: 'heat', color: 'none', heat: 'count', grid: 40,
      missing: miss(!speed && noSpeed, !power && 'Falta a potência estimada: precisa da velocidade (roda ou GPS) e da massa em Carro.'),
    },
  ];
}
