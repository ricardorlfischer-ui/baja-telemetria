/* Peças comuns das páginas Suspensão e Ressonância (só desenho; as contas são do core:
 * suspensionReport / resonanceReport).
 *
 * - PlotCard: ChartCard + XYPlot (reportSpec de components/), com estado vazio grande quando
 *   o relatório diz o que falta.
 * - NoSession / NoShocks: estados vazios úteis.
 * - Num: número clicável que abre o card de explicação (todo número diz de onde saiu).
 * - Callout / StillShocks / DeadShocks: avisos dentro da página, com os sensores.
 * - CommitNumber: campo numérico que só aplica ao sair do campo / Enter (cada mudança
 *   recalcula a sessão). */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Group, NumberInput, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconCar, IconChartAreaLine } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { suspCornerSensor, type SensorId, type Shock, type SuspPlot, type SuspStillWarning } from '@baja/core';
import {
  ChartCard, EmptyState, InfoButton, NoSessionState, SensorChips, XYPlot, reportSpec, useExplain, type XYSpec,
} from '../../components';
import { useChartTheme, type Corner } from '../../theme';
import classes from './susp.module.css';

export { RangeBadge } from '../../components';

/* ---------------------------------------------------------------- gráfico do relatório */
export interface PlotCardProps {
  plot: SuspPlot;
  title?: string;
  subtitle?: ReactNode;
  height?: number;
  /** o que fazer quando o gráfico está vazio (além da frase do relatório) */
  emptyHint?: ReactNode;
  extra?: Partial<XYSpec>;
  actions?: ReactNode;
  footer?: ReactNode;
}

export function PlotCard({ plot, title, subtitle, height = 280, emptyHint, extra, actions, footer }: PlotCardProps) {
  const spec = useMemo(() => reportSpec(plot, { extra }), [plot, extra]);
  return (
    <ChartCard title={title ?? plot.title} subtitle={subtitle} explain={plot.explain} sensors={plot.sensors} actions={actions} footer={footer}>
      {plot.empty ? (
        <div style={{ minHeight: height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState bare icon={IconChartAreaLine} title="Sem dados para este gráfico"
            description={<>{cap(plot.empty)}.{emptyHint ? <> {emptyHint}</> : null}</>} />
        </div>
      ) : (
        <XYPlot spec={spec} height={height} aria-label={plot.title} />
      )}
    </ChartCard>
  );
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* ---------------------------------------------------------------- número clicável */
/** Valor (texto igual ao do antigo) que abre o card de explicação com os sensores da conta. */
export function Num({ children, explain, sensors, title, strong, dim, wrap }: {
  children: ReactNode; explain?: string; sensors?: SensorId[]; title?: string; strong?: boolean; dim?: boolean;
  /** pode quebrar linha (listas de valores numa coluna estreita) */
  wrap?: boolean;
}) {
  const { open } = useExplain();
  const cls = [classes.num, strong ? classes.strong : '', dim || wrap ? classes.dim : '', wrap ? classes.wrapNum : ''].join(' ');
  if (!explain) return <span className={cls}>{children}</span>;
  return (
    <UnstyledButton className={`${cls} ${classes.numLink}`} title="De onde vem este número"
      onClick={e => { e.stopPropagation(); open(explain, { sensors, title }); }}>
      {children}
    </UnstyledButton>
  );
}

/** Quadradinho com a cor fixa do canto. */
export function CornerSwatch({ id, size = 12 }: { id: Corner; size?: number }) {
  const th = useChartTheme();
  return <span className={classes.swatch} style={{ width: size, height: size, background: th.corner[id] }} aria-hidden />;
}

export function CarButton() {
  const nav = useNavigate();
  return (
    <Button variant="default" leftSection={<IconCar size={17} />} onClick={() => nav('/carro')}>
      Dados do carro
    </Button>
  );
}

/* ---------------------------------------------------------------- estados vazios */
export function NoSession({ what }: { what: string }) {
  return (
    <NoSessionState
      description={`Abra um log com os amortecedores gravando para ver ${what}. Sem log à mão, use os dados de exemplo.`} />
  );
}

/** Log sem amortecedor com sinal: a frase do relatório, os canais achados e o que instalar. */
export function NoShocks({ text, sensors, need }: { text: string; sensors: SensorId[]; need: string }) {
  const nav = useNavigate();
  return (
    <EmptyState
      title="Este log não tem amortecedores com sinal"
      description={text}
      action={(
        <Stack gap="md" align="center" maw={560}>
          {/* sem canal nenhum: os quatro amortecedores (aparecem como ausentes) */}
          <SensorChips sensors={sensors.length ? sensors : ['shock_fl', 'shock_fr', 'shock_rl', 'shock_rr']} size="sm" />
          <Text c="dimmed">
            {need} Instale/ligue os potenciômetros lineares em paralelo com os amortecedores (entradas
            analógicas da FT450, calibradas em mm no FT Manager) e grave de novo.
          </Text>
          <Group gap="sm" justify="center">
            <Button variant="default" onClick={() => nav('/aquisicao')}>Ver os sensores do log</Button>
            <Button variant="default" leftSection={<IconCar size={17} />} onClick={() => nav('/carro')}>Dados do carro</Button>
          </Group>
        </Stack>
      )}
    />
  );
}

/** Aviso dentro da página (o que falta para um bloco, com os sensores). */
export function Callout({ children, sensors, tone = 'info' }: { children: ReactNode; sensors?: SensorId[]; tone?: 'info' | 'warn' }) {
  return (
    <Paper withBorder radius="md" p="md" className={tone === 'warn' ? `${classes.callout} ${classes.calloutWarn}` : classes.callout}>
      <Stack gap={8}>
        <Text size="md">{children}</Text>
        {sensors && sensors.length > 0 && <SensorChips sensors={sensors} />}
      </Stack>
    </Paper>
  );
}

/** Amortecedores sem sinal (canal constante ou ausente) quando pelo menos um tem sinal. */
export function DeadShocks({ shocks, why }: { shocks: Shock[]; why: string }) {
  const dead = shocks.filter(k => !k.active), live = shocks.filter(k => k.active);
  if (!dead.length || !live.length) return null;
  const constant = dead.filter(k => k.pos);
  return (
    <Callout tone="warn" sensors={dead.map(k => suspCornerSensor(k.id))}>
      <b>Sem sinal em {dead.map(k => k.id).join(', ')}</b>
      {constant.length === dead.length
        ? ': o canal existe no log mas ficou constante (potenciômetro desligado, conector solto ou calibração zerada no FT Manager?)'
        : constant.length
          ? `: ${constant.map(k => k.id).join(', ')} com canal constante (sensor desligado ou calibração zerada?), os outros sem canal no log`
          : ': o log não tem esses canais'}.
      {' '}Só {live.map(k => k.id).join(', ')} entra nas contas. {why} Para conferir: empurre cada canto com o log gravando e veja se o canal mexe.
    </Callout>
  );
}

/** Amortecedores com sinal mas quase parados no trecho (suspensionReport.still do core: curso
 *  usado < SHOCK_STILL_MM). O texto é o do core; o ⓘ abre o card quality.shockStill. */
export function StillShocks({ still }: { still: SuspStillWarning | null }) {
  if (!still) return null;
  return (
    <Callout tone="warn" sensors={still.sensors}>
      <Group component="span" gap={4} wrap="nowrap" align="flex-start" style={{ display: 'inline-flex' }}>
        <span>{still.text} Com o carro parado, comprima o canto e veja o canal mexer vários mm.</span>
        <InfoButton explain={still.explain} sensors={still.sensors} title="Amortecedor quase parado" size="sm" />
      </Group>
    </Callout>
  );
}

/* ---------------------------------------------------------------- campo numérico */
export function CommitNumber({ label, value, onCommit, suffix, min, step, decimalScale, w = 150, description }: {
  label: ReactNode; value: number; onCommit: (v: number) => void; suffix?: string; min?: number; step?: number;
  decimalScale?: number; w?: number; description?: ReactNode;
}) {
  const [v, setV] = useState<string | number>(value);
  useEffect(() => { setV(value); }, [value]);
  const commit = () => {
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    if (isFinite(n) && n !== value) onCommit(n);
    else setV(value);
  };
  return (
    <NumberInput
      label={label} description={description} value={v} onChange={setV} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); }}
      suffix={suffix} min={min} step={step} decimalScale={decimalScale} w={w} size="md" hideControls={false}
    />
  );
}
