/* Aba "Qualidade": os avisos de dataQuality do core por nível (erro, atenção, informação),
 * cada um com ícone + texto, o que fazer, os sensores envolvidos, o card de explicação e, quando
 * há um instante, o botão de ir ao ponto. */
import { Button, Code, Group, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconAlertOctagon, IconAlertTriangle, IconCircleCheck, IconCrosshair, IconInfoCircle, IconTool, type Icon } from '@tabler/icons-react';
import { SENSOR_IDS, type DataQuality, type QualityIssue, type QualityLevel, type SensorId, type SensorState } from '@baja/core';
import { InfoButton, Section, SensorChips, useExplain } from '../../components';
import { STATUS_COLOR } from '../../theme';
import { goToTime } from './common';

const LEVEL: Record<QualityLevel, { title: string; one: string; icon: Icon; color: string; desc: string }> = {
  error: {
    title: 'Erros', one: 'Erro', icon: IconAlertOctagon, color: STATUS_COLOR.crit,
    desc: 'Impedem análises inteiras (ex.: sem trajetória do GPS). Resolva antes do próximo teste.',
  },
  warn: {
    title: 'Atenção', one: 'Atenção', icon: IconAlertTriangle, color: STATUS_COLOR.warn,
    desc: 'Sensor sem sinal, travado, com saltos ou dados do carro faltando: os números que dependem dele saem errados ou não saem.',
  },
  info: {
    title: 'Informações', one: 'Informação', icon: IconInfoCircle, color: 'var(--mantine-primary-color-filled)',
    desc: 'Limites do que este log consegue medir e o que ganharíamos com mais sensores ou outra configuração.',
  },
};

function IssueCard({ it }: { it: QualityIssue }) {
  const { open } = useExplain();
  const L = LEVEL[it.level];
  const I = L.icon;
  return (
    <Paper withBorder radius="md" p="lg" className="bt-acq-issue" style={{ ['--bt-issue' as string]: L.color }}>
      <Group align="flex-start" wrap="nowrap" gap="md">
        <I size={26} stroke={1.9} color={L.color} style={{ flex: 'none', marginTop: 2 }} aria-label={L.one} />
        <Stack gap={8} style={{ minWidth: 0, flex: 1 }}>
          <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
            <Text fw={600} size="md" style={{ cursor: 'pointer' }} onClick={() => open(it.explain, { sensors: it.sensors, title: it.text })}>
              <Text span fw={700} c={L.color}>{L.one}: </Text>{it.text}
            </Text>
            <InfoButton explain={it.explain} sensors={it.sensors} title={it.text} />
          </Group>
          <Group gap={8} wrap="nowrap" align="flex-start">
            <IconTool size={18} stroke={1.8} style={{ flex: 'none', marginTop: 3, opacity: 0.7 }} aria-hidden />
            <Text size="md"><Text span fw={600}>O que fazer: </Text>{it.action}</Text>
          </Group>
          <Group gap="sm" wrap="wrap">
            <Text size="sm" c="dimmed">Sensores:</Text>
            <SensorChips sensors={it.sensors} size="sm" />
            {it.channel && <Text size="sm" c="dimmed">canal <Code>{it.channel}</Code></Text>}
            {it.t !== undefined && (
              <Button size="sm" variant="light" leftSection={<IconCrosshair size={16} />} onClick={() => goToTime(it.t!)}>
                Ir ao ponto · t = {it.t.toFixed(1)} s
              </Button>
            )}
          </Group>
        </Stack>
      </Group>
    </Paper>
  );
}

export function QualidadeTab({ quality, availability }: { quality: DataQuality; availability: Record<SensorId, SensorState> | null }) {
  const by = (l: QualityLevel) => quality.issues.filter(i => i.level === l);
  const groups = (['error', 'warn', 'info'] as QualityLevel[]).map(l => ({ l, items: by(l) })).filter(g => g.items.length);
  const present = SENSOR_IDS.filter(id => availability?.[id] === 'present');
  const absent = SENSOR_IDS.filter(id => availability?.[id] === 'absent');
  return (
    <div>
      <Section title="Sensores neste log" explain="design.sensorCoverage" sensors={present}
        description="Verde = com sinal neste log · riscado = instalado mas sem sinal · tracejado = sugerido. Clique num sensor para ver o card dele.">
        <Stack gap="sm">
          <Group gap="sm"><Text fw={600} w={150}>Com sinal</Text>{present.length ? <SensorChips sensors={present} size="sm" /> : <Text c="dimmed">nenhum</Text>}</Group>
          <Group gap="sm"><Text fw={600} w={150}>Sem sinal</Text>{absent.length ? <SensorChips sensors={absent} size="sm" /> : <Text c="dimmed">nenhum</Text>}</Group>
        </Stack>
      </Section>

      {!groups.length && (
        <Paper withBorder radius="md" p="xl" component="section" className="bt-section">
          <Group gap="md">
            <ThemeIcon size={44} radius="xl" variant="light" color="green"><IconCircleCheck size={26} /></ThemeIcon>
            <Text size="lg">Nenhum problema encontrado nos dados deste log.</Text>
          </Group>
        </Paper>
      )}

      {groups.map(({ l, items }) => {
        const L = LEVEL[l];
        const I = L.icon;
        return (
          <section key={l} className="bt-section">
            <Group gap={10} mb={4}>
              <I size={22} color={L.color} aria-hidden />
              <Title order={2}>{L.title} ({items.length})</Title>
            </Group>
            <Text c="dimmed" size="sm" mb="md" maw={820}>{L.desc}</Text>
            <Stack gap="md">{items.map(it => <IssueCard key={it.id} it={it} />)}</Stack>
          </section>
        );
      })}
    </div>
  );
}
