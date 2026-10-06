/* #/dev/componentes (fora do menu): vitrine dos componentes com dados sintéticos, para
 * conferir o visual nos temas claro e escuro. Não usa sessão nem o core além de util/gps. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Group, SimpleGrid, Stack, Switch, Text } from '@mantine/core';
import { IconPlayerPause, IconPlayerPlay, IconPencil } from '@tabler/icons-react';
import { EXPLAIN, EXPLAIN_AREAS, type Pt, type SensorId, type TrackOk } from '@baja/core';
import {
  ChartCard, DataTable, EmptyState, MapLegend, PageHeader, Section, SensorChips, StatTile,
  TrackMap, UPlotChart, XYPlot, useExplain, type MapLegendInfo, type MapSource, type TrackMapHandle, type UPlotHandle,
  type XYPlotHandle, type XYSpec,
} from '../components';

/* ---------------------------------------------------------------- dados sintéticos */
const N = 1200, DT = 0.1;                       /* 120 s a 10 Hz */
function synth() {
  const t = new Float64Array(N);
  const x = new Float64Array(N), y = new Float64Array(N), speed = new Float64Array(N), heading = new Float64Array(N), dist = new Float64Array(N);
  const valid = new Uint8Array(N).fill(1), sat = new Uint8Array(N);
  const shock = [0, 1, 2, 3].map(() => new Float64Array(N));
  const ax = new Float64Array(N), ay = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const tt = i * DT;
    t[i] = tt;
    const ph = tt / 40 * 2 * Math.PI;           /* volta de 40 s */
    x[i] = 120 * Math.sin(ph) + 18 * Math.sin(3 * ph);
    y[i] = 70 * Math.cos(ph) - 10 * Math.sin(2 * ph);
    if (i > 0) {
      const dx = x[i] - x[i - 1], dy = y[i] - y[i - 1];
      heading[i] = Math.atan2(dx, dy);
      speed[i] = Math.hypot(dx, dy) / DT * 3.6;
      dist[i] = dist[i - 1] + Math.hypot(dx, dy);
    }
    for (let k = 0; k < 4; k++) shock[k][i] = 60 + 18 * Math.sin(tt * (1.3 + k * 0.17) + k) + 6 * Math.sin(tt * 7.1 + k * 2);
    ax[i] = 0.55 * Math.sin(ph * 2.1) + 0.08 * Math.sin(tt * 5);
    ay[i] = 0.8 * Math.sin(ph * 3) * Math.cos(ph) + 0.05 * Math.cos(tt * 4);
  }
  heading[0] = heading[1]; speed[0] = speed[1];
  const track: TrackOk = {
    ok: true, msg: 'sintética', span: { x: 400, y: 260 }, res: { x: 1.6, y: 1.6 },
    center: { lat: -22.8197, lon: -47.0687 }, fmt: 'm', source: 'sintética',
    x, y, valid, sat, speed, heading, dist, lat: null, lon: null, codeX: new Float64Array(N), codeY: new Float64Array(N),
  };
  return { t, track, shock, ax, ay, speed };
}

const SENSORS_SUSP: SensorId[] = ['shock_fl', 'shock_fr', 'shock_rl', 'shock_rr', 'car_data'];

export default function DevComponentesPage() {
  const D = useMemo(synth, []);
  const [playing, setPlaying] = useState(false);
  const [sat, setSat] = useState(false);
  const [follow, setFollow] = useState(false);
  const [lineMode, setLineMode] = useState(false);
  const [line, setLine] = useState<Pt[] | null>([{ x: -10, y: 60 }, { x: -10, y: 95 }]);
  const [leg, setLeg] = useState<MapLegendInfo>({ lo: NaN, hi: NaN, dark: true });
  const [selRow, setSelRow] = useState(1);
  const mapRef = useRef<TrackMapHandle>(null);
  const upRef = useRef<UPlotHandle>(null);
  const up2Ref = useRef<UPlotHandle>(null);
  const ggRef = useRef<XYPlotHandle>(null);
  const cur = useRef(0);

  /* laço do play: só imperativo (sem re-render), como o cursor de verdade */
  const seek = (tc: number) => {
    cur.current = tc;
    mapRef.current?.setCursor(tc);
    upRef.current?.setCursorTime(tc);
    up2Ref.current?.setCursorTime(tc);
    const i = Math.min(N - 1, Math.max(0, Math.round(tc / DT)));
    ggRef.current?.setHi({ x: D.ay[i], y: D.ax[i] });
  };
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const f = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      let tc = cur.current + dt * 4;
      if (tc > D.t[N - 1]) tc = 0;
      seek(tc);
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  /* specs do XYPlot */
  const lines: XYSpec = useMemo(() => ({
    series: (['FL', 'FR', 'RL', 'RR'] as const).map((id, k) => ({ x: D.t.subarray(0, 200), y: D.shock[k].subarray(0, 200), id, label: id })),
    xLabel: 'tempo (s)', yLabel: 'posição (mm)',
    markers: [{ x: 6.5, label: 'batida', color: 'crit' }],
    hlines: [{ y: 85, label: 'fim de curso', color: 'warn' }],
    tipX: x => `<b>${x.toFixed(2)} s</b>`,
    fmtY: v => v.toFixed(1) + ' mm',
  }), [D]);
  const bars: XYSpec = useMemo(() => {
    const y = Array.from({ length: 30 }, (_, k) => Math.exp(-((k - 15) ** 2) / 40) * 100);
    return {
      bars: { x0: -300, w: 20, y, colors: y.map((_, k) => (k < 15 ? 'neg' : 'pos')) },
      xLabel: 'velocidade do amortecedor (mm/s)', yLabel: '% do tempo',
      markers: [{ x: -100, color: 'muted' }, { x: 100, color: 'muted' }, { x: 0, color: 'fg', label: 'estático' }],
      tipBar: k => `<b>${-300 + k * 20} a ${-280 + k * 20} mm/s</b><br>${y[k].toFixed(1)} %`,
    };
  }, []);
  const gg: XYSpec = useMemo(() => ({
    points: { x: D.ay, y: D.ax, alpha: 0.3 },
    circles: [0.5, 1], equal: true, xLabel: 'lateral (g)', yLabel: 'longitudinal (g)', xRange: [-1.1, 1.1], yRange: [-1.1, 1.1],
  }), [D]);
  const psd: XYSpec = useMemo(() => {
    const f = Array.from({ length: 200 }, (_, k) => 0.2 + k * 0.1);
    const p1 = f.map(v => 1 / (1 + ((v - 2.1) / 0.4) ** 2) + 0.02 / v);
    const p2 = f.map(v => 0.6 / (1 + ((v - 2.4) / 0.6) ** 2) + 0.03 / v);
    return {
      series: [{ x: f, y: p1, label: 'devagar (< 20 km/h)', role: 'c1' }, { x: f, y: p2, label: 'rápido (≥ 20 km/h)', role: 'c2' }],
      logY: true, xLabel: 'frequência (Hz)', yLabel: 'PSD',
      markers: [{ x: 2.1, label: 'queda 2.10 Hz', color: 'fg' }, { x: 0.8, color: 'axis' }, { x: 6, color: 'axis' }],
    };
  }, []);

  const mapSource: MapSource = useMemo(() => ({
    t: D.t, track: D.track, span: { x: 400, y: 260 }, line,
    onSeek: tc => { seek(tc); },
    onLineDrawn: pts => setLine(pts.map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [D, line]);

  const uData = useMemo(() => [D.t, D.speed] as [Float64Array, Float64Array], [D]);
  const uData2 = useMemo(() => [D.t, D.shock[0], D.shock[1]] as [Float64Array, Float64Array, Float64Array], [D]);

  const laps = [
    { n: 1, time: 40.02, vmax: 42.1, vavg: 31.4, dist: 520 },
    { n: 2, time: 39.41, vmax: 43.0, vavg: 32.0, dist: 519 },
    { n: 3, time: 40.88, vmax: 41.2, vavg: 30.9, dist: 521 },
  ];

  return (
    <>
      <PageHeader
        title="Componentes"
        subtitle="Vitrine com dados sintéticos para conferir gráficos, mapa e blocos nos dois temas."
        explain="dev.componentes" sensors={['gps']}
        actions={(
          <Button leftSection={playing ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />} onClick={() => setPlaying(p => !p)}>
            {playing ? 'Pausar' : 'Reproduzir'}
          </Button>
        )}
      />

      <Section title="Blocos de número" description="StatTile: rótulo clicável, valor 28 px, status com ícone e texto, sensores.">
        <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md">
          <StatTile label="Velocidade máxima" value={43.04} decimals={1} unit="km/h" hint="volta 2" explain="gps.vmax" sensors={['gps']} />
          <StatTile label="Curso usado (FL)" value={92} decimals={0} unit="%" status="warn" explain="susp.travel" sensors={['shock_fl', 'car_data']} />
          <StatTile label="T máx da CVT" value={118.4} decimals={1} unit="°C" status="good" statusText="Dentro do limite" explain="cvt.tmax" sensors={['cvt_temp']} />
          <StatTile label="Relação da CVT" value={null} unit="" status="crit" statusText="Sem sensor" hint="precisa de rotação do motor" explain="cvt.ratio" sensors={['engine_rpm', 'wheel']} />
        </SimpleGrid>
      </Section>

      <Section title="Chips dos sensores" description="Presente, ausente, sugerido e neutro (sem sessão).">
        <Stack gap="xs">
          <SensorChips size="sm" sensors={['gps', 'shock_fl', 'shock_rr', 'wheel', 'cvt_temp']}
            availability={{ gps: 'present', shock_fl: 'present', shock_rr: 'absent', wheel: 'absent', cvt_temp: 'present' }} />
          <SensorChips size="sm" sensors={['engine_rpm', 'imu', 'brake_pressure', 'steering', 'throttle']} />
          <SensorChips sensors={['logger', 'car_data', 'gps']} />
        </Stack>
      </Section>

      <Section title="Gráficos XY" description="XYPlot: porte do BT.Plot com o mesmo spec.">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
          <ChartCard title="Posição dos amortecedores" subtitle="Linhas com cor por canto (FL/FR/RL/RR), marcador e limite."
            explain="susp.position" sensors={SENSORS_SUSP}>
            <XYPlot spec={lines} />
          </ChartCard>
          <ChartCard title="Histograma da velocidade do amortecedor" explain="susp.velHist" sensors={['shock_fl']}>
            <XYPlot spec={bars} />
          </ChartCard>
          <ChartCard title="Diagrama g-g" subtitle="Dispersão com círculos e mesma escala nos eixos." explain="chart.gg" sensors={['gps']}>
            <XYPlot spec={gg} height={340} ref={ggRef} />
          </ChartCard>
          <ChartCard title="Espectro andando (PSD)" explain="res.psd" sensors={['shock_fl', 'shock_fr', 'gps']}>
            <XYPlot spec={psd} height={340} />
          </ChartCard>
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg" mt="lg">
          <ChartCard title="Sem dados"><XYPlot spec={{ series: [] }} height={160} /></ChartCard>
          <ChartCard title="Mensagem vazia"><XYPlot spec={{ empty: 'Este log não tem amortecedores.' }} height={160} /></ChartCard>
        </SimpleGrid>
      </Section>

      <Section title="Mapa da pista" description="TrackMap: arraste, roda = zoom, clique = ir ao ponto, duplo clique = enquadrar."
        actions={(
          <Group gap="sm">
            <Switch label="Satélite" checked={sat} onChange={e => setSat(e.currentTarget.checked)} />
            <Switch label="Seguir" checked={follow} onChange={e => setFollow(e.currentTarget.checked)} />
            <Button variant={lineMode ? 'filled' : 'default'} size="xs" leftSection={<IconPencil size={14} />} onClick={() => setLineMode(m => !m)}>
              {lineMode ? 'Cancelar' : 'Desenhar linha (2 cliques)'}
            </Button>
          </Group>
        )}>
        <ChartCard title="Trajetória colorida pela velocidade" explain="map.track" sensors={['gps']} flush
          footer={<MapLegend lo={leg.lo} hi={leg.hi} dark={leg.dark} label="Velocidade (GPS)" unit="km/h" decimals={2} />}>
          <TrackMap source={mapSource} ref={mapRef} height={440} satellite={sat} onSatelliteChange={setSat}
            follow={follow} onFollowChange={setFollow} lineMode={lineMode} onLineModeChange={setLineMode} onLegend={setLeg} />
        </ChartCard>
      </Section>

      <Section title="Canais no tempo (uPlot)" description="Dois painéis com cursor sincronizado; arraste para dar zoom, duplo clique volta.">
        <Stack gap="md">
          <ChartCard title="Velocidade" explain="gps.speed" sensors={['gps']}>
            <UPlotChart ref={upRef} data={uData} series={[{ label: 'Velocidade (km/h)' }]} syncKey="dev" yLabel="km/h" height={200}
              onClick={x => seek(x)} />
          </ChartCard>
          <ChartCard title="Amortecedores dianteiros" explain="susp.position" sensors={['shock_fl', 'shock_fr']}>
            <UPlotChart ref={up2Ref} data={uData2} series={[{ label: 'FL (mm)', id: 'FL' }, { label: 'FR (mm)', id: 'FR' }]}
              syncKey="dev" xLabel="tempo (s)" yLabel="mm" height={220} onClick={x => seek(x)} />
          </ChartCard>
        </Stack>
      </Section>

      <Section title="Tabela" description="DataTable: cabeçalho fixo, linha clicável, números alinhados.">
        <DataTable
          rows={laps} selected={selRow} onRowClick={(_, i) => setSelRow(i)} maxHeight={240}
          columns={[
            { key: 'n', header: 'Volta', numeric: true, width: 80 },
            { key: 'time', header: 'Tempo (s)', numeric: true, render: r => r.time.toFixed(2) },
            { key: 'vmax', header: 'V máx (km/h)', numeric: true, render: r => r.vmax.toFixed(1) },
            { key: 'vavg', header: 'V média (km/h)', numeric: true, render: r => r.vavg.toFixed(1) },
            { key: 'dist', header: 'Distância', numeric: true, render: r => `${r.dist.toFixed(0)} m` },
          ]}
        />
      </Section>

      <Section title="Estado vazio">
        <EmptyState title="Abra uma sessão" description="Escolha um log na página Sessões ou abra o exemplo para ver esta análise." />
      </Section>

      <ExplainCatalog />
      <Text c="dimmed" size="sm" mt="xl">Página de desenvolvimento (#/dev/componentes), fora do menu.</Text>
    </>
  );
}

/* Todos os cards do catálogo EXPLAIN do core, por área: um botão abre cada um (para revisar
 * os textos e achar lacunas). Os ids usados acima que não existem mostram o aviso no card. */
function ExplainCatalog() {
  const { open } = useExplain();
  const ids = Object.keys(EXPLAIN);
  return (
    <Section title="Catálogo de explicações" description={`${ids.length} cards em packages/core/src/explain.ts. Clique para abrir no card de explicação.`}>
      <Stack gap="md">
        {EXPLAIN_AREAS.map(area => {
          const of = ids.filter(id => id.startsWith(area + '.'));
          return (
            <div key={area}>
              <Text size="sm" fw={700} c="dimmed" tt="uppercase" mb={6}>{area} · {of.length}</Text>
              {of.length ? (
                <Group gap={6} wrap="wrap">
                  {of.map(id => (
                    <Button key={id} size="xs" variant="light" onClick={() => open(id)} title={EXPLAIN[id].title}>{id}</Button>
                  ))}
                </Group>
              ) : <Text size="sm" c="dimmed">nenhum card ainda</Text>}
            </div>
          );
        })}
      </Stack>
    </Section>
  );
}
