/* Seção de página: título de 18 px, descrição opcional, ações e espaço generoso entre seções.
 * Com explain, o título também abre o card (como no ChartCard) e os chips dos sensores
 * aparecem ao lado. */
import type { ReactNode } from 'react';
import { Box, Group, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import type { SensorId } from '@baja/core';
import { InfoButton, useExplain } from './explain';
import { SensorChips } from './SensorChips';

export interface SectionProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  explain?: string;
  sensors?: SensorId[];
  children?: ReactNode;
  id?: string;
  /** classe extra (ex.: bt-print-hide) */
  className?: string;
}

export function Section({ title, description, actions, explain, sensors, children, id, className }: SectionProps) {
  const { open } = useExplain();
  const t = typeof title === 'string' ? title : undefined;
  return (
    <Box component="section" id={id} className={className ? `bt-section ${className}` : 'bt-section'}>
      {(title || actions) && (
        <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm" mb="sm">
          <Stack gap={2} style={{ minWidth: 0, flex: '1 1 320px' }}>
            {title && (
              <Group gap={6} wrap="wrap" align="center">
                {explain ? (
                  <UnstyledButton className="bt-card-title--link" onClick={() => open(explain, { sensors, title: t })} title="Abrir explicação">
                    <Title order={2}>{title}</Title>
                  </UnstyledButton>
                ) : <Title order={2}>{title}</Title>}
                {explain && <InfoButton explain={explain} sensors={sensors} title={t} />}
                {explain && <SensorChips sensors={sensors} size="sm" />}
              </Group>
            )}
            {description && (
              <Text c="dimmed" size="sm" maw={820} component={typeof description === 'string' ? 'p' : 'div'}>{description}</Text>
            )}
          </Stack>
          {actions && <Group gap="xs" wrap="wrap" style={{ minWidth: 0, maxWidth: '100%' }}>{actions}</Group>}
        </Group>
      )}
      {children}
    </Box>
  );
}
