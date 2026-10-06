/* Guardar um log na biblioteca (docs/ARQUITETURA.md 4.4): no modo local o resumo da sessão
 * (sessionSummary, 3.6) é calculado aqui no navegador; no remoto, o servidor calcula. */
import { computeSession, parseLog, sessionSummary, type SessionContext } from '@baja/core';
import type { Library, LogInput, SessionMeta, SessionSummary } from '../library/types';
import { configInput, useProfiles } from './profiles';

/** Resumo da sessão ou undefined (erro na conta). */
export function trySummary(ctx: SessionContext | null | undefined): SessionSummary | undefined {
  if (!ctx) return undefined;
  try { return sessionSummary(ctx); } catch (e) { console.warn('sessionSummary falhou', e); return undefined; }
}

/** Guarda um log na biblioteca. Modo local: usa o ctx já calculado (ou lê e calcula com a
 *  configuração em uso) para o tipo do log e o resumo. Os perfis ativos vão como carro/pista. */
export async function addLogToLibrary(
  lib: Library,
  input: LogInput,
  meta: Parameters<Library['addSession']>[1] = {},
  ctx?: SessionContext | null,
): Promise<SessionMeta> {
  const P = useProfiles.getState();
  const m: Parameters<Library['addSession']>[1] = {
    ...(P.activeCarId ? { carId: P.activeCarId } : {}),
    ...(P.activeTrackId ? { trackId: P.activeTrackId } : {}),
    ...meta,
  };
  if (lib.mode === 'local') {
    let c = ctx ?? null;
    if (!c) {
      const { name, text } = typeof File !== 'undefined' && input instanceof File
        ? { name: input.name, text: await input.text() }
        : (input as { name: string; text: string });
      const S = parseLog(text, name);
      c = computeSession(S, configInput(false), {});
      input = { name, text };
    }
    m.kind = c.S.kind;
    const summary = trySummary(c);
    if (summary) m.summary = summary;
  }
  return lib.addSession(input, m);
}
