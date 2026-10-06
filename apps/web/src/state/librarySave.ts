/* Guardar um log na biblioteca (docs/ARQUITETURA.md 4.4): no modo local o resumo da sessão
 * (sessionSummary, 3.6) é calculado aqui no navegador; no remoto, o servidor calcula. */
import * as core from '@baja/core';
import { computeSession, parseLog, type SessionContext } from '@baja/core';
import type { Library, LogInput, SessionMeta, SessionSummary } from '../library/types';
import { configInput, useProfiles } from './profiles';

type SummaryFn = (ctx: SessionContext) => SessionSummary;

/** sessionSummary do core, se o módulo summary.ts já exportar.
 *  TODO(resumo): quando summary.ts estiver pronto, importar sessionSummary direto (e o tipo
 *  SessionSummary em library/types.ts) e apagar esta verificação. */
export function summaryFn(): SummaryFn | null {
  const name = 'sessionSummary';
  const fn = (core as unknown as Record<string, unknown>)[name];
  return typeof fn === 'function' ? (fn as SummaryFn) : null;
}

/** Resumo da sessão ou undefined (core sem sessionSummary, ou erro na conta). */
export function trySummary(ctx: SessionContext | null | undefined): SessionSummary | undefined {
  const fn = summaryFn();
  if (!fn || !ctx) return undefined;
  try { return fn(ctx); } catch (e) { console.warn('sessionSummary falhou', e); return undefined; }
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
