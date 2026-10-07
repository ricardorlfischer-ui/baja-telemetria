/* Peças do cabeçalho (docs/ARQUITETURA.md 4.2): modo da biblioteca e tema.
 * O seletor de sessão e o de trecho ficam em SessionChip.tsx e RangeControl.tsx. */
import { ActionIcon, Badge, Tooltip, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { IconCloud, IconCloudOff, IconDatabase, IconDeviceDesktop, IconMoon, IconPlugConnectedX, IconSun } from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router';
import { useLibrary } from '../library';

/** Modo da biblioteca: "Local", "Servidor · nome do usuário" ou "Este computador". */
export function LibraryBadge() {
  const { mode, user, info, offline, loading, pc, dataDir } = useLibrary();
  const nav = useNavigate();
  const { pathname } = useLocation();
  if (loading) return <Badge variant="light" color="gray" size="lg">…</Badge>;
  if (pc && offline) {
    /* o servidor do PC parou: o aviso no topo da página diz o que fazer */
    return (
      <Tooltip multiline maw={360} label="O servidor da telemetria deste computador não está respondendo. Clique de novo no atalho da telemetria: o app volta sozinho.">
        <Badge variant="light" color="red" size="lg" radius="sm" className="bt-lib-badge"
          leftSection={<IconPlugConnectedX size={14} />} style={{ textTransform: 'none' }}>
          Servidor parado
        </Badge>
      </Tooltip>
    );
  }
  if (pc) {
    /* este computador (atalho da área de trabalho): sem conta; a dica diz onde estão os logs */
    return (
      <Tooltip multiline maw={360} label={`Os logs ficam neste computador, na pasta ${dataDir ?? 'de dados do app'}. Clique para ver em Preferências.`}>
        <Badge
          variant="light" color="brand" size="lg" radius="sm" className="bt-lib-badge"
          leftSection={<IconDeviceDesktop size={14} />}
          onClick={() => nav('/config', { state: { section: 'pasta' } })} style={{ cursor: 'pointer', textTransform: 'none' }}
        >
          Este computador
        </Badge>
      </Tooltip>
    );
  }
  if (mode === 'remote') {
    const label = offline ? 'Servidor fora do ar' : `Servidor · ${user ? user.name : 'entrar'}`;
    return (
      <Tooltip label={offline ? 'O servidor salvo em Preferências não respondeu' : info ? `${info.name} ${info.version}` : 'Servidor da equipe'}>
        <Badge
          variant="light" color={offline ? 'red' : 'brand'} size="lg" radius="sm" className="bt-lib-badge"
          leftSection={offline ? <IconCloudOff size={14} /> : <IconCloud size={14} />}
          onClick={() => (user ? nav('/config') : nav('/login', { state: { from: pathname } }))} style={{ cursor: 'pointer', textTransform: 'none' }}
        >
          {label}
        </Badge>
      </Tooltip>
    );
  }
  return (
    <Tooltip label="As sessões ficam só neste navegador. Para a biblioteca da equipe, configure o servidor em Preferências.">
      <Badge variant="light" color="gray" size="lg" radius="sm" leftSection={<IconDatabase size={14} />}
        onClick={() => nav('/config')} style={{ cursor: 'pointer', textTransform: 'none' }} className="bt-lib-badge">
        Local
      </Badge>
    </Tooltip>
  );
}

/** Alterna escuro/claro (grava nas preferências pelo colorSchemeManager). */
export function ThemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('dark', { getInitialValueInEffect: false });
  const dark = computed === 'dark';
  return (
    <Tooltip label={dark ? 'Tema claro' : 'Tema escuro'}>
      <ActionIcon variant="default" size="lg" aria-label="Alternar tema" onClick={() => setColorScheme(dark ? 'light' : 'dark')}>
        {dark ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}
