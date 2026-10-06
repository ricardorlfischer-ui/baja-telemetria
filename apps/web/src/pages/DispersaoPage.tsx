/* Página /dispersao (docs/ARQUITETURA.md 4.2): X × Y de quaisquer canais, em pontos (cor
 * única, por volta ou por um canal Z) ou mapa de calor (histograma 2D com a contagem ou a
 * média de Z por célula, grade de 16 a 128). Clique numa célula = estatísticas (n, média,
 * mín, máx, desvio) e "ir ao ponto" (a amostra da célula mais perto do clique); clique num
 * ponto = vai direto ao instante. Respeita o trecho do cabeçalho. Atalhos com os pares de
 * canais que respondem perguntas do projeto. O agrupamento fica em dispersao/binning.ts. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActionIcon, Button, Grid, Group, Paper, SegmentedControl, Select, SimpleGrid, Slider, Stack, Text, Title, Tooltip,
} from '@mantine/core';
import { IconArrowsExchange, IconChartDots, IconCrosshair, IconMap2, IconTimeline } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import {
  channelExplainId, decimalsFor, esc, heat, idxAt, pctRange, sensorsOfChannel, type Channel, type SensorId,
} from '@baja/core';
import { ChartCard, EmptyState, MapLegend, PageHeader, Section, StatTile } from '../components';
import { routeByPath } from '../routes';
import { useChartTheme } from '../theme';
import { useCursorEffect, useCtx, useRange, useSessionStore } from '../state/session';
import { lsGet, lsSet } from '../state/prefs';
import { ExplainText, NoSession, fmtN } from './aquisicao/common';
import { bin2d, cellAt, cellBounds, cellStats, collect, extent, nearest, pearson } from './dispersao/binning';
import { ScatterCanvas, type ScatterHandle } from './dispersao/ScatterCanvas';
import { buildPresets, type ColorBy, type HeatValue, type Preset, type ScatterMode } from './dispersao/presets';
import './aquisicao/aquisicao.css';

interface Choice { x: string; y: string; z: string; mode: ScatterMode; color: ColorBy; heat: HeatValue; grid: number; preset: string | null }
const K_CHOICE = 'baja:dispersao';
const readChoice = (): Partial<Choice> => {
  try { const v = JSON.parse(lsGet(K_CHOICE) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
};
const label = (c: Channel | undefined) => (c ? c.name + (c.unit ? ` (${c.unit})` : '') : '');
const N_HEAT = 24;

export default function DispersaoPage() {
  const r = routeByPath('/dispersao')!;
  const nav = useNavigate();
  const ctx = useCtx();
  const ready = useSessionStore(s => s.status === 'ready' && s.ctx !== null);
  const range = useRange();
  const th = useChartTheme();
  const seek = useSessionStore(s => s.seek);
  const plotRef = useRef<ScatterHandle>(null);

  const presets = useMemo(() => (ctx ? buildPresets(ctx) : []), [ctx]);
  const usable = useMemo(() => (ctx ? ctx.all.filter(c => !c.constant && c.count > 1) : []), [ctx]);
  const has = (k: string | undefined) => !!k && usable.some(c => c.key === k);

  /* escolha (lembrada neste navegador; canais que não existem neste log são trocados) */
  const [ch, setCh] = useState<Choice>(() => ({ x: '', y: '', z: '', mode: 'points', color: 'none', heat: 'count', grid: 48, preset: null, ...readChoice() }));
  useEffect(() => {
    if (!ctx) return;
    setCh(c => {
      if (has(c.x) && has(c.y) && (!c.z || has(c.z))) return c;
      const p = presets.find(q => !q.missing);
      if (p) return fromPreset(p);
      return { ...c, x: usable[0]?.key ?? '', y: usable[1]?.key ?? usable[0]?.key ?? '', z: '', preset: null };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);
  useEffect(() => { lsSet(K_CHOICE, JSON.stringify(ch)); }, [ch]);
  const set = (p: Partial<Choice>) => setCh(c => ({ ...c, ...p, preset: 'preset' in p ? p.preset! : null }));
  function fromPreset(p: Preset): Choice {
    return { x: p.x!, y: p.y!, z: p.z ?? '', mode: p.mode, color: p.color, heat: p.heat, grid: p.grid ?? 48, preset: p.id };
  }

  const X = ctx?.all.find(c => c.key === ch.x), Y = ctx?.all.find(c => c.key === ch.y), Z = ch.z ? ctx?.all.find(c => c.key === ch.z) : undefined;
  const [i0, i1, rlabel] = range ?? [0, -1, ''];

  /* dados do trecho */
  const data = useMemo(() => (X && Y ? collect(X.data, Y.data, Z ? Z.data : null, i0, i1) : null), [X, Y, Z, i0, i1]);
  const xr = useMemo<[number, number]>(() => {
    if (!data) return [0, 1];
    const [a, b] = extent(data.x);
    const p = ch.mode === 'points' ? (b - a) * 0.03 : 0;
    return [a - p, b + p];
  }, [data, ch.mode]);
  const yr = useMemo<[number, number]>(() => {
    if (!data) return [0, 1];
    const [a, b] = extent(data.y);
    const p = ch.mode === 'points' ? (b - a) * 0.04 : 0;
    return [a - p, b + p];
  }, [data, ch.mode]);
  const grid = useMemo(() => (data && ch.mode === 'heat' ? bin2d(data, ch.grid, ch.grid, xr, yr) : null), [data, ch.mode, ch.grid, xr, yr]);
  const r2 = useMemo(() => (data ? pearson(data) : NaN), [data]);

  /* seleção: célula / ponto (zera quando os dados mudam) */
  const [selCell, setSelCell] = useState(-1);
  const [selPoint, setSelPoint] = useState(-1);
  const [clickAt, setClickAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => { setSelCell(-1); setSelPoint(-1); setClickAt(null); }, [data, grid]);
  const stats = useMemo(() => (data && grid && selCell >= 0 ? cellStats(data, grid, selCell) : null), [data, grid, selCell]);

  /* cores dos pontos */
  const laps = ctx?.laps ?? [];
  const lapOf = useMemo(() => {
    if (!ctx || !laps.length) return null;
    const a = new Int16Array(ctx.S.t.length).fill(-1);
    laps.forEach((l, k) => { for (let i = l.i0; i <= l.i1; i++) a[i] = k; });
    return a;
  }, [ctx, laps]);
  const zRange = useMemo(() => (Z && range ? pctRange(Z.data, i0, i1, 0.02) : null), [Z, range, i0, i1]);
  const colorBy: ColorBy = ch.color === 'lap' && !lapOf ? 'none' : ch.color === 'z' && !Z ? 'none' : ch.color;
  const { colorIndex, palette } = useMemo(() => {
    if (!data || ch.mode !== 'points' || colorBy === 'none') return { colorIndex: null, palette: [th.series[0]] };
    const idx = new Uint16Array(data.n);
    if (colorBy === 'lap' && lapOf) {
      const few = laps.length <= 8;
      const pal = few ? laps.map((_, k) => th.series[k]) : Array.from({ length: 16 }, (_, k) => heat(k / 15, th.dark));
      const out = pal.length;
      for (let p = 0; p < data.n; p++) {
        const k = lapOf[data.idx[p]];
        idx[p] = k < 0 ? out : few ? k : Math.round(k / Math.max(1, laps.length - 1) * 15);
      }
      return { colorIndex: idx, palette: [...pal, th.mutedLine] };
    }
    const lo = zRange?.lo ?? 0, hi = zRange?.hi ?? 1, span = hi - lo || 1;
    for (let p = 0; p < data.n; p++) idx[p] = Math.max(0, Math.min(N_HEAT - 1, Math.round((data.z![p] - lo) / span * (N_HEAT - 1))));
    return { colorIndex: idx, palette: Array.from({ length: N_HEAT }, (_, k) => heat(k / (N_HEAT - 1), th.dark)) };
  }, [data, ch.mode, colorBy, lapOf, laps, zRange, th]);

  /* cursor do log no gráfico (60×/s, sem re-render) */
  const live = useRef({ X, Y, i0, i1 });
  live.current = { X, Y, i0, i1 };
  const putCursor = (t: number) => {
    const L = live.current, S = useSessionStore.getState().S;
    if (!L.X || !L.Y || !S) { plotRef.current?.setCursor(null); return; }
    const i = idxAt(S.t, t);
    plotRef.current?.setCursor(i >= L.i0 && i <= L.i1 ? { x: L.X.data[i], y: L.Y.data[i] } : null);
  };
  useCursorEffect(t => putCursor(t));
  useEffect(() => { putCursor(useSessionStore.getState().cursor); });

  const sensorsX = useMemo<SensorId[]>(() => (ctx && X ? sensorsOfChannel(ctx, X) : []), [ctx, X]);
  const sensorsY = useMemo<SensorId[]>(() => (ctx && Y ? sensorsOfChannel(ctx, Y) : []), [ctx, Y]);
  const sensorsZ = useMemo<SensorId[]>(() => (ctx && Z ? sensorsOfChannel(ctx, Z) : []), [ctx, Z]);
  const sensors = useMemo(() => [...new Set([...sensorsX, ...sensorsY, ...sensorsZ])], [sensorsX, sensorsY, sensorsZ]);

  const selectData = useMemo(() => {
    if (!ctx) return [];
    const groups = new Map<string, { value: string; label: string; disabled?: boolean }[]>();
    ctx.all.forEach(c => {
      const g = c.group || 'Outros';
      if (!groups.has(g)) groups.set(g, []);
      const dead = c.constant || c.count < 2;
      groups.get(g)!.push({ value: c.key, label: label(c) + (dead ? ' · sem sinal' : ''), disabled: dead });
    });
    return [...groups].map(([group, items]) => ({ group, items }));
  }, [ctx]);

  if (!ready || !ctx || !range) {
    return (
      <>
        <PageHeader title={r.label} subtitle={r.question} explain="chart.scatter" />
        <NoSession icon={IconChartDots} description="Abra um log para cruzar quaisquer dois canais (e um terceiro na cor): rolagem × aceleração lateral, temperatura da CVT × velocidade, curso × distância..." />
      </>
    );
  }
  if (usable.length < 2) {
    return (
      <>
        <PageHeader title={r.label} subtitle={r.question} explain="chart.scatter" />
        <EmptyState icon={IconChartDots} title="Este log tem menos de dois canais com sinal"
          description="A dispersão cruza dois canais que variam. Confira na página Aquisição quais canais ficaram constantes (sensor sem sinal) e o que medir." />
      </>
    );
  }

  const t = ctx.S.t;
  const dx = X ? decimalsFor(X.lo, X.hi) : 2, dy = Y ? decimalsFor(Y.lo, Y.hi) : 2, dz = Z ? decimalsFor(Z.lo, Z.hi) : 2;
  const xLabel = label(X), yLabel = label(Y), zLabel = label(Z);
  const explainId = ch.mode === 'heat' ? 'chart.histogram2d' : 'chart.scatter';

  const tip = (x: number, y: number): string | null => {
    if (!data) return null;
    if (grid) {
      const k = cellAt(grid, x, y);
      if (k < 0 || !grid.count[k]) return null;
      const b = cellBounds(grid, k), n = grid.count[k];
      let h = `<b>${n} amostra${n > 1 ? 's' : ''}</b><div>${esc(X!.name)}: ${b.xa.toFixed(dx)} – ${b.xb.toFixed(dx)}</div><div>${esc(Y!.name)}: ${b.ya.toFixed(dy)} – ${b.yb.toFixed(dy)}</div>`;
      if (grid.sum && Z) h += `<div>média de ${esc(Z.name)}: <b>${(grid.sum[k] / n).toFixed(dz)}</b></div>`;
      return h + '<div style="opacity:.7">clique: estatísticas</div>';
    }
    return `<b>${esc(X!.name)} = ${x.toFixed(dx)}</b><div>${esc(Y!.name)} = ${y.toFixed(dy)}</div><div style="opacity:.7">clique: ir à amostra mais perto</div>`;
  };
  const onPick = (x: number, y: number) => {
    if (!data || !data.n) return;
    if (grid) {
      const k = cellAt(grid, x, y);
      setSelCell(k >= 0 && grid.count[k] ? k : -1);
      setClickAt({ x, y });
      setSelPoint(-1);
      return;
    }
    const p = nearest(data, x, y, xr, yr);
    if (p >= 0) { setSelPoint(p); seek(t[data.idx[p]]); }
  };
  const goCell = () => {
    if (!data || !stats || !clickAt) return;
    const p = nearest(data, clickAt.x, clickAt.y, xr, yr, stats.members);
    if (p >= 0) { setSelPoint(p); seek(t[data.idx[p]]); }
  };
  const selIdx = data && selPoint >= 0 ? data.idx[selPoint] : -1;
  const lapAt = (i: number) => (lapOf && lapOf[i] >= 0 ? laps[lapOf[i]].n : null);

  /* legenda da cor */
  let legend: ReactNode = null;
  if (ch.mode === 'heat' && grid) {
    legend = ch.heat === 'mean' && Z && grid.sum
      ? <MapLegend lo={grid.meanLo} hi={grid.meanHi} dark={th.dark} label={`Média de ${Z.name} por célula`} unit={Z.unit} decimals={dz} />
      : <MapLegend lo={1} hi={grid.maxCount} dark={th.dark} label="Amostras por célula (escala logarítmica)" decimals={1} />;
  } else if (colorBy === 'z' && Z && zRange) {
    legend = <MapLegend lo={zRange.lo} hi={zRange.hi} dark={th.dark} label={`Cor: ${Z.name} (faixa 2–98 %)`} unit={Z.unit} decimals={dz} />;
  } else if (colorBy === 'lap' && laps.length) {
    legend = laps.length <= 8 ? (
      <div className="bt-scatter-legend">
        {laps.map((l, k) => <span key={k}><i style={{ background: th.series[k] }} />Volta {l.n}</span>)}
        <span><i style={{ background: th.mutedLine }} />fora das voltas</span>
      </div>
    ) : <MapLegend lo={laps[0].n} hi={laps[laps.length - 1].n} dark={th.dark} label="Cor: número da volta (cinza = fora das voltas)" decimals={1} />;
  }

  const zOff = !Z;
  return (
    <>
      <PageHeader title={r.label} subtitle={r.question} explain={explainId} sensors={sensors.length ? sensors : undefined} />

      <Section title="Atalhos para o projeto" description="Pares de canais que respondem perguntas do carro novo. Os que não dá para fazer com este log dizem o que falta medir.">
        <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }} spacing="md">
          {presets.map(p => {
            const off = !!p.missing;
            const active = ch.preset === p.id;
            return (
              <Paper key={p.id} withBorder radius="md" p="md" h="100%" className="bt-preset" data-active={active || undefined} data-off={off || undefined}
                role="button" tabIndex={off ? -1 : 0} aria-disabled={off} aria-pressed={active}
                onClick={() => { if (!off) setCh(fromPreset(p)); }}
                onKeyDown={e => { if (!off && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setCh(fromPreset(p)); } }}>
                  <Stack gap={6}>
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <Text fw={650} size="md">{p.title}</Text>
                      <ExplainText explain={p.explain} title={p.title}><Text span size="sm" c="dimmed">o que é</Text></ExplainText>
                    </Group>
                    <Text size="sm" c="dimmed">{p.why}</Text>
                    {off && <Text size="sm" c="orange">{p.missing}</Text>}
                  </Stack>
              </Paper>
            );
          })}
        </SimpleGrid>
      </Section>

      <Section title="Canais e modo" description={`Trecho: ${rlabel}. Com Z escolhido, só entram as amostras com X, Y e Z válidos.`}>
        <Paper withBorder radius="md" p="lg">
          <Stack gap="md">
            <Grid gap="md" align="flex-end">
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Select size="md" label="Eixo X" data={selectData} value={ch.x} searchable maxDropdownHeight={420} allowDeselect={false}
                  onChange={v => v && set({ x: v })} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 'auto' }} style={{ flexGrow: 0 }}>
                <Tooltip label="Trocar X ↔ Y">
                  <ActionIcon size={42} variant="default" aria-label="Trocar X e Y" onClick={() => set({ x: ch.y, y: ch.x })}><IconArrowsExchange size={20} /></ActionIcon>
                </Tooltip>
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 'auto' }}>
                <Select size="md" label="Eixo Y" data={selectData} value={ch.y} searchable maxDropdownHeight={420} allowDeselect={false}
                  onChange={v => v && set({ y: v })} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Select size="md" label="Z (cor ou média, opcional)" placeholder="nenhum" data={selectData} value={ch.z || null} searchable clearable maxDropdownHeight={420}
                  onChange={v => set({ z: v ?? '', ...(v ? {} : { color: ch.color === 'z' ? 'none' : ch.color, heat: 'count' }) })} />
              </Grid.Col>
            </Grid>
            <Group gap="xl" wrap="wrap" align="flex-end">
              <Stack gap={4}>
                <Text size="sm" fw={500}>Modo</Text>
                <SegmentedControl size="md" value={ch.mode} onChange={v => set({ mode: v as ScatterMode })}
                  data={[{ value: 'points', label: 'Pontos' }, { value: 'heat', label: 'Mapa de calor' }]} />
              </Stack>
              {ch.mode === 'points' ? (
                <Stack gap={4}>
                  <Text size="sm" fw={500}>Cor dos pontos</Text>
                  <SegmentedControl size="md" value={colorBy} onChange={v => set({ color: v as ColorBy })} data={[
                    { value: 'none', label: 'Uma cor' },
                    { value: 'lap', label: lapOf ? 'Por volta' : 'Por volta (sem voltas)', disabled: !lapOf },
                    { value: 'z', label: 'Por Z', disabled: zOff },
                  ]} />
                </Stack>
              ) : (
                <>
                  <Stack gap={4}>
                    <Text size="sm" fw={500}>Valor da célula</Text>
                    <SegmentedControl size="md" value={ch.heat === 'mean' && Z ? 'mean' : 'count'} onChange={v => set({ heat: v as HeatValue })} data={[
                      { value: 'count', label: 'Contagem' }, { value: 'mean', label: 'Média de Z', disabled: zOff },
                    ]} />
                  </Stack>
                  <Stack gap={4} style={{ flex: '1 1 260px', maxWidth: 420 }}>
                    <Text size="sm" fw={500}>Grade: {ch.grid} × {ch.grid} células</Text>
                    <Slider size="lg" min={16} max={128} step={8} value={ch.grid} onChange={v => set({ grid: v })} label={null}
                      marks={[{ value: 16, label: '16' }, { value: 48, label: '48' }, { value: 96, label: '96' }, { value: 128, label: '128' }]} mb="md" />
                  </Stack>
                </>
              )}
              {!lapOf && ch.mode === 'points' && (
                <Text size="sm" c="dimmed" maw={360}>{ctx.track.ok ? 'Sem voltas: desenhe a linha de largada no Mapa para colorir por volta.' : 'Sem voltas: este log não tem trajetória do GPS.'}</Text>
              )}
            </Group>
          </Stack>
        </Paper>
      </Section>

      <Section>
        <Grid gap="lg">
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <ChartCard
              title={X && Y ? `${Y.name} × ${X.name}` : 'Dispersão'}
              subtitle={ch.mode === 'heat'
                ? `Cada célula: ${ch.heat === 'mean' && Z ? `média de ${Z.name}` : 'quantas amostras caíram ali'}. Clique numa célula para ver as estatísticas e ir ao ponto.`
                : 'Cada ponto é uma amostra do trecho. Clique num ponto para ir àquele instante (o ponto branco/preto é o cursor do log).'}
              explain={explainId} sensors={sensors}
              footer={data ? `${data.n} de ${data.total} amostras do trecho com ${Z ? 'X, Y e Z' : 'X e Y'} válidos.` : undefined}
            >
              {legend && <div style={{ padding: '4px 4px 10px', maxWidth: 420 }}>{legend}</div>}
              {data && data.n ? (
                <ScatterCanvas
                  ref={plotRef} data={data} xr={xr} yr={yr} xLabel={xLabel} yLabel={yLabel} mode={ch.mode}
                  colorIndex={colorIndex} palette={palette} grid={grid} heatValue={ch.heat === 'mean' && Z ? 'mean' : 'count'}
                  selCell={selCell} selPoint={selPoint} height={560} onPick={onPick} tip={tip}
                />
              ) : (
                <EmptyState bare icon={IconChartDots} title="Nenhuma amostra válida neste trecho"
                  description={`${xLabel || 'X'} e ${yLabel || 'Y'}${Z ? ` e ${zLabel}` : ''} não têm valores ao mesmo tempo no trecho “${rlabel}”. Escolha outro trecho (Sessão no cabeçalho) ou outros canais.`} />
              )}
            </ChartCard>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Stack gap="md">
              <SimpleGrid cols={{ base: 2, lg: 1, xl: 2 }} spacing="md">
                <StatTile label="Amostras no gráfico" value={data ? data.n : null} hint={data ? `de ${data.total} no trecho` : undefined} explain={explainId} sensors={sensors} />
                <StatTile label="Correlação (r)" value={r2} decimals={2} hint={isFinite(r2) ? (Math.abs(r2) > 0.7 ? 'forte' : Math.abs(r2) > 0.4 ? 'moderada' : 'fraca') + ' · linear' : 'sem variação'}
                  explain="chart.scatter" sensors={sensors} />
              </SimpleGrid>

              {ch.mode === 'heat' ? (
                <Paper withBorder radius="md" p="lg">
                  <Title order={3} mb="xs">Célula escolhida</Title>
                  {stats && grid ? (() => {
                    const b = cellBounds(grid, selCell);
                    const rows: { name: string; ch: Channel; s: typeof stats.x; d: number; sens: SensorId[] }[] = [
                      { name: 'X', ch: X!, s: stats.x, d: dx, sens: sensorsX },
                      { name: 'Y', ch: Y!, s: stats.y, d: dy, sens: sensorsY },
                      ...(stats.z && Z ? [{ name: 'Z', ch: Z, s: stats.z, d: dz, sens: sensorsZ }] : []),
                    ];
                    return (
                      <Stack gap="sm">
                        <Text size="sm" c="dimmed">{X!.name}: {b.xa.toFixed(dx)} – {b.xb.toFixed(dx)} · {Y!.name}: {b.ya.toFixed(dy)} – {b.yb.toFixed(dy)}</Text>
                        <StatTile label="Amostras na célula (n)" value={stats.n} hint={`${(stats.n / data!.n * 100).toFixed(1)} % do gráfico · ${(stats.n * (ctx.S.t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : 0)).toFixed(1)} s`} explain="chart.histogram2d" sensors={sensors} />
                        {rows.map(rw => (
                          <div key={rw.name}>
                            <ExplainText explain={channelExplainId(rw.ch.key, rw.sens.length === 1 ? rw.sens[0] : null)} sensors={rw.sens} title={rw.ch.name} strong>
                              {rw.name} · {rw.ch.name}{rw.ch.unit ? ` (${rw.ch.unit})` : ''}
                            </ExplainText>
                            <SimpleGrid cols={4} spacing={4} mt={4}>
                              {(['média', 'mín', 'máx', 'desvio'] as const).map((lb, k) => (
                                <Stack key={lb} gap={0}>
                                  <Text size="xs" c="dimmed">{lb}</Text>
                                  <ExplainText explain="chart.histogram2d" sensors={rw.sens} title={`${rw.ch.name} na célula (${lb})`}>
                                    <Text span fw={600} className="bt-num">{fmtN([rw.s.mean, rw.s.min, rw.s.max, rw.s.std][k], rw.d)}</Text>
                                  </ExplainText>
                                </Stack>
                              ))}
                            </SimpleGrid>
                          </div>
                        ))}
                        <Button size="md" leftSection={<IconCrosshair size={18} />} onClick={goCell}>Ir ao ponto</Button>
                        <Text size="sm" c="dimmed">vai à amostra da célula mais perto de onde você clicou</Text>
                      </Stack>
                    );
                  })() : <Text c="dimmed">Clique numa célula colorida do mapa de calor para ver n, média, mínimo, máximo e desvio de cada canal ali, e ir ao instante.</Text>}
                </Paper>
              ) : null}

              <Paper withBorder radius="md" p="lg">
                <Title order={3} mb="xs">Amostra escolhida</Title>
                {selIdx >= 0 ? (
                  <Stack gap={6}>
                    <Text size="lg" fw={650} className="bt-num">t = {t[selIdx].toFixed(2)} s{lapAt(selIdx) !== null ? ` · volta ${lapAt(selIdx)}` : ''}</Text>
                    <Text className="bt-num"><ExplainText explain={channelExplainId(X!.key, sensorsX.length === 1 ? sensorsX[0] : null)} sensors={sensorsX} title={X!.name}>{X!.name}</ExplainText>: {fmtN(X!.data[selIdx], dx)} {X!.unit}</Text>
                    <Text className="bt-num"><ExplainText explain={channelExplainId(Y!.key, sensorsY.length === 1 ? sensorsY[0] : null)} sensors={sensorsY} title={Y!.name}>{Y!.name}</ExplainText>: {fmtN(Y!.data[selIdx], dy)} {Y!.unit}</Text>
                    {Z && <Text className="bt-num"><ExplainText explain={channelExplainId(Z.key, sensorsZ.length === 1 ? sensorsZ[0] : null)} sensors={sensorsZ} title={Z.name}>{Z.name}</ExplainText>: {fmtN(Z.data[selIdx], dz)} {Z.unit}</Text>}
                    <Text size="sm" c="dimmed">O cursor do log foi para esse instante: veja-o nas outras páginas.</Text>
                    <Group gap="sm" mt={4}>
                      <Button size="md" variant="light" leftSection={<IconTimeline size={18} />} onClick={() => nav('/canais')}>Ver em Canais</Button>
                      <Button size="md" variant="light" leftSection={<IconMap2 size={18} />} onClick={() => nav('/mapa')}>Ver no Mapa</Button>
                    </Group>
                  </Stack>
                ) : (
                  <Text c="dimmed">{ch.mode === 'heat' ? 'Escolha uma célula e use “Ir ao ponto”.' : 'Clique num ponto do gráfico: o cursor do log vai para aquele instante.'}</Text>
                )}
              </Paper>

              <Paper withBorder radius="md" p="lg">
                <Title order={3} mb="xs">Como ler</Title>
                <Stack gap={6}>
                  <Text size="sm">Uma nuvem alinhada é uma relação entre os canais; a inclinação vira número de projeto (ex.: rolagem ÷ aceleração lateral = gradiente de rolagem, °/g).</Text>
                  <Text size="sm">O mapa de calor mostra onde o carro passa mais tempo: a faixa de operação para dimensionar a peça. Com a média de Z, mostra em que regime algo acontece (ex.: onde a CVT esquenta).</Text>
                  <Text size="sm" c="dimmed">Correlação não é causa: confirme com um teste controlado. Células com poucas amostras têm média pouco confiável.</Text>
                </Stack>
              </Paper>
            </Stack>
          </Grid.Col>
        </Grid>
      </Section>
    </>
  );
}
