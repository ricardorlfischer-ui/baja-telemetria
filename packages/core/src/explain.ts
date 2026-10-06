/* Cards de explicação (docs/ARQUITETURA.md 3.8 e 4.6): para cada número, gráfico e
 * correlação usados no projeto do carro novo, o que é, de quais sensores saiu, como é
 * calculado, como usar no carro do ano que vem, limites e o teste para medir melhor.
 *
 * Ids: '<área>.<item>', área ∈ EXPLAIN_AREAS (ex.: 'susp.naturalFreq', 'power.wheelPower').
 * Os cards 'sensor.<id>' são gerados do catálogo de sensores (sensors.ts).
 * Estilo: português claro para um juiz de projeto do Baja SAE; física com a fórmula; no
 * campo design, a peça/decisão concreta do carro novo que o número dimensiona. */
import type { SensorId } from './types';
import { SENSORS, SENSOR_IDS, sensorMatrix } from './sensors';

/** Sensor usado por uma análise: obrigatório, alternativa a outro ou que melhora o resultado. */
export interface ExplainSensor { id: SensorId; need: 'required' | 'alternative' | 'improves'; why: string }

export interface ExplainEntry {
  id: string;
  title: string;
  what: string;                  /* o que mostra */
  sensors: ExplainSensor[];      /* sensores usados (e o porquê) */
  how: string;                   /* como é calculado, com a fórmula */
  design: string;                /* para o carro do ano que vem */
  limits?: string;
  test?: string;                 /* ensaio para medir melhor */
  related?: string[];            /* outros ids */
}

export const EXPLAIN_AREAS = ['track', 'laps', 'susp', 'freq', 'power', 'cvt', 'dyn', 'quality', 'design', 'chart', 'channel', 'sensor'] as const;
export type ExplainArea = typeof EXPLAIN_AREAS[number];

const SHOCKS_REQ = (why: string): ExplainSensor[] => (['shock_fl', 'shock_fr', 'shock_rl', 'shock_rr'] as SensorId[]).map(id => ({ id, need: 'required', why }));

const ENTRIES: ExplainEntry[] = [
  /* ================================================================ suspensão */
  {
    id: 'susp.naturalFreq',
    title: 'Frequência natural e amortecimento (teste de queda)',
    what: 'Com que frequência a carroceria oscila sobre as molas depois de um empurrão (fₙ, em Hz) e quão rápido essa oscilação morre (ζ, a fração do amortecimento crítico), por eixo. É a “assinatura” da suspensão: mola, amortecedor, pneu e massa juntos, medidos no carro real.',
    sensors: [
      ...SHOCKS_REQ('o decaimento é medido no curso de cada amortecedor; o valor do eixo é a média dos dois lados'),
      { id: 'gps', need: 'improves', why: 'acha os instantes com o carro parado (andou < 3 m em 3 s), onde o teste é procurado' },
      { id: 'wheel', need: 'alternative', why: 'sem GPS, “parado” vem da roda (abaixo de 0,8 m/s)' },
      { id: 'car_data', need: 'improves', why: 'com a massa suspensa por roda e a relação roda/amortecedor, fₙ e ζ viram rigidez (N/mm) e amortecimento (N·s/m) na roda e no amortecedor' },
    ],
    how: 'O app acha o evento sozinho: carro parado, desvio médio dos amortecedores acima de 8 mm, calmo antes e parado por 2 s depois. Em cada amortecedor tira a base (mediana do último quarto do trecho), acha o maior pico e os extremos alternados seguintes (refinados por uma parábola). Período T entre os picos 1 e 3 → fd = 1/T. Decremento logarítmico δ = ln(a₁/a₃) → ζ = δ / √(4π² + δ²). Frequência natural fₙ = fd / √(1 − ζ²). Com a massa suspensa por roda m: rigidez equivalente na roda k = m·(2π·fₙ)² e amortecimento c = 2ζ·√(k·m); no amortecedor, × MR² (MR = curso da roda ÷ curso do amortecedor).',
    design: 'É a meta da suspensão do carro novo em números. (1) Mola: para a fₙ desejada e a massa suspensa do carro novo, k_roda = m·(2π·fₙ)² e k_mola = k_roda·MR² (a medida inclui o pneu em série, então a mola real fica um pouco mais rígida). (2) “Flat ride” (Olley): traseira 10–20 % acima da dianteira em frequência, para o carro não galopar nas lombadas. (3) Amortecedor: ζ de ~0,25–0,5 em fora-de-estrada — abaixo disso a carroceria oscila depois de cada obstáculo, acima fica dura nos impactos; o c medido é o valor de baixa velocidade para especificar a válvula/clicks. (4) Compare fₙ com as ondulações da pista: a velocidade v = fₙ·λ não pode cair na velocidade típica da prova.',
    limits: 'Vale para pequenas amplitudes e baixa velocidade do amortecedor (região de baixa velocidade da válvula). A rigidez medida é a do conjunto mola + pneu. A 25 Hz o log vê bem até ~5 Hz: a frequência da roda (8–15 Hz) não aparece. Se a oscilação morrer antes do 3º pico (ζ ≳ 0,7), o app usa meio ciclo ou avisa que não oscilou.',
    test: 'Carro parado, log gravando, piloto sentado: empurre a dianteira para baixo e solte, umas 3 vezes com ~5 s entre elas; depois a traseira. Não acompanhe o carro na volta. Meça a massa suspensa por roda (balança por roda menos a massa não suspensa) e a relação roda/amortecedor para ter k e c.',
    related: ['susp.travelUsed', 'freq.roadWavelength', 'susp.rollGradient', 'quality.carData'],
  },
  {
    id: 'susp.travelUsed',
    title: 'Curso usado do amortecedor',
    what: 'Quanto do curso do amortecedor foi usado no trecho (máximo − mínimo da posição), em mm e em % do curso total, por eixo; junto, as batidas no fim de curso (≥ 95 % do curso) e o curso mínimo sugerido para o carro novo.',
    sensors: [
      ...SHOCKS_REQ('a posição de cada amortecedor dá o curso; no eixo vale o maior dos dois lados'),
      { id: 'car_data', need: 'improves', why: 'o curso total do amortecedor transforma mm em % e liga a detecção de fim de curso' },
      { id: 'gps', need: 'improves', why: 'acha o carro parado para medir o estático (altura de rodagem), de onde se mede compressão e extensão' },
    ],
    how: 'Para cada amortecedor com sinal: posição = estático + deslocamento; curso usado = máx − mín da posição no trecho. Curso sugerido = arredondar para cima (curso usado × 1,15) em múltiplos de 5 mm. Fim de curso: posição ≥ 95 % do curso total, eventos separados por mais de 0,5 s. O estático é a mediana da posição com o carro parado (≥ 25 amostras); sem isso, a mediana do log inteiro.',
    design: 'Define o curso mínimo do amortecedor do carro novo (curso usado + 15 % de folga) e, com a relação roda/amortecedor, o curso de roda que a geometria precisa permitir (bandejas, ângulo das homocinéticas e semi-eixos, batentes). Bateu no fim de curso: mais curso, mola mais rígida ou batente progressivo. Usou menos de ~60 % do curso numa pista representativa: dá para amaciar a mola (mais tração e conforto) ou baixar o carro (CG mais baixo). O estático mostra o “sag”: quanto do curso fica para compressão e quanto para extensão (roda caindo em buracos e saltos).',
    limits: 'Mede o curso do amortecedor; o da roda depende da relação roda/amortecedor, que varia com o curso em suspensões progressivas. Um pico de uma amostra (ruído) infla o máximo: confira a qualidade do canal. O resultado vale para a pista e o piloto do log.',
    test: 'Grave a pista da prova (enduro e suspensão/tração) com ~5 s parado no começo. Meça o curso total do amortecedor (batente a batente) e coloque em Carro.',
    related: ['susp.naturalFreq', 'channel.roughness', 'quality.staticRef'],
  },
  {
    id: 'susp.rollGradient',
    title: 'Gradiente de rolagem (°/g)',
    what: 'Quantos graus a carroceria rola por g de aceleração lateral: a inclinação da reta rolagem × aceleração lateral nas curvas. Em frenagem e em aceleração, o mesmo para a arfagem (°/g).',
    sensors: [
      ...SHOCKS_REQ('rolagem = diferença de curso entre esquerda e direita do mesmo eixo (precisa dos dois lados)'),
      { id: 'car_data', need: 'required', why: 'bitolas e relação roda/amortecedor transformam mm de amortecedor em graus; sem a relação sai subestimado' },
      { id: 'gps', need: 'required', why: 'aceleração lateral = velocidade × taxa de guinada do GPS' },
      { id: 'wheel', need: 'improves', why: 'com a roda, a lateral usa a velocidade da roda × guinada do GPS e a longitudinal a derivada da roda (menos ruído)' },
    ],
    how: 'Rolagem do eixo = atan((d_esq − d_dir)·MR / bitola), em graus (d = deslocamento do amortecedor, + = compressão); rolagem = média dos dois eixos. Reta por mínimos quadrados de rolagem × a_lat, só com o carro andando e |a_lat| > 0,08 g (precisa de ≥ 20 pontos). Arfagem = atan((d̄_diant·MR_F − d̄_tras·MR_R) / entre-eixos), separada em frenagem (a_x < −0,05 g) e aceleração (a_x > 0,05 g).',
    design: 'Dimensiona a rigidez de rolagem do carro novo: rigidez de rolagem necessária ≈ m_s·g·h / gradiente desejado (h = distância do CG ao eixo de rolagem). Gradiente alto: molas mais rígidas, barra estabilizadora (a divisão da barra entre frente e traseira ajusta o sub/sobresterço) ou centro de rolagem mais alto. Na arfagem, compare frenagem × aceleração para avaliar o anti-mergulho e o anti-agachamento da geometria. É uma verificação que liga o CAD da suspensão ao carro real.',
    limits: 'Depende da relação roda/amortecedor (que pode variar com o curso) e das bitolas. A aceleração lateral pelo GPS é aproximada; R² baixo = muita dispersão (pista ondulada mistura curso de buraco com rolagem).',
    test: 'Skid-pad: círculo de raio fixo nos dois sentidos, aumentando a velocidade aos poucos, em piso liso. Para a arfagem: frenagens e acelerações fortes em reta.',
    related: ['dyn.gg', 'susp.naturalFreq', 'quality.carData'],
  },
  /* ================================================================ ressonância */
  {
    id: 'freq.roadWavelength',
    title: 'Comprimento de onda das ondulações da pista',
    what: 'A distância entre ondulações que se repetem na pista (costelas, “costela de vaca”), em metros, e a velocidade em que cada uma faz a carroceria entrar em ressonância.',
    sensors: [
      ...SHOCKS_REQ('o curso dos amortecedores é o sinal; o espectro é a média dos espectros de cada amortecedor'),
      { id: 'gps', need: 'required', why: 'distância percorrida para reamostrar o curso por metro e saber quando o carro anda' },
      { id: 'wheel', need: 'alternative', why: 'com a roda, a distância vem da velocidade da roda integrada (melhor que os passos do GPS)' },
    ],
    how: 'Com o carro andando, em trechos de pelo menos 70 m, o curso de cada amortecedor é reamostrado a cada 0,25 m de distância; tira-se a média móvel de 16 m (sobram as ondas menores que 16 m) e calcula-se o espectro (Welch, janelas de 64 m) em ciclos por metro. Os picos entre 0,8 m e 16 m são as ondulações dominantes, λ = 1/f. Velocidade crítica v = fₙ·λ, com fₙ do teste de queda.',
    design: 'Junta pista e carro: se v = fₙ·λ cai na velocidade típica da prova, a carroceria entra em ressonância exatamente onde o piloto anda. Para o carro novo dá para (1) mudar fₙ (mola) e tirar a ressonância da faixa de uso, (2) aumentar ζ se não der para fugir, (3) usar o entre-eixos: ondas com λ ≈ 2 × entre-eixos fazem a frente subir enquanto a traseira desce (arfagem máxima), λ ≈ entre-eixos excita o afundamento.',
    limits: 'Com GPS de 0,86 m a distância tem erro local; a roda é melhor. O próprio traçado repetido também aparece como pico longo (no exemplo, ~9 m); as costelas aparecem como picos curtos.',
    test: 'Passe pela reta ondulada em 2–3 velocidades constantes: o pico que não muda de λ é a pista.',
    related: ['susp.naturalFreq', 'channel.roughness'],
  },
  /* ================================================================ trem de força */
  {
    id: 'power.wheelPower',
    title: 'Potência na roda',
    what: 'A potência que de fato chega ao chão, em kW, por faixa de velocidade, com a linha do limite de tração (força trativa máx. × v) e a potência do motor como referência.',
    sensors: [
      { id: 'wheel', need: 'required', why: 'a velocidade da roda derivada no tempo dá a aceleração; é muito mais limpa que a do GPS' },
      { id: 'gps', need: 'alternative', why: 'sem roda, a velocidade do GPS (passos de 0,86 m a 4 Hz) dá só a ordem de grandeza' },
      { id: 'car_data', need: 'required', why: 'massa com piloto, Crr, CdA e densidade do ar entram na força' },
    ],
    how: 'P = (m·a + F_res(v))·v, com F_res = Crr·m·g + ½·ρ·CdA·v². a = dv/dt por diferença central (±0,12 s na roda, ±0,5 s no GPS), suavizada em 0,3 s. Só entram amostras acima de 1,5 m/s, acelerando (> 0,03 g) e sem escorregar mais de 12 %; a curva é o percentil 90 de P em faixas de 2 km/h. Força trativa máx. = m·g·(percentil 98 da aceleração); onde P_máx = F·v está a velocidade em que a tração deixa de limitar.',
    design: 'Mostra quanto dos ~7,5 kW do motor chega à roda (eficiência da CVT + redução) e em que velocidade. Abaixo do cruzamento com a linha de tração o carro é limitado por aderência (pneu, peso no eixo, engate da CVT); acima, por potência (calibração da CVT, redução final, arrasto). Para o carro novo: escolha a redução final e a calibração da CVT para entregar a potência máxima na faixa de velocidade mais usada na prova, e use a curva medida (não a de catálogo) no simulador de aceleração e de velocidade máxima.',
    limits: 'Depende de m, Crr e CdA corretos (faça o coast-down). Subidas e descidas viram potência falsa (a inclinação não é medida). Sem sensor de acelerador, amostras com o pé parcial baixam a curva; o percentil 90 ameniza. Com GPS só, a derivada é grosseira.',
    test: 'Em reta plana, 3 acelerações plenas do carro parado até a velocidade máxima, nos dois sentidos; um coast-down antes para medir Crr e CdA.',
    related: ['power.tireCalibration', 'dyn.gg', 'cvt.thermalModel', 'sensor.throttle', 'sensor.engine_rpm'],
  },
  {
    id: 'power.tireCalibration',
    title: 'Calibração do pneu (roda × GPS) e escorregamento',
    what: 'Por quanto a velocidade da roda erra em relação ao GPS (em %) e por quanto multiplicar a circunferência do pneu configurada na FT; com o sensor na roda de tração, também o escorregamento (roda − GPS)/GPS.',
    sensors: [
      { id: 'wheel', need: 'required', why: 'a velocidade que está sendo calibrada' },
      { id: 'gps', need: 'required', why: 'referência de distância/velocidade que não depende do pneu' },
    ],
    how: 'Nos trechos sem aceleração forte (|a| < 0,5 m/s²) e acima de 4 m/s na roda e no GPS, soma as velocidades: k = Σv_GPS / Σv_roda (precisa de mais de 100 amostras). Roda corrigida = v_roda × k; “a roda marca” (1/k − 1) × 100 %. Escorregamento = (v_roda − v_GPS suavizada 0,5 s) / max(v_GPS, 1,5 m/s), limitado entre −100 % e +300 %.',
    design: 'O raio efetivo do pneu sob carga é o que vale para a redução final e a velocidade máxima do carro novo — não o diâmetro nominal. O escorregamento médio nos primeiros 10 m da largada mostra se ela é limitada por tração: acima de ~20 % pede rever o engate da CVT (rotação de engate mais baixa ou mais suave), pressão/tipo do pneu ou mais peso no eixo de tração.',
    limits: 'A calibração usa a soma de muitos trechos, então é boa mesmo com o GPS de 0,86 m; o escorregamento instantâneo é ruidoso. Sensor na roda livre não mede escorregamento (só a calibração).',
    test: 'Uma volta em ritmo constante acima de ~20 km/h dá a calibração. Para o escorregamento: 3 largadas do carro parado de pelo menos 30 m.',
    related: ['power.wheelPower', 'track.gpsPosition'],
  },
  /* ================================================================ CVT */
  {
    id: 'cvt.thermalModel',
    title: 'Modelo térmico da CVT e projeção do enduro',
    what: 'Como a temperatura da CVT responde à potência e à velocidade do carro: constante de tempo, temperatura de regime no ritmo do log, a projeção para o enduro inteiro, em quantos minutos chega no limite e quanto a mais de troca de calor seria preciso.',
    sensors: [
      { id: 'cvt_temp', need: 'required', why: 'a temperatura que o modelo ajusta' },
      { id: 'wheel', need: 'required', why: 'potência na roda (aquecimento) e velocidade (ventilação)' },
      { id: 'gps', need: 'alternative', why: 'sem roda, potência e velocidade saem do GPS (mais ruído)' },
      { id: 'car_data', need: 'required', why: 'temperatura ambiente, limite da CVT, duração do enduro, massa e potência do motor' },
    ],
    how: 'Ajuste por mínimos quadrados de dT/dt = θ₁·P⁺ − (θ₂ + θ₃·v)·(T − T_amb), com T suavizado (4 s) e derivado (±3 s), e as entradas passando pelo mesmo filtro. θ₁ = aquecimento por kW, θ₂ = resfriamento parado, θ₃ = ganho do resfriamento com a velocidade (vento). Constante de tempo andando τ = 1/(θ₂ + θ₃·v̄); regime T_ss = T_amb + θ₁·P̄/(θ₂ + θ₃·v̄). Projeção: o modelo repete o perfil (P, v) do log até completar a duração do enduro. Troca de calor necessária = (T_ss − T_amb)/(T_lim − T_amb).',
    design: 'Responde se a CVT aguenta o enduro. Se a projeção passa do limite, a “troca de calor necessária” diz quanto o coeficiente de resfriamento precisa aumentar (ex.: 1,4× = 40 % a mais): é a meta para o duto/entrada de ar da carcaça do carro novo. θ₃ diz quanto o vento ajuda — se for pequeno, a entrada de ar está mal posicionada; a velocidade em que o vento dobra a troca de calor (θ₂/θ₃) mostra se vale captar ar dinâmico ou se precisa de ventilação forçada.',
    limits: 'Modelo de 1ª ordem: não vê a correia patinando em baixa nem o sol direto. Precisa de ≥ 1 min com a temperatura variando ≥ 2 °C, de preferência aquecendo e esfriando. A potência é a da roda (não a dissipada na correia), então θ₁ inclui a eficiência.',
    test: 'Um log longo (≥ 15 min) andando no ritmo do enduro e depois parado com o motor ligado, para o modelo ver o aquecimento e o resfriamento. Anote a temperatura ambiente.',
    related: ['power.wheelPower', 'sensor.engine_rpm'],
  },
  /* ================================================================ dinâmica */
  {
    id: 'dyn.gg',
    title: 'Diagrama g-g (aceleração lateral × longitudinal)',
    what: 'Cada ponto é um instante: aceleração lateral (+ = direita) e longitudinal (+ = acelerando), em g. O contorno mostra o envelope de aderência que carro e piloto usaram: frenagem máxima, tração máxima e curva máxima.',
    sensors: [
      { id: 'gps', need: 'required', why: 'a lateral sai da velocidade × taxa de guinada (mudança de rumo) do GPS' },
      { id: 'wheel', need: 'improves', why: 'com a roda, a longitudinal é a derivada da velocidade da roda e a lateral = velocidade da roda × guinada, bem menos ruidosas' },
    ],
    how: 'Longitudinal: a_x = dv/dt ÷ g (roda: ±0,12 s; GPS: ±0,5 s, suavizada 0,5 s). Lateral: a_y = v·ψ̇ ÷ g, com ψ̇ = derivada do rumo do GPS (±0,5 s), só acima de 5 km/h. Raio de curva R = v/ψ̇ (limitado a 999 m).',
    design: 'A lateral máxima é o dado de entrada para capotamento e geometria: o carro não tomba enquanto a_y < (bitola/2)/h_CG; com a a_y medida e margem, defina a bitola mínima e a altura máxima do CG do carro novo. A frenagem máxima dimensiona o freio (F = m·a) e a transferência de carga para a frente (m·a·h_CG/entre-eixos); a tração máxima mostra se a largada é limitada por aderência. Um envelope “achatado” num quadrante mostra onde o carro (ou o piloto) não usa a aderência disponível.',
    limits: 'Pelo GPS (passos de 0,86 m a 4 Hz) as acelerações são ordem de grandeza e suavizadas; picos curtos somem. Sem IMU, inclinação da pista e rolagem da carroceria entram como erro. Com o carro derrapando, a guinada não é a direção do movimento.',
    test: 'Skid-pad (círculo de ~10 m de raio, aumentando a velocidade até o limite, nos dois sentidos) e frenagens fortes em reta. Uma IMU melhoraria muito este gráfico.',
    related: ['susp.rollGradient', 'power.wheelPower', 'sensor.imu'],
  },
  /* ================================================================ voltas e pista */
  {
    id: 'laps.delta',
    title: 'Delta para a melhor volta',
    what: 'Em cada ponto da volta, quantos segundos esta volta está atrás (+) ou à frente (−) da melhor volta, na mesma posição da pista. Pintando o mapa com o delta aparecem os trechos onde se ganha ou perde tempo.',
    sensors: [
      { id: 'gps', need: 'required', why: 'distância percorrida e cruzamento da linha de largada' },
      { id: 'logger', need: 'required', why: 'o tempo de cada amostra' },
    ],
    how: 'As voltas são separadas pelo cruzamento da linha de largada (com volta mínima). Para cada volta, a distância desde a linha é normalizada pelo comprimento da melhor volta (corrige traçados de comprimentos diferentes) e delta(d) = t_volta(d) − t_melhor(d), com t_melhor interpolado na mesma distância.',
    design: 'Mostra onde está o tempo. Perda concentrada nas saídas de curva: prioridade do carro novo é tração/aceleração em baixa (CVT, redução, pneu). Nas frenagens: freio e estabilidade. Nas retas: potência e arrasto. Nos trechos ondulados: suspensão (veja a rugosidade no mesmo ponto). Comparando voltas com ajustes diferentes no mesmo dia, cada mudança é medida em segundos, não em sensação.',
    limits: 'Precisa de pelo menos 2 voltas completas e de uma linha de largada bem posta. Com GPS de 0,86 m a 4 Hz, diferenças menores que ~0,1–0,2 s são ruído. Volta com traçado muito diferente desalinha as distâncias.',
    test: 'Grave várias voltas seguidas com o mesmo piloto; troque um ajuste por vez (pressão, clicks, CVT) e compare.',
    related: ['track.gpsPosition', 'channel.roughness', 'dyn.gg'],
  },
  {
    id: 'track.gpsPosition',
    title: 'Posição na pista (GPS → PIC → FT)',
    what: 'A trajetória do carro em metros (X = Leste, Y = Norte) em torno do centro da pista, reconstruída dos códigos 0–255 que o PIC manda pelo expander para as entradas 7 e 8 da FT (ou da latitude/longitude, no log do BUSMASTER).',
    sensors: [
      { id: 'gps', need: 'required', why: 'a posição: X = Back_pressure (entrada 7), Y = O2_General (entrada 8)' },
      { id: 'logger', need: 'required', why: 'a FT grava o código a 25 Hz, repetindo o valor entre as atualizações de 4 Hz do GPS' },
    ],
    how: 'código = V × 51 (log em volts). metros = (código − 127,5) × resolução, com resolução = (tamanho + 2·margem)/255 com centro fixo ou (2·tamanho + 2·margem)/255 com centro automático — os mesmos números do track_config.h. Os degraus de 0,86 m são reconstruídos (quando o código muda um passo, o carro está na fronteira entre os passos; entre mudanças, reta no tempo, no máximo 3 s) e suavizados (média móvel, padrão 0,5 s). Velocidade e rumo por diferença central de ±0,5 s; distância somando os deslocamentos. Com o centro conhecido, volta para lat/lon (WGS84) para o fundo de satélite.',
    design: 'É a base de tudo que depende de “onde”: voltas, delta, mapas por canal (onde a suspensão bate, onde a CVT esquenta), raio das curvas e comprimento das retas da pista — que definem a faixa de velocidade de uso e a relação de transmissão do carro novo. Mostra aos juízes que a equipe mede a pista real, não uma pista imaginada.',
    limits: 'Resolução de ~0,86 m por passo e 4 Hz: bom para traçado, velocidade média e voltas; aceleração e raio saem como ordem de grandeza. Fora da área (código 0 ou 255) a posição trava na borda. A configuração da pista no app tem que ser igual à do track_config.h gravado no PIC.',
    test: 'Para conferir os eixos: ande para o Norte — o Y tem que subir. Ligue o fundo de satélite e veja se o traçado cai em cima da pista.',
    related: ['quality.gpsBorder', 'quality.gpsCalibration', 'laps.delta', 'dyn.gg'],
  },
  {
    id: 'channel.roughness',
    title: 'Rugosidade da pista (canal calculado)',
    what: 'O quanto a pista “sacode” a suspensão em cada instante: o valor RMS (raiz da média dos quadrados) em 1 s da velocidade dos amortecedores, em mm/s. Pintando o mapa com ele aparecem os trechos duros.',
    sensors: [
      ...SHOCKS_REQ('velocidade de cada amortecedor (gravada pela FT ou derivada da posição); entra a média dos que têm sinal'),
      { id: 'gps', need: 'improves', why: 'para pintar o mapa e saber onde fica cada trecho' },
    ],
    how: 'Para cada amortecedor com sinal, média móvel de 1 s de v² (v em mm/s); rugosidade = √(média entre os amortecedores). Na ficha do projeto: mediana e percentil 95 com o carro andando.',
    design: 'Classifica os trechos da pista pela severidade para a suspensão: os de percentil 95 alto definem a faixa de alta velocidade da válvula do amortecedor e a fadiga de bandejas e fixações. Use os trechos mais duros como perfil de entrada dos ensaios de durabilidade do carro novo e para comparar ajustes: mesmo trecho e mesma velocidade com rugosidade menor = suspensão filtrando melhor.',
    limits: 'É a resposta da suspensão, não o perfil da pista: muda com a velocidade e com o ajuste. A 25 Hz os picos de impacto saem subestimados.',
    test: 'Passe pelos mesmos trechos em velocidades diferentes para separar o efeito da pista do da velocidade.',
    related: ['susp.travelUsed', 'freq.roadWavelength', 'track.gpsPosition'],
  },
  /* ================================================================ qualidade dos dados */
  {
    id: 'quality.gpsBorder',
    title: 'GPS na borda da área',
    what: 'A fração do tempo em que o código de posição do PIC ficou travado em 0 ou 255: o carro saiu da área definida no track_config.h e a posição gravada é a borda, não onde ele estava.',
    sensors: [{ id: 'gps', need: 'required', why: 'os códigos X/Y do PIC' }],
    how: 'Uma amostra está na borda se o código de X ou de Y (código = V × 51) está abaixo de 0,5 ou acima de 254,5 (no BUSMASTER, se o código calculado da lat/lon dá 0 ou 255). Porcentagem = amostras na borda ÷ amostras com posição válida.',
    design: 'É ajuste da aquisição, não do carro — mas sem ele mapa, voltas, velocidade e acelerações saem erradas nesses trechos. A área é vão = tamanho + 2·margem por eixo, dividido em 255 passos: dobrar a área dobra o passo (0,86 m → 1,7 m). O ideal é a menor área que cobre a pista inteira com margem para o erro do GPS. Para cada pista nova (ex.: a da competição), meça tamanho e centro no Google Maps antes e grave o PIC.',
    limits: 'Com centro automático (TRACK_CENTER_FIXED = 0), o centro é onde o carro estava ao ligar; se ligar na ponta da pista, metade da área fica fora — por isso o vão dobra nesse modo.',
    test: 'Antes da prova: uma volta devagar e conferir no app que nenhuma amostra fica na borda.',
    related: ['track.gpsPosition', 'quality.gpsCalibration'],
  },
  {
    id: 'quality.gpsCalibration',
    title: 'Calibração das entradas 7 e 8 na FT',
    what: 'Se a FT está gravando a posição do GPS no formato certo. O PIC manda o código 0–255 como 0–5000 mV virtuais e a FT aplica a calibração da entrada do FT Manager antes de gravar.',
    sensors: [{ id: 'gps', need: 'required', why: 'canais Back_pressure (X) e O2_General (Y)' }],
    how: 'O app detecta o formato pelo conteúdo: 0–5,2 = volts (código = V × 51), inteiros 0–255 = código, até 5200 = mV (código = mV × 0,051), senão metros. Valor travado em exatamente 1,000 no mínimo indica a calibração “1 V = 1”.',
    design: 'Recomendado: entrada linear 0–5 V com 0,00 V = 0 e 5,00 V = 5 (o log fica em volts e o app converte). Evite “1 V = 1”: o PIC trava o valor no ponto mínimo da calibração (input_value() em ft_expander.c) e tudo abaixo de 1 V (código < 51, ~66 m a Oeste/Sul do centro com 220 m de vão) vira 1,000. Metros direto não cabe: a FT guarda 3 casas em 16 bits (máx. ±32,767).',
    test: 'Com o carro parado no centro da pista, os dois canais devem ler ~2,5 V (código ~128).',
    related: ['track.gpsPosition', 'quality.gpsBorder'],
  },
  {
    id: 'quality.validSamples',
    title: 'Amostras válidas do canal',
    what: 'Quantas amostras do canal têm dado de verdade. A FT grava 1,797…e308 quando não há valor naquela linha; o app trata como “sem dado”.',
    sensors: [{ id: 'logger', need: 'required', why: 'o datalogger que grava (ou não) cada canal' }],
    how: '% válido = amostras com número ÷ amostras do log. Taxa = amostras válidas ÷ duração entre a primeira e a última.',
    design: 'Canal com poucas amostras fica fora das análises (ou com trechos faltando). Antes de uma sessão de testes importante, confira no app que todos os sensores do carro aparecem com ~100 % de amostras.',
    limits: 'Um canal pode ter 100 % de amostras e mesmo assim estar sem sinal (constante) ou travado: veja os outros avisos.',
    related: ['quality.sampleRate', 'quality.constant'],
  },
  {
    id: 'quality.sampleRate',
    title: 'Taxa de gravação e de atualização',
    what: 'A que taxa o log grava (amostras por segundo) e a que taxa cada sinal muda de fato. O GPS, por exemplo, muda a 4 Hz mesmo gravado a 25 Hz.',
    sensors: [
      { id: 'logger', need: 'required', why: 'a taxa de gravação da FT' },
      { id: 'gps', need: 'improves', why: 'a posição é atualizada pelo módulo a 4 Hz' },
    ],
    how: 'Taxa do log = 1 / mediana do passo de tempo. Taxa de atualização efetiva de um canal = 1 / (10º percentil do intervalo entre mudanças de valor), contando só trechos sem buracos de mais de 1 s.',
    design: 'Pelo teorema da amostragem (Nyquist), a 25 Hz só se enxerga até 12,5 Hz: dá para ver a carroceria (1–3 Hz), mas não a roda/pneu (8–15 Hz) nem o pico real de um impacto. Para o carro novo, se a FT permitir, grave os amortecedores a ≥ 100 Hz; e prefira a velocidade do amortecedor gravada pela FT à derivada da posição.',
    limits: 'O 10º percentil subestima a taxa de sinais que mudam devagar (temperatura) — para eles a taxa importa pouco.',
    related: ['quality.validSamples', 'susp.naturalFreq'],
  },
  {
    id: 'quality.timeGaps',
    title: 'Buracos no tempo do log',
    what: 'Trechos em que o datalogger parou de gravar (o tempo pula mais que 10 amostras, no mínimo 0,5 s).',
    sensors: [{ id: 'logger', need: 'required', why: 'a base de tempo do log' }],
    how: 'Conta os passos de tempo maiores que max(0,5 s, 10 × passo mediano) e soma a duração.',
    design: 'Eventos dentro de um buraco (um salto, uma batida no fim de curso) se perdem. Buracos repetidos costumam ser queda de tensão na FT (bateria, chicote) — vale rever a alimentação no chicote do carro novo.',
    related: ['quality.sampleRate'],
  },
  {
    id: 'quality.constant',
    title: 'Canal constante (sensor sem sinal)',
    what: 'O canal ficou com o mesmo valor o log inteiro: o sensor não mandou sinal (desligado, cabo rompido, sem 5 V) ou a entrada está mal calibrada.',
    sensors: [{ id: 'logger', need: 'required', why: 'o canal gravado pela FT' }],
    how: 'Constante = nenhuma amostra com dado, ou máximo − mínimo do canal < 1e-9 (as amostras sem dado não contam). Canal constante fica fora das análises (ex.: amortecedor constante não é “ativo”).',
    design: 'Um sensor parado tira do projeto todas as análises que dependem dele (veja a matriz sensor × análise). Para o carro novo: conectores com trava, cabos presos longe das partes móveis e um check de sensores no app antes de cada saída.',
    related: ['quality.validSamples', 'quality.stuck'],
  },
  {
    id: 'quality.stuck',
    title: 'Sensor travado com o carro andando',
    what: 'Trechos em que o canal ficou exatamente no mesmo valor por 2 s ou mais com o carro andando (60 s para a temperatura da CVT). Um potenciômetro de suspensão com o carro em movimento nunca fica parado assim.',
    sensors: [
      { id: 'gps', need: 'required', why: 'diz quando o carro está andando (andou ≥ 3 m em 3 s)' },
      { id: 'wheel', need: 'alternative', why: 'sem GPS, andando = roda acima de 0,8 m/s; com a roda, detecta também o GPS congelado' },
    ],
    how: 'Percorre as amostras válidas; o trecho continua enquanto o valor é idêntico, sem buraco maior que 1 s e com o carro andando. Trechos com duração ≥ limite viram aviso.',
    design: 'Mau contato, cursor do potenciômetro gasto ou sensor no fim do curso mecânico (o sensor tem que ter mais curso que o amortecedor). No carro novo: curso do sensor com folga, fixação que não flexiona e proteção contra lama.',
    related: ['quality.constant', 'quality.jumps'],
  },
  {
    id: 'quality.jumps',
    title: 'Saltos impossíveis',
    what: 'Variações entre duas amostras seguidas que o carro não consegue fazer (ex.: amortecedor andando mais de 6 m/s, roda mudando mais de 8 g, CVT pulando mais de 5 °C de uma amostra para a outra, GPS pulando 15 m num passo) e valores fora da faixa física.',
    sensors: [{ id: 'logger', need: 'required', why: 'o canal gravado (o sensor de cada canal aparece no aviso)' }],
    how: '|Δvalor| > limite × Δt entre amostras válidas seguidas (Δt ≤ 1 s); na CVT, também > 5 °C (o ruído do sensor a 25 Hz é de décimos de grau). GPS em metros: |Δ| > max(15 m, 25 m/s × Δt). Faixa física: roda entre −1 e 150 km/h, CVT entre −30 e 300 °C.',
    design: 'Quase sempre é ruído elétrico: no chicote do carro novo, cabos de sinal blindados (malha aterrada num ponto só), longe da bobina e da vela, e terra dos sensores no mesmo ponto da FT.',
    related: ['quality.stuck', 'quality.validSamples'],
  },
  {
    id: 'quality.staticRef',
    title: 'Referência estática dos amortecedores',
    what: 'A posição de cada amortecedor com o carro parado no chão (altura de rodagem). É o zero de onde se mede compressão (+) e extensão (−).',
    sensors: [
      ...SHOCKS_REQ('posição de cada amortecedor'),
      { id: 'gps', need: 'required', why: 'acha o carro parado' },
      { id: 'wheel', need: 'alternative', why: 'sem GPS, parado pela roda' },
    ],
    how: 'Mediana da posição nas amostras com o carro parado (precisa de ≥ 25); sem isso, a mediana do log inteiro (que fica deslocada se o carro passou o tempo todo em compressão).',
    design: 'O estático mede o “sag” real com piloto: quanto curso sobra para compressão e para extensão. Compare com o projeto (CAD) para acertar a pré-carga das molas do carro novo.',
    test: 'Grave ~5 s parado no começo de cada log, carro no chão e piloto sentado.',
    related: ['susp.travelUsed'],
  },
  {
    id: 'quality.carData',
    title: 'Dados do carro que faltam',
    what: 'Medidas do carro que ainda não foram informadas em Carro e que transformam as medidas dos sensores em números de projeto.',
    sensors: [{ id: 'car_data', need: 'required', why: 'massa, geometria, relação roda/amortecedor, curso e massa suspensa' }],
    how: 'Confere se relação roda/amortecedor, curso total e massa suspensa por roda estão preenchidos (> 0) para os dois eixos.',
    design: 'Sem a relação roda/amortecedor a rolagem sai subestimada; sem o curso total não há % do curso nem fim de curso; sem a massa suspensa não há rigidez nem amortecimento na roda. Meça na oficina: massa com piloto, massa suspensa por roda (balança por roda menos a massa não suspensa), relação roda/amortecedor, curso total, bitolas e entre-eixos — e compare com o CAD do carro novo.',
    related: ['susp.rollGradient', 'susp.naturalFreq', 'susp.travelUsed'],
  },
];

/* cards dos sensores, gerados do catálogo */
const sensorEntries = (): ExplainEntry[] => {
  const matrix = sensorMatrix();
  return SENSOR_IDS.map(id => {
    const s = SENSORS[id];
    const items = matrix.find(r => r.sensor === id)?.items || [];
    return {
      id: 'sensor.' + id,
      title: s.name + (s.planned ? ' (sugerido)' : ''),
      what: `${s.where} Serve para: ${s.purpose}.`,
      sensors: [{ id, need: 'required', why: 'é o próprio sensor' }],
      how: `${s.signal} Taxa: ${s.rate}.${s.resolution ? ' Resolução: ' + s.resolution + '.' : ''}`,
      design: (s.planned ? 'Ainda não instalado. Destravaria: ' : 'No projeto do carro novo: ') + (s.unlocks || []).join('; ') + '.',
      limits: s.planned ? 'Sensor sugerido: as análises dele aparecem quando um canal com esse sinal estiver no log.' : undefined,
      related: items.map(x => x.explain).filter(x => x !== 'sensor.' + id),
    };
  });
};

/** Catálogo de explicações por id. */
export const EXPLAIN: Record<string, ExplainEntry> = Object.fromEntries([...ENTRIES, ...sensorEntries()].map(e => [e.id, e]));

/** Card pelo id (undefined se não existir). */
export const getExplain = (id: string): ExplainEntry | undefined => (Object.hasOwn(EXPLAIN, id) ? EXPLAIN[id] : undefined);

/** Sensores usados por um card, no formato dos chips (ids sem repetir). */
export const explainSensorIds = (id: string): SensorId[] => {
  const e = getExplain(id);
  return e ? e.sensors.map(s => s.id).filter((x, i, a) => a.indexOf(x) === i) : [];
};
