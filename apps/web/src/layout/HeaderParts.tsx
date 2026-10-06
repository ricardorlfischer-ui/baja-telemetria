/* Peças do cabeçalho (docs/ARQUITETURA.md 4.2): modo da biblioteca e tema.
 * O seletor de sessão e o de trecho ficam em SessionChip.tsx e RangeControl.tsx. */
import { ActionIcon, Badge, Tooltip, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { IconCloud, IconCloudOff, IconDatabase, IconMoon, IconSun } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { useLibrary } from '../library';

/** Modo da biblioteca: "Local" ou "Servidor · nome do usuário". */
export function LibraryBadge() {
  const { mode, user, info, offline, loading } = useLibrary();
  const nav = useNavigate();
  if (loading) return <Badge variant="light" color="gray" size="lg">…</Badge>;
  if (mode === 'remote') {
    const label = offline ? 'Servidor fora do ar' : `Servidor · ${user ? user.name : 'entrar'}`;
    return (
      <Tooltip label={offline ? 'O servidor salvo em Preferências não respondeu' : info ? `${info.name} ${info.version}` : 'Servidor da equipe'}>
        <Badge
          variant="light" color={offline ? 'red' : 'brand'} size="lg" radius="sm" className="bt-lib-badge"
          leftSection={offline ? <IconCloudOff size={14} /> : <IconCloud size={14} />}
          onClick={() => nav(user ? '/config' : '/login')} style={{ cursor: 'pointer', textTransform: 'none' }}
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
