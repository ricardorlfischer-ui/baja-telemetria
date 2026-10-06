/* Pontos de atenção para o projeto (designReport.recs, = renderDesign do app antigo) e o
 * resumo da qualidade dos dados (dataQuality do core: avisos por nível, os mais graves e o
 * link para a página Aquisição). */
import { Button, Group, Paper, SimpleGrid, Stack, Text, ThemeIcon } from '@mantine/core';
import {
  IconAlertOctagon, IconAlertTriangle, IconArrowRight, IconBulb, IconCircleCheck, IconInfoCircle, IconPlayerTrackNext,
  type Icon,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { fmtTime, type DataQuality, type DesignReport, type QualityIssue, type QualityLevel } from '@baja/core';
import { InfoButton, SensorChips } from '../../components';
import { STATUS_COLOR } from '../../theme';
import { useSessionStore } from '../../state/session';

/* ---------------------------------------------------------------- pontos de atenção */
export function DesignRecs({ design, rangeLabel, shocks }: { design: DesignReport; rangeLabel: string; shocks: number }) {
  const nav = useNavigate();
  const recs = design.recs;
  return (
    <Stack gap="sm">
      {recs.length ? recs.map((r, k) => (
        <Paper key={k} withBorder radius="md" p="md">
          <Group align="flex-start" wrap="nowrap" gap="md">
            <ThemeIcon size={36} radius="xl" variant="light" color="yellow" style={{ flexShrink: 0 }}><IconBulb size={20} /></ThemeIcon>
            <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
              <Text size="md" style={{ lineHeight: 1.5 }}>{r.text}</Text>
              <SensorChips sensors={r.sensors} size="sm" />
            </Stack>
            <InfoButton explain={r.explain} sensors={r.sensors} title="Ponto de atenção" />
          </Group>
        </Paper>
      )) : (
        <Paper withBorder radius="md" p="lg">
          <Group gap="md" wrap="nowrap" align="flex-start">
            <ThemeIcon size={36} radius="xl" variant="light" color={shocks < 4 ? 'gray' : 'green'}>{shocks < 4 ? <IconInfoCircle size={20} /> : <IconCircleCheck size={20} />}</ThemeIcon>
            <Stack gap={4}>
              <Text fw={600}>{shocks < 4 ? 'Nenhum ponto de atenção — mas faltam sensores para avaliar' : `Nenhum ponto de atenção no trecho (${rangeLabel})`}</Text>
              <Text size="sm" c="dimmed">
                {shocks < 4
                  ? `Só ${shocks} de 4 amortecedores com sinal neste log — sem eles não dá para avaliar curso, fim de curso, rolagem e saltos. Os pontos aparecem quando os sensores medem.`
                  : 'Os números medidos não passaram dos limites que o app confere (curso, fim de curso, amortecimento, pneu, CVT).'}
              </Text>
            </Stack>
          </Group>
        </Paper>
      )}
      <Group justify="flex-end">
        <Button variant="subtle" rightSection={<IconArrowRight size={16} />} onClick={() => nav('/projeto')}>Ficha completa do carro</Button>
      </Group>
    </Stack>
  );
}

/* ---------------------------------------------------------------- qualidade dos dados */
const LEVEL: Record<QualityLevel, { label: string; plural: string; icon: Icon; color: string }> = {
  error: { label: 'Erro', plural: 'Erros', icon: IconAlertOctagon, color: STATUS_COLOR.crit },
  warn: { label: 'Atenção', plural: 'Avisos', icon: IconAlertTriangle, color: STATUS_COLOR.warn },
  info: { label: 'Informação', plural: 'Informações', icon: IconInfoCircle, color: 'var(--mantine-color-blue-filled)' },
};
const ORDER: QualityLevel[] = ['error', 'warn', 'info'];

function IssueRow({ q }: { q: QualityIssue }) {
  const seek = useSessionStore(s => s.seek);
  const L = LEVEL[q.level];
  return (
    <Paper withBorder radius="md" p="md">
      <Group align="flex-start" wrap="nowrap" gap="md">
        <L.icon size={22} color={L.color} style={{ flexShrink: 0, marginTop: 2 }} aria-label={L.label} />
        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Text size="md" fw={500}>{q.text}</Text>
          <Text size="sm" c="dimmed">{q.action}</Text>
          <Group gap="sm" wrap="wrap">
            <SensorChips sensors={q.sensors} size="sm" />
            {q.t !== undefined && isFinite(q.t) && (
              <Button size="xs" variant="subtle" leftSection={<IconPlayerTrackNext size={14} />} onClick={() => seek(q.t!)}>
                Ir ao ponto ({fmtTime(q.t)})
              </Button>
            )}
          </Group>
        </Stack>
        <InfoButton explain={q.explain} sensors={q.sensors} title={q.text} />
      </Group>
    </Paper>
  );
}

export function QualitySummary({ dq }: { dq: DataQuality }) {
  const nav = useNavigate();
  const count = (l: QualityLevel) => dq.issues.filter(q => q.level === l).length;
  const top = ORDER.flatMap(l => dq.issues.filter(q => q.level === l && l !== 'info')).slice(0, 3);
  const rest = dq.issues.filter(q => q.level !== 'info').length - top.length;
  return (
    <Stack gap="md">
      <SimpleGrid cols={3} spacing="md">
        {ORDER.map(l => {
          const L = LEVEL[l], n = count(l);
          return (
            <Paper key={l} withBorder radius="md" p="md">
              <Group gap="sm" wrap="nowrap">
                <L.icon size={26} color={n ? L.color : 'var(--mantine-color-dimmed)'} aria-hidden />
                <div>
                  <Text fz={26} fw={650} lh={1.1} className="bt-num" c={n ? undefined : 'dimmed'}>{n}</Text>
                  <Text size="sm" c="dimmed">{L.plural}</Text>
                </div>
              </Group>
            </Paper>
          );
        })}
      </SimpleGrid>
      {top.length ? (
        <Stack gap="sm">{top.map(q => <IssueRow key={q.id} q={q} />)}</Stack>
      ) : (
        <Paper withBorder radius="md" p="md">
          <Group gap="sm" wrap="nowrap">
            <IconCircleCheck size={22} color={STATUS_COLOR.good} />
            <Text>Nenhum erro ou aviso nos canais com papel conhecido{count('info') ? ` (${count('info')} informação${count('info') > 1 ? 'ões' : ''} em Aquisição)` : ''}.</Text>
          </Group>
        </Paper>
      )}
      <Group justify="space-between" wrap="wrap">
        <Text size="sm" c="dimmed">
          Log a {isFinite(dq.logRateHz) ? dq.logRateHz.toFixed(0) : '—'} Hz · {dq.channels.length} canais
          {rest > 0 ? ` · mais ${rest} aviso${rest > 1 ? 's' : ''} em Aquisição` : ''}
        </Text>
        <Button variant="light" rightSection={<IconArrowRight size={16} />} onClick={() => nav('/aquisicao')}>
          Canais, sensores e qualidade
        </Button>
      </Group>
      {dq.issues.some(q => q.level === 'error') && (
        <Text size="sm" c="red" fw={500}>
          Há erros: os números que dependem desses sensores ficam de fora ou podem estar errados.
        </Text>
      )}
    </Stack>
  );
}
