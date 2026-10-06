/* Comparar sessões: carrega o texto de uma sessão da biblioteca e calcula o que os gráficos
 * sobrepostos precisam (histogramas de velocidade do amortecedor e a melhor volta), com os
 * perfis de carro e pista da própria sessão. Tudo pelo core (parseLog → computeSession →
 * suspensionReport / bestLap + lapProfile / sessionSummary); aqui só a orquestração e um
 * cache em memória (o contexto inteiro não fica guardado, só o que a página desenha). */
import {
  bestLap, computeSession, lapProfile, parseLog, sessionSummary, suspensionReport,
  type AnalysisConfigInput, type CornerId, type SensorId, type SessionSummary,
} from '@baja/core';
import type { Library, SessionMeta } from '../../library/types';
import { useProfiles } from '../../state/profiles';

export interface LoadedHist { x0: number; w: number; y: ArrayLike<number>; sensors: SensorId[] }

export interface LoadedSession {
  /** resumo calculado agora (com os perfis da sessão) */
  summary: SessionSummary | null;
  /** histograma de velocidade por canto com sinal (suspensionReport, sessão inteira) */
  velHist: Partial<Record<CornerId, LoadedHist>>;
  /** sem amortecedor com sinal: o texto do core (canais encontrados) */
  shocksEmpty: string | null;
  /** melhor volta (distância e velocidade do GPS) */
  lap: { n: number; time: number; d: Float64Array; v: Float64Array } | null;
  lapMsg: string | null;
  nLaps: number;
  /** perfis usados na conta */
  carName: string;
  trackName: string;
}

/** Configuração da conta para uma sessão: os perfis de carro/pista guardados com ela (quando
 *  existem nesta biblioteca); senão a configuração em uso — o mesmo que openFromLibrary faz. */
export function configFor(meta: SessionMeta): { input: AnalysisConfigInput; carName: string; trackName: string } {
  const P = useProfiles.getState();
  const carP = meta.carId ? P.cars.find(c => c.id === meta.carId) : undefined;
  const trP = meta.trackId ? P.tracks.find(t => t.id === meta.trackId) : undefined;
  const track = trP ? { ...trP.params } : { ...P.draft.track };
  let car = { ...P.draft.car }, susp = { ...P.draft.susp };
  if (carP) {
    const { susp: ps, ...pc } = carP.params;
    car = { ...pc }; susp = { ...(ps || {}) };
  }
  const input: AnalysisConfigInput = { ...track, susp, car };
  if (P.formulas.length) input.formulas = P.formulas.map(f => ({ ...f }));
  return {
    input,
    carName: carP ? carP.name : 'configuração em uso',
    trackName: trP ? trP.name : 'configuração em uso',
  };
}

const cache = new Map<string, Promise<LoadedSession>>();

/** Cede o frame para a barra de progresso aparecer antes da conta pesada. */
export const yieldFrame = (): Promise<void> => new Promise(res => setTimeout(res, 16));

/** Carrega e calcula (com cache por sessão + configuração). */
export function loadSession(lib: Library, meta: SessionMeta): Promise<LoadedSession> {
  const { input, carName, trackName } = configFor(meta);
  const key = `${lib.mode}|${meta.id}|${meta.size}|${JSON.stringify(input)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async (): Promise<LoadedSession> => {
    const text = await lib.getSessionText(meta.id);
    await yieldFrame();
    const S = parseLog(text, meta.fileName || meta.name);
    const ctx = computeSession(S, input, {});
    const n = S.t.length;
    let summary: SessionSummary | null = null;
    try { summary = sessionSummary(ctx); } catch (e) { console.warn('sessionSummary falhou', e); }
    const sr = suspensionReport(ctx, 0, n - 1);
    const velHist: LoadedSession['velHist'] = {};
    sr.velHist.forEach(h => {
      if (!h.bars) return;
      const id = h.key.slice(3) as CornerId;
      velHist[id] = { x0: h.bars.x0, w: h.bars.w, y: Array.from(h.bars.y), sensors: h.sensors };
    });
    let lap: LoadedSession['lap'] = null, lapMsg: string | null = null;
    if (!ctx.track.ok) lapMsg = 'sem posição do GPS neste log';
    else if (!ctx.laps.length) lapMsg = 'nenhuma volta completa (defina a linha de largada no perfil da pista)';
    else {
      const b = bestLap(ctx.laps), L = ctx.laps[b];
      const pr = lapProfile(ctx.S, ctx.track, L);
      lap = { n: L.n, time: L.time, d: pr.d, v: pr.v };
    }
    return { summary, velHist, shocksEmpty: sr.hasShocks ? null : sr.empty, lap, lapMsg, nLaps: ctx.laps.length, carName, trackName };
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}
