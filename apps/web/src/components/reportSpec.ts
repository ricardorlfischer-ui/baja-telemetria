/* Gráfico de relatório do core → spec do XYPlot (o único conversor; antes havia três:
 * voltas/repPlot.ts, veiculo/shared.tsx repSpec e suspensao/shared.tsx suspSpec).
 *
 * Os relatórios (docs/ARQUITETURA.md 3.4) devolvem o spec do BT.Plot do app antigo sem cores
 * nem callbacks: RepPlot (trem de força, CVT, dinâmica, voltas, mapas) e SuspPlot (suspensão,
 * ressonância). Cada série/barra/marcador traz um papel (`role`, ou o `id` nas séries da
 * suspensão) e os tooltips vêm como RepFmt; aqui o papel vira a cor do tema (pelo nome, o
 * XYPlot resolve) e o RepFmt vira texto. Nenhuma conta. */
import { esc, fmtRep, type RepBarTip, type RepFmt, type RepPlot, type SuspPlot } from '@baja/core';
import type { XYSpec } from './XYPlot';

/** Qualquer gráfico de relatório do core. */
export type ReportPlot = RepPlot | SuspPlot;

/* o que os dois formatos têm em comum (RepPlot e SuspPlot cabem aqui) */
type Nums = ArrayLike<number>;
interface LoosePlot {
  empty?: string;
  series?: { id: string; role?: string; x: Nums; y: Nums; label?: string; width?: number; dots?: { x: number; y: number }[] }[];
  points?: { x: Nums; y: Nums; alpha?: number };
  bars?: { x0: number; w: number; y: Nums; roles?: string[] };
  hlines?: { y: number; role?: string; label?: string }[];
  markers?: { x: number; role?: string; label?: string; row?: number }[];
  circles?: number[];
  legend?: { label: string; role: string }[];
  xLabel?: string; yLabel?: string; logY?: boolean; equal?: boolean; zeroY?: boolean;
  xRange?: [number, number]; yRange?: [number, number];
  tipX?: RepFmt; fmtY?: RepFmt; barTips?: RepBarTip[];
}

/* Papéis dos relatórios da suspensão/ressonância → nome de cor do tema (o antigo usava
 * --pos/--neg/--muted/--c1...). Os outros papéis (FL, c1, muted, ref, cmp, crit...) já são
 * nomes de cor do tema e passam direto. */
const ROLE_ALIAS: Record<string, string> = {
  comp: 'pos', ext: 'neg', knee: 'muted', static: 'fg', band: 'axis', drop: 'fg', peak: 'muted',
  fit: 'c2', brake: 'c2', accel: 'c3', slow: 'c1', fast: 'c2', road: 'c1',
};

/** Nome de cor do tema para um papel do relatório (undefined = cor pela ordem). */
export const reportColor = (role: string | undefined): string | undefined => (role ? ROLE_ALIAS[role] ?? role : undefined);

/** Spec do XYPlot para um gráfico de relatório. `onClick` (x no eixo do gráfico) liga o
 *  "clique = ir ao ponto"; `extra` sobrepõe campos (ex.: yRange igual entre cantos, hi). */
export function reportSpec(p: ReportPlot, opts: { onClick?: (x: number) => void; extra?: Partial<XYSpec> } = {}): XYSpec {
  if (p.empty) return { empty: p.empty, ...opts.extra };
  const r: LoosePlot = p;
  const spec: XYSpec = {
    xLabel: r.xLabel, yLabel: r.yLabel, logY: r.logY, zeroY: r.zeroY, xRange: r.xRange,
    equal: r.equal, yRange: r.yRange, circles: r.circles,
  };
  if (r.series) {
    spec.series = r.series.map(s => ({
      x: s.x, y: s.y, id: s.id, role: s.role, label: s.label, width: s.width, dots: s.dots,
      color: reportColor(s.role ?? s.id),
    }));
  }
  if (r.points) spec.points = { x: r.points.x, y: r.points.y, alpha: r.points.alpha };
  if (r.bars) spec.bars = { x0: r.bars.x0, w: r.bars.w, y: r.bars.y, colors: r.bars.roles?.map(reportColor) };
  if (r.hlines) spec.hlines = r.hlines.map(h => ({ y: h.y, color: reportColor(h.role), label: h.label }));
  if (r.markers) spec.markers = r.markers.map(m => ({ x: m.x, color: reportColor(m.role), label: m.label, row: m.row }));
  if (r.legend) spec.legend = r.legend.map(l => ({ label: l.label, role: l.role, color: reportColor(l.role) }));
  const tx = r.tipX, fy = r.fmtY, bt = r.barTips;
  if (tx) spec.tipX = x => `<b>${esc(fmtRep(tx, x))}</b>`;
  if (fy) spec.fmtY = v => fmtRep(fy, v);
  if (bt) spec.tipBar = k => (bt[k] ? `<b>${esc(bt[k].title)}</b>${bt[k].note ? ' ' + esc(bt[k].note!) : ''}<br>${esc(bt[k].text)}` : '');
  if (opts.onClick) spec.onClick = opts.onClick;
  return opts.extra ? { ...spec, ...opts.extra } : spec;
}
