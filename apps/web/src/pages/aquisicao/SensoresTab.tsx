/* Aba "Sensores e projeto" — para mostrar aos juízes que a aquisição serve ao projeto:
 *  - os sensores do carro (com sinal neste log, sem sinal, sugeridos) e o que cada um destrava;
 *  - a matriz sensor × área de análise (contagens) e a matriz detalhada
 *    sensor → análise → decisão de projeto do carro do ano que vem (sensorMatrix do core),
 *    cada célula abrindo o card de explicação; com versão para imprimir / PDF.
 * Catálogos (SENSORS, sensorMatrix, EXPLAIN) e disponibilidade (sensorAvailability) vêm do core. */
import { Fragment, useMemo, useRef, useState } from 'react';
import { Badge, Button, Group, List, Paper, SegmentedControl, SimpleGrid, Stack, Table, Text, ThemeIcon, Title, UnstyledButton } from '@mantine/core';
import { IconCircleCheck, IconCircleDashed, IconCircleOff, IconPrinter, IconX } from '@tabler/icons-react';
import {
  getExplain, sensorMatrix, SENSOR_IDS, SENSORS, type DataQuality, type SensorId, type SensorState,
} from '@baja/core';
import { InfoButton, Section, sensorIcon, useExplain } from '../../components';
import { STATUS_COLOR } from '../../theme';

/* áreas do catálogo de explicações (prefixo do id) agrupadas para a matriz resumida */
const AREAS: { id: string; label: string; prefixes: string[] }[] = [
  { id: 'map', label: 'Mapa e pista', prefixes: ['track', 'chart'] },
  { id: 'laps', label: 'Voltas', prefixes: ['laps'] },
  { id: 'susp', label: 'Suspensão', prefixes: ['susp', 'channel'] },
  { id: 'freq', label: 'Ressonância', prefixes: ['freq'] },
  { id: 'power', label: 'Trem de força', prefixes: ['power'] },
  { id: 'cvt', label: 'CVT', prefixes: ['cvt'] },
  { id: 'dyn', label: 'Dinâmica', prefixes: ['dyn'] },
  { id: 'data', label: 'Dados e projeto', prefixes: ['quality', 'design', 'sensor'] },
];
const areaOf = (explain: string): string => {
  const p = explain.split('.')[0];
  return (AREAS.find(a => a.prefixes.includes(p)) ?? AREAS[AREAS.length - 1]).id;
};

type St = SensorState | 'unknown';
const STATE: Record<St, { text: string; color: string; icon: typeof IconCircleCheck }> = {
  present: { text: 'Com sinal neste log', color: STATUS_COLOR.good, icon: IconCircleCheck },
  absent: { text: 'Sem sinal neste log', color: STATUS_COLOR.crit, icon: IconCircleOff },
  planned: { text: 'Sugerido (ainda não instalado)', color: 'var(--mantine-color-dimmed)', icon: IconCircleDashed },
  unknown: { text: 'Instalado no carro', color: 'var(--mantine-primary-color-filled)', icon: IconCircleCheck },
};

function StateBadge({ st }: { st: St }) {
  const S = STATE[st];
  const I = S.icon;
  return (
    <span className="bt-status" style={{ ['--bt-status' as string]: S.color }}>
      <I size={16} stroke={2} aria-hidden />{S.text}
    </span>
  );
}

/* por que um sensor instalado está sem sinal neste log (pela qualidade dos dados) */
function absentReason(id: SensorId, q: DataQuality | null): string {
  if (!q) return '';
  if (id === 'car_data') return 'Faltam medidas em Carro (massa, relação roda/amortecedor, curso, massa suspensa).';
  const chs = q.channels.filter(c => c.sensor === id);
  if (id === 'gps' && !chs.length) return 'Sem canais X/Y do GPS (entradas 7/8) nem posição do módulo neste log.';
  if (!chs.length) return 'Nenhum canal deste sensor foi gravado neste log.';
  const dead = chs.filter(c => c.constant || !c.valid);
  if (dead.length === chs.length) return `O canal existe (${chs.map(c => c.key).join(', ')}), mas ficou constante: o sensor não mandou sinal.`;
  return `Canais: ${chs.map(c => c.key).join(', ')}.`;
}

function SensorCard({ id, st, nItems, reason }: { id: SensorId; st: St; nItems: number; reason: string }) {
  const { open } = useExplain();
  const s = SENSORS[id];
  const I = sensorIcon(id);
  return (
    <Paper withBorder radius="md" p="lg" className="bt-acq-sensor" data-state={st}>
      <Stack gap={10}>
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <UnstyledButton onClick={() => open('sensor.' + id)} className="bt-card-title--link" style={{ minWidth: 0 }}>
            <Group gap={10} wrap="nowrap">
              <ThemeIcon size={40} radius="md" variant="light" color={st === 'present' ? 'green' : st === 'absent' ? 'red' : 'gray'}>
                <I size={22} stroke={1.8} />
              </ThemeIcon>
              <Text fw={650} size="lg" lh={1.25}>{s.name}</Text>
            </Group>
          </UnstyledButton>
          <InfoButton explain={'sensor.' + id} title={s.name} />
        </Group>
        <StateBadge st={st} />
        {reason && <Text size="sm" c={st === 'absent' ? undefined : 'dimmed'}>{reason}</Text>}
        <Text size="sm"><Text span fw={600}>Serve para: </Text>{s.purpose}.</Text>
        {s.unlocks && s.unlocks.length > 0 && (
          <div>
            <Text size="sm" fw={600} mb={2}>{s.planned ? 'Destravaria no projeto:' : 'Decisões do carro novo:'}</Text>
            <List size="sm" spacing={2}>{s.unlocks.map((u, k) => <List.Item key={k}>{u}</List.Item>)}</List>
          </div>
        )}
        <Text size="sm" c="dimmed">{nItems} análise(s) na matriz abaixo · taxa: {s.rate}</Text>
      </Stack>
    </Paper>
  );
}

type View = 'all' | 'present' | 'absent' | 'planned';

export function SensoresTab({ availability, quality, sessionName }: {
  availability: Record<SensorId, SensorState> | null; quality: DataQuality | null; sessionName: string | null;
}) {
  const { open } = useExplain();
  const matrix = useMemo(() => sensorMatrix(), []);
  const [view, setView] = useState<View>('all');
  const [cell, setCell] = useState<{ sensor: SensorId; area: string } | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const stOf = (id: SensorId): St => availability?.[id] ?? (SENSORS[id].planned ? 'planned' : 'unknown');
  const nOf = (id: SensorId) => matrix.find(r => r.sensor === id)?.items.length ?? 0;

  const groups: { title: string; desc: string; ids: SensorId[] }[] = availability
    ? [
      { title: 'Com sinal neste log', desc: 'Os números das análises desta sessão saem destes sensores.', ids: SENSOR_IDS.filter(i => availability[i] === 'present') },
      { title: 'Instalados, sem sinal neste log', desc: 'As análises que dependem deles não aparecem nesta sessão. O motivo e o que conferir estão em cada cartão (e na aba Qualidade).', ids: SENSOR_IDS.filter(i => availability[i] === 'absent') },
      { title: 'Sugeridos para o carro novo', desc: 'Ainda não instalados: o que cada um destravaria no projeto.', ids: SENSOR_IDS.filter(i => availability[i] === 'planned') },
    ]
    : [
      { title: 'Instalados no carro', desc: 'Abra uma sessão para ver quais deles têm sinal no log.', ids: SENSOR_IDS.filter(i => !SENSORS[i].planned) },
      { title: 'Sugeridos para o carro novo', desc: 'Ainda não instalados: o que cada um destravaria no projeto.', ids: SENSOR_IDS.filter(i => SENSORS[i].planned) },
    ];

  const rows = matrix.filter(r => view === 'all' || stOf(r.sensor) === view || (view === 'present' && stOf(r.sensor) === 'unknown'))
    .filter(r => !cell || r.sensor === cell.sensor)
    .map(r => ({ ...r, items: cell ? r.items.filter(x => areaOf(x.explain) === cell.area) : r.items }))
    .filter(r => r.items.length);

  const print = () => {
    const done = () => { document.body.classList.remove('bt-print-matrix'); window.removeEventListener('afterprint', done); };
    document.body.classList.add('bt-print-matrix');
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1000);
  };

  return (
    <div>
      <div className="bt-print-hide" style={{ marginBottom: 40 }}>
      <Section
        title="Para os juízes: a aquisição a serviço do projeto"
        description="Cada sensor do carro, o que ele permite analisar e qual decisão do carro do ano que vem cada análise sustenta. Todo número do app diz de quais destes sensores saiu; aqui está o mapa completo. Clique em qualquer sensor ou análise para ver como é medido e calculado."
        explain="design.sensorCoverage" sensors={availability ? SENSOR_IDS.filter(i => availability[i] === 'present') : undefined}
      >
        <Stack gap="xl">
          {groups.filter(g => g.ids.length).map(g => (
            <div key={g.title}>
              <Title order={3} mb={2}>{g.title} ({g.ids.length})</Title>
              <Text size="sm" c="dimmed" mb="sm">{g.desc}</Text>
              <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
                {g.ids.map(id => <SensorCard key={id} id={id} st={stOf(id)} nItems={nOf(id)} reason={stOf(id) === 'absent' ? absentReason(id, quality) : ''} />)}
              </SimpleGrid>
            </div>
          ))}
        </Stack>
      </Section>
      </div>

      <Section
        title="Matriz sensor × projeto"
        description="Quantas análises cada sensor alimenta em cada área. Clique num número para ver só aquelas análises na tabela abaixo."
        explain="design.sensorCoverage"
        actions={<Button className="bt-print-hide" size="md" variant="default" leftSection={<IconPrinter size={18} />} onClick={print}>Imprimir / PDF</Button>}
      >
        <div className="bt-print-area">
          <div className="bt-print-only">
            <Title order={1}>Baja Telemetria — sensores × análises × decisões de projeto</Title>
            <Text>{sessionName ? `Sessão: ${sessionName} · ` : ''}{new Date().toLocaleDateString('pt-BR')}</Text>
          </div>
          <div className="bt-acq-hscroll">
            <Table className="bt-acq-matrix" withTableBorder withColumnBorders verticalSpacing="sm" horizontalSpacing="sm" miw={900}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Sensor</Table.Th>
                  {AREAS.map(a => <Table.Th key={a.id} ta="center">{a.label}</Table.Th>)}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {matrix.map(r => {
                  const st = stOf(r.sensor);
                  const I = sensorIcon(r.sensor);
                  return (
                    <Table.Tr key={r.sensor} data-state={st}>
                      <Table.Td>
                        <UnstyledButton className="bt-card-title--link" onClick={() => open('sensor.' + r.sensor)}>
                          <Group gap={8} wrap="nowrap">
                            <I size={18} stroke={1.8} aria-hidden />
                            <Text fw={600} size="sm" td={st === 'absent' ? 'line-through' : undefined}>{SENSORS[r.sensor].name}</Text>
                          </Group>
                        </UnstyledButton>
                        <Text size="xs" c="dimmed">{STATE[st].text}</Text>
                      </Table.Td>
                      {AREAS.map(a => {
                        const n = r.items.filter(x => areaOf(x.explain) === a.id).length;
                        const sel = cell && cell.sensor === r.sensor && cell.area === a.id;
                        return (
                          <Table.Td key={a.id} ta="center" className="bt-acq-mcell" data-n={n || undefined} data-sel={sel || undefined}>
                            {n ? (
                              <UnstyledButton className="bt-acq-mnum" onClick={() => { setCell(sel ? null : { sensor: r.sensor, area: a.id }); if (!sel) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }}
                                aria-label={`${SENSORS[r.sensor].name}: ${n} análise(s) em ${a.label}`}>{n}</UnstyledButton>
                            ) : <Text span c="dimmed">·</Text>}
                          </Table.Td>
                        );
                      })}
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </div>

          <Group ref={detailRef} justify="space-between" mt={40} mb="sm" wrap="wrap" gap="sm" style={{ scrollMarginTop: 80 }}>
            <Stack gap={2}>
              <Title order={2}>Sensor → análise → decisão de projeto</Title>
              <Text size="sm" c="dimmed">Cada linha: uma análise que o sensor permite (clique para o card: como é calculada, sensores, limites) e a decisão do carro novo que ela sustenta.</Text>
            </Stack>
            <Group gap="sm" className="bt-print-hide">
              {cell && (
                <Button size="md" variant="light" leftSection={<IconX size={16} />} onClick={() => setCell(null)}>
                  {SENSORS[cell.sensor].short} · {AREAS.find(a => a.id === cell.area)?.label}
                </Button>
              )}
              <SegmentedControl size="md" value={view} onChange={v => { setView(v as View); setCell(null); }} data={[
                { value: 'all', label: 'Todos' },
                { value: 'present', label: availability ? 'Com sinal' : 'Instalados' },
                ...(availability ? [{ value: 'absent', label: 'Sem sinal' }] : []),
                { value: 'planned', label: 'Sugeridos' },
              ]} />
            </Group>
          </Group>

          <div className="bt-acq-hscroll">
            <Table className="bt-acq-detail" withTableBorder verticalSpacing="sm" horizontalSpacing="md" miw={760}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w="22%">Sensor</Table.Th>
                  <Table.Th w="30%">Análise</Table.Th>
                  <Table.Th>Decisão de projeto do carro novo</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map(r => {
                  const st = stOf(r.sensor);
                  return (
                    <Fragment key={r.sensor}>
                      {r.items.map((it, k) => {
                        const e = getExplain(it.explain);
                        return (
                          <Table.Tr key={r.sensor + it.explain + k} data-first={k === 0 || undefined}>
                            {k === 0 && (
                              <Table.Td rowSpan={r.items.length} className="bt-acq-sensor-cell">
                                <UnstyledButton className="bt-card-title--link" onClick={() => open('sensor.' + r.sensor)}>
                                  <Text fw={650}>{SENSORS[r.sensor].name}</Text>
                                </UnstyledButton>
                                <div style={{ marginTop: 4 }}><StateBadge st={st} /></div>
                              </Table.Td>
                            )}
                            <Table.Td>
                              <UnstyledButton className="bt-card-title--link" onClick={() => open(it.explain, { sensors: [r.sensor], title: e?.title })}>
                                <Text size="md" fw={500}>{e ? e.title : it.explain}</Text>
                              </UnstyledButton>
                            </Table.Td>
                            <Table.Td><Text size="md">{it.decision}</Text></Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
                {!rows.length && (
                  <Table.Tr><Table.Td colSpan={3}><Text c="dimmed" ta="center" py="md">Nenhum sensor nesse filtro.</Text></Table.Td></Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </div>
          <Group gap="xs" mt="sm" className="bt-print-hide">
            <Badge variant="light" color="gray" size="lg">{rows.reduce((s, r) => s + r.items.length, 0)} análises</Badge>
            <Text size="sm" c="dimmed">A tabela imprime com o filtro atual.</Text>
          </Group>
        </div>
      </Section>
    </div>
  );
}
