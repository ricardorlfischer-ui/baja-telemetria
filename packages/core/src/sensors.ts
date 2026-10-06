/* Catálogo dos sensores e entradas do carro (docs/ARQUITETURA.md 3.8): de onde vem cada
 * número que o app mostra. Serve para a equipe saber o que cada sensor destrava e para
 * mostrar aos juízes que a aquisição está ligada às decisões do projeto do carro novo.
 *
 * O caminho do GPS segue o firmware do PIC (samples/pic_gps_expander: track_config.h,
 * gps_pos.c, ft_expander.c, main.c) e o log do BUSMASTER de 05/10. */
import type { SensorId } from './types';
import type { SessionContext } from './pipeline';
import { detectRoles, type ChannelRole } from './quality';

/** Sensor ou entrada do carro. planned = sugerido, ainda não instalado. */
export interface Sensor {
  id: SensorId;
  name: string;
  short: string;                 /* rótulo curto para os chips */
  where: string;                 /* onde fica no carro */
  signal: string;                /* como chega no log (canal da FT / CAN) */
  rate: string;                  /* taxa */
  resolution?: string;
  purpose: string;               /* para que serve (o que o app calcula com ele) */
  planned?: boolean;
  channels?: string[];           /* canais típicos no log */
  unlocks?: string[];            /* o que destrava para o projeto (sugeridos: o que ganharíamos) */
}

/** Ordem de apresentação (instalados primeiro, depois os sugeridos). */
export const SENSOR_IDS: SensorId[] = [
  'gps', 'shock_fl', 'shock_fr', 'shock_rl', 'shock_rr', 'wheel', 'cvt_temp', 'logger', 'car_data',
  'engine_rpm', 'imu', 'brake_pressure', 'steering', 'throttle',
];

const shock = (id: SensorId, nome: string, canto: string, ch: string, vel: string): Sensor => ({
  id, name: `Amortecedor ${nome}`, short: `Amort. ${canto}`,
  where: `Potenciômetro linear em paralelo com o amortecedor ${nome} (fixo no chassi e na bandeja/balança). Mede o curso do amortecedor, não o da roda: curso na roda = curso do amortecedor × relação roda/amortecedor (Carro).`,
  signal: `Tensão 0–5 V numa entrada analógica da FT450, calibrada em mm no FT Manager → canal ${ch} (posição, mm). A FT também grava a velocidade derivada → ${vel} (mm/s). Sem o canal de velocidade, o app deriva a posição (±1,5 amostra).`,
  rate: '25 Hz no log da FT (0,04 s por amostra): enxerga até 12,5 Hz',
  resolution: 'a do conversor de 0–5 V da FT dividida pelo curso calibrado; a FT grava com 3 casas',
  purpose: 'curso usado e % do curso, histogramas de velocidade (baixa/alta velocidade, compressão/extensão), frequência natural e ζ no teste de queda, rolagem e arfagem (°), saltos e pousos, batidas no fim de curso, rugosidade da pista e espectro da pista por distância',
  channels: [ch, vel],
  unlocks: ['curso mínimo do amortecedor do carro novo (+15 % sobre o usado)', 'faixa de trabalho das válvulas (velocidades p95 e de pouso)', 'mola e amortecimento pela frequência natural e ζ', 'gradiente de rolagem para dimensionar barra estabilizadora'],
});

export const SENSORS: Record<SensorId, Sensor> = {
  gps: {
    id: 'gps', name: 'GPS (posição na pista)', short: 'GPS',
    where: 'Módulo GPS no barramento CAN de 1 Mbps do carro (quadros padrão 0x028 = posição, 0x023 = fix/satélites). Um PIC18F27Q83 (pic_gps_expander) no mesmo barramento lê a posição e emula um input expander FuelTech (produto 0x47E0) para a FT450 gravar.',
    signal: 'Módulo GPS → CAN 0x028 (longitude e latitude, int32 em 1e-7 grau) e 0x023 (fix 3D + flag fixOK) → PIC: distância ao centro da pista do track_config.h, em Leste (X) e Norte (Y), vira um código 0–255 por eixo (código = floor(128 + d / resolução), travado em 0 e 255) → expander FTCAN, entradas 7 (X) e 8 (Y), como 0–5000 mV virtuais → a FT450 aplica a calibração do FT Manager (recomendado 0,00 V = 0 e 5,00 V = 5: log em volts, código = V × 51) → no CSV, X = Back_pressure (DataID 0x0177) e Y = O2_General (DataID 0x0027). Status opcional (entrada GPS_INPUT_STATUS: 0 sem GPS, 85 sem fix, 170 pegando o centro, 255 ok). No log do BUSMASTER o app lê a latitude/longitude direto do 0x028 (só com fix 3D).',
    rate: '4 Hz (atualização da posição pelo módulo); a FT repete o último valor a 25 Hz no log',
    resolution: 'vão / 255 por passo: 200 m + 2 × 10 m de margem → ≈ 0,863 m (centro fixo, TRACK_CENTER_FIXED = 1); com centro automático o vão dobra (2 × 200 + 2 × 10 m → ≈ 1,65 m). Fora da área o código trava em 0/255 (borda).',
    purpose: 'trajetória e mapa colorido por canal, velocidade e distância (quando não há roda), voltas, delta para a melhor volta, aceleração lateral e raio de curva (g-g), detecção de carro parado (estático dos amortecedores, teste de queda), referência para calibrar a circunferência do pneu e medir o escorregamento da roda de tração, espectro da pista por distância',
    channels: ['Back_pressure', 'O2_General'],
    unlocks: ['tempo por volta e onde se ganha/perde tempo (traçado, curvas lentas)', 'aceleração lateral máx. e raio de curva → bitola, entre-eixos, altura do CG contra capotamento', 'calibração da roda e escorregamento → pneu e engate da CVT'],
  },
  shock_fl: shock('shock_fl', 'dianteiro esquerdo', 'FL', 'Shock_-_Front_Left', 'Shock_velocity_FL'),
  shock_fr: shock('shock_fr', 'dianteiro direito', 'FR', 'Shock_-_Front_Right', 'Shock_velocity_FR'),
  shock_rl: shock('shock_rl', 'traseiro esquerdo', 'RL', 'Shock_-_Rear_Left', 'Shock_velocity_RL'),
  shock_rr: shock('shock_rr', 'traseiro direito', 'RR', 'Shock_-_Rear_Right', 'Shock_velocity_RR'),
  wheel: {
    id: 'wheel', name: 'Velocidade da roda', short: 'Roda',
    where: 'Sensor Hall/indutivo lendo dentes ou ímãs no cubo de uma roda — de tração (mede também o escorregamento) ou livre (velocidade real do carro). Qual das duas fica em Carro.',
    signal: 'Pulsos numa entrada de velocidade da FT450; a FT converte com a circunferência do pneu configurada no FT Manager → canal de velocidade da roda (ex.: Wheel_speed, km/h). O app corrige a circunferência comparando com o GPS.',
    rate: '25 Hz no log; a resolução em baixa velocidade depende do número de pulsos por volta',
    resolution: 'circunferência ÷ pulsos por volta (mais pulsos = melhor em baixa velocidade e na largada)',
    purpose: 'velocidade e distância precisas, aceleração longitudinal (bem melhor que pelo GPS), potência na roda, largadas 0–10/20/30 m, coast-down (Crr e CdA), escorregamento roda × GPS, aceleração lateral = v × guinada do GPS',
    channels: ['Wheel_speed'],
    unlocks: ['potência que chega na roda e eficiência do trem de força', 'curva de tração × potência → redução final e calibração da CVT', 'Crr e CdA reais para simular o carro novo'],
  },
  cvt_temp: {
    id: 'cvt_temp', name: 'Temperatura da CVT', short: 'CVT',
    where: 'Termopar/termistor (ou sensor infravermelho apontado para a correia) na carcaça da CVT.',
    signal: 'Entrada analógica da FT450 calibrada em °C → canal da CVT (ex.: CVT_temp).',
    rate: '25 Hz no log; a temperatura muda em dezenas de segundos (constante de tempo de minutos)',
    purpose: 'modelo térmico de 1ª ordem dT/dt = θ₁·P − (θ₂ + θ₃·v)·(T − T_amb): constante de tempo, temperatura de regime, projeção para o enduro e quanto de troca de calor falta',
    channels: ['CVT_temp'],
    unlocks: ['dimensionar dutos/entrada de ar da CVT para o enduro', 'saber se a correia passa do limite antes do fim da prova'],
  },
  logger: {
    id: 'logger', name: 'Datalogger (FT450)', short: 'Logger',
    where: 'ECU FuelTech FT450 no painel: grava todas as entradas (e as do expander) num log exportado pelo FT Manager em CSV. Na bancada/teste, o BUSMASTER num PC grava os quadros CAN crus.',
    signal: 'CSV do FT Manager: coluna TIME (s) + um canal por entrada; 1,797…e308 = sem dado naquela amostra. BUSMASTER: cada quadro com a hora do PC (o app monta os blocos FTCAN e decodifica o GPS e o debug do PIC, 0x7E9).',
    rate: '25 Hz no log de 05/10 (0,04 s); define a banda de tudo: só se enxerga até a metade da taxa (12,5 Hz)',
    purpose: 'base de tempo de todas as contas; a taxa limita o que dá para medir (frequência da roda, picos de impacto, derivadas)',
    unlocks: ['saber o que dá para medir com a taxa atual e onde vale gravar mais rápido'],
  },
  car_data: {
    id: 'car_data', name: 'Medidas do carro (digitadas)', short: 'Carro',
    where: 'Página Carro: medidas feitas na oficina (balança por roda, trena, catálogo do amortecedor, geometria do CAD).',
    signal: 'Não é sensor: números digitados — massa com piloto, entre-eixos, bitolas, relação roda/amortecedor, curso total do amortecedor, massa suspensa por roda, Crr, CdA, ρ do ar, potência do motor, temperatura ambiente, limite da CVT e duração do enduro.',
    rate: 'não é amostrado: vale para o carro e o ajuste do dia (refaça ao mudar molas, massa ou geometria)',
    purpose: 'transformam medida em grandeza de projeto: curso do amortecedor em ângulo de rolagem/arfagem (°), frequência em rigidez e amortecimento na roda (N/mm, N·s/m), aceleração em força e potência (N, kW), % do curso e fim de curso',
    unlocks: ['comparar o carro medido com o projetado (CAD) e corrigir o modelo do carro novo'],
  },
  engine_rpm: {
    id: 'engine_rpm', name: 'Rotação do motor', short: 'RPM', planned: true,
    where: 'Captador indutivo no cabo da vela (ou sinal da bobina) do motor Briggs & Stratton.',
    signal: 'Pulsos numa entrada de rotação da FT450 → canal RPM.',
    rate: '≥ 25 Hz no log (um pulso por volta do motor)',
    purpose: 'com a velocidade da roda dá a relação da CVT em tempo real (rpm do motor ÷ rpm da roda ÷ redução fixa): curva de engate e de troca, rotação de potência máxima e patinação da correia',
    unlocks: ['calibrar pesos e molas da CVT para manter o motor na rotação de potência máxima', 'potência do motor × potência na roda = eficiência do trem de força', 'detectar a correia patinando (rotação sobe e a roda não)'],
  },
  imu: {
    id: 'imu', name: 'IMU (acelerômetro + giroscópio de 3 eixos)', short: 'IMU', planned: true,
    where: 'Presa rígida no chassi, perto do centro de gravidade.',
    signal: 'CAN (ou saídas analógicas na FT) → acelerações ax, ay, az (g) e velocidades angulares (°/s).',
    rate: '≥ 100 Hz',
    purpose: 'acelerações lateral, longitudinal e vertical medidas direto (g-g sem depender dos passos de 0,86 m do GPS), guinada, rolagem e arfagem reais para conferir as dos potenciômetros, cargas de pouso',
    unlocks: ['cargas reais de pouso e impacto para dimensionar chassi, bandejas e pontos de fixação', 'g-g confiável para definir bitola, CG e limite de capotamento', 'gradiente de rolagem sem depender da relação roda/amortecedor'],
  },
  brake_pressure: {
    id: 'brake_pressure', name: 'Pressão de freio', short: 'Freio', planned: true,
    where: 'Transdutores de pressão (0–5 V) nas linhas dianteira e traseira, depois do cilindro mestre.',
    signal: 'Entradas analógicas da FT450 calibradas em bar.',
    rate: '25 Hz (ou mais)',
    purpose: 'separar frenagem de desaceleração por resistência, distribuição de frenagem dianteira/traseira, pressão de travamento e força no pedal',
    unlocks: ['dimensionar cilindros mestres e o balanço de freio do carro novo', 'coast-down mais limpo (excluir qualquer toque no freio)', 'gradiente de arfagem em frenagem × pressão → anti-mergulho'],
  },
  steering: {
    id: 'steering', name: 'Ângulo do volante', short: 'Volante', planned: true,
    where: 'Potenciômetro rotativo na coluna de direção.',
    signal: 'Entrada analógica da FT450 calibrada em graus.',
    rate: '25 Hz',
    purpose: 'ângulo de direção × aceleração lateral × raio de curva: subesterço/sobresterço, relação de direção usada, correções do piloto',
    unlocks: ['escolher a relação da caixa de direção e o curso do volante', 'gradiente de subesterço para ajustar distribuição de peso, pneu e geometria'],
  },
  throttle: {
    id: 'throttle', name: 'Posição do acelerador (TPS)', short: 'TPS', planned: true,
    where: 'Potenciômetro no pedal ou no eixo da borboleta do carburador.',
    signal: 'Entrada analógica da FT450 → canal TPS (%).',
    rate: '25 Hz',
    purpose: 'separar aceleração plena (curva de potência só com o pedal no fundo), confirmar coast-down sem pé, tempo em aceleração plena por volta, estilo do piloto',
    unlocks: ['curva de potência na roda mais limpa → redução e CVT', 'onde o piloto tira o pé: curvas que limitam o tempo de volta'],
  },
};

/** Estado de cada sensor nesta sessão. */
export type SensorState = 'present' | 'absent' | 'planned';

/* papéis de cada sensor (os canais do log que contam como "o sensor") */
const SENSOR_ROLES: Partial<Record<SensorId, ChannelRole[]>> = {
  shock_fl: ['shock_pos_FL', 'shock_vel_FL'], shock_fr: ['shock_pos_FR', 'shock_vel_FR'],
  shock_rl: ['shock_pos_RL', 'shock_vel_RL'], shock_rr: ['shock_pos_RR', 'shock_vel_RR'],
  wheel: ['wheel'], cvt_temp: ['cvt_temp'],
  engine_rpm: ['engine_rpm'], imu: ['imu'], brake_pressure: ['brake_pressure'], steering: ['steering'], throttle: ['throttle'],
};

/** Quais sensores este log tem, pelos papéis da qualidade dos dados (detectRoles): presente =
 *  o canal existe e tem sinal (não constante). GPS: X e Y com sinal, ou lat/lon válida no
 *  BUSMASTER. Logger: há base de tempo. Carro: massa, relação roda/amortecedor, curso e massa
 *  suspensa informados. Sugeridos sem canal no log = 'planned'. */
export function sensorAvailability(ctx: Pick<SessionContext, 'S' | 'cfg'> & { track?: { ok: boolean } }): Record<SensorId, SensorState> {
  const S = ctx.S, roles = detectRoles(S, ctx.cfg);
  const live = (role: ChannelRole) => { const k = roles[role]; const c = k ? S.channels.find(x => x.key === k) : undefined; return !!c && !c.constant && c.count > 0; };
  const out = {} as Record<SensorId, SensorState>;
  for (const id of SENSOR_IDS) {
    let on: boolean;
    /* trajetória válida = o GPS entrou nas contas, mesmo com X/Y parados o log inteiro */
    if (id === 'gps') on = !!(ctx.track && ctx.track.ok) || (S.gps ? S.gps.lat.some(v => v === v) : live('gps_x') && live('gps_y'));
    else if (id === 'logger') on = S.t.length >= 2;
    else if (id === 'car_data') {
      const c = ctx.cfg.car;
      on = +c.mass > 0 && (+c.mrF > 0 || +c.mrR > 0) && (+c.strokeF > 0 || +c.strokeR > 0) && (+c.massF > 0 || +c.massR > 0);
    } else on = (SENSOR_ROLES[id] || []).some(live);
    out[id] = on ? 'present' : SENSORS[id].planned ? 'planned' : 'absent';
  }
  return out;
}

/** Linha da matriz sensor → análises → decisões de projeto (página Aquisição e apresentação). */
export interface SensorMatrixRow { sensor: SensorId; items: { explain: string; decision: string }[] }

/* Itens por sensor: análise (id do card em explain.ts) → decisão do carro novo que ela
 * sustenta. Todo id existe no catálogo e o card cita o sensor da linha (o teste confere);
 * quem acrescentar análises novas acrescenta aqui também. */
const shockItems = (ax: 'F' | 'R'): [string, string][] => {
  const eixo = ax === 'F' ? 'dianteira' : 'traseira', amort = ax === 'F' ? 'amortecedor dianteiro' : 'amortecedor traseiro';
  return [
    ['susp.travelUsed', `curso mínimo do ${amort} (+15 % sobre o usado) e curso de roda da geometria`],
    ['susp.bottomOut', `batente progressivo / mais curso na ${eixo}; casos de carga do chassi`],
    ['susp.velocityP95', `faixa de velocidade em que a curva do ${amort} precisa ser acertada`],
    ['susp.velocityBands', 'peso dos ajustes de baixa × alta velocidade (amortecedor de 2 ou 4 vias)'],
    ['susp.velocityHistogram', 'curva força × velocidade do amortecedor e efeito de cada acerto'],
    ['susp.naturalFreq', ax === 'F' ? 'mola e amortecimento da dianteira (fₙ, ζ)' : 'mola traseira 10–20 % acima da dianteira em frequência (flat ride)'],
    ['susp.rideRates', `mola (N/mm) e amortecimento (N·s/m) da ${eixo} do carro novo`],
    ['susp.rollGradient', 'rigidez de rolagem: molas e barra estabilizadora'],
    ['susp.pitchGradient', ax === 'F' ? 'geometria anti-mergulho (frenagem)' : 'geometria anti-agachamento (aceleração)'],
    ['susp.jumps', 'energia dos pousos: válvula de alta, batente e cargas do chassi'],
    ['channel.roughness', 'trechos duros da pista para os testes de durabilidade'],
    ['freq.speedSplit', 'separar ressonância do carro de excitação da pista'],
    ['freq.criticalSpeed', `fₙ da ${eixo} para tirar a ressonância da faixa de velocidade da prova`],
  ];
};

const MATRIX: [SensorId, [string, string][]][] = [
  ['gps', [
    ['track.gpsPosition', 'mapa da pista: onde cada fenômeno acontece'],
    ['chart.trackMap', 'mapa colorido por canal: onde a suspensão bate e a CVT esquenta'],
    ['track.channelMap', 'mini-mapas por canal: localiza cada problema na pista'],
    ['track.distance', 'quilometragem do carro e das peças (manutenção e durabilidade)'],
    ['laps.lapTimes', 'meta de tempo de volta e comparação de acertos'],
    ['laps.delta', 'traçado e trechos onde se ganha ou perde tempo por volta'],
    ['laps.sectors', 'trechos da pista que mais pesam no tempo → prioridade de projeto'],
    ['laps.speedTrace', 'velocidade de curva, frenagem e saída: aderência × tração × potência'],
    ['dyn.gg', 'envelope de aderência usado por carro e piloto'],
    ['dyn.latMax', 'aceleração lateral máx. → bitola mínima e altura máx. do CG (capotamento)'],
    ['dyn.minRadius', 'raio de giro, ângulo de esterço e entre-eixos máximo'],
    ['dyn.speedHistogram', 'faixa de velocidade para otimizar redução final e CVT'],
    ['power.tireCalibration', 'circunferência certa do pneu na FT (raio efetivo para a redução)'],
    ['power.launchSlip', 'escorregamento na largada → engate da CVT e pneu'],
    ['freq.roadWavelength', 'distância entre ondulações da pista → velocidades de ressonância'],
    ['freq.criticalSpeed', 'velocidade em que a pista excita a carroceria → escolha da mola'],
    ['freq.speedSplit', 'separar o que é do carro do que é da pista no espectro'],
    ['susp.staticHeight', 'altura de rodagem e sag reais (carro parado)'],
    ['freq.dropTest', 'acha o teste de queda com o carro parado'],
    ['quality.gpsBorder', 'tamanho da área e centro no track_config.h'],
  ]],
  ['shock_fl', shockItems('F')],
  ['shock_fr', shockItems('F')],
  ['shock_rl', shockItems('R')],
  ['shock_rr', shockItems('R')],
  ['wheel', [
    ['power.speedSource', 'velocidade e aceleração limpas para todas as contas de trem de força'],
    ['power.tireCalibration', 'circunferência do pneu e raio efetivo sob carga'],
    ['power.wheelPower', 'potência que chega na roda → eficiência da CVT e da redução'],
    ['power.powerCurve', 'redução final e calibração da CVT para a faixa de velocidade da prova'],
    ['power.tractiveForce', 'limite de tração e força de projeto de semi-eixos e cubos'],
    ['power.launch', 'tempos 0–30 m: rotação de engate da CVT, redução e pneu'],
    ['power.launchSlip', 'escorregamento da roda de tração na largada'],
    ['power.coastDown', 'Crr e CdA reais para o simulador do carro novo'],
    ['power.braking', 'desaceleração máx. → dimensionar cilindros, pinças e discos'],
    ['power.vmax', 'velocidade máxima × relação de transmissão'],
    ['cvt.thermalModel', 'potência e ventilação que entram no modelo térmico da CVT'],
    ['susp.jumps', 'roda disparando no ar → tranco no trem de força no pouso'],
    ['dyn.gg', 'aceleração longitudinal precisa (frenagem e tração)'],
  ]],
  ['cvt_temp', [
    ['cvt.maxTemp', 'margem até o limite da correia e onde a CVT esquenta na pista'],
    ['cvt.heatRate', 'comparar dutos e calibrações no mesmo trajeto'],
    ['cvt.coolRate', 'se vale abertura que funcione parado ou ventilação forçada'],
    ['cvt.steadyState', 'temperatura de regime no enduro × limite'],
    ['cvt.timeConstant', 'quanto tempo de prova até o regime; duração mínima dos testes'],
    ['cvt.enduranceProjection', 'se a CVT aguenta o enduro inteiro'],
    ['cvt.reachLimit', 'em que minuto da prova a CVT passaria do limite'],
    ['cvt.coolingNeed', 'meta de troca de calor para o duto de ar do carro novo'],
    ['cvt.thermalModel', 'entrada de ar/dutos da CVT para o enduro não passar do limite'],
  ]],
  ['logger', [
    ['quality.sampleRate', 'taxa de gravação de cada canal (o que dá para enxergar)'],
    ['freq.sampleRate', 'gravar amortecedores a ≥ 100 Hz no carro novo para ver a roda'],
    ['quality.timeGaps', 'alimentação e chicote da FT sem quedas'],
    ['quality.validSamples', 'conferir todos os sensores antes de cada teste'],
    ['laps.delta', 'base de tempo das voltas e do delta'],
    ['design.duration', 'tempo de teste acumulado do carro'],
    ['chart.stackedChannels', 'correlações entre canais no mesmo instante'],
  ]],
  ['car_data', [
    ['susp.rideRates', 'rigidez e amortecimento na roda (precisa da massa suspensa e do MR)'],
    ['susp.rollGradient', 'rolagem em graus (precisa de bitola e relação roda/amortecedor)'],
    ['susp.pitchGradient', 'arfagem em graus (precisa de entre-eixos e relação roda/amortecedor)'],
    ['susp.bottomOut', 'fim de curso (precisa do curso total do amortecedor)'],
    ['power.wheelPower', 'força e potência (precisa da massa com piloto, Crr e CdA)'],
    ['power.tractiveForce', 'força trativa em N (precisa da massa com piloto)'],
    ['power.coastDown', 'Crr e CdA (precisa da massa e da densidade do ar)'],
    ['power.resistances', 'parâmetros do simulador de desempenho do carro novo'],
    ['cvt.thermalModel', 'limite da correia, ambiente e duração do enduro'],
    ['quality.carData', 'medidas que faltam medir na oficina (comparar com o CAD)'],
  ]],
  ['engine_rpm', [
    ['sensor.engine_rpm', 'relação da CVT em tempo real → pesos e molas da CVT'],
    ['power.powerCurve', 'potência do motor × roda = eficiência do trem de força'],
    ['power.launch', 'rotação de engate da CVT na largada'],
    ['cvt.steadyState', 'correia patinando, que esquenta a CVT'],
  ]],
  ['imu', [
    ['sensor.imu', 'cargas de pouso para o chassi; g-g sem depender do GPS'],
    ['susp.jumps', 'aceleração vertical real nos pousos → cargas de projeto'],
    ['susp.bottomOut', 'carga real das batidas no batente'],
    ['dyn.latMax', 'lateral medida direto → limite de capotamento'],
    ['dyn.accelMax', 'aceleração medida direto, sem derivar velocidade'],
    ['dyn.brakeMax', 'desaceleração medida direto'],
  ]],
  ['brake_pressure', [
    ['sensor.brake_pressure', 'cilindros mestres e balanço de freio'],
    ['power.braking', 'pressão × desaceleração → dimensionar o sistema de freio'],
    ['dyn.brakeMax', 'pressão usada na frenagem máxima'],
    ['power.coastDown', 'coast-down sem nenhum toque no freio'],
    ['susp.pitchGradient', 'arfagem em frenagem × pressão → anti-mergulho'],
  ]],
  ['steering', [
    ['sensor.steering', 'relação de direção e subesterço'],
    ['dyn.minRadius', 'ângulo de esterço usado nas curvas mais fechadas'],
    ['dyn.latMax', 'gradiente de subesterço (volante × aceleração lateral)'],
  ]],
  ['throttle', [
    ['sensor.throttle', 'curva de potência só em aceleração plena'],
    ['power.powerCurve', 'curva de potência sem trechos de pé parcial'],
    ['power.coastDown', 'confirmar o pé fora no coast-down'],
    ['laps.speedTrace', 'onde o piloto tira o pé: curvas que limitam a volta'],
  ]],
];

/** Sensor → análises que ele permite → decisão de projeto. */
export function sensorMatrix(): SensorMatrixRow[] {
  return MATRIX.map(([sensor, items]) => ({ sensor, items: items.map(([explain, decision]) => ({ explain, decision })) }));
}
