/* Qualidade dos dados (docs/ARQUITETURA.md 3.5): por canal do log, o papel detectado
 * (GPS X/Y, amortecedor, roda, CVT, ...), amostras válidas, taxa efetiva, faixa, trechos
 * travados e saltos impossíveis; e a lista de avisos com nível, texto, o que fazer, o card
 * de explicação e os sensores envolvidos.
 *
 * Os papéis saem das mesmas regras que as contas usam (guessGpsChannels, findShocks,
 * findWheelCh/findCvtCh e os canais escolhidos em cfg.car), então "papel detectado" aqui
 * é exatamente o canal que entrou em cada análise. */
import type { CarConfig, Channel, GpsFmt, SensorId, Session, TrackConfig } from './types';
import type { ActiveShock, CornerId } from './analysis';
import type { SessionContext } from './pipeline';
import { guessGpsChannels, detectFmt, toCode, spanOf } from './gps';
import { findShocks, CORNERS } from './analysis';
import { findWheelCh, findCvtCh } from './vehicle';

/** Papel de um canal do log. */
export type ChannelRole =
  | 'gps_x' | 'gps_y' | 'gps_status'
  | 'gps_lat' | 'gps_lon' | 'gps_sats' | 'gps_fix' | 'gps_pic_x' | 'gps_pic_y'
  | `shock_pos_${CornerId}` | `shock_vel_${CornerId}`
  | 'wheel' | 'cvt_temp'
  | 'engine_rpm' | 'throttle' | 'brake_pressure' | 'steering' | 'imu';

export const CHANNEL_ROLES: ChannelRole[] = [
  'gps_x', 'gps_y', 'gps_status',
  'gps_lat', 'gps_lon', 'gps_sats', 'gps_fix', 'gps_pic_x', 'gps_pic_y',
  'shock_pos_FL', 'shock_pos_FR', 'shock_pos_RL', 'shock_pos_RR',
  'shock_vel_FL', 'shock_vel_FR', 'shock_vel_RL', 'shock_vel_RR',
  'wheel', 'cvt_temp', 'engine_rpm', 'throttle', 'brake_pressure', 'steering', 'imu',
];

/** Nome do papel para a interface. */
export const ROLE_LABEL: Record<ChannelRole, string> = {
  gps_x: 'GPS X (Leste, entrada 7)', gps_y: 'GPS Y (Norte, entrada 8)', gps_status: 'Status do GPS',
  gps_lat: 'GPS · latitude (CAN 0x028)', gps_lon: 'GPS · longitude (CAN 0x028)', gps_sats: 'GPS · satélites (CAN 0x023)',
  gps_fix: 'GPS · tipo de fix (CAN 0x023)', gps_pic_x: 'PIC · código X (CAN 0x7E9)', gps_pic_y: 'PIC · código Y (CAN 0x7E9)',
  shock_pos_FL: 'Amortecedor diant. esq. · posição', shock_pos_FR: 'Amortecedor diant. dir. · posição',
  shock_pos_RL: 'Amortecedor tras. esq. · posição', shock_pos_RR: 'Amortecedor tras. dir. · posição',
  shock_vel_FL: 'Amortecedor diant. esq. · velocidade', shock_vel_FR: 'Amortecedor diant. dir. · velocidade',
  shock_vel_RL: 'Amortecedor tras. esq. · velocidade', shock_vel_RR: 'Amortecedor tras. dir. · velocidade',
  wheel: 'Velocidade da roda', cvt_temp: 'Temperatura da CVT',
  engine_rpm: 'Rotação do motor', throttle: 'Posição do acelerador', brake_pressure: 'Pressão de freio',
  steering: 'Ângulo do volante', imu: 'IMU (aceleração / giro)',
};

/** Sensor físico de cada papel (catálogo em sensors.ts). */
export const ROLE_SENSOR: Record<ChannelRole, SensorId> = {
  gps_x: 'gps', gps_y: 'gps', gps_status: 'gps',
  gps_lat: 'gps', gps_lon: 'gps', gps_sats: 'gps', gps_fix: 'gps', gps_pic_x: 'gps', gps_pic_y: 'gps',
  shock_pos_FL: 'shock_fl', shock_pos_FR: 'shock_fr', shock_pos_RL: 'shock_rl', shock_pos_RR: 'shock_rr',
  shock_vel_FL: 'shock_fl', shock_vel_FR: 'shock_fr', shock_vel_RL: 'shock_rl', shock_vel_RR: 'shock_rr',
  wheel: 'wheel', cvt_temp: 'cvt_temp',
  engine_rpm: 'engine_rpm', throttle: 'throttle', brake_pressure: 'brake_pressure', steering: 'steering', imu: 'imu',
};

/* canais do GPS no log do BUSMASTER (parseBusmaster): nome do canal → papel */
const BUSMASTER_GPS: [string, ChannelRole][] = [
  ['GPS · latitude', 'gps_lat'], ['GPS · longitude', 'gps_lon'], ['GPS · satélites', 'gps_sats'], ['GPS · tipo de fix', 'gps_fix'],
  ['PIC · X (código)', 'gps_pic_x'], ['PIC · Y (código)', 'gps_pic_y'], ['PIC · status GPS', 'gps_status'],
];

/** Papéis do GPS que só existem no log do BUSMASTER (quadros do módulo e do PIC). */
const BM_GPS_ROLES = new Set<ChannelRole>(BUSMASTER_GPS.map(x => x[1]).filter(r => r !== 'gps_status'));

/** Abaixo disso (mm de máx − mín da posição) um amortecedor com sinal está "quase parado":
 *  potenciômetro solto, travado ou mal calibrado (ou o carro parado no trecho). Vale para a
 *  qualidade (log inteiro), para suspensionReport (trecho) e para a interface. */
export const SHOCK_STILL_MM = 1;

/* sensores ainda não instalados: reconhecidos pelo nome do canal, se aparecerem no log */
const PLANNED_RE: [ChannelRole, RegExp][] = [
  ['engine_rpm', /rpm|rota[cç][aã]o|engine.?speed/i],
  ['throttle', /tps|throttle|acelerador|borboleta/i],
  ['brake_pressure', /brake|freio/i],
  ['steering', /steer|volante|dire[cç][aã]o/i],
  ['imu', /imu|gyro|giro|accel|acelera[cç]|g.?force|^a(cc)?[_.]?[xyz]$/i],
];

/** Papéis dos canais desta sessão: papel → chave do canal. */
export type RoleMap = Partial<Record<ChannelRole, string>>;

/** Papel de cada canal do log, com as mesmas regras das contas. cfg = configuração já
 *  normalizada (canais X/Y e cfg.car.wheelCh/cvtCh); sem cfg, só pelos nomes. */
export function detectRoles(S: Session, cfg?: Pick<TrackConfig, 'chX' | 'chY' | 'chStatus'> & { car?: Pick<CarConfig, 'wheelCh' | 'cvtCh'> }): RoleMap {
  const roles: RoleMap = {};
  const keys = S.channels.map(c => c.key);
  const has = (k: string | undefined): k is string => !!k && keys.includes(k);
  if (!S.gps) {
    let x = cfg?.chX, y = cfg?.chY, st = cfg?.chStatus;
    if (!has(x) || !has(y)) { const g = guessGpsChannels(keys); x = g.x; y = g.y; st = g.status; }
    if (has(x)) roles.gps_x = x;
    if (has(y)) roles.gps_y = y;
    if (has(st)) roles.gps_status = st;
  } else {
    /* BUSMASTER: a posição vem de S.gps (lat/lon do 0x028); os canais do módulo e do PIC são do GPS */
    for (const [k, r] of BUSMASTER_GPS) if (has(k)) roles[r] = k;
  }
  findShocks(S.channels).forEach(k => {
    if (k.pos) roles[`shock_pos_${k.id}`] = k.pos.key;
    if (k.vel) roles[`shock_vel_${k.id}`] = k.vel.key;
  });
  /* roda e CVT: o canal escolhido em Carro, senão o achado pelo nome (= vehPrep) */
  const pick = (key: string | undefined, find: (chs: Channel[]) => Channel | null) => (key ? S.channels.find(c => c.key === key) : null) || find(S.channels);
  const w = pick(cfg?.car?.wheelCh, findWheelCh), c = pick(cfg?.car?.cvtCh, findCvtCh);
  if (w) roles.wheel = w.key;
  if (c) roles.cvt_temp = c.key;
  const used = new Set(Object.values(roles));
  for (const [role, re] of PLANNED_RE) {
    const cand = S.channels.filter(ch => ch.src === 'log' && !used.has(ch.key) && re.test(ch.key));
    const ch = cand.find(x => !x.constant) || cand[0];
    if (ch) { roles[role] = ch.key; used.add(ch.key); }
  }
  return roles;
}

/* ---------------------------------------------------------------- tipos */
export type QualityLevel = 'info' | 'warn' | 'error';

/** Aviso da qualidade dos dados. */
export interface QualityIssue {
  id: string;                    /* único na lista (ex.: 'gps.border', 'stuck:Shock_-_Front_Left') */
  level: QualityLevel;
  text: string;                  /* o que foi visto, com o número */
  action: string;                /* o que fazer */
  explain: string;               /* id do card de explicação (explain.ts) */
  sensors: SensorId[];
  channel?: string;              /* chave do canal, quando o aviso é de um canal */
  t?: number;                    /* instante para "ir ao ponto" (s), quando faz sentido */
}

/** Trecho em que o canal ficou com o mesmo valor com o carro andando. */
export interface StuckRun { i0: number; i1: number; t0: number; t1: number; value: number }
/** Salto impossível entre duas amostras válidas seguidas. */
export interface JumpEvent { i: number; t: number; from: number; to: number }

/** Qualidade de um canal do log. */
export interface ChannelQuality {
  key: string;
  name: string;
  unit: string;
  role: ChannelRole | null;
  roleLabel: string;             /* '' sem papel */
  sensor: SensorId | null;
  n: number;                     /* amostras no log */
  valid: number;                 /* amostras com dado */
  validPct: number;              /* % */
  rateHz: number;                /* amostras válidas por segundo (NaN com < 2) */
  updateHz: number;              /* taxa de atualização efetiva: 1 / (10º percentil do intervalo entre mudanças de valor); NaN com < 10 mudanças */
  lo: number;
  hi: number;
  constant: boolean;
  stuck: StuckRun[];
  stuckS: number;                /* s travado no total */
  jumps: JumpEvent[];            /* até 50 */
  jumpCount: number;
  outOfRange: number;            /* amostras fora da faixa física do papel */
  explain: string;               /* card do sensor (sensor.<id>) ou da qualidade */
}

export interface DataQuality {
  channels: ChannelQuality[];
  issues: QualityIssue[];
  roles: RoleMap;
  logRateHz: number;             /* 1 / mediana do passo de tempo */
  duration: number;              /* s */
  gpsBorderPct: number | null;   /* % das posições válidas na borda da área (null sem trajetória) */
  gpsUpdateHz: number;           /* taxa efetiva da posição (NaN sem GPS) */
}

/* ---------------------------------------------------------------- limites físicos */
const STUCK_S = 2;                     /* mesmo valor ≥ 2 s com o carro andando */
/* papéis em que valor parado é normal por mais tempo (inércia térmica) ou sempre */
const stuckLimit = (role: ChannelRole | null): number =>
  role === 'cvt_temp' ? 60 : role && ROLE_SENSOR[role] === 'gps' ? Infinity : STUCK_S;
/* variação máxima possível por segundo (unidades do canal), por papel */
/* minStep: o ruído do sensor nunca passa disso entre duas amostras (a temperatura tem ruído
 * de décimos de grau a 25 Hz, que em °C/s parece rápido) */
const JUMP_RATE: Partial<Record<ChannelRole, { units: string[]; perS: number; minStep?: number; what: string }>> = {
  shock_pos_FL: { units: ['', 'mm'], perS: 6000, what: '6 m/s de velocidade do amortecedor' },
  shock_pos_FR: { units: ['', 'mm'], perS: 6000, what: '6 m/s de velocidade do amortecedor' },
  shock_pos_RL: { units: ['', 'mm'], perS: 6000, what: '6 m/s de velocidade do amortecedor' },
  shock_pos_RR: { units: ['', 'mm'], perS: 6000, what: '6 m/s de velocidade do amortecedor' },
  shock_vel_FL: { units: ['', 'mm/s'], perS: 1.5e6, what: '150 g de aceleração do amortecedor' },
  shock_vel_FR: { units: ['', 'mm/s'], perS: 1.5e6, what: '150 g de aceleração do amortecedor' },
  shock_vel_RL: { units: ['', 'mm/s'], perS: 1.5e6, what: '150 g de aceleração do amortecedor' },
  shock_vel_RR: { units: ['', 'mm/s'], perS: 1.5e6, what: '150 g de aceleração do amortecedor' },
  wheel: { units: ['', 'km/h'], perS: 282, what: '8 g de aceleração da roda' },
  cvt_temp: { units: ['', '°C', 'C', 'ºC'], perS: 20, minStep: 5, what: 'mais de 5 °C de uma amostra para a outra e 20 °C/s' },
};
/* faixa física (amostras fora contam como impossíveis) */
const PHYS_RANGE: Partial<Record<ChannelRole, { units: string[]; lo: number; hi: number }>> = {
  wheel: { units: ['', 'km/h'], lo: -1, hi: 150 },
  cvt_temp: { units: ['', '°C', 'C', 'ºC'], lo: -30, hi: 300 },
};
const GPS_JUMP_M = 15, GPS_VMAX = 25;  /* m num passo; m/s (90 km/h) para passos mais longos */

/* ---------------------------------------------------------------- contas por canal */
const uniq = <T,>(a: T[]): T[] => a.filter((x, i) => a.indexOf(x) === i);
const pct = (a: number, b: number) => (b > 0 ? a / b * 100 : 0);
const f1 = (v: number) => (v === v && isFinite(v) ? v.toFixed(1) : '—');
const f0 = (v: number) => (v === v && isFinite(v) ? v.toFixed(0) : '—');

function rates(t: Float64Array, d: Float64Array): { rateHz: number; updateHz: number; valid: number } {
  let valid = 0, first = -1, last = -1, prev = -1;
  const changes: number[] = [];
  let lastChange = NaN;
  for (let i = 0; i < d.length; i++) {
    if (d[i] !== d[i]) continue;
    valid++;
    if (first < 0) first = i;
    if (prev >= 0) {
      if (t[i] - t[prev] > 1) lastChange = NaN;            /* buraco: recomeça */
      else if (d[i] !== d[prev]) {
        if (lastChange === lastChange) changes.push(t[i] - lastChange);
        lastChange = t[i];
      }
    }
    prev = last = i;
  }
  const dur = last > first ? t[last] - t[first] : 0;
  changes.sort((a, b) => a - b);
  const q = changes.length >= 10 ? changes[Math.floor(0.1 * (changes.length - 1))] : NaN;
  return { valid, rateHz: dur > 0 ? (valid - 1) / dur : NaN, updateHz: q > 0 ? 1 / q : NaN };
}

/* trechos com o mesmo valor; quebra em NaN longo (> 1 s), em mudança de valor e quando o carro para */
function stuckRuns(t: Float64Array, d: Float64Array, moving: (i: number) => boolean, minS: number): StuckRun[] {
  const out: StuckRun[] = [];
  if (!isFinite(minS)) return out;
  let rs = -1, rl = -1;
  const close = () => { if (rs >= 0 && t[rl] - t[rs] >= minS) out.push({ i0: rs, i1: rl, t0: t[rs], t1: t[rl], value: d[rs] }); };
  for (let i = 0; i < d.length; i++) {
    if (d[i] !== d[i]) continue;
    if (!moving(i)) { close(); rs = rl = -1; continue; }
    if (rs >= 0 && d[i] === d[rs] && t[i] - t[rl] <= 1) { rl = i; continue; }
    close();
    rs = rl = i;
  }
  close();
  return out;
}

function jumpEvents(t: Float64Array, d: Float64Array, limit: (dt: number) => number, toUnit: (v: number) => number = v => v): { list: JumpEvent[]; count: number } {
  const list: JumpEvent[] = [];
  let count = 0, prev = -1;
  for (let i = 0; i < d.length; i++) {
    if (d[i] !== d[i]) continue;
    if (prev >= 0) {
      const dt = t[i] - t[prev];
      if (dt <= 1 && Math.abs(toUnit(d[i]) - toUnit(d[prev])) > limit(Math.max(dt, 0.01))) {
        count++;
        if (list.length < 50) list.push({ i, t: t[i], from: d[prev], to: d[i] });
      }
    }
    prev = i;
  }
  return { list, count };
}

/* ---------------------------------------------------------------- qualidade da sessão */
/** Qualidade dos dados de uma sessão já calculada (ctx de computeSession). */
export function dataQuality(S: Session, ctx: Pick<SessionContext, 'cfg' | 'track' | 'stopped' | 'veh' | 'susp'>): DataQuality {
  const t = S.t, n = t.length, cfg = ctx.cfg, car = cfg.car, tr = ctx.track;
  const roles = detectRoles(S, cfg);
  const roleOf = new Map<string, ChannelRole>();
  (Object.keys(roles) as ChannelRole[]).forEach(r => { const k = roles[r]!; if (!roleOf.has(k)) roleOf.set(k, r); });
  const issues: QualityIssue[] = [];
  const add = (x: QualityIssue) => { if (!issues.some(y => y.id === x.id)) issues.push(x); };

  /* tempo: taxa do log e buracos */
  const dts: number[] = [];
  for (let i = 1; i < n; i++) dts.push(t[i] - t[i - 1]);
  const sdt = dts.slice().sort((a, b) => a - b);
  const mdt = sdt.length ? sdt[sdt.length >> 1] : NaN;
  const logRateHz = mdt > 0 ? 1 / mdt : NaN;
  const duration = n > 1 ? t[n - 1] - t[0] : 0;

  /* carro andando: pela máscara de parado (GPS; sem GPS, pela roda) */
  const stopped = ctx.stopped;
  const moving = (i: number) => !!stopped && !stopped[i];
  const movSrc: SensorId = tr.ok ? 'gps' : 'wheel';        /* de onde veio a máscara de parado */

  /* GPS: formato e resolução para os saltos em metros */
  const span = spanOf(cfg), res = { x: span.x / 255, y: span.y / 255 };
  const gpsFmt = (key: string): GpsFmt => (tr.fmt && !S.gps ? tr.fmt : detectFmt(S.channels.find(c => c.key === key)!.data));

  const channels: ChannelQuality[] = S.channels.map(c => {
    const role = roleOf.get(c.key) || null;
    const sensor = role ? ROLE_SENSOR[role] : null;
    const r = rates(t, c.data);
    let stuck: StuckRun[] = [];
    if (!c.constant && stopped) stuck = stuckRuns(t, c.data, moving, stuckLimit(role));
    let jumps: { list: JumpEvent[]; count: number } = { list: [], count: 0 };
    if (role === 'gps_x' || role === 'gps_y') {
      const fmt = gpsFmt(c.key), step = role === 'gps_x' ? res.x : res.y;
      jumps = jumpEvents(t, c.data, dt => Math.max(GPS_JUMP_M, GPS_VMAX * dt), v => (fmt === 'm' ? v : toCode(v, fmt) * step));
    } else if (role && JUMP_RATE[role] && JUMP_RATE[role]!.units.includes(c.unit)) {
      const lim = JUMP_RATE[role]!.perS, min = JUMP_RATE[role]!.minStep || 0;
      jumps = jumpEvents(t, c.data, dt => Math.max(min, lim * dt));
    }
    let outOfRange = 0;
    const pr = role ? PHYS_RANGE[role] : undefined;
    if (pr && pr.units.includes(c.unit)) for (let i = 0; i < n; i++) { const v = c.data[i]; if (v === v && (v < pr.lo || v > pr.hi)) outOfRange++; }
    return {
      key: c.key, name: c.name, unit: c.unit, role, roleLabel: role ? ROLE_LABEL[role] : '', sensor,
      n, valid: r.valid, validPct: pct(r.valid, n), rateHz: r.rateHz, updateHz: r.updateHz,
      lo: c.lo, hi: c.hi, constant: c.constant,
      stuck, stuckS: stuck.reduce((s, x) => s + (x.t1 - x.t0), 0),
      jumps: jumps.list, jumpCount: jumps.count, outOfRange,
      explain: sensor ? 'sensor.' + sensor : 'quality.validSamples',
    };
  });
  const cq = (key: string | undefined) => (key ? channels.find(c => c.key === key) : undefined);

  /* ---------- logger */
  if (n < 2) add({ id: 'log.short', level: 'error', text: 'O log tem menos de 2 amostras.', action: 'Grave de novo: confira se o datalogger da FT estava ligado e gravando.', explain: 'quality.sampleRate', sensors: ['logger'] });
  if (logRateHz === logRateHz && logRateHz < 50) {
    add({
      id: 'log.rate', level: 'info',
      text: `Log gravado a ${f0(logRateHz)} Hz: só enxerga oscilações até ${f1(logRateHz / 2)} Hz (Nyquist). A frequência da roda (massa não suspensa, ~8–15 Hz) fica fora disso.`,
      action: 'Se a FT permitir, grave os amortecedores mais rápido (≥ 100 Hz) para ver o pneu/roda e os picos de velocidade nos impactos.',
      explain: 'quality.sampleRate', sensors: ['logger'],
    });
  }
  let gaps = 0, gapS = 0, gapT = NaN;
  const gapMin = Math.max(0.5, 10 * (mdt > 0 ? mdt : 0.04));
  for (let i = 1; i < n; i++) { const d = t[i] - t[i - 1]; if (d > gapMin) { gaps++; gapS += d; if (gapT !== gapT) gapT = t[i - 1]; } }
  if (gaps) {
    add({
      id: 'log.gaps', level: 'warn', t: gapT,
      text: `${gaps} buraco(s) no tempo do log (${f1(gapS)} s sem amostras, o primeiro em t = ${f1(gapT)} s).`,
      action: 'Confira a memória do datalogger e a alimentação da FT (queda de tensão reinicia a gravação). As contas pulam os buracos, mas eventos dentro deles se perdem.',
      explain: 'quality.timeGaps', sensors: ['logger'],
    });
  }

  /* ---------- GPS */
  let gpsBorderPct: number | null = null;
  const gx = cq(roles.gps_x), gy = cq(roles.gps_y);
  /* taxa da posição: X/Y da FT ou, no BUSMASTER, latitude/longitude do módulo (0x028) */
  const px = S.gps ? cq(roles.gps_lon) : gx, py = S.gps ? cq(roles.gps_lat) : gy;
  const gpsUpdateHz = px && py ? Math.max(px.updateHz === px.updateHz ? px.updateHz : 0, py.updateHz === py.updateHz ? py.updateHz : 0) || NaN : NaN;
  /* BUSMASTER sem nenhuma posição com fix 3D: aviso que diz o que o módulo mandou */
  let noFix = false;
  if (S.gps && !S.gps.lat.some(v => v === v)) {
    noFix = true;
    /* quantas posições o 0x028 trouxe (parseBusmaster escreve "N posições GPS (M com fix)" no info) */
    const mi = /(\d+) posições GPS \((\d+) com fix\)/.exec(S.info || '');
    const nPos = mi ? +mi[1] : null;
    const chan = (r: ChannelRole) => { const k = roles[r]; return k ? S.channels.find(c => c.key === k) : undefined; };
    const fixC = chan('gps_fix'), satC = chan('gps_sats'), stC = chan('gps_status');
    const det: string[] = [];
    if (fixC && fixC.count) {
      const seen = [...new Set(Array.from(fixC.data).filter(v => v === v))].sort((a, b) => a - b);
      det.push(seen.length === 1 ? `tipo de fix sempre ${seen[0]}${seen[0] < 3 ? ' (precisa de 3 = 3D)' : ''}` : `tipo de fix entre ${seen[0]} e ${seen[seen.length - 1]}`);
    }
    if (satC && satC.count) det.push(`no máximo ${satC.hi} satélite(s)`);
    if (stC && stC.count) {
      let n85 = 0;
      for (const v of stC.data) if (v === 85) n85++;
      if (n85) det.push(`status do PIC 85 (sem fix) em ${f0(pct(n85, stC.count))} % do tempo`);
    }
    const what = nPos === 0 ? 'O módulo GPS não mandou nenhuma posição (quadro 0x028) neste log'
      : `O módulo GPS mandou ${nPos === null ? 'posições' : nPos + ' posições'}, nenhuma com fix 3D`;
    add({
      id: 'gps.nofix', level: 'error',
      text: what + (det.length ? ': ' + det.join(', ') + '.' : '.') + ' Sem posição válida não há trajetória, mapa, voltas nem velocidade pelo GPS, e o GPS conta como ausente neste log.',
      action: nPos === 0
        ? 'Confira se o módulo GPS está ligado no barramento CAN (1 Mbps) e mandando o 0x028 a 4 Hz.'
        : 'Ligue o carro em céu aberto e espere o fix 3D (tipo de fix 3, status do PIC 255) antes de começar a gravar; confira a antena (longe do motor e de metal por cima) e o quadro 0x023 do módulo.',
      explain: 'quality.gpsFix', sensors: ['gps'],
    });
  }
  if (!S.gps && !(gx && gy)) {
    add({
      id: 'gps.missing', level: 'warn',
      text: 'Este log não tem os canais de posição do GPS (X/Y do expander).',
      action: 'Confira no FT Manager se as entradas 7 (X, Leste) e 8 (Y, Norte) do expander estão sendo gravadas, ou escolha os canais em Pista e GPS. Sem GPS não há mapa, voltas, aceleração lateral nem calibração da roda.',
      explain: 'track.gpsPosition', sensors: ['gps'],
    });
  } else if (!tr.ok && !noFix) {
    add({ id: 'gps.track', level: 'error', text: `Sem trajetória: ${tr.msg}`, action: S.gps ? 'Grave com o GPS com fix 3D (céu aberto, espere o fix antes de sair) e confira o quadro 0x023 do módulo.' : 'Confira os canais X/Y e o formato em Pista e GPS.', explain: 'track.gpsPosition', sensors: ['gps'] });
  }
  if (tr.ok) {
    let nv = 0, ns = 0, ts = NaN;
    for (let i = 0; i < n; i++) if (tr.valid[i]) { nv++; if (tr.sat[i]) { ns++; if (ts !== ts) ts = t[i]; } }
    gpsBorderPct = pct(ns, nv);
    if (ns) {
      const sp = spanOf(cfg);
      add({
        id: 'gps.border', level: gpsBorderPct > 1 ? 'warn' : 'info', t: ts,
        text: `GPS na borda da área em ${f1(gpsBorderPct)} % do tempo: o código travou em 0 ou 255 e a posição ali é falsa (área de ${f0(sp.x)} × ${f0(sp.y)} m).`,
        action: 'Aumente a margem (TRACK_MARGIN_M) ou o tamanho (TRACK_SIZE_X_M / TRACK_SIZE_Y_M) no track_config.h, ou corrija o centro (TRACK_CENTER_LAT/LON) para o meio da pista; grave o PIC de novo e use os mesmos números em Pista e GPS. Área maior = passo maior (vão ÷ 255).',
        explain: 'quality.gpsBorder', sensors: ['gps'],
      });
    }
    if (gpsUpdateHz === gpsUpdateHz && gpsUpdateHz < 3) {
      add({
        id: 'gps.rate', level: 'warn',
        text: `A posição do GPS muda no máximo a ${f1(gpsUpdateHz)} Hz (o módulo manda 4 Hz).`,
        action: S.gps
          ? 'Confira a taxa do módulo GPS (0x028 a 4 Hz) e se o barramento CAN não está perdendo quadros; com menos de 4 Hz a velocidade e o raio de curva perdem resolução.'
          : 'Confira a taxa do módulo GPS (0x028 a 4 Hz) e o período do bloco do expander que leva as entradas 7/8; com menos de 4 Hz a velocidade e o raio de curva perdem resolução.',
        explain: 'quality.sampleRate', sensors: ['gps', 'logger'],
      });
    }
    if (!S.gps && tr.fmt) {
      const fmt = tr.fmt;
      if (fmt === 'V') {
        for (const c of [gx, gy]) {
          if (!c) continue;
          const d = S.channels.find(x => x.key === c.key)!.data;
          let at1 = 0, nv1 = 0;
          for (let i = 0; i < n; i++) if (d[i] === d[i]) { nv1++; if (Math.abs(d[i] - 1) < 5e-4) at1++; }
          if (Math.abs(c.lo - 1) < 5e-4 && at1 > 0.02 * nv1) {
            add({
              id: 'gps.calib1V:' + c.key, level: 'warn', channel: c.key,
              text: `${c.name} fica travado em 1,000 em ${f0(pct(at1, nv1))} % das amostras: parece a calibração “1 V = 1” na FT.`,
              action: `Na FT (FT Manager, entrada linear 0–5 V) use 0,00 V = 0 e 5,00 V = 5. Com “1 V = 1” o PIC trava no ponto mínimo da calibração e tudo abaixo de 1 V (código < 51, mais de ~${f0((128 - 51) * span.x / 255)} m a Oeste/Sul do centro) se perde.`,
              explain: 'quality.gpsCalibration', sensors: ['gps'],
            });
          }
        }
      } else if (fmt === 'code' || fmt === 'mV') {
        add({
          id: 'gps.fmt', level: 'info',
          text: `Os canais do GPS estão em ${fmt === 'code' ? 'código 0–255' : 'mV (0–5000)'}; o app converte, mas o recomendado é o log em volts.`,
          action: 'Na FT (entrada linear 0–5 V) use 0,00 V = 0 e 5,00 V = 5: o log fica em volts e o app faz código = V × 51.',
          explain: 'quality.gpsCalibration', sensors: ['gps'],
        });
      } else if (fmt === 'm') {
        const sat = [gx, gy].some(c => c && (Math.abs(c.lo) > 32.7 || Math.abs(c.hi) > 32.7));
        add({
          id: 'gps.fmt', level: sat ? 'warn' : 'info',
          text: sat ? 'Os canais do GPS estão em metros e chegam em ±32,767: a FT guarda 3 casas em 16 bits e corta o valor.' : 'Os canais do GPS estão em metros direto da FT.',
          action: 'Metros não cabem nesses canais (máx. ±32,767). Use 0,00 V = 0 e 5,00 V = 5 na FT e deixe o app converter.',
          explain: 'quality.gpsCalibration', sensors: ['gps'],
        });
      }
    }
    /* GPS congelado com a roda dizendo que o carro anda */
    if (!S.gps && gx && gy && ctx.veh.src === 'roda' && ctx.veh.v) {
      const X = S.channels.find(c => c.key === gx.key)!.data, Y = S.channels.find(c => c.key === gy.key)!.data, v = ctx.veh.v;
      const both = Float64Array.from(X, (x, i) => (x === x && Y[i] === Y[i] ? x * 1e6 + Y[i] : NaN));
      const runs = stuckRuns(t, both, i => v[i] > 3, STUCK_S);
      if (runs.length) {
        const s = runs.reduce((a, r) => a + r.t1 - r.t0, 0);
        [gx, gy].forEach(c => { c.stuck = runs.map(r => ({ ...r, value: S.channels.find(x => x.key === c.key)!.data[r.i0] })); c.stuckS = s; });
        add({
          id: 'gps.frozen', level: 'warn', t: runs[0].t0,
          text: `Posição do GPS parada ${runs.length} vez(es) (${f1(s)} s) com a roda acima de 11 km/h.`,
          action: 'O GPS perdeu o fix ou o PIC parou de receber o 0x028 (status 85 = sem fix, 0 = sem dados). Confira a antena (céu aberto, longe do motor) e grave também o status do GPS (GPS_INPUT_STATUS no track_config.h).',
          explain: 'quality.stuck', sensors: ['gps', 'wheel'],
        });
      }
    }
  }

  /* ---------- por canal */
  for (const c of channels) {
    const sens: SensorId[] = c.sensor ? [c.sensor] : ['logger'];
    const lvl: QualityLevel = c.role ? 'warn' : 'info';
    /* latitude/longitude do BUSMASTER vazias = sem fix: o aviso gps.nofix já explica */
    const bmGps = !!c.role && BM_GPS_ROLES.has(c.role);
    if (!c.valid && bmGps && noFix) continue;
    if (!c.valid) {
      add({ id: 'empty:' + c.key, level: lvl, channel: c.key, text: `${c.name}: nenhuma amostra com dado.`, action: 'Confira se a entrada está configurada e gravando no FT Manager (a FT grava 1,797…e308 quando não há dado).', explain: 'quality.validSamples', sensors: sens });
      continue;
    }
    if (c.validPct < 50 && (c.role === 'gps_lat' || c.role === 'gps_lon')) {
      add({ id: 'valid:' + c.key, level: 'warn', channel: c.key, text: `${c.name}: só ${f0(c.validPct)} % das amostras com fix 3D.`, action: 'Espere o fix 3D antes de sair (céu aberto, antena longe do motor); sem fix a posição fica fora das contas.', explain: 'quality.gpsFix', sensors: sens });
    } else if (c.validPct < 50) {
      add({ id: 'valid:' + c.key, level: c.role ? 'warn' : 'info', channel: c.key, text: `${c.name}: só ${f0(c.validPct)} % das amostras têm dado.`, action: 'Confira a taxa de gravação desse canal na FT e o conector do sensor; trechos sem dado ficam fora das contas.', explain: 'quality.validSamples', sensors: sens });
    }
    /* status do GPS e os quadros do módulo/PIC podem ficar parados (sem fix, carro parado) */
    if (c.constant && c.role && c.role !== 'gps_status' && !bmGps) {
      add({ id: 'const:' + c.key, level: 'warn', channel: c.key, text: `${c.name} (${c.roleLabel}) ficou constante em ${c.lo}${c.unit ? ' ' + c.unit : ''} o log inteiro: o sensor não mandou sinal.`, action: 'Confira o cabo, o conector e a alimentação de 5 V do sensor e a calibração da entrada no FT Manager. Um canal constante fica fora das análises.', explain: 'quality.constant', sensors: sens });
    }
    if (c.stuck.length && c.role !== 'gps_x' && c.role !== 'gps_y') {
      add({
        id: 'stuck:' + c.key, level: lvl, channel: c.key, t: c.stuck[0].t0,
        text: `${c.name}: ${c.stuck.length} trecho(s) com o mesmo valor por ≥ ${f0(stuckLimit(c.role))} s com o carro andando (${f1(c.stuckS)} s no total, o primeiro em t = ${f1(c.stuck[0].t0)} s).`,
        action: 'Sensor travado: mau contato, cursor do potenciômetro gasto ou sensor no fim do curso mecânico. Confira o sensor nesse ponto do log e a fixação.',
        explain: 'quality.stuck', sensors: uniq([c.sensor || 'logger', movSrc]),
      });
    }
    if (c.jumpCount) {
      const why = c.role === 'gps_x' || c.role === 'gps_y' ? `mais de ${GPS_JUMP_M} m num passo (ou mais de 90 km/h)` : JUMP_RATE[c.role!]?.what || '';
      add({
        id: 'jump:' + c.key, level: 'warn', channel: c.key, t: c.jumps[0].t,
        text: `${c.name}: ${c.jumpCount} salto(s) impossível(is) entre amostras seguidas (${why}), o primeiro em t = ${f1(c.jumps[0].t)} s.`,
        action: 'Ruído elétrico ou mau contato: passe o cabo longe da bobina/vela e do motor, use cabo blindado com a malha num ponto só e confira o terra do sensor.',
        explain: 'quality.jumps', sensors: sens,
      });
    }
    if (c.outOfRange) {
      add({ id: 'range:' + c.key, level: 'warn', channel: c.key, text: `${c.name}: ${c.outOfRange} amostra(s) fora da faixa possível.`, action: 'Confira a calibração da entrada no FT Manager e o sensor.', explain: 'quality.jumps', sensors: sens });
    }
  }

  /* ---------- amortecedores */
  const act = ctx.susp.shocks.filter((k): k is ActiveShock => k.active);
  if (!act.length) {
    const any = ctx.susp.shocks.some(k => k.pos);
    add({
      id: 'susp.none', level: any ? 'warn' : 'info',
      text: any ? 'Os canais dos amortecedores existem mas nenhum tem sinal.' : 'Este log não tem os potenciômetros dos amortecedores.',
      action: 'Sem eles não há curso usado, frequência natural, rolagem, saltos nem rugosidade. Grave os 4 (Shock_-_Front_Left etc.) com o carro no chão nos primeiros segundos.',
      explain: 'susp.travelUsed', sensors: ['shock_fl', 'shock_fr', 'shock_rl', 'shock_rr'],
    });
  } else {
    const miss = CORNERS.filter(k => !act.some(a => a.id === k.id));
    if (miss.length) {
      add({
        id: 'susp.partial', level: 'info',
        text: `Amortecedores com sinal: ${act.map(k => k.id).join(', ')} (faltam ${miss.map(k => k.id).join(', ')}).`,
        action: 'Rolagem precisa dos dois lados do eixo, arfagem da frente e da traseira, torção dos quatro. Confira os sensores que faltam.',
        explain: 'susp.rollGradient', sensors: miss.map(k => ('shock_' + k.id.toLowerCase()) as SensorId),
      });
    }
    /* com sinal, mas quase parado no log inteiro (< SHOCK_STILL_MM de máx − mín) */
    const still = act.filter(k => k.pos.hi - k.pos.lo < SHOCK_STILL_MM);
    if (still.length) {
      add({
        id: 'susp.still', level: 'warn',
        text: `Amortecedor com sinal mas quase parado (< ${SHOCK_STILL_MM} mm de curso no log): ${still.map(k => `${k.id} mexe só ${(k.pos.hi - k.pos.lo).toFixed(1)} mm`).join(', ')}. Potenciômetro solto, travado ou mal calibrado.`,
        action: 'Confira a fixação do potenciômetro nos dois lados (o corpo e a haste têm que acompanhar o amortecedor), se o cursor não está travado e a calibração da entrada no FT Manager (mm por volt). Com o carro parado, comprima o canto e veja o canal mexer vários mm.',
        explain: 'quality.shockStill', sensors: still.map(k => ('shock_' + k.id.toLowerCase()) as SensorId),
      });
    }
    const noStop = act.filter(k => !k.staticFromStop);
    if (noStop.length) {
      add({
        id: 'susp.static', level: 'info',
        /* o estático (suspPrep) usa só o "parado" do GPS (andou < 3 m em 3 s): a roda não entra nessa conta */
        text: `Posição estática de ${noStop.map(k => k.id).join(', ')} tirada da mediana do log inteiro: ` +
          (tr.ok ? 'não houve ≥ 25 amostras com o carro parado.' : 'sem trajetória do GPS não dá para saber quando o carro estava parado (a velocidade da roda não entra nessa conta).'),
        action: 'Grave uns 5 s parado no começo (carro no chão, piloto sentado), com o GPS com fix: o curso passa a ser medido a partir da altura de rodagem real.',
        explain: 'quality.staticRef', sensors: noStop.map(k => ('shock_' + k.id.toLowerCase()) as SensorId).concat(['gps']),
      });
    }
    const calc = act.filter(k => k.vCalc);
    if (calc.length) {
      add({
        id: 'susp.vcalc', level: 'info',
        text: `Velocidade de ${calc.map(k => k.id).join(', ')} derivada da posição (a FT não gravou Shock_velocity).`,
        action: `A ${f0(logRateHz)} Hz a derivada suaviza os picos de impacto. Grave também a velocidade na FT ou aumente a taxa.`,
        explain: 'quality.sampleRate', sensors: calc.map(k => ('shock_' + k.id.toLowerCase()) as SensorId).concat(['logger']),
      });
    }
  }

  /* ---------- roda */
  const veh = ctx.veh;
  if (!veh.wheelAny) {
    add({
      id: 'wheel.none', level: 'info',
      text: tr.ok ? 'Sem velocidade da roda: aceleração e potência saem do GPS (ordem de grandeza).' : 'Sem velocidade da roda nem GPS: não há velocidade, aceleração nem potência.',
      action: 'Um sensor de roda (Hall na roda de tração) dá aceleração precisa, potência na roda, largadas, coast-down e escorregamento.',
      explain: 'power.wheelPower', sensors: ['wheel', 'gps'],
    });
  } else if (veh.wheel && tr.ok) {
    if (!veh.kN) {
      add({ id: 'wheel.calib', level: 'info', text: 'Não deu para calibrar a roda pelo GPS: poucos trechos acima de 14 km/h sem acelerar forte.', action: 'Grave uma volta em ritmo constante acima de ~20 km/h.', explain: 'power.tireCalibration', sensors: ['wheel', 'gps'] });
    } else if (Math.abs(veh.k - 1) > 0.01) {
      add({
        id: 'wheel.calib', level: 'warn',
        text: `A roda marca ${veh.k < 1 ? '+' : ''}${((1 / veh.k - 1) * 100).toFixed(1)} % em relação ao GPS.`,
        action: `Corrija a circunferência do pneu na FT: multiplique o valor atual por ${veh.k.toFixed(4)}.`,
        explain: 'power.tireCalibration', sensors: ['wheel', 'gps'],
      });
    }
  }
  /* ---------- CVT */
  if (!veh.cvtAny) {
    add({ id: 'cvt.none', level: 'info', text: 'Sem temperatura da CVT neste log.', action: 'Com ela o app ajusta o modelo térmico e projeta a temperatura no enduro (precisa de ≥ 1 min com a temperatura variando).', explain: 'cvt.thermalModel', sensors: ['cvt_temp'] });
  }

  /* ---------- dados do carro */
  const miss: string[] = [];
  if (!(+car.mrF > 0) || !(+car.mrR > 0)) miss.push('relação roda/amortecedor');
  if (!(+car.strokeF > 0) || !(+car.strokeR > 0)) miss.push('curso total dos amortecedores');
  if (!(+car.massF > 0) || !(+car.massR > 0)) miss.push('massa suspensa por roda');
  if (miss.length) {
    add({
      id: 'car.data', level: act.length ? 'warn' : 'info',
      text: `Faltam dados do carro: ${miss.join(', ')}.`,
      action: 'Meça e coloque em Carro: massa com piloto, massa suspensa por roda (balança por roda menos a massa não suspensa), relação roda/amortecedor, curso total, bitolas e entre-eixos. Sem eles rolagem sai subestimada, sem % do curso, fim de curso, rigidez nem amortecimento.',
      explain: 'quality.carData', sensors: ['car_data'],
    });
  }

  const order: Record<QualityLevel, number> = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  return { channels, issues, roles, logRateHz, duration, gpsBorderPct, gpsUpdateHz };
}
