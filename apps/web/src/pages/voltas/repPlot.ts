/* Spec do XYPlot a partir de um gráfico de relatório do core (RepPlot: formato do BT.Plot sem
 * cores nem callbacks). As cores saem do tema pelo id/role; os textos do tooltip pelo RepFmt.
 * Sugestão (deviations): mover para src/components, todas as páginas de análise precisam. */
import { esc, fmtRep, type RepPlot } from '@baja/core';
import type { XYSpec } from '../../components';

export function repToSpec(p: RepPlot, onClick?: (x: number) => void): XYSpec {
  const spec: XYSpec = {
    xLabel: p.xLabel, yLabel: p.yLabel, logY: p.logY, equal: p.equal, xRange: p.xRange, yRange: p.yRange,
    zeroY: p.zeroY, circles: p.circles, empty: p.empty,
  };
  if (p.series) spec.series = p.series.map(s => ({ x: s.x, y: s.y, id: s.id, role: s.role, label: s.label, width: s.width }));
  if (p.points) spec.points = { x: p.points.x, y: p.points.y, alpha: p.points.alpha };
  if (p.bars) spec.bars = { x0: p.bars.x0, w: p.bars.w, y: p.bars.y, colors: p.bars.roles };
  if (p.hlines) spec.hlines = p.hlines.map(h => ({ y: h.y, color: h.role, label: h.label }));
  if (p.markers) spec.markers = p.markers.map(m => ({ x: m.x, color: m.role, label: m.label }));
  if (p.legend) spec.legend = p.legend.map(l => ({ label: l.label, role: l.role }));
  const tx = p.tipX, fy = p.fmtY, bt = p.barTips;
  if (tx) spec.tipX = x => `<b>${esc(fmtRep(tx, x))}</b>`;
  if (fy) spec.fmtY = v => fmtRep(fy, v);
  if (bt) spec.tipBar = k => (bt[k] ? `<b>${esc(bt[k].title)}</b>${bt[k].note ? ' ' + esc(bt[k].note) : ''}<br>${esc(bt[k].text)}` : '');
  if (p.clickSeek && onClick) spec.onClick = onClick;
  return spec;
}
