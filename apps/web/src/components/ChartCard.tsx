/* Moldura de todo gráfico das análises: título clicável (abre o card de explicação),
 * botão ⓘ, chips dos sensores que entraram na conta, ações e o corpo (XYPlot, TrackMap...).
 * Requisito central (ARQUITETURA 4.6): todo gráfico diz de quais sensores saiu. */
import type { ReactNode } from 'react';
import { Box, Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import type { SensorId } from '@baja/core';
import { InfoButton, useExplain } from './explain';
import { SensorChips } from './SensorChips';

export interface ChartCardProps {
  title: ReactNode;
  /** uma linha abaixo do título (como ler o gráfico) */
  subtitle?: ReactNode;
  /** id do card de explicação (catálogo EXPLAIN do core) */
  explain?: string;
  /** sensores que de fato entraram neste gráfico */
  sensors?: SensorId[];
  actions?: ReactNode;
  /** rodapé (nota, legenda extra) */
  footer?: ReactNode;
  children?: ReactNode;
  /** sem padding no corpo (mapa de ponta a ponta) */
  flush?: boolean;
}

export function ChartCard({ title, subtitle, explain, sensors, actions, footer, children, flush }: ChartCardProps) {
  const { open } = useExplain();
  const t = typeof title === 'string' ? title : undefined;
  const openCard = explain ? () => open(explain, { sensors, title: t }) : undefined;
  return (
    <Paper withBorder radius="md" className="bt-chart-card">
      <Stack gap={6} p="md" pb={flush ? 'sm' : 6}>
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
          <Group gap={8} wrap="wrap" style={{ minWidth: 0 }} align="center">
            {openCard ? (
              <UnstyledButton onClick={openCard} className="bt-card-title bt-card-title--link" title="Abrir explicação">
                {title}
              </UnstyledButton>
            ) : (
              <span className="bt-card-title">{title}</span>
            )}
            {/* chips: cada um abre o card do próprio sensor */}
            <SensorChips sensors={sensors} />
          </Group>
          <Group gap={4} wrap="nowrap">
            {actions}
            {explain && <InfoButton explain={explain} sensors={sensors} title={t} />}
          </Group>
        </Group>
        {subtitle && <Text size="sm" c="dimmed">{subtitle}</Text>}
      </Stack>
      <div className={flush ? 'bt-chart-body bt-chart-body--flush' : 'bt-chart-body'}>{children}</div>
      {footer && <Box px="md" pb="sm" pt={4} fz="sm" c="dimmed">{footer}</Box>}
    </Paper>
  );
}
