/* Card de explicação (docs/ARQUITETURA.md 4.6) — requisito central: para cada número,
 * gráfico e correlação, o que é, DE QUAIS SENSORES SAIU (com o estado neste log), como é
 * calculado, como usar no projeto do carro do ano que vem, limites e o teste para medir
 * melhor. Serve para a equipe e para mostrar aos juízes que a aquisição serve ao projeto.
 *
 * Drawer à direita (~480 px), tela cheia no celular. O conteúdo vem do catálogo EXPLAIN do
 * core; id que não existe mostra um aviso com o id (ajuda a achar lacunas no catálogo). */
import type { ReactNode } from 'react';
import { ActionIcon, Alert, Badge, Box, Button, Code, Drawer, Group, Paper, Stack, Text, Title, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertTriangle, IconArrowLeft, IconBulb, IconCar, IconFlask, IconMathFunction, IconCpu, IconEye, IconLink,
} from '@tabler/icons-react';
import { getExplain, SENSORS, type ExplainSensor, type SensorId } from '@baja/core';
import { SensorChips, SENSOR_STATE_TEXT, useSensorAvailability, type SensorState } from '../components/SensorChips';
import type { ExplainOptions } from '../components/explain';
import './explain.css';

const NEED_LABEL: Record<ExplainSensor['need'], string> = {
  required: 'obrigatório',
  alternative: 'alternativa',
  improves: 'melhora',
};
const NEED_COLOR: Record<ExplainSensor['need'], string> = { required: 'brand', alternative: 'gray', improves: 'teal' };

export interface ExplainDrawerProps {
  opened: boolean;
  id: string | null;
  opts?: ExplainOptions;
  onClose: () => void;
  /** abre outro card (links "veja também" e chips dos sensores) */
  onNavigate: (id: string) => void;
  /** há card anterior na pilha */
  canBack: boolean;
  onBack: () => void;
}

function Block({ icon, title, children, accent }: { icon: ReactNode; title: string; children: ReactNode; accent?: boolean }) {
  return (
    <Box className={accent ? 'bt-explain-block bt-explain-block--accent' : 'bt-explain-block'}>
      <Group gap={8} mb={6} wrap="nowrap">
        <span className="bt-explain-ico" aria-hidden>{icon}</span>
        <Title order={3} className="bt-explain-h">{title}</Title>
      </Group>
      {children}
    </Box>
  );
}

const Para = ({ children }: { children: ReactNode }) => <Text className="bt-explain-text">{children}</Text>;

export function ExplainDrawer({ opened, id, opts, onClose, onNavigate, canBack, onBack }: ExplainDrawerProps) {
  const mobile = useMediaQuery('(max-width: 48em)');
  const avail = useSensorAvailability();
  const e = id ? getExplain(id) : undefined;
  const used = new Set<SensorId>(opts?.sensors ?? []);
  /* sensores que a página disse que entraram, mas o card não cita (deixa visível) */
  const extra = (opts?.sensors ?? []).filter(s => !e || !e.sensors.some(x => x.id === s));
  const stateOf = (s: SensorId): SensorState | 'unknown' => avail?.[s] ?? (SENSORS[s]?.planned ? 'planned' : 'unknown');

  const header = (
    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
      {canBack && (
        <Tooltip label="Card anterior">
          <ActionIcon variant="subtle" color="gray" onClick={onBack} aria-label="Card anterior"><IconArrowLeft size={18} /></ActionIcon>
        </Tooltip>
      )}
      <Text fw={700} size="lg" lineClamp={2}>{e ? e.title : 'Explicação'}</Text>
    </Group>
  );

  return (
    <Drawer
      opened={opened} onClose={onClose} position="right" size={mobile ? '100%' : 480}
      title={header} padding="lg" classNames={{ title: 'bt-explain-title', body: 'bt-explain-body' }}
    >
      {id && (
        <Stack gap="lg">
          <Group gap={6} wrap="wrap">
            <Code className="bt-explain-id">{id}</Code>
            {opts?.title && e && opts.title !== e.title && <Text size="sm" c="dimmed">aberto de “{opts.title}”</Text>}
          </Group>

          {!e && (
            <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />} title="Este card ainda não está no catálogo">
              <Text size="sm">
                Nenhuma explicação com o id <Code>{id}</Code> em <Code>packages/core/src/explain.ts</Code>.
                Acrescente a entrada (o que mostra, sensores, como é calculado, uso no projeto) para este gráfico/número.
              </Text>
              {opts?.sensors && opts.sensors.length > 0 && (
                <Stack gap={4} mt="sm">
                  <Text size="sm" fw={600}>Sensores informados pela página:</Text>
                  <SensorChips sensors={opts.sensors} size="sm" onClick={s => onNavigate('sensor.' + s)} />
                </Stack>
              )}
            </Alert>
          )}

          {e && (
            <>
              <Block icon={<IconEye size={18} />} title="O que mostra"><Para>{e.what}</Para></Block>

              <Block icon={<IconCpu size={18} />} title="Sensores usados">
                <Text size="sm" c="dimmed" mb={8}>
                  {avail
                    ? 'Verde = presente neste log · cinza = ausente · tracejado = sugerido (ainda não instalado). Clique no sensor para ver o card dele.'
                    : 'Sem sessão aberta: mostrando só o catálogo. Abra um log para ver quais destes sensores ele tem.'}
                </Text>
                <Stack gap={10}>
                  {e.sensors.map((s, k) => {
                    const st = stateOf(s.id);
                    return (
                      <Paper key={s.id + k} withBorder radius="md" p="sm" className="bt-explain-sensor" data-used={used.has(s.id) || undefined}>
                        <Group gap={6} wrap="wrap" mb={4}>
                          <SensorChips sensors={[s.id]} size="sm" onClick={x => onNavigate('sensor.' + x)} />
                          <Badge size="sm" variant="light" color={NEED_COLOR[s.need]}>{NEED_LABEL[s.need]}</Badge>
                          {used.has(s.id) && <Badge size="sm" variant="outline" color="green">usado nesta conta</Badge>}
                          {st !== 'unknown' && <Text size="xs" c="dimmed">{SENSOR_STATE_TEXT[st]}</Text>}
                        </Group>
                        <Text size="sm">{s.why}</Text>
                      </Paper>
                    );
                  })}
                  {extra.length > 0 && (
                    <Group gap={6} wrap="wrap">
                      <Text size="sm" c="dimmed">Também entraram nesta conta:</Text>
                      <SensorChips sensors={extra} size="sm" onClick={x => onNavigate('sensor.' + x)} />
                    </Group>
                  )}
                </Stack>
              </Block>

              <Block icon={<IconMathFunction size={18} />} title="Como é calculado"><Para>{e.how}</Para></Block>

              <Block icon={<IconCar size={18} />} title="Para o carro do ano que vem" accent><Para>{e.design}</Para></Block>

              {e.limits && <Block icon={<IconBulb size={18} />} title="Limitações"><Para>{e.limits}</Para></Block>}
              {e.test && <Block icon={<IconFlask size={18} />} title="Teste para medir melhor"><Para>{e.test}</Para></Block>}

              {e.related && e.related.length > 0 && (
                <Block icon={<IconLink size={18} />} title="Veja também">
                  <Group gap={8} wrap="wrap">
                    {e.related.map(r => {
                      const re = getExplain(r);
                      return (
                        <Button key={r} size="xs" variant="light" color={re ? 'brand' : 'yellow'} onClick={() => onNavigate(r)}
                          title={r} className="bt-explain-related">
                          {re ? re.title : r}
                        </Button>
                      );
                    })}
                  </Group>
                </Block>
              )}
            </>
          )}
        </Stack>
      )}
    </Drawer>
  );
}
