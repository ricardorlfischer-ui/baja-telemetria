/* Um conversor só (components/reportSpec.ts) no lugar dos três que havia (voltas/repPlot.ts,
 * veiculo/shared.tsx repSpec, suspensao/shared.tsx suspSpec). Este teste guarda uma cópia dos
 * antigos e confere, para todos os gráficos dos relatórios do exemplo e de logs reais, que o
 * desenho sai igual: mesmas cores resolvidas no tema (séries, barras, marcadores, linhas,
 * legenda, nos dois temas), mesmos eixos e mesmos textos de tooltip. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeSession, cvtReport, demoCSV, dynamicsReport, esc, fmtRep, lapReport, parseCSV, parseLog, powertrainReport,
  resonanceReport, suspensionReport, type RepPlot, type SessionContext, type SuspPlot,
} from '@baja/core';
import { reportSpec } from '../src/components/reportSpec';
import { seriesColor, type XYSpec } from '../src/components/XYPlot';
import { CHART_DARK, CHART_LIGHT, resolveColor, type ChartTheme } from '../src/theme';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/core/test/fixtures');

/* ------------------------------------------------ cópia dos conversores antigos */
const ROLE_COLOR: Record<string, string> = {
  comp: 'pos', ext: 'neg', knee: 'muted', static: 'fg', band: 'axis', drop: 'fg', peak: 'muted',
  fit: 'c2', brake: 'c2', accel: 'c3', slow: 'c1', fast: 'c2', road: 'c1',
};
const roleColor = (th: ChartTheme, role: string | undefined): string => resolveColor(th, role ? ROLE_COLOR[role] ?? role : undefined) ?? th.fg;
function oldSuspSpec(p: SuspPlot, th: ChartTheme): XYSpec {
  if (p.empty) return { empty: p.empty };
  const tipX = p.tipX, fmtY = p.fmtY, tips = p.barTips;
  return {
    series: p.series?.map(s => ({ x: s.x, y: s.y, label: s.label, width: s.width, dots: s.dots, color: roleColor(th, s.id) })),
    bars: p.bars && { x0: p.bars.x0, w: p.bars.w, y: p.bars.y, colors: p.bars.roles.map(r => roleColor(th, r)) },
    points: p.points && { x: p.points.x, y: p.points.y, alpha: p.points.alpha, color: th.series[0] },
    markers: p.markers?.map(m => ({ x: m.x, label: m.label, row: m.row, color: roleColor(th, m.role) })),
    legend: p.legend?.map(l => ({ label: l.label, color: roleColor(th, l.role) })),
    xLabel: p.xLabel, yLabel: p.yLabel, logY: p.logY, zeroY: p.zeroY, xRange: p.xRange,
    tipX: tipX ? x => `<b>${fmtRep(tipX, x)}</b>` : undefined,
    fmtY: fmtY ? v => fmtRep(fmtY, v) : undefined,
    tipBar: tips ? k => (tips[k] ? `<b>${esc(tips[k].title)}</b>${tips[k].note ? ' ' + esc(tips[k].note!) : ''}<br>${esc(tips[k].text)}` : '') : undefined,
  };
}
function oldRepSpec(p: RepPlot): XYSpec {
  if (p.empty) return { empty: p.empty };
  const tipX = p.tipX, fmtY = p.fmtY, tips = p.barTips;
  return {
    series: p.series?.map(q => ({ x: q.x, y: q.y, id: q.id, color: q.role, label: q.label, width: q.width })),
    points: p.points ? { x: p.points.x, y: p.points.y, alpha: p.points.alpha } : undefined,
    bars: p.bars ? { x0: p.bars.x0, w: p.bars.w, y: p.bars.y, colors: p.bars.roles } : undefined,
    hlines: p.hlines?.map(l => ({ y: l.y, color: l.role, label: l.label })),
    markers: p.markers?.map(m => ({ x: m.x, color: m.role, label: m.label })),
    circles: p.circles, xLabel: p.xLabel, yLabel: p.yLabel, logY: p.logY, equal: p.equal,
    xRange: p.xRange, yRange: p.yRange, zeroY: p.zeroY,
    legend: p.legend?.map(l => ({ label: l.label, role: l.role })),
    tipX: tipX ? (x: number) => `<b>${esc(fmtRep(tipX, x))}</b>` : undefined,
    fmtY: fmtY ? (v: number) => fmtRep(fmtY, v) : undefined,
    tipBar: tips ? (k: number) => { const b = tips[k]; return b ? `<b>${esc(b.title)}</b>${b.note ? ' ' + esc(b.note) : ''}<br>${esc(b.text)}` : ''; } : undefined,
  };
}

/* ------------------------------------------------ o que o XYPlot desenha de um spec */
function drawn(s: XYSpec, th: ChartTheme) {
  const xs = [-100, -1, 0, 0.5, 3, 42.7, 1000];
  const legend = s.legend
    ? s.legend.map((l, i) => [l.label, seriesColor(th, l, i)])
    : (s.series || []).length > 1 ? (s.series || []).map((q, i) => [q.label, seriesColor(th, q, i)]).filter(l => l[0]) : [];
  return {
    empty: s.empty,
    series: (s.series || []).map((q, i) => ({ c: seriesColor(th, q, i), label: q.label, width: q.width, n: q.x.length, dots: q.dots?.length })),
    bars: s.bars && { x0: s.bars.x0, w: s.bars.w, n: s.bars.y.length, c: Array.from(s.bars.y, (_, k) => (s.bars!.colors && resolveColor(th, s.bars!.colors[k])) || resolveColor(th, s.bars!.color) || th.series[0]) },
    points: s.points && { n: s.points.x.length, c: resolveColor(th, s.points.color) ?? th.series[0], a: s.points.alpha },
    markers: (s.markers || []).map(m => [m.x, m.label, m.row, resolveColor(th, m.color) ?? th.fg]),
    hlines: (s.hlines || []).map(l => [l.y, l.label, resolveColor(th, l.color) ?? th.fg]),
    legend,
    axes: [s.xLabel, s.yLabel, s.logY, s.zeroY, s.xRange, s.yRange, s.equal, s.circles],
    tipX: s.tipX && xs.map(s.tipX), fmtY: s.fmtY && xs.map(s.fmtY),
    tipBar: s.tipBar && s.bars && Array.from(s.bars.y, (_, k) => s.tipBar!(k)),
  };
}

/* gráficos de um relatório: objetos com explain + sensors + algo para desenhar ou empty */
function plotsOf(o: unknown, out: (RepPlot | SuspPlot)[] = [], seen = new Set<unknown>()): (RepPlot | SuspPlot)[] {
  if (!o || typeof o !== 'object' || seen.has(o) || ArrayBuffer.isView(o)) return out;
  seen.add(o);
  const r = o as Record<string, unknown>;
  if (typeof r.explain === 'string' && Array.isArray(r.sensors) && ('series' in r || 'bars' in r || 'points' in r || 'hlines' in r || ('empty' in r && ('key' in r || 'id' in r))))
    out.push(r as unknown as RepPlot);
  for (const v of Array.isArray(o) ? o : Object.values(r)) plotsOf(v, out, seen);
  return out;
}

function reports(ctx: SessionContext) {
  const n = ctx.S.t.length, i1 = n - 1;
  const susp = [...plotsOf(suspensionReport(ctx, 0, i1)), ...plotsOf(resonanceReport(ctx, 0, i1, {}))] as SuspPlot[];
  const rep = [
    ...plotsOf(powertrainReport(ctx, 0, i1)), ...plotsOf(cvtReport(ctx, 0, i1)), ...plotsOf(dynamicsReport(ctx, 0, i1)),
  ] as RepPlot[];
  const laps = plotsOf(lapReport(ctx)) as RepPlot[];
  return { susp, rep, laps };
}

const demo = () => { const S = parseCSV(demoCSV(), 'exemplo.csv'); S.demo = true; return computeSession(S, {}, { autoLine: true }); };
const real = (f: string) => computeSession(parseLog(readFileSync(path.join(FIX, f), 'utf8'), f), {});

describe('reportSpec = os três conversores antigos', () => {
  const cases: [string, () => SessionContext][] = [
    ['exemplo', demo], ['ft_log3_shocks_compact.csv', () => real('ft_log3_shocks_compact.csv')], ['ft_log3_gps.csv', () => real('ft_log3_gps.csv')],
  ];
  for (const [name, mk] of cases) {
    it(name, () => {
      const { susp, rep, laps } = reports(mk());
      expect(susp.length + rep.length).toBeGreaterThan(3);
      for (const th of [CHART_DARK, CHART_LIGHT]) {
        susp.forEach(p => expect(drawn(reportSpec(p), th), `${name} · ${p.key}`).toEqual(drawn(oldSuspSpec(p, th), th)));
        rep.forEach(p => expect(drawn(reportSpec(p), th), `${name} · ${p.id}`).toEqual(drawn(oldRepSpec(p), th)));
        /* voltas: repToSpec antigo = mesmo que repSpec nas cores (id/role sem cor explícita) */
        laps.forEach(p => {
          const old = oldRepSpec(p);
          old.series = old.series?.map(q => ({ ...q, color: undefined, role: p.series!.find(s => s.id === q.id)!.role }));
          expect(drawn(reportSpec(p), th), `${name} · ${p.id}`).toEqual(drawn(old, th));
        });
      }
    });
  }

  it('clique: o onClick vai para o spec (ir ao ponto) e extra sobrepõe', () => {
    const ctx = demo();
    const lr = lapReport(ctx);
    expect(lr.speed?.clickSeek).toBe(true);
    let got = NaN;
    const s = reportSpec(lr.speed!, { onClick: x => { got = x; }, extra: { yRange: [0, 99] } });
    s.onClick!(12.5);
    expect(got).toBe(12.5);
    expect(s.yRange).toEqual([0, 99]);
    expect(reportSpec({ id: 'x', explain: 'a.b', sensors: [], empty: 'sem dados' }).empty).toBe('sem dados');
  });
});
