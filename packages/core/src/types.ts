/* Tipos compartilhados do @baja/core (docs/ARQUITETURA.md 3.3 e 3.8).
 * Os valores padrão moram nos módulos de origem: DEFAULT_CFG em gps.ts, DEFAULT_SUSP em
 * analysis.ts, DEFAULT_CAR em vehicle.ts. */

/** Ponto no plano local da pista (m, x = Leste, y = Norte). */
export interface Pt { x: number; y: number }

/** Origem do canal: do log, calculado do GPS, calculado (veículo/suspensão) ou fórmula do usuário. */
export type ChannelSrc = 'log' | 'gps' | 'calc' | 'formula';

/** Canal antes de finishChannel (sem a faixa calculada). */
export interface ChannelInput {
  key: string;
  name: string;
  unit: string;
  data: Float64Array;
  src: ChannelSrc;
  group?: string;
}

/** Canal pronto: faixa (ignorando NaN), número de amostras válidas e se é constante. */
export interface Channel extends ChannelInput {
  lo: number;
  hi: number;
  count: number;
  constant: boolean;
}

/** Sessão (resultado de qualquer parser). */
export interface Session {
  name: string;
  kind: 'FT' | 'BUSMASTER';
  t: Float64Array;                                  /* tempo em s */
  channels: Channel[];
  gps?: { lat: Float64Array; lon: Float64Array };   /* só BUSMASTER: posição real do módulo */
  clock0?: string;                                  /* só BUSMASTER: hora do primeiro quadro */
  info: string;                                     /* texto curto para o cabeçalho */
  demo?: boolean;
}

/** Formato do valor de GPS no log ('auto' = detectar pelo canal). */
export type GpsFmt = 'V' | 'mV' | 'code' | 'm';

/** Pista / GPS (campos de DEFAULT_CFG, track_config.h). */
export interface TrackConfig {
  lat0: number;
  lon0: number;
  centerFixed: boolean;
  sizeX: number;
  sizeY: number;
  margin: number;
  chX: string;
  chY: string;
  chStatus: string;
  fmt: 'auto' | GpsFmt;
  smooth: number;          /* s, média móvel da posição */
  minLap: number;          /* s, volta mínima */
  line: Pt[] | null;       /* linha de largada (2 pontos) */
}

/** Suspensão (campos de DEFAULT_SUSP). Curso/massa/MR migraram para o carro: aqui só
 *  aparecem em configurações antigas (normalizeConfig apaga). */
export interface SuspConfig {
  compPos: boolean;        /* posição aumenta quando o amortecedor comprime */
  knee: number;            /* mm/s: separa baixa / alta velocidade no histograma */
  moving: boolean;         /* histogramas só com o carro andando (> 3 km/h) */
  strokeF?: number;
  strokeR?: number;
  massF?: number;
  massR?: number;
  mrF?: number;
  mrR?: number;
  fmin: number;            /* banda onde procurar a frequência da carroceria (Hz) */
  fmax: number;
}

/** Dados do carro (campos de DEFAULT_CAR). */
export interface CarConfig {
  mass: number;            /* kg, carro + piloto */
  wb: number;              /* entre-eixos, mm */
  trackF: number;          /* bitola, mm */
  trackR: number;
  mrF: number;             /* relação roda/amortecedor; 0 = não informado */
  mrR: number;
  strokeF: number;         /* curso total do amortecedor, mm */
  strokeR: number;
  massF: number;           /* massa suspensa por roda, kg */
  massR: number;
  wheelCh: string;
  wheelDriven: boolean;
  cvtCh: string;
  tAmb: number;
  tCvtMax: number;
  endurance: number;
  crr: number;
  cda: number;
  rho: number;
  power: number;           /* kW no motor */
}

/** Canal calculado pelo usuário (formulas.ts). */
export interface Formula {
  id: string;
  name: string;
  unit: string;
  expr: string;
}

export type AnalysisConfig = TrackConfig & { susp: SuspConfig; car: CarConfig; formulas?: Formula[] };

/** Sensores e entradas do carro (catálogo em sensors.ts). */
export type SensorId =
  | 'gps' | 'shock_fl' | 'shock_fr' | 'shock_rl' | 'shock_rr' | 'wheel' | 'cvt_temp' | 'logger' | 'car_data'
  | 'engine_rpm' | 'imu' | 'brake_pressure' | 'steering' | 'throttle';
