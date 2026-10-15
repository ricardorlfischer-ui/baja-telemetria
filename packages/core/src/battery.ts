/* Bateria (novo): quanto a bateria do carro ainda dura, pela queda da tensão de REPOUSO que a
 * FT450 grava. Não é porte do app antigo.
 *
 * A bateria do carro é uma Aliant YLP07: LiFePO4 de 4 células (12,8 V nominal), 24 Wh. O
 * carro não tem carga ligada na bateria: tudo o que liga (FT450, bomba, bobina, GPS, PIC) sai
 * dela.
 *
 * Por que repouso (logs de 14/10): com o motor ligado a tensão oscila ±0,4 V com a carga
 * (bomba, bobina), e a curva do LiFePO4 é quase plana (≈ 0,1 V a cada 10 % de carga): uma reta
 * na tensão com carga não enxerga a descarga (dava "> 34 h"). Já a tensão com o motor parado e
 * estável cai de forma limpa ao longo do dia (13,18 → 12,76 V em 47 min de log, 68 → 29 %).
 *
 * Conta:
 *   1. tensão real = tensão gravada + correção (a FT450 mede ~0,5 V a menos que o multímetro;
 *      a correção fica em "Dados do carro");
 *   2. trechos de repouso: rotação ≤ 50 rpm e tensão estável (máx − mín ≤ 0,05 V) por ≥ 3 s;
 *      cada trecho vira um ponto (mediana). Um ponto 0,1 V abaixo de um repouso mais tarde
 *      estava com carga ligada (sem carga na bateria a tensão de repouso não sobe) e sai;
 *   3. carga (%) de cada ponto pela curva tensão × carga típica de LiFePO4 4S (LFP_OCV);
 *   4. ritmo = −inclinação da reta carga × tempo de log nos pontos de repouso (%/h);
 *      dura ainda = (carga no último repouso − reserva) ÷ ritmo; cheia = (100 − reserva) ÷ ritmo;
 *      energia = ritmo × Wh da bateria (W); corrente ≈ W ÷ 12,8 V.
 *
 * Sem dado para isso (sem canal de rotação, sem 2 repousos com 5 min entre eles, ou carga de
 * repouso que não caiu 2 %), o app não inventa número: diz o que gravar. O tempo é o de log
 * (FT ligada); nos logs juntados os intervalos com tudo desligado não contam. */
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

/** Canal da tensão da bateria pelo nome (FT Manager: Battery_voltage / Tensão_da_bateria). */
export const findBatteryCh = (chs: Channel[]): Channel | null => {
  const c = chs.filter(c => c.src === 'log' && /batt?er[iy]|vbat|^bat(\b|_)/i.test(c.key));
  return c.find(x => !x.constant) || c[0] || null;
};

/* canal da rotação (o mesmo critério da qualidade dos dados) */
const findRpmCh = (chs: Channel[]): Channel | null => {
  const c = chs.filter(c => c.src === 'log' && /rpm|rota[cç][aã]o|engine.?speed/i.test(c.key));
  return c.find(x => !x.constant) || c[0] || null;
};

/* faixa plausível da leitura (V); fora disso é lixo (sem dado, FT ligando) */
const V_MIN = 5, V_MAX = 20;
/* acima disso a bateria está no carregador (ou acabou de sair dele): não é descarga */
const V_CHARGING = 13.8;
/* repouso: rotação até 50 rpm e tensão estável por pelo menos 3 s */
export const REST = { rpm: 50, window: 3, steady: 0.05, loaded: 0.1, minSpan: 300, minDrop: 2 };
/* rotação acima disso = motor ligado (para a queda com o motor ligado) */
const RPM_ON = 300;

/** Um trecho de repouso: motor parado e tensão estável. */
export interface RestPoint {
  t: number;                     /* s, meio do trecho */
  t0: number; t1: number;
  v: number;                     /* V reais (gravada + correção), mediana do trecho */
  soc: number;                   /* % pela curva LFP_OCV */
  loaded?: boolean;              /* abaixo de um repouso mais tarde: tinha carga ligada (não entra) */
}

/** Trechos de repouso em [i0, i1]: rotação ≤ REST.rpm e máx − mín ≤ REST.steady por janelas de
 *  REST.window s seguidas. V = tensão real (já com a correção). */
export function restPoints(t: ArrayLike<number>, V: ArrayLike<number>, rpm: ArrayLike<number>, i0: number, i1: number): RestPoint[] {
  const out: RestPoint[] = [];
  let cur: { t0: number; t1: number; v: number[] } | null = null;
  const close = () => {
    if (!cur) return;
    const v = median(Float64Array.from(cur.v));
    out.push({ t: (cur.t0 + cur.t1) / 2, t0: cur.t0, t1: cur.t1, v, soc: lfpSoc(v) });
    cur = null;
  };
  for (let i = i0; i <= i1;) {
    let j = i, lo = Infinity, hi = -Infinity, ok = true;
    const vs: number[] = [];
    while (j <= i1 && t[j] - t[i] < REST.window) {
      const v = V[j], r = rpm[j];
      if (!(v === v) || !(r === r) || r > REST.rpm || v < V_MIN || v > V_MAX) { ok = false; break; }
      if (v < lo) lo = v; if (v > hi) hi = v; vs.push(v); j++;
    }
    const full = ok && j <= i1 + 1 && j > i && t[j - 1] - t[i] >= REST.window * 0.9;
    if (full && hi - lo <= REST.steady) {
      if (cur && t[i] - cur.t1 <= 0.5) { cur.t1 = t[j - 1]; cur.v.push(...vs); }
      else { close(); cur = { t0: t[i], t1: t[j - 1], v: vs }; }
      i = j;
    } else { close(); i = ok ? j : j + 1; }
  }
  close();
  /* sem carga na bateria a tensão de repouso não sobe: um ponto bem abaixo de um mais tarde
   * estava com algo ligado (bomba, ventoinha) e não mede a carga */
  let laterMax = -Infinity;
  for (let k = out.length - 1; k >= 0; k--) {
    if (out[k].v < laterMax - REST.loaded) out[k].loaded = true;
    else laterMax = Math.max(laterMax, out[k].v);
  }
  return out;
}

export type BatteryStatus = 'ok' | 'flat' | 'noRest' | 'noRpm' | 'charging' | 'short';

export interface BatteryReport {
  ok: boolean;                   /* false = sem canal da bateria (empty diz o que fazer) */
  empty?: string;
  status?: BatteryStatus;        /* ok = descarga medida no repouso; flat = repouso não caiu; noRest/noRpm = sem repouso; charging; short */
  bat: BatteryConfig;
  src: RepText;                  /* canal, correção e bateria */
  reading: string;               /* a frase principal */
  tiles: RepTile[];
  notes: RepText[];              /* avisos (log curto, poucos repousos, carga ligada parado...) */
  plot: RepPlot | null;          /* tensão real × tempo com os repousos e a tendência */
  curvePlot: RepPlot;            /* curva tensão × carga com o pedaço percorrido em destaque */
  rest: RestPoint[];             /* trechos de repouso achados (loaded = não entraram) */
  /* números (para testes e outras páginas) */
  vStart: number; vEnd: number;  /* V reais de repouso nas pontas da tendência */
  socStart: number; socEnd: number;
  rate: number;                  /* %/h de descarga (NaN sem estimativa) */
  hoursLeft: number | null;      /* h até a reserva */
  hoursFull: number | null;      /* h de carga cheia até a reserva */
  watts: number | null;          /* consumo médio, W */
  sag: number | null;            /* V a menos com o motor ligado que no repouso (mediana) */
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
const mergeS = (a: SensorId[], ...b: SensorId[]): SensorId[] => [...a, ...b.filter(x => !a.includes(x))];

/** Bateria no trecho [i0, i1]. */
export function batteryReport(ctx: Pick<SessionContext, 'S' | 'cfg'>, i0: number, i1: number): BatteryReport {
  const S = ctx.S, t = S.t, car = ctx.cfg.car, bat = batteryOf(car);
  const ch = (car.batCh ? S.channels.find(c => c.key === car.batCh) : null) || findBatteryCh(S.channels);
  const rpmCh = findRpmCh(S.channels);
  const bS: SensorId[] = ['battery'], timeS: SensorId[] = ['battery', 'logger'];
  const restS: SensorId[] = rpmCh ? ['battery', 'engine_rpm', 'logger'] : timeS;
  const allS: SensorId[] = mergeS(restS, 'car_data');
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
    bat, tiles: [] as RepTile[], notes: [] as RepText[], plot: null, curvePlot: curvePlot(), rest: [] as RestPoint[],
    vStart: NaN, vEnd: NaN, socStart: NaN, socEnd: NaN, rate: NaN, hoursLeft: null, hoursFull: null, watts: null, sag: null,
    quantum: NaN, duration: 0, explain: 'battery.life',
  };
  if (!ch) {
    return {
      ...base, ok: false, src: { text: '', explain: 'sensor.battery', sensors: [] }, reading: '', sensors: [],
      empty: 'Nenhum canal de tensão da bateria neste log. No FT Manager, marque o canal “Tensão da bateria” (Battery voltage) ao exportar o CSV, ou escolha o canal em “Dados do carro”.',
    };
  }

  /* tensão real de cada amostra do trecho */
  const n = t.length, V = new Float64Array(n).fill(NaN);
  const tx: number[] = [], vx: number[] = [];
  for (let i = i0; i <= i1; i++) {
    const v = ch.data[i];
    if (v === v && v > V_MIN && v < V_MAX && t[i] === t[i]) { V[i] = v + bat.offset; tx.push(t[i]); vx.push(V[i]); }
  }
  const src: RepText = {
    text: `Canal ${ch.name} + ${fx(bat.offset, 2)} V de correção da FT450${rpmCh ? ` · repouso = ${rpmCh.name} parado e tensão estável` : ''} · bateria ${bat.model}, ${fx(bat.wh, 0)} Wh, ${fx(bat.vNom, 1)} V · reserva ${fx(bat.reserve, 0)} % (em “Dados do carro”).`,
    explain: 'battery.soc', sensors: mergeS(restS, 'car_data'),
  };
  if (tx.length < 10) {
    return { ...base, ok: false, src, reading: '', sensors: bS, empty: `O canal ${ch.name} não tem leitura válida (entre ${V_MIN} e ${V_MAX} V) neste trecho.` };
  }
  const nv = tx.length, duration = tx[nv - 1] - tx[0];
  const sorted = Float64Array.from(vx).sort();
  let q = Infinity;
  for (let k = 1; k < nv; k++) { const d = sorted[k] - sorted[k - 1]; if (d > 1e-6 && d < q) q = d; }
  const quantum = isFinite(q) ? q : 0.01;

  /* repousos e queda com o motor ligado */
  const rest = rpmCh ? restPoints(t, V, rpmCh.data, i0, i1) : [];
  const good = rest.filter(p => !p.loaded);
  let sag: number | null = null;
  if (rpmCh && good.length) {
    const on: number[] = [];
    for (let i = i0; i <= i1; i++) if (V[i] === V[i] && rpmCh.data[i] > RPM_ON) on.push(V[i]);
    if (on.length > 25) sag = median(Float64Array.from(good.map(p => p.v))) - median(Float64Array.from(on));
  }

  /* tendência da carga de repouso × tempo (mínimos quadrados) */
  let rate = NaN, socStart = NaN, socEnd = NaN, vStart = NaN, vEnd = NaN, span = 0;
  if (good.length >= 2) {
    span = good[good.length - 1].t - good[0].t;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    const ta = good[0].t;
    for (const p of good) { const x = (p.t - ta) / 3600; sx += x; sy += p.soc; sxx += x * x; sxy += x * p.soc; }
    const m = good.length, den = m * sxx - sx * sx;
    const b = den > 0 ? (m * sxy - sx * sy) / den : 0, a = (sy - b * sx) / m;
    rate = -b;
    socStart = Math.min(100, Math.max(0, a));
    /* carga agora = o último repouso medido (não a reta: é o número mais direto) */
    socEnd = good[good.length - 1].soc;
    vStart = lfpVolt(socStart); vEnd = good[good.length - 1].v;
  } else if (good.length === 1) {
    socStart = socEnd = good[0].soc; vStart = vEnd = good[0].v;
  }
  const restMed = good.length ? median(Float64Array.from(good.map(p => p.v))) : NaN;

  const status: BatteryStatus =
    restMed > V_CHARGING ? 'charging'
      : duration < 60 ? 'short'
        : !rpmCh ? 'noRpm'
          : good.length < 2 || span < REST.minSpan ? 'noRest'
            : !(rate * span / 3600 >= REST.minDrop) ? 'flat'
              : 'ok';

  const notes: RepText[] = [];
  let hoursLeft: number | null = null, hoursFull: number | null = null, watts: number | null = null, reading: string;
  const restWhat = 'Deixe a FT ligada com o motor parado uns 10 s no começo e no fim de cada teste (e entre um log e outro): é a tensão de repouso que mede a carga.';
  if (status === 'charging') {
    reading = `Tensão de repouso de ${fx(restMed, 2)} V (acima de ${fx(V_CHARGING, 1)} V): a bateria está no carregador ou acabou de sair dele. A queda não mede o consumo; repita com a bateria descansada.`;
  } else if (status === 'short') {
    reading = `Log curto demais (${fmtDur(duration)}) para medir a descarga. ${restWhat}`;
  } else if (status === 'noRpm') {
    reading = `Sem o canal de rotação no log, o app não separa o repouso (motor parado) do motor ligado, e com o motor ligado a tensão oscila demais para medir a descarga. Exporte o CSV com o canal RPM.`;
  } else if (status === 'noRest') {
    reading = good.length
      ? `Só ${good.length === 1 ? 'um trecho' : 'trechos muito próximos'} de repouso neste log (${fmtDur(span)} entre o primeiro e o último): precisa de pelo menos 5 min entre dois repousos para medir a descarga. ${restWhat}`
      : `Nenhum trecho de repouso (motor parado e tensão estável) neste log: com o motor ligado a tensão oscila com a carga e não mede a descarga. ${restWhat}`;
  } else if (status === 'flat') {
    reading = `A tensão de repouso quase não mudou em ${fmtDur(span)} (${fx(good[0].v, 2)} → ${fx(vEnd, 2)} V): o consumo foi pequeno demais para medir neste trecho. Para uma estimativa, grave um teste mais longo com repousos no começo e no fim.`;
  } else {
    const useful = Math.max(0, socEnd - bat.reserve);
    hoursLeft = useful / rate;
    hoursFull = (100 - bat.reserve) / rate;
    watts = rate / 100 * bat.wh;
    reading = `Com o consumo deste log (${fx(watts, 1)} W, ≈ ${fx(watts / bat.vNom, 2)} A), a bateria vai de ${fx(socEnd, 0)} % até a reserva de ${fx(bat.reserve, 0)} % em cerca de ${fmtHours(hoursLeft)}. Cheia, duraria ~${fmtHours(hoursFull)}.`;
    if (span < 20 * 60) notes.push({ text: `Os repousos cobrem só ${fmtDur(span)}: na parte plana da curva do LiFePO4 0,01 V muda ~1 % de carga. Use como ordem de grandeza; com 20 min ou mais entre o primeiro e o último repouso o número fica firme.`, explain: 'battery.life', sensors: restS });
    if (good.length < 3) notes.push({ text: `Só ${good.length} trechos de repouso na conta: mais repousos (entre os logs, por exemplo) deixam a tendência mais firme.`, explain: 'battery.voltageTrend', sensors: restS });
  }
  if (status === 'ok' || status === 'flat' || status === 'noRest') {
    if (socEnd === socEnd && socEnd < 20) notes.push({ text: `Carga baixa (${fx(socEnd, 0)} % no último repouso): carregue antes do próximo teste. Abaixo de ~12 V a bomba e a bobina começam a falhar.`, explain: 'battery.soc', sensors: bS });
    const ld = rest.filter(p => p.loaded);
    if (ld.length) notes.push({ text: `${ld.length} trecho(s) com o motor parado mas a tensão bem abaixo do repouso seguinte (algo ligado: bomba, ventoinha, partida) ficaram fora da conta.`, explain: 'battery.voltageTrend', sensors: restS });
  }

  /* gráfico: tensão real (até ~2000 pontos), repousos e a tendência */
  const step = Math.max(1, Math.floor(nv / 2000));
  const px: number[] = [], py: number[] = [];
  for (let k = 0; k < nv; k += step) { px.push(tx[k]); py.push(vx[k]); }
  const series: RepSeries[] = [{ id: 'measured', role: 'c1', label: 'tensão real (gravada + correção)', x: Float64Array.from(px), y: Float64Array.from(py) }];
  if (good.length) series.push({ id: 'rest', role: 'c3', label: 'repouso (motor parado)', x: Float64Array.from(good.map(p => p.t)), y: Float64Array.from(good.map(p => p.v)), width: 4 });
  if (rate === rate && good.length >= 2) {
    const ta = good[0].t, k = 20;
    const fx2 = Float64Array.from({ length: k + 1 }, (_, j) => ta + span * j / k);
    series.push({ id: 'fit', role: 'ref', label: 'tendência da carga', x: fx2, y: fx2.map(x => lfpVolt(socStart - rate * (x - ta) / 3600)), width: 2 });
  }
  const plot: RepPlot = { id: 'batVolt', explain: 'battery.voltageTrend', sensors: restS, series, xLabel: 'tempo (s)', yLabel: 'tensão (V)' };

  const end = car.endurance > 0 ? car.endurance : 0;
  const okRate = status === 'ok';
  const endSoc = okRate ? 100 - rate * end / 60 : null;
  const tiles: RepTile[] = [
    {
      key: 'left', label: 'Dura ainda', value: hoursLeft, text: hoursLeft === null ? '—' : '≈ ' + fmtHours(hoursLeft),
      unit: okRate ? `até ${fx(bat.reserve, 0)} % de carga, com o consumo deste log` : 'sem estimativa neste log (veja o texto acima)',
      explain: 'battery.life', sensors: allS,
    },
    {
      key: 'full', label: 'Carga cheia dura', value: hoursFull, text: hoursFull === null ? '—' : '≈ ' + fmtHours(hoursFull),
      unit: `de 100 % até ${fx(bat.reserve, 0)} %`, explain: 'battery.life', sensors: allS,
    },
    {
      key: 'soc', label: 'Carga agora (repouso)', value: socEnd === socEnd ? socEnd : null, text: fx(socEnd, 0),
      unit: socEnd === socEnd ? `% · ${fx(vEnd, 2)} V no último repouso${good.length >= 2 ? ` · começou com ${fx(good[0].soc, 0)} %` : ''}` : '% · precisa de um repouso (motor parado)',
      explain: 'battery.soc', sensors: mergeS(restS, 'car_data'),
    },
    {
      key: 'rate', label: 'Ritmo de descarga', value: okRate ? rate : null, text: okRate ? fx(rate, 0) : '—',
      unit: good.length >= 2 ? `%/h · repouso ${fx(good[0].v, 2)} → ${fx(vEnd, 2)} V em ${fmtDur(span)} de log (${good.length} repousos)` : '%/h · precisa de 2 repousos com 5 min ou mais entre eles',
      explain: 'battery.voltageTrend', sensors: restS,
    },
    {
      key: 'power', label: 'Consumo médio', value: watts, text: watts === null ? '—' : fx(watts, 1),
      unit: watts === null ? 'W' : `W · ≈ ${fx(watts / bat.vNom, 2)} A`, explain: 'battery.drain', sensors: allS,
    },
    {
      key: 'endurance', label: `Enduro de ${fx(end, 0)} min`, value: endSoc,
      text: endSoc === null ? '—' : endSoc >= bat.reserve ? `sobra ${fx(endSoc, 0)} %` : `acaba aos ${fx((100 - bat.reserve) / rate * 60, 0)} min`,
      unit: endSoc === null ? 'precisa da descarga medida' : 'saindo com a bateria cheia, mesmo consumo', explain: 'battery.endurance', sensors: allS,
    },
    {
      key: 'sag', label: 'Queda com o motor ligado', value: sag, text: sag === null ? '—' : fx(sag, 2),
      unit: sag === null ? 'V · precisa de repouso e de motor ligado no log' : 'V a menos que no repouso (mediana): o peso da carga elétrica (bomba, bobina)',
      explain: 'battery.drain', sensors: rpmCh ? ['battery', 'engine_rpm'] : bS,
    },
  ];

  return {
    ok: true, status, bat, src, reading, tiles, notes, plot,
    curvePlot: vStart === vStart && vEnd === vEnd && vStart !== vEnd ? curvePlot([vEnd, vStart]) : curvePlot(),
    rest, vStart, vEnd, socStart, socEnd, rate: okRate ? rate : NaN, hoursLeft, hoursFull, watts, sag, quantum, duration,
    explain: 'battery.life', sensors: allS,
  };
}
