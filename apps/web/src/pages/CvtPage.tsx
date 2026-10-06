/* Página /cvt (renderCvt de legacy/js/vehicleui.js): canal da temperatura, blocos, o modelo
 * térmico ajustado, medido × modelo (clique = ir ao ponto), projeção para o enduro e a nota.
 * Em destaque, o que muda no projeto do carro novo: a troca de calor necessária.
 *
 * Tudo vem de cvtReport (core); a página só desenha. */
import { useMemo } from 'react';
import { Alert, Box, Button, Group, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconAlertOctagon, IconAlertTriangle, IconCar, IconCircleCheck, IconTemperature } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { cvtReport, type CvtReport, type RepTile, type SessionContext } from '@baja/core';
import { InfoButton, PageHeader, Section, SensorChips } from '../components';
import { routeByPath } from '../routes';
import { useCtx, useRange, useSessionStore } from '../state/session';
import { STATUS_COLOR } from '../theme';
import { MissingState, Grid2, NeedSensors, NoSession, RangeBadge, RepChart, RepTiles, SourceNote, VehStyles, type TileStatus } from './veiculo/shared';

const ROUTE = '/cvt';

export default function CvtPage() {
  const r = routeByPath(ROUTE)!;
  const ctx = useCtx();
  const range = useRange();
  if (!ctx || !range) return <NoSession title={r.label} subtitle={r.question} what="a temperatura da CVT e a projeção para o enduro" />;
  return <Body ctx={ctx} i0={range[0]} i1={range[1]} label={range[2]} />;
}

function Body({ ctx, i0, i1, label }: { ctx: SessionContext; i0: number; i1: number; label: string }) {
  const r = routeByPath(ROUTE)!;
  const nav = useNavigate();
  const seek = useSessionStore(s => s.seek);
  const rep = useMemo(() => cvtReport(ctx, i0, i1), [ctx, i0, i1]);
  const car = ctx.cfg.car;

  const carBtn = <Button variant="default" size="md" leftSection={<IconCar size={18} />} onClick={() => nav('/carro')}>Dados do carro</Button>;
  const header = (
    <PageHeader title={r.label} subtitle={r.question} explain="cvt.thermalModel" sensors={rep.ok ? rep.sensors : undefined}
      actions={<><RangeBadge label={label} />{carBtn}</>} />
  );

  if (!rep.ok) {
    return (
      <>
        <VehStyles />
        {header}
        <MissingState
          icon={IconTemperature} title="Sem temperatura da CVT neste log"
          action={carBtn}
        >
            <Stack gap="md">
              <Text c="dimmed">{rep.empty}</Text>
              <Text fw={600}>O que medir:</Text>
              <NeedSensors sensors={['cvt_temp', 'wheel', 'gps']} why={{
                cvt_temp: 'Sensor de temperatura (termopar ou NTC) na carcaça da CVT, perto da polia movida, numa entrada analógica da FT. Sem ele não há modelo térmico.',
                wheel: 'Velocidade da roda: o modelo usa a potência transmitida e o vento (velocidade do carro).',
                gps: 'GPS: alternativa à roda para a velocidade e para calibrar o pneu.',
              }} />
              <Text size="sm" c="dimmed">Se o sensor existe com outro nome de canal, escolha-o na página Carro (canal da temperatura da CVT). Para valer a projeção, grave pelo menos 10–15 min andando no ritmo do enduro e alguns minutos parado.</Text>
            </Stack>
        </MissingState>
      </>
    );
  }

  const fit = rep.fit && rep.fit.ok ? rep.fit : null;
  const statusOf = (t: RepTile): TileStatus | undefined => {
    if (t.key === 'tmax' && isFinite(rep.tmax)) return rep.tmax >= +car.tCvtMax ? { status: 'crit', text: `acima do limite de ${car.tCvtMax} °C` } : { status: 'good', text: `abaixo de ${car.tCvtMax} °C` };
    if (t.key === 'tReach') return t.value !== null
      ? { status: 'crit', text: `de enduro até ${car.tCvtMax} °C`, hint: '' }
      : { status: 'good', text: 'não chega no limite', hint: `limite ${car.tCvtMax} °C` };
    if (t.key === 'coolNeed') return t.text !== 'ok' ? { status: 'crit', text: 'precisa de mais ventilação' } : { status: 'good', text: 'ventilação suficiente' };
    return undefined;
  };

  return (
    <>
      <VehStyles />
      {header}

      <Section>
        <SourceNote src={rep.src} label="Temperatura da CVT" icon={IconTemperature}>
          <Text size="sm" c="dimmed">Ambiente, limite e duração do enduro vêm da página Carro e entram na projeção.</Text>
        </SourceNote>
      </Section>

      <Section title="O que muda no projeto do carro novo">
        <DesignVerdict rep={rep} tLim={+car.tCvtMax} endurance={+car.endurance} />
      </Section>

      <Section title="Números do trecho" description="Cada número abre o card com a conta e os sensores de onde saiu.">
        <RepTiles tiles={rep.tiles} statusOf={statusOf} />
      </Section>

      <Section title="Modelo térmico" explain="cvt.thermalModel" sensors={rep.sensors}
        description="O calor gerado na correia é proporcional à potência transmitida; a troca de calor cresce com a velocidade do carro. O app ajusta as três constantes nos dados deste trecho e simula a temperatura.">
        {fit ? (
          <Paper withBorder radius="md" p="lg" mb="lg">
            <Stack gap="sm">
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Text fw={600}>{rep.fitText}</Text>
                <InfoButton explain="cvt.thermalModel" sensors={rep.sensors} title="Modelo térmico" />
              </Group>
              <div className="bt-veh-code">{rep.equation}</div>
              <Text size="sm" c="dimmed">{rep.unitsText}</Text>
              <Text>{rep.reading}</Text>
            </Stack>
          </Paper>
        ) : (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={20} />} title="O modelo não fechou neste trecho" mb="lg">
            <Text>{rep.modelMsg}</Text>
            <Text size="sm" c="dimmed" mt={6}>
              Precisa de velocidade (roda ou GPS) e de um trecho que aqueça e esfrie a CVT: grave mais tempo andando e alguns minutos parado.
              A temperatura medida continua no gráfico abaixo.
            </Text>
          </Alert>
        )}
        <Grid2>
          <RepChart
            plot={rep.fitPlot} title="Temperatura medida × modelo" height={320} onClickX={t => seek(t)}
            subtitle="Se o modelo acompanha a medida, a projeção é confiável. Clique para ir ao instante."
          />
          <RepChart
            plot={rep.projPlot} title="Projeção para o enduro" height={320}
            subtitle={`Repetindo o ritmo deste trecho por ${car.endurance} min, começando na temperatura ambiente.`}
            emptyHint="A projeção precisa do modelo térmico ajustado (temperatura da CVT + velocidade)."
          />
        </Grid2>
        {rep.note && <Text size="sm" c="dimmed" mt="md" maw={900}>{rep.note}</Text>}
      </Section>
    </>
  );
}

/* Destaque: a troca de calor que a CVT do carro novo precisa (ou a margem que sobra). */
function DesignVerdict({ rep, tLim, endurance }: { rep: CvtReport; tLim: number; endurance: number }) {
  const tile = (k: string) => rep.tiles.find(t => t.key === k);
  const need = tile('coolNeed'), tss = tile('Tss'), reach = tile('tReach'), tend = tile('Tend');
  if (!need || !rep.fit || !rep.fit.ok) {
    return (
      <Paper withBorder radius="md" p="lg">
        <Group gap="md" wrap="nowrap" align="flex-start">
          <ThemeIcon size={44} radius="md" variant="light" color="gray"><IconTemperature size={24} /></ThemeIcon>
          <Stack gap={4}>
            <Text fw={650} size="lg">Sem modelo, sem projeção</Text>
            <Text c="dimmed">
              Com o modelo térmico ajustado esta caixa diz quanto a troca de calor da CVT precisa aumentar (duto, abertura, ventoinha)
              para aguentar {endurance} min de enduro abaixo de {tLim} °C. {rep.modelMsg}
            </Text>
          </Stack>
        </Group>
      </Paper>
    );
  }
  const bad = need.text !== 'ok';
  const color = bad ? STATUS_COLOR.crit : STATUS_COLOR.good;
  const Ico = bad ? IconAlertOctagon : IconCircleCheck;
  return (
    <Paper withBorder radius="md" p="lg" style={{ borderLeft: `6px solid ${color}` }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
        <Group gap="md" wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
          <Box style={{ color }} pt={4}><Ico size={36} stroke={1.8} /></Box>
          <Stack gap={6} style={{ minWidth: 0 }}>
            <Text fw={600} c="dimmed">{bad ? 'A CVT não aguenta o enduro com a ventilação atual' : 'A ventilação atual da CVT aguenta o enduro'}</Text>
            <Title order={2} style={{ fontSize: 30, lineHeight: 1.15 }}>
              {bad ? `${need.text} de troca de calor` : `Margem de ${(need.value ?? 0).toFixed(0)} °C no regime`}
            </Title>
            <Text size="lg">
              {bad ? `${need.unit.charAt(0).toUpperCase()}${need.unit.slice(1)} no regime.` : `Regime previsto abaixo do limite de ${tLim} °C.`}
              {' '}Regime previsto: <b>{tss?.text} °C</b> (limite {tLim} °C)
              {reach && reach.value !== null ? <> · chega no limite com <b>{reach.text} min</b> de enduro</> : null}
              {tend ? <> · após {endurance} min: <b>{tend.text} °C</b></> : null}.
            </Text>
            {rep.each10 !== undefined && isFinite(rep.each10) && (
              <Text c="dimmed">
                Cada +10 % de troca de calor (duto, abertura, ventoinha) baixa o regime em ~{rep.each10.toFixed(0)} °C.
                O regime supõe o enduro com o mesmo ritmo deste trecho.
              </Text>
            )}
            <SensorChips sensors={need.sensors} size="sm" />
          </Stack>
        </Group>
        <InfoButton explain={need.explain} sensors={need.sensors} title="Troca de calor necessária" size="lg" />
      </Group>
    </Paper>
  );
}
