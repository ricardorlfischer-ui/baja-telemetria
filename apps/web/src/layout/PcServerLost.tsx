/* Modo "este computador" (docs/NO-MEU-PC.md): o servidor que roda escondido no PC parou com o
 * app aberto (parar-telemetria, fechou, PC dormiu). Aviso fixo no topo de todas as páginas,
 * em vez de cada lista mostrar um erro solto: o que aconteceu, o que fazer (o atalho) e que
 * os logs continuam na pasta. Some sozinho quando o servidor volta (library/context.tsx). */
import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { IconPlugConnectedX, IconRefresh } from '@tabler/icons-react';
import { useLibrary } from '../library';

export function PcServerLost() {
  const { pc, offline, dataDir, recheck } = useLibrary();
  if (!pc || !offline) return null;
  return (
    <Alert color="red" variant="light" radius="md" mb="lg" icon={<IconPlugConnectedX size={22} />}
      title={<Text fw={650} size="md">O servidor da telemetria parou</Text>} role="alert">
      <Group justify="space-between" gap="sm" wrap="wrap" align="flex-end">
        <Stack gap={4} style={{ flex: '1 1 280px', minWidth: 0 }}>
          <Text size="md">
            Clique de novo no atalho <b>Telemetria · Mauá Racing Baja</b> (área de trabalho ou menu Iniciar): este app
            volta sozinho em alguns segundos, sem recarregar.
          </Text>
          <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
            Nada se perdeu: os logs, perfis e anotações continuam na pasta {dataDir ? <b>{dataDir}</b> : 'de dados'}. Enquanto
            isso, a sessão aberta continua na tela, mas nada novo é guardado.
          </Text>
        </Stack>
        <Button variant="default" leftSection={<IconRefresh size={17} />} onClick={recheck}>Tentar agora</Button>
      </Group>
    </Alert>
  );
}
