/* Curso dos amortecedores no trecho, no tempo: para achar o teste de queda e escolher a janela
 * que "Analisar trecho dos gráficos" usa. Arrastar = janela dos gráficos (setView, a mesma da
 * página Canais); duplo clique = volta ao todo; clique = ir ao ponto; linha = cursor do play. */
import { useEffect, useMemo, useRef } from 'react';
import type uPlot from 'uplot';
import type { ActiveShock, SessionContext } from '@baja/core';
import { UPlotChart, type UPlotHandle } from '../../components';
import { useCursorEffect, useSessionStore } from '../../state/session';

export function ShockTimeChart({ ctx, i0, i1, height = 260 }: { ctx: SessionContext; i0: number; i1: number; height?: number }) {
  const ref = useRef<UPlotHandle>(null);
  const view = useSessionStore(s => s.view);
  const setView = useSessionStore(s => s.setView);
  const resetView = useSessionStore(s => s.resetView);
  const seek = useSessionStore(s => s.seek);
  const act = useMemo(() => ctx.susp.shocks.filter((k): k is ActiveShock => k.active), [ctx]);
  const data = useMemo<uPlot.AlignedData>(
    () => [ctx.S.t.subarray(i0, i1 + 1), ...act.map(k => k.disp.subarray(i0, i1 + 1))],
    [ctx, act, i0, i1],
  );
  const series = useMemo(() => act.map(k => ({ label: k.id, id: k.id })), [act]);

  /* a janela da store (de qualquer página) aparece aqui como zoom */
  useEffect(() => {
    const h = ref.current;
    if (!h) return;
    if (view) h.setXRange(view[0], view[1]); else h.resetX();
  }, [view, data]);
  useCursorEffect(t => ref.current?.setCursorTime(t));

  return (
    <UPlotChart
      ref={ref} data={data} series={series} height={height}
      xLabel="tempo (s)" yLabel="mm (+ = comprimido)"
      xRange={view ?? undefined}
      onZoom={r => { if (r) setView(r); else resetView(); }}
      onClick={x => seek(x)}
    />
  );
}
