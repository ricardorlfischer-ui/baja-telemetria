/* Página /voltas (docs/ARQUITETURA.md 4.2): tabela de voltas (buildLaps do antigo), seletores
 * "Volta" × "contra", velocidade × distância, diferença de tempo acumulada e os 10 trechos onde
 * ganhou/perdeu (renderLaps + frameLaps). As contas são do core (lapTable, lapReport); aqui só
 * se desenha. Clique nos gráficos = ir ao ponto; clique numa volta = selecionar (trecho = volta). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Group, Paper, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import { useNavigate } from 'react-router';
import { IconAntennaOff, IconFlag, IconMap2, IconPlayerPlayFilled, IconRoute, IconSparkles, IconStarFilled } from '@tabler/icons-react';
import {
  fmtTime, idxAt, lapCursorDist, lapReport, lapSeekTime, lapTable,
  type LapTableReport, type LapTableRow, type SensorId, type SessionContext,
} from '@baja/core';
import {
  ChartCard, DataTable, EmptyState, InfoButton, PageHeader, Section, StatTile, XYPlot, reportSpec,
  type Column, type XYPlotHandle,
} from '../components';
import { routeByPath } from '../routes';
import { useCtx, useCursorEffect, useSessionReady, useSessionStore } from '../state/session';
import { NoSession, applyAutoLine, useCursorLap } from './mapa/common';
import './mapa/mapa.css';

const LAP_SENSORS: SensorId[] = ['gps', 'logger'];
/* abaixo disto (m andados na sessão) não faz sentido procurar voltas */
const MIN_LAP_DIST = 100;

export default function VoltasPage() {
  const r = routeByPath('/voltas')!;
  const ready = useSessionReady();
  const ctx = useCtx();
  const header = <PageHeader title={r.label} subtitle={r.question} explain="laps.table" sensors={LAP_SENSORS} />;
  if (!ready || !ctx) return <>{header}<NoSession what="As voltas saem do GPS: cruzamentos da linha de largada." /></>;
  return <>{header}<VoltasBody ctx={ctx} /></>;
}

/* ---------------------------------------------------------------- sem voltas */
function NoLaps({ ctx, table }: { ctx: SessionContext; table: LapTableReport }) {
  const nav = useNavigate();
  if (!ctx.track.ok) {
    return (
      <EmptyState icon={IconAntennaOff} title="Sem trajetória de GPS"
        description={`${ctx.track.msg ? ctx.track.msg.replace(/\.$/, '') + '. ' : ''}As voltas são separadas pelo cruzamento da linha de largada, que precisa da posição do GPS (canais X/Y nas entradas 7 e 8 da FT, ou latitude/longitude do BUSMASTER com fix). Confira os canais em Pista e GPS; no próximo teste, espere o GPS pegar fix antes de sair.`}
        action={<Button size="md" variant="default" leftSection={<IconRoute size={18} />} onClick={() => nav('/pista')}>Conferir Pista e GPS</Button>}
      />
    );
  }
  /* log de bancada / carro parado: não há voltas a separar */
  const dist = ctx.track.dist[ctx.track.dist.length - 1];
  if (!ctx.laps.length && !(dist >= MIN_LAP_DIST)) {
    return (
      <EmptyState icon={IconFlag} title="O carro quase não andou neste log"
        description={`Pelo GPS, o carro percorreu só ${isFinite(dist) ? dist.toFixed(0) : '0'} m nesta sessão: não há voltas para separar. Para comparar voltas, grave um teste com o carro dando várias voltas seguidas na pista (mesmo piloto), com o GPS com fix desde a saída.`}
        action={<Button size="md" variant="default" leftSection={<IconMap2 size={18} />} onClick={() => nav('/mapa')}>Ver a trajetória no Mapa</Button>}
      />
    );
  }
  if (!ctx.cfg.line) {
    return (
      <EmptyState icon={IconFlag} title="Falta a linha de largada"
        description={`${table.empty} A linha automática fica perpendicular ao movimento no primeiro trecho com o carro andando; para pôr exatamente na largada, desenhe com 2 cliques no mapa.`}
        action={(
          <Group gap="sm" justify="center">
            <Button size="md" leftSection={<IconSparkles size={18} />} onClick={() => applyAutoLine()}>Linha automática</Button>
            <Button size="md" variant="default" leftSection={<IconMap2 size={18} />} onClick={() => nav('/mapa')}>Desenhar no Mapa</Button>
          </Group>
        )}
      />
    );
  }
  return (
    <EmptyState icon={IconFlag} title="Nenhuma volta completa"
      description={`${table.empty} A linha precisa cruzar o traçado num ponto por onde o carro passa a cada volta; a volta mínima fica em Pista e GPS.`}
      action={(
        <Group gap="sm" justify="center">
          <Button size="md" variant="default" leftSection={<IconMap2 size={18} />} onClick={() => nav('/mapa')}>Ajustar a linha no Mapa</Button>
          <Button size="md" variant="default" leftSection={<IconRoute size={18} />} onClick={() => nav('/pista')}>Volta mínima (Pista e GPS)</Button>
        </Group>
      )}
    />
  );
}

/* cabeçalho de coluna com ⓘ (cada número da tabela diz de onde saiu) */
const COL_EXPLAIN: Record<string, { explain: string; sensors: SensorId[] }> = {
  'Volta': { explain: 'laps.table', sensors: LAP_SENSORS },
  'Tempo': { explain: 'laps.lapTimes', sensors: LAP_SENSORS },
  'Δ melhor': { explain: 'laps.delta', sensors: LAP_SENSORS },
  'V máx': { explain: 'channel.gps_speed', sensors: ['gps'] },
  'V média': { explain: 'channel.gps_speed', sensors: ['gps'] },
  'Dist.': { explain: 'track.distance', sensors: ['gps'] },
};

/* ---------------------------------------------------------------- página */
function VoltasBody({ ctx }: { ctx: SessionContext }) {
  const selLap = useSessionStore(s => s.selLap);
  const rangeMode = useSessionStore(s => s.rangeMode);
  const setLap = useSessionStore(s => s.setLap);
  const setRangeMode = useSessionStore(s => s.setRangeMode);
  const seek = useSessionStore(s => s.seek);
  const curLap = useCursorLap(ctx.laps);

  const table = useMemo(() => lapTable(ctx, selLap), [ctx, selLap]);
  const [cmp, setCmp] = useState<number | null>(null);
  const [ref, setRef] = useState<number | null>(null);
  useEffect(() => { setCmp(null); setRef(null); }, [ctx.laps]);
  const rep = useMemo(() => lapReport(ctx, cmp, ref, selLap), [ctx, cmp, ref, selLap]);

  /* gráficos por distância: clique = ir ao ponto; marcador = cursor dentro da volta comparada */
  const speedRef = useRef<XYPlotHandle>(null);
  const deltaRef = useRef<XYPlotHandle>(null);
  const specs = useMemo(() => {
    const go = (d: number) => { const t = lapSeekTime(rep, d); if (isFinite(t)) seek(t); };
    return {
      speed: rep.speed ? reportSpec(rep.speed, { onClick: go }) : null,
      delta: rep.delta ? reportSpec(rep.delta, { onClick: go }) : null,
      sectors: rep.sectors ? reportSpec(rep.sectors) : null,
    };
  }, [rep, seek]);
  const placeMarker = (t: number) => {
    const tr = ctx.track;
    if (!tr.ok) return;
    const d = lapCursorDist(rep, tr, idxAt(ctx.S.t, t), t);
    const markers = d === null ? [] : [{ x: d, color: 'cursor' }];
    speedRef.current?.update({ markers });
    deltaRef.current?.update({ markers });
  };
  useCursorEffect(t => placeMarker(t));
  useEffect(() => { placeMarker(useSessionStore.getState().cursor); });

  if (!table.ok) return <NoLaps ctx={ctx} table={table} />;

  const pick = (row: LapTableRow) => {
    setCmp(null);
    setLap(row.k);
    if (rangeMode === 'session') setRangeMode('lap');
  };
  const allSession = () => { setLap(-1); if (rangeMode === 'lap') setRangeMode('session'); };

  const bestRow = table.rows.find(r => r.best);
  const columns: Column<LapTableRow>[] = table.columns.map((h, c) => ({
    key: h,
    numeric: c > 0,
    header: (
      <span className="bt-voltas-th">
        {h}<InfoButton explain={COL_EXPLAIN[h]?.explain ?? table.explain} sensors={COL_EXPLAIN[h]?.sensors ?? table.sensors} title={h} size="sm" />
      </span>
    ),
    render: (row: LapTableRow) => {
      if (c === 0) {
        return (
          <Group gap={6} wrap="nowrap">
            {row.k === curLap
              ? <IconPlayerPlayFilled size={13} className="bt-voltas-cur" aria-label="cursor nesta volta" />
              : <span style={{ width: 13, display: 'inline-block' }} />}
            {row.cells[0]}
          </Group>
        );
      }
      if (c === 1 && row.best) {
        return <span className="bt-voltas-best"><IconStarFilled size={14} aria-hidden />{row.cells[1]}</span>;
      }
      return row.cells[c];
    },
  }));

  const fin = rep.ok ? rep.fin : NaN;
  return (
    <>
      <Section>
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md">
          <StatTile label="Voltas completas" value={table.rows.length} explain="laps.lapTimes" sensors={table.sensors}
            hint="cruzando a linha de largada" />
          <StatTile label="Melhor volta" value={fmtTime(table.best)} explain="laps.lapTimes" sensors={table.sensors}
            hint={bestRow ? `volta ${bestRow.lap.n} · ${bestRow.cells[3]} km/h máx` : undefined} />
          <StatTile label={rep.lap ? `Volta ${rep.lap.n} (comparada)` : 'Volta comparada'} value={rep.lap ? fmtTime(rep.lap.time) : null}
            explain="laps.compare" sensors={rep.sensors} hint={rep.refLap ? `contra volta ${rep.refLap.n} · ${fmtTime(rep.refLap.time)}` : 'precisa de 2 voltas'} />
          <StatTile label="Diferença no fim" value={isFinite(fin) ? `${fin >= 0 ? '+' : ''}${fin.toFixed(2)}` : null} unit="s"
            explain="laps.delta" sensors={rep.sensors}
            hint={isFinite(fin) ? (fin >= 0 ? 'mais lenta que a referência' : 'mais rápida que a referência') : undefined} />
        </SimpleGrid>
      </Section>

      <Section title="Tabela de voltas" explain={table.explain} sensors={table.sensors}
        description="As voltas são sempre da sessão inteira. Clique numa volta para ver só ela: o trecho de todas as páginas passa a ser essa volta, o cursor vai para a largada e o play fica nela."
        actions={<Button variant="default" onClick={allSession} disabled={selLap < 0}>Sessão inteira</Button>}>
        <Paper withBorder radius="md" className="bt-voltas-table">
          <DataTable columns={columns} rows={table.rows} rowKey={r => r.k} onRowClick={pick}
            selected={(r: LapTableRow) => r.sel} maxHeight={440} />
          <Text size="sm" c="dimmed" px="md" py="sm">
            {table.note} · <IconStarFilled size={12} style={{ verticalAlign: '-1px' }} /> melhor volta · <IconPlayerPlayFilled size={12} style={{ verticalAlign: '-1px' }} /> volta do cursor
          </Text>
        </Paper>
      </Section>

      <Section title="Comparar duas voltas" explain={rep.explain} sensors={rep.sensors}
        description="As duas voltas são postas na mesma distância (a comparada é escalada para o comprimento da referência) e comparadas metro a metro. Velocidade mínima de curva baixa aponta aderência lateral; saída lenta, tração e CVT; reta lenta, potência e arrasto.">
        {!rep.ok ? (
          <EmptyState icon={IconFlag} title="Só uma volta" description={rep.empty} />
        ) : (
          <Stack gap="lg">
            <Paper withBorder radius="md" p="md">
              <Group gap="lg" align="flex-end" wrap="wrap">
                <Select label="Volta" data={rep.options.map(o => ({ value: String(o.value), label: o.label }))} value={String(rep.cmp)}
                  onChange={v => v !== null && setCmp(+v)} allowDeselect={false} w={260} comboboxProps={{ withinPortal: true }} />
                <Select label="contra" data={rep.options.map(o => ({ value: String(o.value), label: o.label }))} value={String(rep.ref)}
                  onChange={v => v !== null && setRef(+v)} allowDeselect={false} w={260} comboboxProps={{ withinPortal: true }} />
                <Group gap={4} wrap="nowrap" style={{ flex: '1 1 320px' }}>
                  <Text size="md" className="bt-num">{rep.summary}</Text>
                  <InfoButton explain="laps.compare" sensors={rep.sensors} title="Comparação de voltas" />
                </Group>
              </Group>
            </Paper>

            {rep.speed && specs.speed && (
              <ChartCard title="Velocidade ao longo da volta" explain={rep.speed.explain} sensors={rep.speed.sensors}
                subtitle="clique para ir ao ponto · a linha vertical é o cursor, quando ele está na volta comparada">
                <XYPlot ref={speedRef} spec={specs.speed} height={340} aria-label="Velocidade ao longo da volta" />
              </ChartCard>
            )}
            <div className="bt-voltas-grid">
              {rep.delta && specs.delta && (
                <ChartCard title="Diferença de tempo acumulada" explain={rep.delta.explain} sensors={rep.delta.sensors}
                  subtitle={`acima de zero = a volta ${rep.lap?.n} está perdendo para a ${rep.refLap?.n} · clique para ir ao ponto`}>
                  <XYPlot ref={deltaRef} spec={specs.delta} height={300} aria-label="Diferença de tempo acumulada" />
                </ChartCard>
              )}
              {rep.sectors && specs.sectors && (
                <ChartCard title="Onde ganhou e perdeu tempo (10 trechos de mesma distância)" explain={rep.sectors.explain} sensors={rep.sectors.sensors}
                  subtitle="altura = quanto tempo no trecho; passe o mouse para ver os metros e os segundos">
                  <XYPlot spec={specs.sectors} height={300} aria-label="Onde ganhou e perdeu tempo" />
                </ChartCard>
              )}
            </div>
          </Stack>
        )}
      </Section>
    </>
  );
}
