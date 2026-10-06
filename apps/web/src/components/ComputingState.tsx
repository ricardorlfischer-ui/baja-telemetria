/* Aviso de "calculando" das páginas com log grande (state/heavy.ts, useComputed): aparece
 * antes da conta pesada, para a aba não congelar sem explicação. */
import { Loader, Paper, Stack, Text } from '@mantine/core';
import { useSessionStore } from '../state/session';

export function ComputingState({ what }: { what: string }) {
  const n = useSessionStore(s => (s.S ? s.S.t.length : 0));
  return (
    <Paper withBorder radius="md" p={48} className="bt-empty" aria-live="polite" aria-busy>
      <Stack align="center" gap="sm">
        <Loader />
        <Text fw={600}>Calculando {what}…</Text>
        <Text c="dimmed" size="sm" ta="center" maw={520}>
          Log grande ({n.toLocaleString('pt-BR')} amostras): a conta roda aqui no navegador e pode levar alguns
          segundos. A página fica parada até terminar.
        </Text>
      </Stack>
    </Paper>
  );
}
