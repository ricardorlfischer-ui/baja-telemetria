/* Limpeza da trajetória do GPS (novo, não é porte): tira do cálculo as posições que não são
 * o carro, antes da trajetória (computeTrack, que continua igual ao app antigo). Só tira
 * pontos, com motivo; nunca inventa nem move posição. Vale para o log da FT (código 0–255
 * do PIC nas entradas 7/8); o log do BUSMASTER (lat/lon com fix 3D) não passa por aqui.
 *
 * Por que precisa (firmware do PIC, gps_pos.c, e os logs de 14/10):
 *   - antes de ter posição o PIC manda X = Y = 128 (2,51 V, o centro exato) e, sem fix, repete
 *     a última posição: o log "salta" do centro para a pista e de volta;
 *   - fora da área o código trava em 0 ou 255 (borda): a posição real é desconhecida;
 *   - entre um log e outro (logs juntados) o carro andou com a FT desligada;
 *   - a velocidade do GPS é a diferença de posição em ±0,5 s: um salto de 160 m vira 500 km/h.
 *
 * Regras, nesta ordem (cada amostra tirada guarda o motivo):
 *   edge   código ≤ 0 ou ≥ 255 em qualquer eixo (fora da área do track_config.h);
 *   noPos  centro exato (128, 128) parado ≥ 1 s, com salto (> 6 passos) para entrar ou
 *          sair e do outro lado outro salto ou a ponta do log: é o "sem posição" do PIC;
 *   jump   entre duas amostras seguidas a distância passa de vmax·Δt (Δt ≥ 0,25 s, a taxa do
 *          GPS) + 3 passos: a trajetória é cortada ali, sai 0,5 s de cada lado (a velocidade
 *          não atravessa o corte) e trechos de menos de 2 s entre cortes saem inteiros;
 *   once   longe do centro (> core m) e numa região por onde o carro passou menos de
 *          minPasses vezes (células de 5 m com as 8 vizinhas; uma passagem = visitas
 *          separadas por mais de 10 s): perto do centro fica tudo, longe vale o que se repete;
 *   speed  garantia final: se a velocidade da trajetória ainda passar de vmax em algum
 *          ponto, ele sai e a trajetória é refeita (até 4 vezes). */
import type { Session, TrackConfig } from './types';
import { computeTrack, detectFmt, spanOf, toCode, type Track } from './gps';

export interface GpsCleanOpts {
  vmax: number;                  /* km/h, velocidade máxima aceitável do carro */
  core: number;                  /* m, raio em torno do centro onde todo ponto fica */
  minPasses: number;             /* passagens mínimas longe do centro */
}

export const GPS_CLEAN_DEFAULT: GpsCleanOpts = { vmax: 70, core: 50, minPasses: 2 };

/** Opções efetivas pelos campos gps* da pista (padrão GPS_CLEAN_DEFAULT). */
export const gpsCleanOpts = (cfg: Partial<TrackConfig>): GpsCleanOpts => {
  const d = GPS_CLEAN_DEFAULT;
  const num = (v: unknown, def: number, ok: (x: number) => boolean) => (typeof v === 'number' && isFinite(v) && ok(v) ? v : def);
  return {
    vmax: num(cfg.gpsVmax, d.vmax, x => x > 5),
    core: num(cfg.gpsCore, d.core, x => x >= 0),
    minPasses: Math.round(num(cfg.gpsMinPasses, d.minPasses, x => x >= 1)),
  };
};

export type GpsCleanReason = 'edge' | 'noPos' | 'jump' | 'once' | 'speed';
export const GPS_CLEAN_REASONS: GpsCleanReason[] = ['edge', 'noPos', 'jump', 'once', 'speed'];
export const GPS_CLEAN_LABEL: Record<GpsCleanReason, string> = {
  edge: 'fora da área (código na borda)',
  noPos: 'sem posição do PIC (centro exato)',
  jump: 'salto impossível',
  once: 'passou uma vez só, longe do centro',
  speed: 'acima da velocidade máxima',
};
const CODE: Record<GpsCleanReason, number> = { edge: 1, noPos: 2, jump: 3, once: 4, speed: 5 };

export interface GpsCleanReport {
  opts: GpsCleanOpts;
  bad: Uint8Array;               /* por amostra: 0 = mantida (ou sem posição no log), 1..5 = motivo (ordem de GPS_CLEAN_REASONS) */
  counts: Record<GpsCleanReason, number>;   /* amostras tiradas por motivo */
  total: number;                 /* amostras com posição no log */
  removed: number;
  pct: number;                   /* % das amostras com posição que saíram */
  breaks: number;                /* cortes por salto impossível */
  vmaxRaw: number;               /* km/h, velocidade máx. da trajetória sem a limpeza */
  vmax: number;                  /* km/h, depois da limpeza (NaN sem trajetória) */
}

const maxOf = (a: ArrayLike<number>): number => { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; };

/** Limpa as posições do GPS da FT e devolve a sessão só para a trajetória (os canais X/Y com
 *  NaN onde saiu), a trajetória dela e o relatório. null = nada a limpar aqui (BUSMASTER,
 *  sem canais X/Y). A sessão original não muda. */
export function gpsClean(S: Session, cfg: TrackConfig): { S: Session; track: Track; report: GpsCleanReport } | null {
  if (S.gps) return null;
  const cx = S.channels.find(c => c.key === cfg.chX), cy = S.channels.find(c => c.key === cfg.chY);
  if (!cx || !cy) return null;
  const o = gpsCleanOpts(cfg), t = S.t, n = t.length;
  const fmt = cfg.fmt === 'auto' ? detectFmt(cx.data) : cfg.fmt;
  const coded = fmt !== 'm';
  const span = spanOf(cfg), res = { x: span.x / 255, y: span.y / 255 };
  const step = coded ? Math.max(res.x, res.y) : 1;
  const cs = cfg.chStatus ? S.channels.find(c => c.key === cfg.chStatus) : null;

  /* posição de cada amostra como o computeTrack lê (antes de tirar o degrau e suavizar) */
  const X = new Float64Array(n).fill(NaN), Y = new Float64Array(n).fill(NaN);
  const A = new Float64Array(n).fill(NaN), B = new Float64Array(n).fill(NaN);
  const has = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const vx = cx.data[i], vy = cy.data[i];
    if (vx !== vx || vy !== vy || t[i] !== t[i]) continue;
    if (cs) { const st = cs.data[i]; if (!(fmt === 'm' ? st >= 254 : toCode(st, fmt) >= 254)) continue; }
    if (coded) { A[i] = toCode(vx, fmt); B[i] = toCode(vy, fmt); X[i] = (A[i] - 127.5) * res.x; Y[i] = (B[i] - 127.5) * res.y; }
    else { X[i] = vx; Y[i] = vy; }
    has[i] = 1;
  }
  const bad = new Uint8Array(n);
  const ok = (i: number) => has[i] === 1 && bad[i] === 0;
  let total = 0;
  for (let i = 0; i < n; i++) total += has[i];

  if (coded) {
    /* edge: travado na borda da área */
    for (let i = 0; i < n; i++) if (has[i] && (A[i] < 0.5 || A[i] > 254.5 || B[i] < 0.5 || B[i] > 254.5)) bad[i] = CODE.edge;
    /* noPos: centro exato parado, entrando e saindo por salto (ou na ponta do log) */
    const atC = (i: number) => has[i] === 1 && Math.abs(A[i] - 128) < 0.3 && Math.abs(B[i] - 128) < 0.3;
    /* vizinho da corrida: -1 = ponta do log (ou sem dado), 1 = salto, 0 = chegou andando */
    const side = (i: number, j: number) => (j < 0 || j >= n || !has[j] ? -1 : Math.hypot(A[j] - A[i], B[j] - B[i]) > 6 ? 1 : 0);
    for (let i = 0; i < n;) {
      if (!atC(i)) { i++; continue; }
      let j = i;
      while (j + 1 < n && atC(j + 1)) j++;
      const a = side(i, i - 1), b = side(j, j + 1);
      /* pelo menos um salto de verdade; o log inteiro parado no centro fica */
      if (t[j] - t[i] >= 1 && a !== 0 && b !== 0 && (a === 1 || b === 1)) for (let k = i; k <= j; k++) bad[k] = CODE.noPos;
      i = j + 1;
    }
  }

  /* jump: corta onde a distância entre amostras seguidas é impossível */
  const vms = o.vmax / 3.6;
  const cuts: [number, number][] = [];
  let p = -1;
  for (let i = 0; i < n; i++) {
    if (!ok(i)) continue;
    if (p >= 0) {
      const dt = t[i] - t[p], d = Math.hypot(X[i] - X[p], Y[i] - Y[p]);
      if (d > vms * Math.max(dt, 0.25) + 3 * step) cuts.push([p, i]);
    }
    p = i;
  }
  const GUARD = 0.5, ISLAND = 2;
  for (const [a, b] of cuts) {
    for (let k = a; k >= 0 && t[k] >= t[a] - GUARD; k--) if (ok(k)) bad[k] = CODE.jump;
    for (let k = b; k < n && t[k] <= t[b] + GUARD; k++) if (ok(k)) bad[k] = CODE.jump;
  }
  if (cuts.length) {
    /* trechos curtos entre cortes (ou entre a ponta do log e um corte) */
    const edges = [-1, ...cuts.map(c => c[1]), n];
    for (let s = 0; s + 1 < edges.length; s++) {
      const from = Math.max(0, edges[s]), to = edges[s + 1] - 1;
      let f = -1, l = -1;
      for (let k = from; k <= to; k++) if (ok(k)) { if (f < 0) f = k; l = k; }
      if (f >= 0 && t[l] - t[f] < ISLAND) for (let k = f; k <= l; k++) if (ok(k)) bad[k] = CODE.jump;
    }
  }

  /* once: longe do centro, só onde o carro passou minPasses vezes ou mais */
  if (o.minPasses > 1) {
    const C = 5, GAP = 10;
    const cellOf = (i: number) => `${Math.floor(X[i] / C)},${Math.floor(Y[i] / C)}`;
    const visits = new Map<string, number[]>(), last = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      if (!ok(i) || Math.hypot(X[i], Y[i]) <= o.core) continue;
      const k = cellOf(i), lt = last.get(k);
      if (lt === undefined || t[i] - lt > GAP) { const v = visits.get(k); if (v) v.push(t[i]); else visits.set(k, [t[i]]); }
      last.set(k, t[i]);
    }
    const support = new Map<string, number>();
    const passesAt = (k: string): number => {
      const got = support.get(k);
      if (got !== undefined) return got;
      const [gx, gy] = k.split(',').map(Number);
      const ts: number[] = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const v = visits.get(`${gx + dx},${gy + dy}`); if (v) ts.push(...v); }
      ts.sort((a, b) => a - b);
      let c = 0, prev = -Infinity;
      for (const x of ts) { if (x - prev > GAP) c++; prev = x; }
      support.set(k, c);
      return c;
    };
    for (let i = 0; i < n; i++) if (ok(i) && Math.hypot(X[i], Y[i]) > o.core && passesAt(cellOf(i)) < o.minPasses) bad[i] = CODE.once;
  }

  /* trajetória com o que ficou; speed: garantia final do limite */
  const sessionOf = (): Session => {
    const dx = Float64Array.from(cx.data), dy = Float64Array.from(cy.data);
    for (let i = 0; i < n; i++) if (bad[i]) { dx[i] = NaN; dy[i] = NaN; }
    return { ...S, channels: S.channels.map(c => (c === cx ? { ...c, data: dx } : c === cy ? { ...c, data: dy } : c)) };
  };
  let Sg = sessionOf(), track = computeTrack(Sg, cfg);
  for (let it = 0; it < 4 && track.ok; it++) {
    let hit = 0;
    for (let i = 0; i < n; i++) if (track.valid[i] && track.speed[i] > o.vmax && ok(i)) { bad[i] = CODE.speed; hit++; }
    if (!hit) break;
    Sg = sessionOf(); track = computeTrack(Sg, cfg);
  }

  const counts = Object.fromEntries(GPS_CLEAN_REASONS.map(r => [r, 0])) as Record<GpsCleanReason, number>;
  let removed = 0;
  for (let i = 0; i < n; i++) if (bad[i] && has[i]) { counts[GPS_CLEAN_REASONS[bad[i] - 1]]++; removed++; }
  const raw = computeTrack(S, cfg);
  return {
    S: Sg, track,
    report: {
      opts: o, bad, counts, total, removed, pct: total ? removed / total * 100 : 0, breaks: cuts.length,
      vmaxRaw: raw.ok ? maxOf(raw.speed) : NaN, vmax: track.ok ? maxOf(track.speed) : NaN,
    },
  };
}
