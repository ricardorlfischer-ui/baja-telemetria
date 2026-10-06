/* Cabeçalho de página: título (24 px), a frase do que a página responde para o projeto,
 * ações à direita, botão ⓘ e chips dos sensores opcionais (o título abre o card quando há
 * explain). */
import type { ReactNode } from 'react';
import { Group, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import type { SensorId } from '@baja/core';
import { InfoButton, useExplain } from './explain';
import { SensorChips } from './SensorChips';

export interface PageHeaderProps {
  title: ReactNode;
  /** uma frase: o que esta página responde para o projeto do carro */
  subtitle?: ReactNode;
  actions?: ReactNode;
  explain?: string;
  sensors?: SensorId[];
}

export function PageHeader({ title, subtitle, actions, explain, sensors }: PageHeaderProps) {
  const { open } = useExplain();
  const t = typeof title === 'string' ? title : undefined;
  return (
    <Group justify="space-between" align="flex-start" wrap="wrap" gap="md" mb="lg" className="bt-page-header">
      <Stack gap={4} style={{ minWidth: 0, flex: '1 1 320px' }}>
        <Group gap={6} wrap="nowrap">
          {explain ? (
            <UnstyledButton className="bt-card-title--link" onClick={() => open(explain, { sensors, title: t })} title="Abrir explicação">
              <Title order={1}>{title}</Title>
            </UnstyledButton>
          ) : <Title order={1}>{title}</Title>}
          {explain && <InfoButton explain={explain} sensors={sensors} title={t} size="lg" />}
        </Group>
        {subtitle && <Text c="dimmed" size="md" maw={820}>{subtitle}</Text>}
        {sensors && sensors.length > 0 && <SensorChips sensors={sensors} size="sm" />}
      </Stack>
      {actions && <Group gap="xs" wrap="wrap">{actions}</Group>}
    </Group>
  );
}
