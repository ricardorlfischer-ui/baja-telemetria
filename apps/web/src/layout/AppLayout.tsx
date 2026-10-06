/* Casca do app (docs/ARQUITETURA.md 4.2): AppShell com barra lateral de 260 px recolhível
 * (menu no celular), cabeçalho de 60 px e barra de reprodução de 64 px nas páginas com player. */
import { Suspense, useEffect } from 'react';
import { ActionIcon, AppShell, Burger, Center, Group, Loader, Text, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Link, Outlet, useLocation } from 'react-router';
import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from '@tabler/icons-react';
import { NavMenu } from './NavMenu';
import { LibraryBadge, ThemeToggle } from './HeaderParts';
import { SessionChip } from './SessionChip';
import { RangeControl } from './RangeControl';
import { PlayerBar } from './PlayerBar';
import { routeByPath } from '../routes';
import { usePrefs } from '../state/prefs';
import { useSessionHotkeys } from '../state/hotkeys';
import { APP_NAME, BrandLogo, FULL_NAME, TEAM_NAME } from '../brand';

export function AppLayout() {
  const [mobileOpen, { toggle: toggleMobile, close: closeMobile }] = useDisclosure(false);
  const collapsed = usePrefs(s => s.navCollapsed);
  const setPrefs = usePrefs(s => s.set);
  const { pathname } = useLocation();
  const route = routeByPath(pathname);
  const player = !!route?.player;
  /* atalhos do play: espaço, ← → (Shift = 1 s), Home, End */
  useSessionHotkeys();
  /* página nova começa do topo (o HashRouter não restaura a rolagem sozinho) */
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !mobileOpen, desktop: collapsed } }}
      footer={{ height: 64, collapsed: !player }}
      padding={{ base: 'md', sm: 'lg', lg: 'xl' }}
    >
      <AppShell.Header className="bt-header">
        <Group h="100%" px="md" gap="sm" wrap="nowrap" justify="space-between">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <Burger opened={mobileOpen} onClick={toggleMobile} hiddenFrom="sm" size="sm" aria-label="Menu" />
            <Tooltip label={collapsed ? 'Mostrar o menu' : 'Esconder o menu'}>
              <ActionIcon variant="subtle" color="gray" size="lg" visibleFrom="sm" onClick={() => setPrefs({ navCollapsed: !collapsed })}
                aria-label={collapsed ? 'Mostrar o menu' : 'Esconder o menu'}>
                {collapsed ? <IconLayoutSidebarLeftExpand size={20} /> : <IconLayoutSidebarLeftCollapse size={20} />}
              </ActionIcon>
            </Tooltip>
            <Link to="/" className="bt-brand" aria-label={`${FULL_NAME} — início`}>
              <BrandLogo size={36} />
              <span className="bt-brand-text">
                <Text span fw={750} size="md" visibleFrom="xs" className="bt-brand-team">{TEAM_NAME}</Text>
                <Text span size="xs" c="dimmed" visibleFrom="xs" className="bt-brand-app">{APP_NAME}</Text>
              </span>
            </Link>
            <SessionChip />
            <Group visibleFrom="md" gap="sm" wrap="nowrap"><RangeControl /></Group>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <Group visibleFrom="sm"><LibraryBadge /></Group>
            <ThemeToggle />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className="bt-navbar">
        <NavMenu onNavigate={closeMobile} />
      </AppShell.Navbar>

      <AppShell.Main className="bt-main">
        <div className="bt-page">
          <Suspense fallback={<Center py={80}><Loader /></Center>}>
            <Outlet />
          </Suspense>
        </div>
      </AppShell.Main>

      <AppShell.Footer className="bt-footer">
        {player && <PlayerBar />}
      </AppShell.Footer>
    </AppShell>
  );
}
