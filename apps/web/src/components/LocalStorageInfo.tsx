/* Onde ficam os logs da biblioteca local e se estão protegidos (página Sessões no modo local e
 * Preferências): espaço usado / disponível (navigator.storage.estimate), proteção contra a
 * limpeza automática do navegador (navigator.storage.persisted) com o botão "Proteger os logs",
 * e o texto honesto: os logs ficam neste navegador, neste computador; para outro computador ou
 * para ter uma cópia, o Backup em Preferências. */
import { useCallback, useEffect, useState } from 'react';
import { Anchor, Badge, Button, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconShield, IconShieldCheck, IconShieldExclamation } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { ensurePersisted, fmtBytes, requestPersist, storageStatus, type StorageStatus } from '../library/storage';

export interface LocalStorageInfoProps {
  /** há sessões guardadas: pede a proteção sozinho (uma vez por carga da página) */
  hasSessions?: boolean;
  /** muda quando a biblioteca muda (recalcula o espaço usado) */
  version?: number;
}

/** Vai para a seção Backup de Preferências. */
export function useGoToBackup(): () => void {
  const nav = useNavigate();
  return useCallback(() => nav('/config', { state: { section: 'backup' } }), [nav]);
}

export function LocalStorageInfo({ hasSessions = false, version = 0 }: LocalStorageInfoProps) {
  const [st, setSt] = useState<StorageStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const goBackup = useGoToBackup();

  const refresh = useCallback(async () => {
    const s = await storageStatus();
    setSt(s);
    return s;
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await storageStatus();
      if (!alive) return;
      setSt(s);
      /* com sessões guardadas e sem proteção: pede ao navegador (o Firefox pergunta) */
      if (hasSessions && s.persisted === false) {
        const ok = await ensurePersisted();
        if (ok && alive) setSt(await storageStatus());
      }
    })();
    return () => { alive = false; };
  }, [hasSessions, version]);

  const protect = async () => {
    setBusy(true);
    try {
      const ok = await requestPersist();
      await refresh();
      if (ok) {
        notifications.show({ color: 'green', title: 'Logs protegidos', message: 'O navegador não vai apagar os logs sozinho quando faltar espaço no disco.', autoClose: 5000 });
      } else if (ok === false) {
        notifications.show({
          color: 'yellow', title: 'O navegador não liberou a proteção agora', autoClose: 12_000,
          message: 'Chrome e Edge liberam sozinhos para sites usados com frequência (ou nos favoritos, ou instalados como app); o Firefox pergunta. Enquanto isso, exporte um backup de vez em quando.',
        });
      } else {
        notifications.show({ color: 'yellow', title: 'Este navegador não tem essa opção', message: 'Exporte um backup de vez em quando para não perder os logs.', autoClose: 8000 });
      }
    } finally { setBusy(false); }
  };

  const persisted = st?.persisted ?? null;
  const badge = !st ? null
    : persisted === true
      ? <Badge size="lg" tt="none" variant="light" color="green" leftSection={<IconShieldCheck size={15} />}>protegidos contra limpeza automática</Badge>
      : persisted === false
        ? <Badge size="lg" tt="none" variant="light" color="yellow" leftSection={<IconShieldExclamation size={15} />}>sem proteção contra limpeza automática</Badge>
        : <Badge size="lg" tt="none" variant="light" color="gray" leftSection={<IconShield size={15} />}>o navegador não informa a proteção</Badge>;

  return (
    <Stack gap="xs">
      <Text size="md">
        Os logs que você guarda ficam <b>neste navegador, neste computador</b>: não vão para a internet nem para os outros
        integrantes, e continuam aqui quando você volta ao app. Limpar os dados do site (ou do navegador) apaga os logs, e numa
        aba anônima nada fica guardado depois de fechar. Para levar a outro computador ou ter uma cópia, use o{' '}
        <Anchor component="button" type="button" onClick={goBackup} fz="md" style={{ verticalAlign: 'baseline' }}>Backup (exportar/importar)</Anchor>.
      </Text>
      <Group gap="sm" wrap="wrap" align="center">
        {badge}
        {st && st.usage !== null && (
          <Text size="sm" c="dimmed" className="bt-num">
            Espaço usado: {fmtBytes(st.usage)}{st.quota ? ` de ${fmtBytes(st.quota)} disponíveis` : ''}
          </Text>
        )}
      </Group>
      {persisted === false && (
        <Text size="sm" c="dimmed">Sem proteção, o navegador pode apagar os dados do site sozinho se o disco ficar cheio.</Text>
      )}
      <Group gap="xs" wrap="wrap">
        {persisted === false && (
          <Button size="sm" variant="light" leftSection={<IconShieldCheck size={16} />} loading={busy} onClick={() => { void protect(); }}>
            Proteger os logs
          </Button>
        )}
      </Group>
    </Stack>
  );
}
