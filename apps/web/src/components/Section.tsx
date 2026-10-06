/* Seção de página: título de 18 px, descrição opcional, ações e espaço generoso entre seções. */
import type { ReactNode } from 'react';
import { Box, Group, Stack, Text, Title } from '@mantine/core';
import type { SensorId } from '@baja/core';
import { InfoButton } from './explain';

export interface SectionProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  explain?: string;
  sensors?: SensorId[];
  children?: ReactNode;
  id?: string;
}

export function Section({ title, description, actions, explain, sensors, children, id }: SectionProps) {
  return (
    <Box component="section" id={id} className="bt-section">
      {(title || actions) && (
        <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm" mb="sm">
          <Stack gap={2} style={{ minWidth: 0 }}>
            {title && (
              <Group gap={4} wrap="nowrap">
                <Title order={2}>{title}</Title>
                {explain && <InfoButton explain={explain} sensors={sensors} title={typeof title === 'string' ? title : undefined} />}
              </Group>
            )}
            {description && <Text c="dimmed" size="sm" maw={820}>{description}</Text>}
          </Stack>
          {actions && <Group gap="xs">{actions}</Group>}
        </Group>
      )}
      {children}
    </Box>
  );
}
