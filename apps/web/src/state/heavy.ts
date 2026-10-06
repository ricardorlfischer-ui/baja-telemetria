/* Contas pesadas das páginas com logs grandes.
 *
 * Os relatórios do core rodam no navegador, na hora de desenhar a página (useMemo). Num log de
 * centenas de milhares de amostras (ex.: 28 MB, 380 mil linhas) a ficha, a suspensão ou a
 * ressonância levam segundos: a aba congelava logo depois do clique no menu, sem nenhum aviso.
 * useComputed faz o mesmo que o useMemo, mas, com log grande, primeiro desenha o aviso
 * "Calculando…" (a página recebe null) e só depois de pintar roda a conta. Log pequeno: na
 * hora, igual ao useMemo (sem piscar). */
import { useEffect, useMemo, useRef, useState, type DependencyList } from 'react';
import { dataQuality, type DataQuality, type SessionContext } from '@baja/core';
import { useSessionStore } from './session';

/** Acima disto (amostras no log) as contas das páginas esperam o aviso aparecer. */
export const BIG_LOG = 50_000;

/** Roda fn depois do próximo quadro pintado (aba em segundo plano: no máximo ~80 ms depois). */
function afterPaint(fn: () => void): () => void {
  let started = false, raf = 0;
  let t2: ReturnType<typeof setTimeout> | undefined;
  const go = () => { if (started) return; started = true; t2 = setTimeout(fn, 0); };
  if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(go);
  const t1 = setTimeout(go, 80);
  return () => {
    started = true;
    if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    clearTimeout(t1);
    if (t2 !== undefined) clearTimeout(t2);
  };
}

const sameDeps = (a: DependencyList, b: DependencyList) => a.length === b.length && a.every((d, i) => Object.is(d, b[i]));

/** useMemo para as contas pesadas: devolve null enquanto calcula um log grande (a página mostra
 *  <ComputingState />). Erro na conta vai para a página (e para o PageErrorBoundary), como no
 *  useMemo. `deps` com tamanho fixo, como no useMemo. */
export function useComputed<T>(fn: () => T, deps: DependencyList): T | null {
  const big = useSessionStore(s => !!s.S && s.S.t.length > BIG_LOG);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  /* log pequeno: na hora */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => (big ? null : { v: fn() }), [big, ...deps]);
  /* log grande: depois de pintar o aviso */
  const [done, setDone] = useState<{ deps: DependencyList; v?: T; err?: unknown } | null>(null);
  const fresh = !!done && sameDeps(done.deps, deps);
  useEffect(() => {
    if (!big || fresh) return;
    const d = deps;
    return afterPaint(() => {
      try { setDone({ deps: d, v: fnRef.current() }); } catch (e) { setDone({ deps: d, err: e }); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [big, fresh, ...deps]);
  if (!big) return now!.v;
  if (!fresh) return null;
  if (done!.err !== undefined) throw done!.err;
  return done!.v as T;
}

/* ---------------------------------------------------------------- qualidade dos dados */
/** dataQuality(S, ctx) do core, ou o erro da conta. */
export interface QualityResult { dq: DataQuality | null; err: string | null }
const qualityCache = new WeakMap<SessionContext, QualityResult>();

/** Qualidade dos dados do log aberto, calculada uma vez por contexto (memória por ctx) e
 *  compartilhada pelas páginas (Visão geral, Aquisição, Carro, Pista) — antes cada página
 *  recalculava a sua. */
export function qualityOf(ctx: SessionContext): QualityResult {
  let q = qualityCache.get(ctx);
  if (!q) {
    try { q = { dq: dataQuality(ctx.S, ctx), err: null }; } catch (e) {
      console.error(e);
      q = { dq: null, err: e instanceof Error ? e.message : String(e) };
    }
    qualityCache.set(ctx, q);
  }
  return q;
}

/** Qualidade dos dados da sessão aberta (null sem sessão, ou enquanto um log grande calcula
 *  pela primeira vez: a página mostra o aviso). Não re-renderiza com o cursor. */
export function useQuality(): QualityResult | null {
  const ctx = useSessionStore(s => s.ctx);
  const cached = ctx ? qualityCache.get(ctx) : undefined;
  const lazy = useComputed(() => (ctx && !cached ? qualityOf(ctx) : null), [ctx, !!cached]);
  return ctx ? cached ?? lazy : null;
}

/** dataQuality da sessão aberta (null sem sessão, calculando ou se a conta falhou). */
export const useDataQuality = (): DataQuality | null => useQuality()?.dq ?? null;
