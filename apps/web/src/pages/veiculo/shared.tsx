/* Peças comuns das páginas do veículo (Trem de força, CVT, Dinâmica — o vehicleui.js /
 * renderDyn do app antigo). Só desenham o que os relatórios do core devolvem: RepPlot →
 * XYPlot, RepTile → StatTile, RepText → nota da fonte. Nenhuma conta aqui.
 *
 * Ficam nesta pasta (e não em src/components) porque outros agentes estão mexendo nos
 * componentes compartilhados; ver as sugestões em deviations. */
import type { CSSProperties, ReactNode, Ref } from 'react';
import { Badge, Box, Group, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconInfoCircle, type Icon } from '@tabler/icons-react';
import { esc, fmtRep, SENSORS, type RepPlot, type RepText, type RepTile, type SensorId } from '@baja/core';
import {
  ChartCard, InfoButton, NoSessionState, PageHeader, SensorChips, StatTile,
  XYPlot, type XYPlotHandle, type XYSpec,
} from '../../components';
import type { Status } from '../../theme';

/* ---------------------------------------------------------------- RepPlot → XYSpec */

/** Spec do XYPlot a partir do RepPlot do core (cores pelo role, tooltips pelo RepFmt). */
export function repSpec(p: RepPlot, extra: Partial<XYSpec> = {}): XYSpec {
  if (p.empty) return { empty: p.empty };
  const tipX = p.tipX, fmtY = p.fmtY, tips = p.barTips;
  return {
    series: p.series?.map(q => ({ x: q.x, y: q.y, id: q.id, color: q.role, label: q.label, width: q.width })),
    points: p.points ? { x: p.points.x, y: p.points.y, alpha: p.points.alpha } : undefined,
    bars: p.bars ? { x0: p.bars.x0, w: p.bars.w, y: p.bars.y, colors: p.bars.roles } : undefined,
    hlines: p.hlines?.map(l => ({ y: l.y, color: l.role, label: l.label })),
    markers: p.markers?.map(m => ({ x: m.x, color: m.role, label: m.label })),
    circles: p.circles,
    xLabel: p.xLabel, yLabel: p.yLabel, logY: p.logY, equal: p.equal,
    xRange: p.xRange, yRange: p.yRange, zeroY: p.zeroY,
    legend: p.legend?.map(l => ({ label: l.label, role: l.role })),
    tipX: tipX ? (x: number) => `<b>${esc(fmtRep(tipX, x))}</b>` : undefined,
    fmtY: fmtY ? (v: number) => fmtRep(fmtY, v) : undefined,
    tipBar: tips ? (k: number) => {
      const b = tips[k];
      return b ? `<b>${esc(b.title)}</b>${b.note ? ' ' + esc(b.note) : ''}<br>${esc(b.text)}` : '';
    } : undefined,
    ...extra,
  };
}

export interface RepChartProps {
  plot: RepPlot | null | undefined;
  title: string;
  /** como ler o gráfico (texto do app antigo) */
  subtitle?: ReactNode;
  height?: number;
  /** clique no gráfico com x em tempo: ir ao ponto */
  onClickX?: (x: number) => void;
  /** texto extra quando o relatório não tem dados para o gráfico (o que medir) */
  emptyHint?: ReactNode;
  footer?: ReactNode;
  actions?: ReactNode;
  plotRef?: Ref<XYPlotHandle>;
  /** sobrepõe campos do spec (ex.: hi) */
  extra?: Partial<XYSpec>;
  /** caixa do gráfico (ex.: quadrado do g-g) */
  boxStyle?: CSSProperties;
  /** explain/sensores quando plot é null */
  explain?: string;
  sensors?: SensorId[];
}

/** ChartCard + XYPlot de um RepPlot. Gráfico sem dados vira uma caixa com a mensagem do
 *  relatório (e o que medir), da mesma altura, em vez do texto pequeno no canvas. */
export function RepChart({ plot, title, subtitle, height = 300, onClickX, emptyHint, footer, actions, plotRef, extra, boxStyle, explain, sensors }: RepChartProps) {
  const empty = !plot ? 'sem dados' : plot.empty;
  return (
    <ChartCard
      title={title} subtitle={subtitle} explain={plot?.explain ?? explain} sensors={plot?.sensors ?? sensors}
      actions={actions} footer={footer}
    >
      {empty ? (
        <Stack align="center" justify="center" gap={6} style={{ minHeight: height }} px="md" ta="center">
          <Text fw={600} size="md">{empty.charAt(0).toUpperCase() + empty.slice(1)}</Text>
          {emptyHint && <Text c="dimmed" size="sm" maw={460}>{emptyHint}</Text>}
        </Stack>
      ) : (
        <Box style={boxStyle}>
          <XYPlot
            ref={plotRef} height={height} aria-label={title}
            spec={repSpec(plot!, { ...(onClickX ? { onClick: onClickX } : {}), ...extra })}
          />
        </Box>
      )}
    </ChartCard>
  );
}

/* ---------------------------------------------------------------- blocos */

/* O RepTile traz "unidade e contexto" juntos (texto pequeno do antigo). Se começa com uma
 * unidade, ela vai ao lado do número e o resto vira a linha de baixo. */
const UNIT_RE = /^(km\/h|kW|N|s|g|m|m²|°C|°C\/min|min|min:s|%|Hz|mm|mm\/s)$/;
export function splitUnit(unit: string): { unit?: string; hint?: string } {
  if (!unit) return {};
  const m = /^(\S+)\s*(.*)$/.exec(unit.trim());
  if (m && UNIT_RE.test(m[1])) return { unit: m[1], hint: m[2] || undefined };
  return { hint: unit };
}

/** status do bloco (ícone + texto); hint substitui a linha de baixo ('' = sem linha) */
export interface TileStatus { status: Status; text?: string; hint?: string }

/** Grade dos blocos do relatório (largura mínima 230 px, quantas colunas couberem). */
export function RepTiles({ tiles, statusOf, min = 230 }: {
  tiles: RepTile[]; statusOf?: (t: RepTile) => TileStatus | undefined; min?: number;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 16 }}>
      {tiles.map(t => {
        const u = splitUnit(t.unit);
        const st = statusOf?.(t);
        return (
          <StatTile
            key={t.key} label={t.label} value={t.text} unit={u.unit} hint={st?.hint !== undefined ? st.hint || undefined : u.hint}
            explain={t.explain} sensors={t.sensors} status={st?.status} statusText={st?.text}
          />
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- notas */

/** Nota de "de onde vêm os dados" (pwSrc, cvSrc, dySrc): texto, sensores e ⓘ. */
export function SourceNote({ src, label, icon: Ico = IconInfoCircle, children }: {
  src: RepText; label: string; icon?: Icon; children?: ReactNode;
}) {
  return (
    <Paper withBorder radius="md" p="md">
      <Group align="flex-start" wrap="nowrap" gap="md">
        <ThemeIcon size={40} radius="md" variant="light"><Ico size={22} stroke={1.7} /></ThemeIcon>
        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap="wrap">
            <Text fw={650}>{label}</Text>
            <SensorChips sensors={src.sensors} size="sm" />
          </Group>
          {src.text && <Text>{src.text}</Text>}
          {children}
        </Stack>
        <InfoButton explain={src.explain} sensors={src.sensors} title={label} />
      </Group>
    </Paper>
  );
}

/** Lista "Sensor: para que serve" (nos estados vazios: o que falta e o que medir). */
export function NeedSensors({ sensors, why }: { sensors: SensorId[]; why?: Partial<Record<SensorId, string>> }) {
  return (
    <Stack gap={8} align="stretch" ta="left" maw={560} mx="auto">
      {sensors.map(id => (
        <Group key={id} gap={8} wrap="nowrap" align="flex-start">
          <SensorChips sensors={[id]} size="sm" />
          <Text size="sm" c="dimmed">{why?.[id] ?? SENSORS[id]?.purpose}</Text>
        </Group>
      ))}
    </Stack>
  );
}

/* ---------------------------------------------------------------- estados da página */

/** Rótulo do trecho analisado (o seletor fica no cabeçalho). */
export function RangeBadge({ label }: { label: string }) {
  return (
    <Badge size="lg" variant="light" radius="sm" style={{ textTransform: 'none', fontWeight: 600 }}
      title="Trecho analisado: escolha Sessão, Volta ou Janela no cabeçalho">
      Trecho: {label}
    </Badge>
  );
}

/** Sem sessão aberta (ou abrindo): cabeçalho + estado vazio com os botões para abrir. */
export function NoSession({ title, subtitle, what }: { title: string; subtitle: string; what: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <NoSessionState
        description={`Esta página mostra ${what} de um log. Escolha um log na biblioteca ou abra os dados de exemplo para ver como fica.`} />
    </>
  );
}

/** Estado vazio com conteúdo rico (o EmptyState compartilhado põe a descrição dentro de um
 *  <Text>/<p>, que não pode conter listas e chips): o que falta e o que medir. */
export function MissingState({ icon: Ico, title, children, action }: { icon: Icon; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Paper withBorder radius="md" className="bt-empty">
      <Stack align="center" gap="sm" py={44} px="md" ta="center">
        <ThemeIcon size={52} radius="xl" variant="light" color="gray"><Ico size={28} stroke={1.6} /></ThemeIcon>
        <Title order={3} mt={4}>{title}</Title>
        <Box maw={640} w="100%">{children}</Box>
        {action && <div style={{ marginTop: 8 }}>{action}</div>}
      </Stack>
    </Paper>
  );
}

/** Grade de 2 colunas a partir de `from` px de tela (1 abaixo), sem rolagem horizontal. */
export function Grid2({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={wide ? 'bt-veh-grid bt-veh-grid--wide' : 'bt-veh-grid'}>{children}</div>;
}

/** CSS local das páginas do veículo (grade 2 colunas ≥ 1200 px; ≥ 1500 px nas "largas"). */
export function VehStyles() {
  return (
    <style>{`
.bt-veh-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; align-items: start; }
@media (min-width: 1200px) { .bt-veh-grid:not(.bt-veh-grid--wide) { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 1500px) { .bt-veh-grid--wide { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.bt-veh-stack > * + * { margin-top: 20px; }
.bt-veh-code { font-family: var(--mantine-font-family-monospace); font-size: 14px; padding: 10px 12px; border-radius: 8px;
  background: var(--mantine-color-default-hover); overflow-wrap: anywhere; }
`}</style>
  );
}
