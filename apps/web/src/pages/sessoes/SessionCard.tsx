/* Cartão de uma sessão da biblioteca: nome, data, tipo, pista/carro/piloto, os números
 * principais do resumo (sessionSummary do core, guardado com a sessão) com o card de
 * explicação de cada um, os sensores presentes no log e as ações (abrir, editar, baixar,
 * apagar). */
import {
  ActionIcon, Alert, Badge, Box, Button, Group, Paper, SimpleGrid, Stack, Text, Title, Tooltip, UnstyledButton,
} from '@mantine/core';
import {
  IconAlertTriangle, IconCalculator, IconCar, IconDownload, IconPencil, IconPlayerPlay, IconRoute, IconTrash, IconUser,
  IconUpload,
} from '@tabler/icons-react';
import { SENSOR_IDS, SENSORS, fmtTime, type SensorId, type SummaryMetric } from '@baja/core';
import { InfoButton, SensorChips, useExplain, type SensorState } from '../../components';
import type { SessionMeta } from '../../library';
import { fmtDate, fmtIso, fmtSize, kindLabel } from './meta';

/** Números do cartão (chaves do resumo, docs/ARQUITETURA.md 3.6). */
const CARD_METRICS: { key: string; label: string; fmt?: (v: number) => string; unit?: string }[] = [
  { key: 'session.duration', label: 'Duração', fmt: fmtTime, unit: '' },
  { key: 'session.distance', label: 'Distância', fmt: v => (v >= 1000 ? (v / 1000).toFixed(2) : v.toFixed(0)) },
  { key: 'session.laps', label: 'Voltas' },
  { key: 'session.bestLap', label: 'Melhor volta', fmt: fmtTime, unit: '' },
  { key: 'session.vmax', label: 'V máx' },
  { key: 'cvt.tmax', label: 'T máx CVT' },
];

/* sensores "de hardware" (sem os sugeridos): presentes ficam verdes, ausentes cinza */
const HW_SENSORS: SensorId[] = SENSOR_IDS.filter(id => !SENSORS[id].planned);

function MiniMetric({ m, label, fmt, unitOverride }: { m: SummaryMetric | undefined; label: string; fmt?: (v: number) => string; unitOverride?: string }) {
  const { open } = useExplain();
  const v = m?.value;
  const has = v !== null && v !== undefined && isFinite(v);
  let unit = unitOverride ?? m?.unit ?? '';
  let shown = '—';
  if (has && m) {
    if (m.key === 'session.distance') { shown = fmt!(v); unit = v >= 1000 ? 'km' : 'm'; }
    else shown = fmt ? fmt(v) : (m.text ?? String(v));
  }
  const body = (
    <Stack gap={2} style={{ minWidth: 0 }}>
      <Text size="sm" c="dimmed" fw={500} truncate="end">{label}</Text>
      <Group gap={4} align="baseline" wrap="nowrap">
        <Text fz={21} fw={650} className="bt-num" c={has ? undefined : 'dimmed'} lh={1.15}>{shown}</Text>
        {has && unit && <Text size="sm" c="dimmed">{unit}</Text>}
      </Group>
    </Stack>
  );
  if (!m) return body;
  return (
    <Tooltip label={has ? `${m.label}: clique para ver de onde saiu` : `${m.label}: não medido neste log — clique para ver o que falta`} openDelay={400}>
      <UnstyledButton className="bt-mini-metric" onClick={e => { e.stopPropagation(); open(m.explain, { sensors: m.sensors, title: m.label }); }}>
        {body}
      </UnstyledButton>
    </Tooltip>
  );
}

export interface SessionCardProps {
  m: SessionMeta;
  trackName?: string;
  carName?: string;
  local: boolean;
  canEdit: boolean;
  opening: boolean;
  busy?: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDownload: () => void;
  onDelete: () => void;
  /** calcula (local) ou pede ao servidor o resumo de novo */
  onRecompute?: () => void;
  /** pode pedir o recálculo (local: sempre; servidor: qualquer membro — POST /sessions/:id/summary) */
  canRecompute?: boolean;
}

export function SessionCard({ m, trackName, carName, local, canEdit, opening, busy, onOpen, onEdit, onDownload, onDelete, onRecompute, canRecompute }: SessionCardProps) {
  const mayRecompute = !!onRecompute && (canRecompute ?? canEdit);
  const s = m.summary;
  const get = (k: string) => s?.metrics.find(x => x.key === k);
  const sensorsM = get('quality.sensors');
  const present = new Set(sensorsM?.sensors ?? []);
  const avail: Partial<Record<SensorId, SensorState>> = Object.fromEntries(HW_SENSORS.map(id => [id, present.has(id) ? 'present' : 'absent']));
  const date = m.date ? fmtDate(m.date) : '';
  return (
    <Paper withBorder radius="md" p="lg" className="bt-session-card">
      <Stack gap="md" h="100%">
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
          <Stack gap={4} style={{ minWidth: 0 }}>
            <UnstyledButton onClick={onOpen} className="bt-card-title--link" title="Abrir esta sessão">
              <Title order={3} lineClamp={2} style={{ wordBreak: 'break-word' }}>{m.name}</Title>
            </UnstyledButton>
            <Text size="sm" c="dimmed">
              {date ? <><b>{date}</b> · </> : null}{kindLabel(m.kind)} · {fmtSize(m.size)}
            </Text>
          </Stack>
          <Badge variant="light" color={m.kind === 'BUSMASTER' ? 'grape' : 'brand'} size="lg" radius="sm" style={{ flexShrink: 0 }}>
            {m.kind === 'BUSMASTER' ? 'CAN' : 'FT'}
          </Badge>
        </Group>

        <Group gap="lg" wrap="wrap">
          <Group gap={6} wrap="nowrap"><IconRoute size={16} style={{ opacity: 0.7 }} /><Text size="sm" c={trackName ? undefined : 'dimmed'}>{trackName || 'sem pista'}</Text></Group>
          <Group gap={6} wrap="nowrap"><IconCar size={16} style={{ opacity: 0.7 }} /><Text size="sm" c={carName ? undefined : 'dimmed'}>{carName || 'sem carro'}</Text></Group>
          <Group gap={6} wrap="nowrap"><IconUser size={16} style={{ opacity: 0.7 }} /><Text size="sm" c={m.driver ? undefined : 'dimmed'}>{m.driver || 'sem piloto'}</Text></Group>
        </Group>

        {s ? (
          <>
            <Group gap={4} wrap="nowrap">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: '0.05em' }}>Resumo da sessão inteira</Text>
              <InfoButton explain="design.compareSessions" title="Resumo da sessão" size="sm" />
              {m.summaryOutdated && (
                <Tooltip label="Calculado com uma versão antiga das contas: os números podem mudar ao recalcular">
                  <Badge color="yellow" variant="light" size="sm">versão antiga</Badge>
                </Tooltip>
              )}
            </Group>
            {(m.summaryOutdated || m.summaryError) && (
              <Alert variant="light" color={m.summaryError ? 'red' : 'yellow'} icon={<IconAlertTriangle size={18} />} p="sm"
                title={m.summaryError ? 'O último cálculo do resumo falhou' : 'Resumo de uma versão antiga das contas'}>
                <Stack gap={6}>
                  <Text size="sm">
                    {m.summaryError || (local
                      ? 'As contas do app mudaram depois que este resumo foi calculado: recalcule para os números ficarem iguais aos das outras sessões.'
                      : 'O servidor recalcula sozinho ao reiniciar; se não recalculou, peça agora para os números ficarem iguais aos das outras sessões.')}
                  </Text>
                  {mayRecompute && (
                    <Button size="sm" variant="default" leftSection={<IconCalculator size={15} />} loading={busy} onClick={onRecompute} w="fit-content">
                      {local ? 'Recalcular o resumo' : 'Pedir ao servidor para recalcular'}
                    </Button>
                  )}
                </Stack>
              </Alert>
            )}
            <SimpleGrid cols={3} spacing="md" verticalSpacing="md">
              {CARD_METRICS.map(c => <MiniMetric key={c.key} m={get(c.key)} label={c.label} fmt={c.fmt} unitOverride={c.unit} />)}
            </SimpleGrid>
            <Group gap={8} wrap="wrap" align="center">
              <Text size="sm" c="dimmed">Sensores:</Text>
              <Box style={{ flex: '1 1 200px', minWidth: 0 }}><SensorChips sensors={HW_SENSORS} availability={avail} size="sm" /></Box>
            </Group>
          </>
        ) : (
          <Alert variant="light" color={m.summaryError ? 'red' : 'gray'} icon={<IconAlertTriangle size={18} />}
            title={m.summaryError ? 'A análise deste log falhou' : 'Sem resumo calculado'}>
            <Stack gap={6}>
              <Text size="sm">{m.summaryError || 'Os números da sessão aparecem aqui depois do cálculo do resumo.'}</Text>
              {mayRecompute && (
                <Button size="sm" variant="default" leftSection={<IconCalculator size={15} />} loading={busy} onClick={onRecompute} w="fit-content">
                  {local ? 'Calcular o resumo agora' : 'Pedir ao servidor para recalcular'}
                </Button>
              )}
            </Stack>
          </Alert>
        )}

        {(m.tags.length > 0 || m.notes) && (
          <Stack gap={6}>
            {m.tags.length > 0 && (
              <Group gap={6}>{m.tags.map(t => <Badge key={t} variant="outline" color="gray" size="md" radius="sm" style={{ textTransform: 'none' }}>{t}</Badge>)}</Group>
            )}
            {m.notes && <Text size="sm" c="dimmed" lineClamp={2} title={m.notes}>{m.notes}</Text>}
          </Stack>
        )}

        <Group justify="space-between" wrap="wrap" gap="sm" mt="auto">
          <Group gap={6} wrap="nowrap">
            <IconUpload size={15} style={{ opacity: 0.6 }} />
            <Text size="sm" c="dimmed">{m.uploadedBy ? `${m.uploadedBy} · ` : ''}{local ? 'guardada' : 'enviada'} em {fmtIso(m.createdAt)}</Text>
          </Group>
          <Group gap={6} wrap="nowrap">
            <Tooltip label="Editar dados (data, pista, carro, piloto, etiquetas, notas)">
              <ActionIcon variant="default" size="lg" onClick={onEdit} disabled={!canEdit} aria-label="Editar dados"><IconPencil size={18} /></ActionIcon>
            </Tooltip>
            <Tooltip label="Baixar o log original">
              <ActionIcon variant="default" size="lg" onClick={onDownload} aria-label="Baixar o log original"><IconDownload size={18} /></ActionIcon>
            </Tooltip>
            <Tooltip label="Apagar da biblioteca">
              <ActionIcon variant="default" color="red" size="lg" onClick={onDelete} disabled={!canEdit} aria-label="Apagar"><IconTrash size={18} /></ActionIcon>
            </Tooltip>
            <Button leftSection={<IconPlayerPlay size={17} />} loading={opening} onClick={onOpen}>Abrir</Button>
          </Group>
        </Group>
      </Stack>
    </Paper>
  );
}
