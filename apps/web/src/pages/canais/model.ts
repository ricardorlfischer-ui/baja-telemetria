/* Modelo da página Canais (sem React): painéis, layouts prontos, eixo X (tempo ou distância),
 * dados para o uPlot (NaN → null para virar falha no traço) e a volta de referência
 * sobreposta. As contas de engenharia são todas do @baja/core; aqui só a geometria do
 * desenho (qual x cada amostra ocupa, alinhar a volta de referência na mesma posição). */
import {
  CORNERS, decimalsFor, detectRoles, fmtVal, idxAt, mergeSensors, sensorsOfChannel, vehSpeedSensors,
  type Channel, type Lap, type RoleMap, type SensorId, type SessionContext,
} from '@baja/core';
import type { ChannelLayout } from '../../state/prefs';
import { CORNER_LABEL, type ChartTheme, type Corner } from '../../theme';

/* ---------------------------------------------------------------- painéis */
export interface PanelDef {
  id: string;
  keys: string[];
  /** altura da área do gráfico (px) */
  height: number;
}

export const PANEL_MIN_H = 120;
export const PANEL_DEFAULT_H = 240;   /* ≥ 240 px (ARQUITETURA 1): grande e legível; arrastar a borda ajusta */
export const PANEL_MAX_H = 720;

let seq = 0;
export const newPanelId = (): string => 'p' + (++seq).toString(36) + Date.now().toString(36).slice(-3);

export const mkPanel = (keys: string[], height = PANEL_DEFAULT_H): PanelDef => ({ id: newPanelId(), keys, height });

/** Unidade normalizada (um eixo Y por painel: só canais da mesma unidade juntos). */
export const unitOf = (c: Channel | undefined): string => (c?.unit ?? '').trim();

/** Separa grupos de chaves em painéis de uma unidade só (ordem preservada). */
export function splitByUnit(groups: string[][], chan: (k: string) => Channel | undefined, height = PANEL_DEFAULT_H): PanelDef[] {
  const out: PanelDef[] = [];
  for (const g of groups) {
    const by = new Map<string, string[]>();
    for (const k of g) {
      const c = chan(k);
      if (!c) continue;
      const u = unitOf(c);
      if (!by.has(u)) by.set(u, []);
      if (!by.get(u)!.includes(k)) by.get(u)!.push(k);
    }
    for (const keys of by.values()) if (keys.length) out.push(mkPanel(keys, height));
  }
  return out;
}

/* ---------------------------------------------------------------- papéis e cantos */
export interface ChannelInfo {
  roles: RoleMap;
  /** canto de cada canal (posição/velocidade do amortecedor, velocidade calculada) */
  corner: Map<string, Corner>;
  /** sensores de cada canal (sensorsOfChannel do core), sob demanda */
  sensors: (key: string) => SensorId[];
  /** casas decimais do valor (decimalsFor da faixa do canal, como o antigo) */
  dec: (key: string) => number;
  chan: (key: string) => Channel | undefined;
}

export function channelInfo(ctx: SessionContext): ChannelInfo {
  const roles = detectRoles(ctx.S, ctx.cfg);
  const corner = new Map<string, Corner>();
  for (const id of CORNERS.map(c => c.id) as Corner[]) {
    const p = roles[`shock_pos_${id}`], v = roles[`shock_vel_${id}`];
    if (p) corner.set(p, id);
    if (v) corner.set(v, id);
    corner.set('susp:v' + id, id);
  }
  const byKey = new Map(ctx.all.map(c => [c.key, c]));
  const sCache = new Map<string, SensorId[]>();
  const dCache = new Map<string, number>();
  return {
    roles, corner,
    chan: k => byKey.get(k),
    sensors: k => {
      let s = sCache.get(k);
      if (!s) { s = byKey.has(k) ? sensorsOfChannel(ctx, k, roles) : []; sCache.set(k, s); }
      return s;
    },
    dec: k => {
      let d = dCache.get(k);
      if (d === undefined) { const c = byKey.get(k); d = c ? decimalsFor(c.lo, c.hi) : 2; dCache.set(k, d); }
      return d;
    },
  };
}

/** Cores dos canais de um painel: canto = cor fixa do canto; os outros pegam os slots da
 *  paleta pela ordem, pulando os que os cantos do painel já usam. Passou de 8: cinza (nunca
 *  repetir cor). */
export function panelColors(keys: string[], info: ChannelInfo, th: ChartTheme): string[] {
  const used = new Set<number>();
  const slotOf: Record<Corner, number> = { FL: 0, FR: 1, RL: 2, RR: 3 };
  keys.forEach(k => { const c = info.corner.get(k); if (c) used.add(slotOf[c]); });
  let next = 0;
  return keys.map(k => {
    const c = info.corner.get(k);
    if (c) return th.corner[c];
    while (used.has(next)) next++;
    const s = next < th.series.length ? th.series[next] : th.muted;
    used.add(next);
    return s;
  });
}

/** Cor mais clara (volta de referência): a mesma cor com transparência. */
export const lighter = (hex: string, alpha = 0.42): string => {
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex + Math.round(alpha * 255).toString(16).padStart(2, '0');
  return hex;
};

/* ---------------------------------------------------------------- layouts prontos */
export type PresetId = 'tudo' | 'suspensao' | 'velocidade' | 'trem';
export const PRESETS: { id: PresetId; label: string; hint: string }[] = [
  { id: 'tudo', label: 'Tudo', hint: 'um painel por canal que varia (como o app antigo)' },
  { id: 'suspensao', label: 'Suspensão', hint: 'posições dos 4 cantos juntas, velocidades juntas, arfagem e rolagem' },
  { id: 'velocidade', label: 'Velocidade e GPS', hint: 'velocidade, acelerações, raio de curva e diferença para a melhor volta' },
  { id: 'trem', label: 'Trem de força e CVT', hint: 'velocidade, potência na roda, temperatura da CVT e escorregamento' },
];

/** Aviso do layout: resumo curto (sempre visível) e o texto completo (o que fazer). */
export interface Note { short: string; text: string; level: 'warn' | 'info' }

export interface PresetResult {
  panels: PanelDef[];
  /** o que falta neste log para o layout ficar completo (sensor sem sinal, ausente...) */
  notes: Note[];
}

const has = (ctx: SessionContext, k: string | undefined | null): k is string => !!k && ctx.all.some(c => c.key === k && !c.constant);
const warn = (short: string, text: string): Note => ({ short, text, level: 'warn' });
const info_ = (short: string, text: string): Note => ({ short, text, level: 'info' });

/** Avisos dos amortecedores: canal que existe mas está constante ("sem sinal") ou falta. */
export function shockNotes(ctx: SessionContext): Note[] {
  const out: Note[] = [];
  const dead = ctx.susp.shocks.filter(k => k.pos && !k.active);
  const none = ctx.susp.shocks.filter(k => !k.pos);
  const active = ctx.susp.shocks.filter(k => k.active);
  if (dead.length) {
    out.push(warn(`Amortecedor sem sinal: ${dead.map(k => k.id).join(', ')}`,
      `Sem sinal: ${dead.map(k => `${k.id} (${k.pos!.name}, constante em ${fmtVal(k.pos!.lo, 1)})`).join(', ')}. ` +
      'O canal existe no log, mas o valor não mudou: confira o potenciômetro, o conector e a entrada na FT antes do próximo teste.'));
  }
  if (none.length === 4) out.push(warn('Sem amortecedores no log', 'Este log não tem canais de amortecedor (posição dos 4 cantos). Para ver a suspensão, ligue os potenciômetros lineares nas entradas da FT.'));
  else if (none.length) out.push(warn(`Sem canal: ${none.map(k => k.id).join(', ')}`, `Sem canal de posição no log: ${none.map(k => CORNER_LABEL[k.id as Corner]).join(', ')}.`));
  if (active.length && active.length < 4 && !dead.length && !none.length) out.push(info_(`Só ${active.map(k => k.id).join(', ')} com sinal`, `Só ${active.map(k => k.id).join(', ')} com sinal.`));
  return out;
}

export function buildPreset(id: PresetId, ctx: SessionContext, info: ChannelInfo): PresetResult {
  const chan = info.chan;
  const notes: Note[] = [];
  const speedKeys = ['veh:v', 'gps:speed'].filter(k => has(ctx, k));
  const veh = ctx.veh;
  if (id === 'tudo') {
    const list = ctx.all.filter(c => !c.constant).map(c => [c.key]);
    const nConst = ctx.all.filter(c => c.constant).length;
    notes.push(...shockNotes(ctx).filter(n => n.short.startsWith('Amortecedor sem sinal')));
    if (nConst) notes.push(info_(`${nConst} canais constantes fora`, `${nConst} canais constantes ficaram de fora (estão no fim da lista, em “Constantes”): sem variação, não têm o que mostrar no tempo.`));
    return { panels: splitByUnit(list, chan), notes };
  }
  if (id === 'suspensao') {
    const act = ctx.susp.shocks.filter(k => k.active);
    const pos = act.map(k => k.pos!.key);
    const vel = act.map(k => (k.vel && !k.vel.constant ? k.vel.key : 'susp:v' + k.id)).filter(k => has(ctx, k));
    const ang = ['susp:pitch', 'susp:rollF', 'susp:rollR'].filter(k => has(ctx, k));
    const mm = ['susp:heave', 'susp:warp'].filter(k => has(ctx, k));
    const rough = ['susp:rough'].filter(k => has(ctx, k));
    notes.push(...shockNotes(ctx));
    if (act.length && !ang.length) notes.push(info_('Sem arfagem/rolagem', 'Arfagem e rolagem precisam de 2 cantos com sinal (frente e trás, ou esquerda e direita) e da geometria do carro (página Carro).'));
    const groups = [pos, vel, ang, mm, rough, speedKeys.slice(0, 1)].filter(g => g.length);
    return { panels: act.length ? splitByUnit(groups, chan) : [], notes };
  }
  if (id === 'velocidade') {
    if (!ctx.track.ok) notes.push(warn('Sem GPS', `Sem trajetória do GPS: ${ctx.track.msg || 'o log não tem posição.'} Velocidade, acelerações em curva, raio e voltas precisam do GPS (entradas 7/8 da FT ou lat/lon no BUSMASTER).`));
    if (ctx.track.ok && ctx.laps.length < 2) notes.push(info_('Sem voltas', 'A diferença para a melhor volta precisa de pelo menos 2 voltas: defina a linha de largada na página Mapa ou Pista e GPS.'));
    const lon = ['veh:ax', 'gps:along'].filter(k => has(ctx, k));
    const lat = ['veh:ay', 'gps:alat'].filter(k => has(ctx, k));
    const groups = [speedKeys, lon, lat, ['gps:radius'].filter(k => has(ctx, k)), ['gps:delta'].filter(k => has(ctx, k)), ['gps:lap'].filter(k => has(ctx, k))];
    return { panels: splitByUnit(groups.filter(g => g.length), chan), notes };
  }
  /* trem de força e CVT */
  const r = info.roles;
  if (!veh.wheel) {
    notes.push(veh.wheelAny
      ? warn('Roda sem sinal', `Sem sinal do sensor de roda (${veh.wheelAny.name} constante): velocidade e potência vêm só do GPS, com menos resolução nas largadas.`)
      : info_('Sem sensor de roda', 'Sem sensor de velocidade da roda no log: velocidade e potência vêm do GPS. Um sensor de roda (indutivo no disco de freio) melhora largadas e frenagens.'));
  }
  if (!veh.cvt) {
    notes.push(veh.cvtAny
      ? warn('CVT sem sinal', `Sem sinal da temperatura da CVT (${veh.cvtAny.name} constante): confira o termopar/sensor e a entrada na FT.`)
      : info_('Sem temperatura da CVT', 'Sem temperatura da CVT no log: um sensor de temperatura na carcaça da CVT permite o modelo térmico e a projeção do enduro.'));
  }
  if (!r.engine_rpm) notes.push(info_('Sem rotação do motor', 'Sem rotação do motor: com rotação + roda daria para medir a relação da CVT em cada instante (sensor sugerido).'));
  const groups = [
    speedKeys,
    ['veh:P'].filter(k => has(ctx, k)),
    [veh.cvt?.key].filter((k): k is string => has(ctx, k)),
    ['veh:slip'].filter(k => has(ctx, k)),
    [veh.wheel?.key].filter((k): k is string => has(ctx, k)),
    [r.engine_rpm, r.throttle].filter((k): k is string => has(ctx, k)),
    ['veh:ax', 'gps:along'].filter(k => has(ctx, k)).slice(0, 1),
  ];
  return { panels: splitByUnit(groups.filter(g => g.length), chan), notes };
}

/** Painéis de um layout salvo: canais que não existem neste log saem (e viram aviso). */
export function fromSaved(l: ChannelLayout, info: ChannelInfo): PresetResult {
  const missing: string[] = [];
  const groups = l.panels.map(p => p.keys.filter(k => { const ok = !!info.chan(k); if (!ok && !missing.includes(k)) missing.push(k); return ok; }));
  const panels: PanelDef[] = [];
  l.panels.forEach((p, i) => {
    const sp = splitByUnit([groups[i]], info.chan, Math.max(PANEL_MIN_H, Math.min(PANEL_MAX_H, p.height || PANEL_DEFAULT_H)));
    panels.push(...sp);
  });
  const notes = missing.length ? [warn(`${missing.length} canais do layout faltam`, `Canais do layout “${l.name}” que não existem neste log: ${missing.join(', ')}.`)] : [];
  return { panels, notes };
}

/* ---------------------------------------------------------------- eixo X */
export interface XAxisData {
  mode: 'time' | 'dist';
  /** x de cada amostra (crescente, sem NaN) */
  X: Float64Array;
  label: string;
  unit: string;
  /** de onde vem a distância (sensores) — vazio no tempo */
  sensors: SensorId[];
  src: string;
}

/** Distância crescente para o eixo X: NaN vira o último valor válido (o começo, o primeiro
 *  valor válido) e nunca volta para trás (máximo acumulado). Só geometria do desenho. */
export function monotone(d: ArrayLike<number>): Float64Array {
  const n = d.length, out = new Float64Array(n);
  let f = 0;
  while (f < n && !(d[f] === d[f])) f++;
  if (f >= n) return out;
  let last = d[f];
  for (let i = 0; i < n; i++) {
    const v = d[i];
    if (i >= f && v === v && v > last) last = v;
    out[i] = last;
  }
  return out;
}

/** Fonte da distância: a do veículo (roda corrigida pelo GPS, ou velocidade do GPS
 *  integrada) ou a da trajetória do GPS. null = sem sensor de velocidade nem GPS. */
export function distanceSource(ctx: SessionContext): { d: ArrayLike<number>; sensors: SensorId[]; src: string } | null {
  const veh = ctx.veh;
  if (veh.dist && veh.v) {
    return { d: veh.dist, sensors: vehSpeedSensors(veh), src: veh.src === 'roda' ? (veh.kN ? 'roda (calibrada pelo GPS)' : 'roda') : 'velocidade do GPS' };
  }
  if (ctx.track.ok) return { d: ctx.track.dist, sensors: ['gps'], src: 'trajetória do GPS' };
  return null;
}

const xCache = new WeakMap<object, XAxisData>();
export function xAxisData(ctx: SessionContext, mode: 'time' | 'dist'): XAxisData {
  if (mode === 'dist') {
    const ds = distanceSource(ctx);
    if (ds) {
      const key = ds.d as object;
      let x = xCache.get(key);
      if (!x) {
        x = { mode: 'dist', X: monotone(ds.d), label: 'distância (m)', unit: 'm', sensors: mergeSensors(ds.sensors, 'logger'), src: ds.src };
        xCache.set(key, x);
      }
      return x;
    }
  }
  return { mode: 'time', X: ctx.S.t, label: 'tempo (s)', unit: 's', sensors: [], src: 'relógio do logger' };
}

/** x (posição no eixo) do instante t: no tempo é o próprio t; na distância, interpolado
 *  entre as amostras vizinhas. */
export function xAtTime(t: Float64Array, X: Float64Array, tc: number): number {
  if (X === t) return tc;
  const n = t.length;
  if (!n) return 0;
  const i = idxAt(t, tc);
  if (i >= n - 1 || tc <= t[0]) return X[i];
  const dt = t[i + 1] - t[i];
  return dt > 0 ? X[i] + (X[i + 1] - X[i]) * (tc - t[i]) / dt : X[i];
}

/** Instante t da posição x (primeira amostra que chega em x; parado, o começo da parada). */
export function timeAtX(t: Float64Array, X: Float64Array, x: number): number {
  if (X === t) return x;
  const n = X.length;
  if (!n) return 0;
  if (x <= X[0]) return t[0];
  if (x >= X[n - 1]) return t[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] < x) lo = m; else hi = m; }
  const dx = X[hi] - X[lo];
  return dx > 0 ? t[lo] + (t[hi] - t[lo]) * (x - X[lo]) / dx : t[hi];
}

/* ---------------------------------------------------------------- dados do uPlot */
/** O uPlot só abre falha no traço com null (NaN ligaria as pontas). Canais sem NaN vão
 *  como estão (Float64Array, sem cópia); os com falhas viram array com null (em cache). */
const nullCache = new WeakMap<Float64Array, (number | null)[]>();
export function plotArray(c: Channel): ArrayLike<number | null> {
  if (c.count >= c.data.length) return c.data;
  let a = nullCache.get(c.data);
  if (!a) {
    const d = c.data, n = d.length;
    a = new Array<number | null>(n);
    for (let i = 0; i < n; i++) { const v = d[i]; a[i] = v === v ? v : null; }
    nullCache.set(c.data, a);
  }
  return a;
}

/** Volta de referência sobreposta à volta selecionada, na grade de amostras da selecionada:
 *  no tempo, alinhada pelo início da volta (t − início da selecionada + início da ref.); na
 *  distância, pela distância normalizada (como o delta do core). null fora da volta. */
export interface Overlay { sel: Lap; ref: Lap }
const ovCache = new WeakMap<Float64Array, Map<string, (number | null)[]>>();
const xIds = new WeakMap<Float64Array, number>();
let xSeq = 0;
const xId = (X: Float64Array): number => { let k = xIds.get(X); if (k === undefined) { k = ++xSeq; xIds.set(X, k); } return k; };
export function overlayArray(c: Channel, t: Float64Array, X: Float64Array, ov: Overlay): (number | null)[] {
  const key = `${X === t ? 't' : 'd' + xId(X)}|${ov.sel.i0}-${ov.sel.i1}|${ov.ref.i0}-${ov.ref.i1}`;
  let m = ovCache.get(c.data);
  if (!m) { m = new Map(); ovCache.set(c.data, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const d = c.data, n = d.length, out = new Array<number | null>(n).fill(null);
  const { sel, ref } = ov;
  const P = X === t ? t : X;                 /* eixo do alinhamento */
  const s0 = P[sel.i0], r0 = P[ref.i0];
  const sSpan = P[sel.i1] - s0, rSpan = P[ref.i1] - r0;
  const timeMode = X === t;
  if (!timeMode && !(sSpan > 0 && rSpan > 0)) { m.set(key, out); return out; }
  let j = ref.i0;
  for (let i = sel.i0; i <= sel.i1; i++) {
    const q = timeMode ? P[i] - s0 + r0 : r0 + (P[i] - s0) / sSpan * rSpan;
    if (q > P[ref.i1]) break;
    while (j < ref.i1 && P[j + 1] <= q) j++;
    const j1 = Math.min(ref.i1, j + 1);
    const a = d[j], b = d[j1], dp = P[j1] - P[j];
    let v: number;
    if (!(a === a)) v = NaN;
    else if (!(b === b) || !(dp > 0)) v = a;
    else v = a + (b - a) * (q - P[j]) / dp;
    out[i] = v === v ? v : null;
  }
  m.set(key, out);
  if (m.size > 24) m.delete(m.keys().next().value!);
  return out;
}

/** Índice da amostra da volta de referência alinhada com a amostra i da selecionada
 *  (-1 fora da volta) — para o valor da referência no cursor. */
export function refIndexAt(t: Float64Array, X: Float64Array, ov: Overlay, i: number): number {
  const { sel, ref } = ov;
  if (i < sel.i0 || i > sel.i1) return -1;
  if (X === t) {
    const q = t[i] - sel.t0 + ref.t0;
    return q > ref.t1 ? -1 : Math.max(ref.i0, Math.min(ref.i1, idxAt(t, q)));
  }
  const s0 = X[sel.i0], r0 = X[ref.i0], sSpan = X[sel.i1] - s0, rSpan = X[ref.i1] - r0;
  if (!(sSpan > 0 && rSpan > 0)) return -1;
  const q = r0 + (X[i] - s0) / sSpan * rSpan;
  return Math.max(ref.i0, Math.min(ref.i1, idxAt(X, q)));
}

/** Busca sem acento e sem caixa. */
export const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Casas decimais dos rótulos de um eixo pela distância entre marcas. */
export const tickDecimals = (step: number): number => {
  if (!(step > 0) || !isFinite(step)) return 0;
  return Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9)));
};
