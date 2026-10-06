/* Estado vazio útil: diz o que falta e o que fazer ("abra uma sessão", "este log não tem
 * amortecedores: ..."), com ação opcional. */
import type { ReactNode } from 'react';
import { Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconInbox, type Icon } from '@tabler/icons-react';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: Icon;
  action?: ReactNode;
  /** sem moldura (dentro de um ChartCard, por exemplo) */
  bare?: boolean;
}

export function EmptyState({ title, description, icon: Ico = IconInbox, action, bare }: EmptyStateProps) {
  const body = (
    <Stack align="center" gap="xs" py={bare ? 'lg' : 48} px="md" ta="center">
      <ThemeIcon size={52} radius="xl" variant="light" color="gray">
        <Ico size={28} stroke={1.6} />
      </ThemeIcon>
      <Title order={3} mt={4}>{title}</Title>
      {description && <Text c="dimmed" maw={520}>{description}</Text>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </Stack>
  );
  if (bare) return body;
  return <Paper withBorder radius="md" className="bt-empty">{body}</Paper>;
}
