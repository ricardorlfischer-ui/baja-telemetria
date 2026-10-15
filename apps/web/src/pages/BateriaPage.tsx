/* Página /bateria (novo, battery.ts do core): quanto a bateria ainda dura pela queda da
 * tensão que a FT450 grava, a carga pela tensão, o consumo médio e se ela aguenta o enduro.
 * A leitura da FT vem corrigida (+0,5 V por padrão, em "Dados do carro").
 *
 * Tudo vem de batteryReport (core); a página só desenha. */
import { Alert, Box, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconBatteryAutomotive, IconCar, IconCircleCheck, IconInfoCircle } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { batteryReport, type BatteryReport, type RepTile, type SessionContext } from '@baja/core';
import { InfoButton, PageHeader, Section, SensorChips } from '../components';
import { routeByPath } from '../routes';
import { useCtx, useRange, useSessionStore } from '../state/session';
import { STATUS_COLOR, type Status } from '../theme';
import { ComputingPage, Grid2, MissingState, NeedSensors, NoSession, RangeBadge, RepChart, RepTiles, SourceNote, VehStyles, type TileStatus } from './veiculo/shared';
import { useComputed } from '../state/heavy';

const ROUTE = '/bateria';

export default function BateriaPage() {
  const r = routeByPath(ROUTE)!;
  const ctx = useCtx();
  const range = useRange();
  if (!ctx || !range) return <NoSession title={r.label} subtitle={r.question} what="a tensão da bateria e quanto ela ainda dura" />;
  return <Body ctx={ctx} i0={range[0]} i1={range[1]} label={range[2]} />;
}

function Body({ ctx, i0, i1, label }: { ctx: SessionContext; i0: number; i1: number; label: string }) {
  const rep = useComputed(() => batteryReport(ctx, i0, i1), [ctx, i0, i1]);
  const r = routeByPath(ROUTE)!;
  if (!rep) return <ComputingPage title={r.label} subtitle={r.question} label={label} what="a estimativa da bateria" />;
  return <Content label={label} rep={rep} />;
}

function Content({ label, rep }: { label: string; rep: BatteryReport }) {
  const r = routeByPath(ROUTE)!;
  const nav = useNavigate();
  const seek = useSessionStore(s => s.seek);

  const carBtn = <Button variant="default" size="md" leftSection={<IconCar size={18} />} onClick={() => nav('/carro')}>Dados do carro</Button>;
  const header = (
    <PageHeader title={r.label} subtitle={r.question} explain="battery.life" sensors={rep.ok ? rep.sensors : undefined}
      actions={<><RangeBadge label={label} />{carBtn}</>} />
  );

  if (!rep.ok) {
    return (
      <>
        <VehStyles />
        {header}
        <MissingState icon={IconBatteryAutomotive} title="Sem tensão da bateria neste log" action={carBtn}>
          <Stack gap="md">
            <Text c="dimmed">{rep.empty}</Text>
            <Text fw={600}>O que gravar:</Text>
            <NeedSensors sensors={['battery', 'logger']} why={{
              battery: 'A FT450 já mede a tensão da alimentação: basta incluir o canal “Tensão da bateria” na exportação do CSV no FT Manager.',
              logger: 'Um log longo (20 min ou mais) com o carro ligado: a tensão do LiFePO4 cai devagar.',
            }} />
            <Text size="sm" c="dimmed">Se o canal existe com outro nome, escolha-o na página Carro (canal da tensão da bateria).</Text>
          </Stack>
        </MissingState>
      </>
    );
  }

  const reserve = rep.bat.reserve;
  const statusOf = (t: RepTile): TileStatus | undefined => {
    if (t.key === 'soc' && t.value !== null) {
      return t.value < 20 ? { status: 'crit', text: 'carregue antes do próximo teste' } : t.value < 40 ? { status: 'warn', text: 'menos da metade' } : { status: 'good', text: 'carga boa' };
    }
    if (t.key === 'endurance' && t.value !== null) {
      return t.value < reserve ? { status: 'crit', text: 'não aguenta o enduro' } : t.value < reserve + 15 ? { status: 'warn', text: 'aguenta com pouca folga' } : { status: 'good', text: 'aguenta o enduro' };
    }
    return undefined;
  };

  return (
    <>
      <VehStyles />
      {header}

      <Section>
        <SourceNote src={rep.src} label="Tensão da bateria" icon={IconBatteryAutomotive}>
          <Text size="sm" c="dimmed">
            A FT450 lê a tensão a menos que o multímetro; a correção é somada antes de qualquer conta. Bateria, correção e reserva
            ficam em “Dados do carro”.
          </Text>
        </SourceNote>
      </Section>

      <Section title="Quanto ainda dura">
        <Verdict rep={rep} />
      </Section>

      <Section title="Números do trecho" description="Cada número abre o card com a conta e os sensores de onde saiu.">
        <RepTiles tiles={rep.tiles} statusOf={statusOf} />
        {rep.notes.length > 0 && (
          <Stack gap="sm" mt="lg">
            {rep.notes.map((n, k) => (
              <Alert key={k} color="yellow" variant="light" icon={<IconAlertTriangle size={20} />}>
                <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
                  <Text>{n.text}</Text>
                  <InfoButton explain={n.explain} sensors={n.sensors} title="Aviso" />
                </Group>
              </Alert>
            ))}
          </Stack>
        )}
      </Section>

      <Section title="Tensão e carga" explain="battery.voltageTrend" sensors={rep.plot?.sensors}>
        <Grid2>
          <RepChart
            plot={rep.plot} title="Tensão real da bateria" height={320} onClickX={t => seek(t)}
            subtitle="Leitura da FT + correção. Em destaque, os trechos de repouso (motor parado, tensão estável) e a tendência da carga que entra nas contas: com o motor ligado a tensão oscila com a carga e não mede a descarga. Clique para ir ao instante."
          />
          <RepChart
            plot={rep.curvePlot} title="Curva tensão × carga (LiFePO4 12,8 V)" height={320}
            subtitle="Curva típica de fabricante; em destaque, o pedaço da curva que a bateria percorreu neste trecho. Repare como ela é plana entre 20 e 90 %."
          />
        </Grid2>
      </Section>
    </>
  );
}

/* Destaque: a frase principal com a cor do status. */
function Verdict({ rep }: { rep: BatteryReport }) {
  const left = rep.tiles.find(t => t.key === 'left');
  /* com a descarga medida: crítico abaixo de 20 % de carga, atenção com menos de 30 min */
  const st: Status = rep.status === 'ok'
    ? (rep.socEnd < 20 ? 'crit' : (rep.hoursLeft ?? 0) < 0.5 ? 'warn' : 'good')
    : 'warn';
  const color = STATUS_COLOR[st];
  const Ico = st === 'good' ? IconCircleCheck : st === 'crit' ? IconAlertTriangle : IconInfoCircle;
  const TITLE: Record<NonNullable<BatteryReport['status']>, string> = {
    ok: `${left?.text ?? '—'} até ${rep.bat.reserve} % de carga`,
    flat: 'Descarga pequena demais para medir neste log',
    noRest: 'Sem estimativa: faltam trechos de repouso',
    noRpm: 'Sem estimativa: falta o canal de rotação',
    charging: 'Bateria sendo carregada',
    short: 'Log curto demais',
  };
  const title = rep.status ? TITLE[rep.status] : '—';
  return (
    <Paper withBorder radius="md" p="lg" style={{ borderLeft: `6px solid ${color}` }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
        <Group gap="md" wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
          <Box style={{ color }} pt={4}><Ico size={36} stroke={1.8} /></Box>
          <Stack gap={6} style={{ minWidth: 0 }}>
            <Text fw={600} c="dimmed">{rep.bat.model} · {rep.bat.wh} Wh</Text>
            <Title order={2} style={{ fontSize: 30, lineHeight: 1.15 }}>{title}</Title>
            <Text size="lg">{rep.reading}</Text>
            <SensorChips sensors={rep.sensors} size="sm" />
          </Stack>
        </Group>
        <InfoButton explain="battery.life" sensors={rep.sensors} title="Quanto a bateria ainda dura" size="lg" />
      </Group>
    </Paper>
  );
}
