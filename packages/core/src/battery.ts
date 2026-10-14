/* Bateria (novo): quanto a bateria do carro ainda dura, pela queda da tensão que a FT450
 * grava. Não é porte do app antigo.
 *
 * A bateria do carro é uma Aliant YLP07: LiFePO4 de 4 células (12,8 V nominal), 24 Wh. O
 * carro não tem carga (o motor B&S não tem alternador ligado na bateria): tudo o que liga
 * (FT450, bomba, bobina, GPS, PIC) sai dela, e a tensão cai devagar conforme ela descarrega.
 *
 * Conta:
 *   1. tensão real = tensão gravada + correção (a FT450 mede ~0,5 V a menos que o multímetro;
 *      a correção fica em "Dados do carro");
 *   2. reta por mínimos quadrados da tensão × tempo no trecho (a reta tira o ruído e os
 *      degraus de resolução; as pontas da reta são a tensão do começo e do fim);
 *   3. carga (%) de cada ponta pela curva tensão × carga típica de LiFePO4 4S (LFP_OCV);
 *   4. ritmo de descarga = carga que caiu ÷ tempo de log; dura ainda = (carga agora − reserva)
 *      ÷ ritmo; cheia = (100 − reserva) ÷ ritmo; energia = carga que caiu × Wh da bateria.
 *
 * A curva do LiFePO4 é muito plana entre 20 e 90 % (≈ 0,1 V a cada 10 %): poucos centésimos de
 * volt mudam muito a estimativa. Por isso o relatório diz a resolução do canal, a queda em
 * passos e avisa quando o log é curto. */
import type { CarConfig, Channel, SensorId } from './types';
import type { SessionContext } from './pipeline';
import { median } from './analysis';
import type { RepPlot, RepSeries, RepText, RepTile } from './reports/powertrain';

/** Bateria do carro (padrão: a Aliant YLP07 da equipe). */
export interface BatteryConfig {
  model: string;                 /* nome para a interface */
  wh: number;                    /* energia nominal, Wh */
  vNom: number;                  /* tensão nominal, V (LiFePO4 4S = 12,8 V) */
  offset: number;                /* V somados à leitura da FT (ela mede a menos) */
  reserve: number;               /* % de carga que não se conta como "útil" (folga para partir) */
}

export const DEFAULT_BATTERY: BatteryConfig = { model: 'Aliant YLP07 (LiFePO4)', wh: 24, vNom: 12.8, offset: 0.5, reserve: 10 };

/** Bateria efetiva do carro: os campos bat* de "Dados do carro" sobre o padrão. */
export const batteryOf = (car: Partial<CarConfig> | null | undefined): BatteryConfig => {
  const c = car || {}, d = DEFAULT_BATTERY;
  const pos = (v: unknown, def: number) => (typeof v === 'number' && v > 0 ? v : def);
  return {
    model: c.batModel && c.batModel.trim() ? c.batModel.trim() : d.model,
    wh: pos(c.batWh, d.wh),
    vNom: d.vNom,
    offset: typeof c.batOffset === 'number' && isFinite(c.batOffset) ? c.batOffset : d.offset,
    reserve: typeof c.batReserve === 'number' && c.batReserve >= 0 && c.batReserve < 100 ? c.batReserve : d.reserve,
  };
};

/** Curva tensão em repouso × carga de uma bateria LiFePO4 de 4 células (12,8 V), valores
 *  típicos de fabricante: [V, %]. Entre os pontos, reta. */
export const LFP_OCV: [number, number][] = [
  [10.0, 0], [12.0, 10], [12.5, 20], [12.8, 30], [12.9, 40], [13.0, 50],
  [13.1, 60], [13.2, 70], [13.3, 80], [13.4, 90], [13.6, 100],
];

/** Carga (%) pela tensão real, na curva LFP_OCV (0 abaixo de 10 V, 100 acima de 13,6 V). */
export const lfpSoc = (v: number): number => {
  const T = LFP_OCV;
  if (!(v === v)) return NaN;
  if (v <= T[0][0]) return 0;
  for (let k = 1; k < T.length; k++) {
    if (v <= T[k][0]) { const [v0, s0] = T[k - 1], [v1, s1] = T[k]; return s0 + (s1 - s0) * (v - v0) / (v1 - v0); }
  }
  return 100;
};

/** Tensão real (V) de uma carga (%), inversa de lfpSoc. */
export const lfpVolt = (soc: number): number => {
  const T = LFP_OCV;
  if (soc <= 0) return T[0][0];
  for (let k = 1; k < T.length; k++) {
    if (soc <= T[k][1]) { const [v0, s0] = T[k - 1], [v1, s1] = T[k]; return v0 + (v1 - v0) * (soc - s0) / (s1 - s0); }
  }
  return T[T.length - 1][0];
};

/** %/V da curva na tensão v (inclinação local; quanto a carga muda por volt). */
const socPerVolt = (v: number): number => {
  const T = LFP_OCV;
  for (let k = 1; k < T.length; k++) if (v <= T[k][0] || k === T.length - 1) return (T[k][1] - T[k - 1][1]) / (T[k][0] - T[k - 1][0]);
  return 100;
};

/** Canal da tensão da bateria pelo nome (FT Manager: Battery_voltage / Tensão_da_bateria). */
export const findBatteryCh = (chs: Channel[]): Channel | null => {
  const c = chs.filter(c => c.src === 'log' && /batt?er[iy]|vbat|^bat(\b|_)/i.test(c.key));
  return c.find(x => !x.constant) || c[0] || null;
};

/* faixa plausível da leitura (V); fora disso é lixo (sem dado, FT ligando) */
const V_MIN = 5, V_MAX = 20;
/* acima disso a bateria está no carregador (ou acabou de sair dele): não é descarga */
const V_CHARGING = 13.8;

export type BatteryStatus = 'ok' | 'flat' | 'charging' | 'short';

export interface BatteryReport {
  ok: boolean;                   /* false = sem canal da bateria (empty diz o que fazer) */
  empty?: string;
  status?: BatteryStatus;        /* ok = queda medida; flat = sem queda medível; charging; short = log curto */
  bat: BatteryConfig;
  src: RepText;                  /* canal, correção e bateria */
  reading: string;               /* a frase principal */
  tiles: RepTile[];
  notes: RepText[];              /* avisos (log curto, resolução, carregando...) */
  plot: RepPlot | null;          /* tensão real × tempo + reta */
  curvePlot: RepPlot;            /* curva tensão × carga com o começo e o fim do trecho */
  /* números (para testes e outras páginas) */
  vStart: number; vEnd: number;  /* V reais nas pontas da reta */
  socStart: number; socEnd: number;
  rate: number;                  /* %/h de descarga (≤ 0 = não caiu) */
  hoursLeft: number | null;      /* h até a reserva; flat: limite inferior */
  hoursFull: number | null;      /* h de carga cheia até a reserva */
  watts: number | null;          /* consumo médio, W */
  quantum: number;               /* resolução do canal, V */
  duration: number;              /* s de log com tensão válida */
  explain: string;
  sensors: SensorId[];
}

/** "3 h 05 min", "42 min" */
export const fmtHours = (h: number): string => {
  if (!isFinite(h)) return '—';
  const m = Math.round(h * 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};
const fx = (v: number, d: number) => (v === v && isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');
const fmtDur = (s: number) => (s < 120 ? `${Math.round(s)} s` : fmtHours(s / 3600));

/** Bateria no trecho [i0, i1]. */
export function batteryReport(ctx: Pick<SessionContext, 'S' | 'cfg'>, i0: number, i1: number): BatteryReport {
  const S = ctx.S, t = S.t, car = ctx.cfg.car, bat = batteryOf(car);
  const ch = (car.batCh ? S.channels.find(c => c.key === car.batCh) : null) || findBatteryCh(S.channels);
  const bS: SensorId[] = ['battery'], timeS: SensorId[] = ['battery', 'logger'], allS: SensorId[] = ['battery', 'logger', 'car_data'];
  /* curva típica; com o trecho, o pedaço da curva entre a tensão do fim e a do começo em destaque */
  const curvePlot = (span?: [number, number]): RepPlot => {
    const series: RepSeries[] = [{ id: 'ocv', role: 'muted', label: 'LiFePO4 4S (típica)', x: Float64Array.from(LFP_OCV.map(p => p[0])), y: Float64Array.from(LFP_OCV.map(p => p[1])) }];
    if (span) {
      const [va, vb] = span, k = 24;
      const x = Float64Array.from({ length: k + 1 }, (_, j) => va + (vb - va) * j / k);
      series.push({ id: 'trecho', role: 'c1', label: 'este trecho (fim → começo)', x, y: x.map(lfpSoc), width: 6 });
    }
    return { id: 'batCurve', explain: 'battery.soc', sensors: span ? bS : [], series, xLabel: 'tensão real (V)', yLabel: 'carga (%)' };
  };
  const base = {
    bat, tiles: [] as RepTile[], notes: [] as RepText[], plot: null, curvePlot: curvePlot(),
    vStart: NaN, vEnd: NaN, socStart: NaN, socEnd: NaN, rate: NaN, hoursLeft: null, hoursFull: null, watts: null,
    quantum: NaN, duration: 0, explain: 'battery.life',
  };
  const srcNone: RepText = { text: '', explain: 'sensor.battery', sensors: [] };
  if (!ch) {
    return {
      ...base, ok: false, src: srcNone, reading: '', sensors: [],
      empty: 'Nenhum canal de tensão da bateria neste log. No FT Manager, marque o canal “Tensão da bateria” (Battery voltage) ao exportar o CSV, ou escolha o canal em “Dados do carro”.',
    };
  }

  /* amostras válidas do trecho, já com a correção da FT */
  const tx: number[] = [], vx: number[] = [];
  for (let i = i0; i <= i1; i++) {
    const v = ch.data[i];
    if (v === v && v > V_MIN && v < V_MAX && t[i] === t[i]) { tx.push(t[i]); vx.push(v + bat.offset); }
  }
  const src: RepText = {
    text: `Canal ${ch.name} + ${fx(bat.offset, 2)} V de correção da FT450 · bateria ${bat.model}, ${fx(bat.wh, 0)} Wh, ${fx(bat.vNom, 1)} V · reserva ${fx(bat.reserve, 0)} % (em “Dados do carro”).`,
    explain: 'sensor.battery', sensors: mergeS(bS, 'car_data'),
  };
  if (tx.length < 10) {
    return { ...base, ok: false, src, reading: '', sensors: bS, empty: `O canal ${ch.name} não tem leitura válida (entre ${V_MIN} e ${V_MAX} V) neste trecho.` };
  }

  const n = tx.length, ta = tx[0], duration = tx[n - 1] - ta;
  /* resolução: menor passo entre valores diferentes */
  const sorted = Float64Array.from(vx).sort();
  let q = Infinity;
  for (let k = 1; k < n; k++) { const d = sorted[k] - sorted[k - 1]; if (d > 1e-6 && d < q) q = d; }
  const quantum = isFinite(q) ? q : 0.01;

  /* reta v = a + b·(t − ta) por mínimos quadrados */
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let k = 0; k < n; k++) { const x = tx[k] - ta, y = vx[k]; sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const den = n * sxx - sx * sx;
  const b = den > 0 ? (n * sxy - sx * sy) / den : 0, a = (sy - b * sx) / n;
  const vStart = a, vEnd = a + b * duration;
  const socStart = lfpSoc(vStart), socEnd = lfpSoc(vEnd);
  const vMed = median(Float64Array.from(vx));
  const hours = duration / 3600;
  const drop = vStart - vEnd;                      /* V que a reta caiu */
  const rate = hours > 0 ? (socStart - socEnd) / hours : NaN;

  const status: BatteryStatus = vMed > V_CHARGING ? 'charging' : duration < 60 ? 'short' : drop < quantum ? 'flat' : 'ok';
  const notes: RepText[] = [];
  let hoursLeft: number | null = null, hoursFull: number | null = null, watts: number | null = null, reading: string;
  const useful = Math.max(0, socEnd - bat.reserve);

  if (status === 'charging') {
    reading = `Tensão real de ${fx(vMed, 2)} V (acima de ${fx(V_CHARGING, 1)} V): a bateria está sendo carregada ou acabou de sair do carregador. A queda não mede o consumo; repita com a bateria descansada.`;
  } else if (status === 'short') {
    reading = `Log curto demais (${fmtDur(duration)}) para medir a queda da tensão. Grave pelo menos 20 min com o carro ligado.`;
  } else if (status === 'flat') {
    /* a queda foi menor que um passo de resolução: o ritmo é no máximo um passo no tempo todo */
    const maxRate = quantum * socPerVolt(vEnd) / hours;
    hoursLeft = maxRate > 0 ? useful / maxRate : null;
    reading = `A tensão não caiu de forma medível em ${fmtDur(duration)} (menos de um passo de ${fx(quantum, 3)} V do canal). ` +
      (hoursLeft !== null ? `Com uma queda menor que um passo, a bateria dura mais de ${fmtHours(hoursLeft)} a partir da carga atual (${fx(socEnd, 0)} %).` : '');
  } else {
    hoursLeft = rate > 0 ? useful / rate : null;
    hoursFull = rate > 0 ? (100 - bat.reserve) / rate : null;
    watts = hours > 0 ? (socStart - socEnd) / 100 * bat.wh / hours : null;
    reading = `Com o consumo deste log (${fx(watts ?? NaN, 1)} W, ≈ ${fx((watts ?? NaN) / bat.vNom, 2)} A), a bateria vai de ${fx(socEnd, 0)} % até a reserva de ${fx(bat.reserve, 0)} % em cerca de ${hoursLeft !== null ? fmtHours(hoursLeft) : '—'}.` +
      (hoursFull !== null ? ` Cheia, duraria ~${fmtHours(hoursFull)}.` : '');
  }

  if (status === 'ok' || status === 'flat') {
    if (duration < 20 * 60) notes.push({ text: `Log curto (${fmtDur(duration)}): na parte plana da curva do LiFePO4 0,01 V muda ~1 % de carga. Use como ordem de grandeza; para um número firme, grave 20 min ou mais com o carro ligado.`, explain: 'battery.life', sensors: timeS });
    const steps = drop / quantum;
    if (status === 'ok' && steps < 5) notes.push({ text: `A tensão caiu só ${fx(steps, 1)} passo(s) de resolução (${fx(quantum, 3)} V): a estimativa pode mudar bastante com um log mais longo.`, explain: 'battery.voltageTrend', sensors: bS });
    if (socEnd < 20) notes.push({ text: `Carga baixa (${fx(socEnd, 0)} %): carregue antes do próximo teste. Abaixo de ~12 V a bomba e a bobina começam a falhar.`, explain: 'battery.soc', sensors: bS });
  }

  /* gráfico da tensão real (até ~2000 pontos) com a reta */
  const step = Math.max(1, Math.floor(n / 2000));
  const px: number[] = [], py: number[] = [];
  for (let k = 0; k < n; k += step) { px.push(tx[k]); py.push(vx[k]); }
  const plot: RepPlot = {
    id: 'batVolt', explain: 'battery.voltageTrend', sensors: timeS,
    series: [
      { id: 'measured', role: 'c1', label: 'tensão real (gravada + correção)', x: Float64Array.from(px), y: Float64Array.from(py) },
      { id: 'fit', role: 'ref', label: 'reta (tendência)', x: Float64Array.of(ta, ta + duration), y: Float64Array.of(vStart, vEnd), width: 2 },
    ],
    xLabel: 'tempo (s)', yLabel: 'tensão (V)',
  };

  const end = car.endurance > 0 ? car.endurance : 0;
  const endSoc = rate > 0 && status === 'ok' ? 100 - rate * end / 60 : null;
  const tiles: RepTile[] = [
    {
      key: 'left', label: 'Dura ainda', value: hoursLeft,
      text: hoursLeft === null ? '—' : (status === 'flat' ? '> ' : '≈ ') + fmtHours(hoursLeft),
      unit: status === 'ok' ? `até ${fx(bat.reserve, 0)} % de carga, com o consumo deste log` : status === 'flat' ? 'limite inferior: a tensão não caiu' : 'sem estimativa neste log',
      explain: 'battery.life', sensors: allS,
    },
    {
      key: 'full', label: 'Carga cheia dura', value: hoursFull, text: hoursFull === null ? '—' : '≈ ' + fmtHours(hoursFull),
      unit: `de 100 % até ${fx(bat.reserve, 0)} %`, explain: 'battery.life', sensors: allS,
    },
    {
      key: 'soc', label: 'Carga agora (pela tensão)', value: socEnd, text: fx(socEnd, 0),
      unit: `% · começou o trecho com ${fx(socStart, 0)} %`, explain: 'battery.soc', sensors: mergeS(bS, 'car_data'),
    },
    {
      key: 'drop', label: 'Queda da tensão', value: hours > 0 ? drop / hours : null, text: hours > 0 ? fx(drop / hours, 3) : '—',
      unit: `V/h · ${fx(vStart, 2)} → ${fx(vEnd, 2)} V em ${fmtDur(duration)}`, explain: 'battery.voltageTrend', sensors: timeS,
    },
    {
      key: 'power', label: 'Consumo médio', value: watts, text: watts === null ? '—' : fx(watts, 1),
      unit: watts === null ? 'W' : `W · ≈ ${fx(watts / bat.vNom, 2)} A · ${fx((socStart - socEnd) / 100 * bat.wh, 2)} Wh gastos`, explain: 'battery.drain', sensors: allS,
    },
    {
      key: 'endurance', label: `Enduro de ${fx(end, 0)} min`, value: endSoc,
      text: endSoc === null ? '—' : endSoc >= bat.reserve ? `sobra ${fx(endSoc, 0)} %` : `acaba aos ${fx((100 - bat.reserve) / rate * 60, 0)} min`,
      unit: endSoc === null ? 'precisa de uma queda medida' : 'saindo com a bateria cheia, mesmo consumo', explain: 'battery.endurance', sensors: allS,
    },
  ];

  return {
    ok: true, status, bat, src, reading, tiles, notes, plot,
    curvePlot: curvePlot([vEnd, vStart]),
    vStart, vEnd, socStart, socEnd, rate, hoursLeft, hoursFull, watts, quantum, duration,
    explain: 'battery.life', sensors: allS,
  };
}

const mergeS = (a: SensorId[], ...b: SensorId[]): SensorId[] => [...a, ...b.filter(x => !a.includes(x))];
