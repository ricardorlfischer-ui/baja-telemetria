/* Partes da página Comparar sessões: tabela métricas × sessões, métrica ao longo das datas e
 * os gráficos sobrepostos (histogramas de velocidade do amortecedor e melhor volta). Os
 * números vêm do resumo da sessão (sessionSummary) e dos relatórios do core; aqui só a
 * diferença para a primeira sessão (subtração, para mostrar) e o desenho. */
import { Fragment, useMemo } from 'react';
import { Select, Stack, UnstyledButton } from '@mantine/core';
import { IconArrowDownRight, IconArrowUpRight, IconEqual } from '@tabler/icons-react';
import { fmtTime, SENSOR_IDS, type CornerId, type SensorId, type SessionSummary, type SummaryMetric } from '@baja/core';
import { ChartCard, EmptyState, InfoButton, SensorChips, useExplain, XYPlot, type XYSeries, type XYSpec } from '../../components';
import { CORNER_LABEL, STATUS_COLOR, useChartTheme, type Status } from '../../theme';
import type { SessionMeta } from '../../library/types';
import type { LoadedSession } from './loader';
import './comparar.css';

/** Uma sessão escolhida, já na ordem das datas (idx 0 = referência das diferenças). */
export interface CmpSession {
  meta: SessionMeta;
  idx: number;
  /** papel da cor (c1..c8): a mesma em todos os gráficos */
  role: string;
  dateText: string;
  summary: SessionSummary | null;
  summarySrc: 'guardado' | 'recalculado' | null;
  loaded: LoadedSession | null;
  error: string | null;
}

const GROUP_ORDER = ['Sessão', 'Suspensão', 'Trem de força', 'CVT', 'Qualidade'];

/* direção "melhor" só onde ela é óbvia (o resto fica neutro, sem cor) */
const BETTER: Record<string, 'lower' | 'higher'> = {
  'session.bestLap': 'lower', 'session.vmax': 'higher', 'power.vmax': 'higher',
  'power.pmax': 'higher', 'power.traction': 'higher',
  'power.launch30': 'lower', 'power.launch20kmh': 'lower', 'power.launchSlip': 'lower',
  'susp.bottomOuts.F': 'lower', 'susp.bottomOuts.R': 'lower',
  'cvt.tmax': 'lower', 'cvt.steady': 'lower', 'cvt.endTemp': 'lower', 'cvt.coolingExtra': 'lower',
  'cvt.margin': 'higher', 'cvt.timeToLimit': 'higher',
  'quality.gpsValid': 'higher', 'quality.sensors': 'higher',
};

/** Casas decimais do texto da métrica ("12.34" → 2), para a diferença sair igual. */
const decOf = (t: string | undefined): number => {
  const m = /^-?\d+(?:\.(\d+))?$/.exec(t ?? '');
  return m ? (m[1]?.length ?? 0) : 2;
};

export interface MetricRow {
  key: string;
  group: string;
  label: string;
  unit: string;
  explain: string;
  /** métrica de cada sessão (undefined = a sessão não tem resumo) */
  cells: (SummaryMetric | undefined)[];
  sensors: SensorId[];
  hasValue: boolean;
}

/** Métricas alinhadas por chave, agrupadas na ordem do resumo. */
export function metricRows(sessions: CmpSession[]): MetricRow[] {
  const keys: string[] = [];
  const first = new Map<string, SummaryMetric>();
  sessions.forEach(s => s.summary?.metrics.forEach(m => { if (!first.has(m.key)) { first.set(m.key, m); keys.push(m.key); } }));
  const rows = keys.map(k => {
    const m0 = first.get(k)!;
    const cells = sessions.map(s => s.summary?.metrics.find(m => m.key === k));
    const set = new Set<SensorId>();
    cells.forEach(c => c?.sensors.forEach(x => set.add(x)));
    return {
      key: k, group: m0.group, label: m0.label, unit: m0.unit, explain: m0.explain, cells,
      sensors: SENSOR_IDS.filter(id => set.has(id)),
      hasValue: cells.some(c => c && (c.value !== null || c.text !== undefined)),
    };
  });
  return GROUP_ORDER.flatMap(g => rows.filter(r => r.group === g)).concat(rows.filter(r => !GROUP_ORDER.includes(r.group)));
}

export function Swatch({ role }: { role: string }) {
  const th = useChartTheme();
  const k = +role.slice(1) - 1;
  return <span className="bt-cmp-swatch" style={{ background: th.series[k] ?? th.muted }} aria-hidden />;
}

/* ---------------------------------------------------------------- tabela métricas × sessões */
export function MetricsTable({ sessions, rows, selected, onSelect }: {
  sessions: CmpSession[]; rows: MetricRow[]; selected: string | null; onSelect: (key: string) => void;
}) {
  const { open } = useExplain();
  let lastGroup = '';
  return (
    <div className="bt-cmp-scroll bt-table-wrap">
      <table className="bt-cmp-table">
        <thead>
          <tr>
            <th className="bt-cmp-first">Métrica e sensores</th>
            {sessions.map(s => (
              <th key={s.meta.id}>
                <div className="bt-cmp-sess">
                  <Swatch role={s.role} />
                  <Stack gap={1}>
                    <b>{s.idx + 1} · {s.meta.name}</b>
                    <span>{s.dateText}{s.idx === 0 ? ' · referência' : ''}</span>
                  </Stack>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const grpRow = r.group !== lastGroup;
            lastGroup = r.group;
            const ref = r.cells[0];
            const dir = BETTER[r.key];
            return (
              <Fragment key={r.key}>
                {grpRow && (
                  <tr className="bt-cmp-grp">
                    <td className="bt-cmp-first">{r.group}</td>
                    <td colSpan={sessions.length} />
                  </tr>
                )}
                <tr className="bt-cmp-row" data-selected={selected === r.key ? '' : undefined} onClick={() => onSelect(r.key)}
                  title="Clique para ver esta métrica ao longo das datas (gráfico abaixo)">
                  <td className="bt-cmp-first">
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, justifyContent: 'space-between' }}>
                      <UnstyledButton className="bt-cmp-label bt-card-title--link"
                        onClick={e => { e.stopPropagation(); open(r.explain, { sensors: r.sensors, title: r.label }); }}>
                        {r.label}{r.unit ? <span className="bt-cmp-unit">({r.unit})</span> : null}
                      </UnstyledButton>
                      <InfoButton explain={r.explain} sensors={r.sensors} title={r.label} size="sm" />
                    </div>
                    {r.sensors.length > 0 && <div style={{ marginTop: 6 }}><SensorChips sensors={r.sensors} availability={{}} /></div>}
                  </td>
                  {r.cells.map((c, j) => {
                    const s = sessions[j];
                    const missing = !c || (c.value === null && c.text === undefined);
                    const shown = !c ? (s.summary ? '—' : 'sem resumo') : c.text ?? (c.value !== null ? String(c.value) : '—');
                    let diff: React.ReactNode = null;
                    if (j > 0 && c && ref && c.value !== null && ref.value !== null) {
                      const d = c.value - ref.value, dec = decOf(c.text);
                      const same = +d.toFixed(dec) === 0;
                      let st: Status | null = null, word = '';
                      if (dir && !same) { const better = dir === 'higher' ? d > 0 : d < 0; st = better ? 'good' : 'serious'; word = better ? 'melhor' : 'pior'; }
                      const Ico = same ? IconEqual : d > 0 ? IconArrowUpRight : IconArrowDownRight;
                      diff = (
                        <span className="bt-cmp-diff" data-status={st ?? undefined} style={st ? { ['--bt-status' as string]: STATUS_COLOR[st] } : undefined}
                          title={dir ? 'Diferença para a sessão 1 (cor só quando a direção “melhor” é óbvia)' : 'Diferença para a sessão 1 (sem “melhor/pior”: depende do objetivo)'}>
                          <Ico size={15} stroke={2.2} aria-hidden />
                          {same ? 'igual' : `${d > 0 ? '+' : ''}${d.toFixed(dec)}${r.unit ? ' ' + r.unit : ''}`}{word ? ` · ${word}` : ''}
                        </span>
                      );
                    }
                    return (
                      <td key={s.meta.id}>
                        <button type="button" className={missing ? 'bt-cmp-val bt-cmp-val--missing' : 'bt-cmp-val'}
                          title="Abrir a explicação com os sensores desta sessão"
                          onClick={e => { e.stopPropagation(); open(r.explain, { sensors: c?.sensors ?? [], title: `${r.label} — ${s.meta.name}` }); }}>
                          {shown}{!missing && r.unit && c?.value !== null ? <span className="bt-cmp-unit">{r.unit}</span> : null}
                        </button>
                        {diff && <div>{diff}</div>}
                      </td>
                    );
                  })}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- métrica ao longo das datas */
export function TrendChart({ sessions, rows, metric, onMetric }: {
  sessions: CmpSession[]; rows: MetricRow[]; metric: string | null; onMetric: (k: string) => void;
}) {
  const { open } = useExplain();
  const th = useChartTheme();
  const row = rows.find(r => r.key === metric) ?? null;
  const data = useMemo(() => rows.filter(r => r.hasValue).map(r => ({ value: r.key, label: `${r.group} · ${r.label}${r.unit ? ` (${r.unit})` : ''}` })), [rows]);
  const vals = row ? row.cells.map(c => (c && c.value !== null ? c.value : NaN)) : [];
  const ok = vals.filter(v => v === v);
  /* barras horizontais a partir do zero (valores negativos à esquerda): uma linha por sessão,
   * com o nome inteiro — mais legível que o eixo numérico para poucas sessões */
  const lo = Math.min(0, ...ok), hi = Math.max(0, ...ok), span = hi - lo || 1;
  const z = (0 - lo) / span * 100;
  return (
    <ChartCard title={row ? `${row.label} ao longo das datas` : 'Métrica ao longo das datas'} explain="design.metricTrend" sensors={row?.sensors}
      subtitle="Uma barra por sessão, da mais antiga (em cima) para a mais nova. Clique numa linha da tabela acima ou escolha aqui a métrica; clique numa barra para ver os sensores daquela sessão."
      actions={(
        <Select size="md" w={340} maw="60vw" searchable data={data} value={metric} onChange={v => v && onMetric(v)}
          aria-label="Métrica do gráfico" placeholder="Métrica" comboboxProps={{ withinPortal: true }} />
      )}>
      {!row || !ok.length ? (
        <EmptyState bare title={row ? 'Nenhuma das sessões tem esta métrica' : 'Escolha uma métrica'}
          description={row ? 'Os sensores ou o teste que esta métrica precisa não estão em nenhuma das sessões escolhidas: abra o ⓘ para ver o que medir.' : undefined} />
      ) : (
        <div className="bt-trend">
          {sessions.map((s, k) => {
            const v = vals[k], c = row.cells[k];
            const has = v === v;
            const a = has ? Math.min(z, (v - lo) / span * 100) : z, w = has ? Math.abs(v - 0) / span * 100 : 0;
            return (
              <button type="button" key={s.meta.id} className="bt-trend-row" title="Abrir a explicação com os sensores desta sessão"
                onClick={() => open(row.explain, { sensors: c?.sensors ?? [], title: `${row.label} — ${s.meta.name}` })}>
                <span className="bt-trend-name"><Swatch role={s.role} /><span><b>{s.idx + 1} · {s.meta.name}</b><small>{s.dateText}</small></span></span>
                <span className="bt-trend-track">
                  {lo < 0 && <i className="bt-trend-zero" style={{ left: `${z}%` }} />}
                  {has && <i className="bt-trend-bar" style={{ left: `${a}%`, width: `${Math.max(w, 0.4)}%`, background: th.series[k] ?? th.muted }} />}
                </span>
                <span className={has ? 'bt-trend-val' : 'bt-trend-val bt-trend-val--missing'}>
                  {has ? <>{c?.text ?? v}{row.unit ? <small> {row.unit}</small> : null}</> : 'sem valor'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </ChartCard>
  );
}

/* ---------------------------------------------------------------- histogramas sobrepostos */
export function ShockOverlay({ sessions, corner }: { sessions: CmpSession[]; corner: CornerId }) {
  const withH = sessions.filter(s => s.loaded?.velHist[corner]);
  const without = sessions.filter(s => s.loaded && !s.loaded.velHist[corner]);
  const sensors = useMemo(() => {
    const set = new Set<SensorId>();
    withH.forEach(s => s.loaded!.velHist[corner]!.sensors.forEach(x => set.add(x)));
    return SENSOR_IDS.filter(id => set.has(id));
  }, [withH, corner]);
  const spec = useMemo<XYSpec>(() => {
    if (!withH.length) return { empty: '' };
    const bw = Math.min(...withH.map(s => s.loaded!.velHist[corner]!.w));
    const same = withH.every(s => s.loaded!.velHist[corner]!.w === bw);
    const series: XYSeries[] = withH.map(s => {
      const h = s.loaded!.velHist[corner]!, f = bw / h.w;
      const x = Array.from(h.y, (_, j) => h.x0 + (j + 0.5) * h.w), y = Array.from(h.y, v => v * f);
      return { x, y, role: s.role, label: `${s.idx + 1} · ${s.meta.name}`, width: 2 };
    });
    return {
      series, legend: series.map(q => ({ label: q.label!, role: q.role })), xLabel: 'velocidade do amortecedor (mm/s, + = compressão)',
      yLabel: same ? '% do tempo' : `% do tempo por ${bw} mm/s`,
      tipX: xx => `<b>${xx.toFixed(0)} mm/s</b>`, fmtY: v => v.toFixed(1) + ' %',
      markers: [{ x: 0, color: 'axis' }],
    };
  }, [withH, corner]);
  const title = `Amortecedor ${corner} · ${CORNER_LABEL[corner]}`;
  const sensor = ('shock_' + corner.toLowerCase()) as SensorId;
  return (
    <ChartCard title={title} explain="chart.shockHistOverlay" sensors={withH.length ? sensors : [sensor]}
      subtitle={withH.length ? 'Mais estreito = mais controle; mais largo = mais macio. Carro andando, mesma escala para todas as sessões.' : undefined}
      footer={withH.length && without.length ? `Sem sinal neste amortecedor em: ${without.map(s => `${s.idx + 1} · ${s.meta.name}`).join(', ')}.` : undefined}>
      {withH.length ? <XYPlot spec={spec} height={280} /> : (
        <EmptyState bare title={`Nenhuma sessão tem sinal no ${corner}`}
          description={`O potenciômetro do amortecedor ${CORNER_LABEL[corner].toLowerCase()} não gravou nas sessões escolhidas (canal ausente ou constante). Confira o sensor, o chicote e a calibração no FT Manager e grave um teste com ele ligado.`} />
      )}
    </ChartCard>
  );
}

export function LapOverlay({ sessions }: { sessions: CmpSession[] }) {
  const withL = sessions.filter(s => s.loaded?.lap);
  const without = sessions.filter(s => s.loaded && !s.loaded.lap);
  const spec = useMemo<XYSpec>(() => {
    const series: XYSeries[] = withL.map(s => {
      const l = s.loaded!.lap!;
      return { x: l.d, y: l.v, role: s.role, label: `${s.idx + 1} · ${s.meta.name} (volta ${l.n}, ${fmtTime(l.time)})`, width: 2 };
    });
    return {
    series, legend: series.map(q => ({ label: q.label!, role: q.role })),
    xLabel: 'distância na volta (m)', yLabel: 'km/h', tipX: x => `<b>${x.toFixed(0)} m</b>`, fmtY: v => v.toFixed(1) + ' km/h',
    };
  }, [withL]);
  return (
    <ChartCard title="Melhor volta: velocidade × distância" explain="laps.speedTrace" sensors={['gps', 'logger']}
      subtitle="A melhor volta de cada sessão, sobreposta pela distância desde a linha de largada. Onde uma curva é mais lenta, uma saída é pior ou a reta não chega na mesma velocidade."
      footer={without.length ? `Sem volta para comparar: ${without.map(s => `${s.idx + 1} · ${s.meta.name} — ${s.loaded!.lapMsg}`).join('; ')}.` : undefined}>
      {withL.length ? <XYPlot spec={spec} height={320} /> : (
        <EmptyState bare title="Nenhuma sessão tem volta completa"
          description="As voltas saem da posição do GPS e da linha de largada. Grave com o GPS com fix e defina a linha de largada no perfil da pista (página Mapa ou Pista e GPS)." />
      )}
    </ChartCard>
  );
}
