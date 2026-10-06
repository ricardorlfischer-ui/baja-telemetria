/* Barra lateral: grupos e páginas do routes.tsx. Páginas que precisam de sessão ficam
 * desabilitadas (com dica) quando não há sessão aberta; Equipe só com o servidor. */
import { NavLink, ScrollArea, Stack, Text, Tooltip } from '@mantine/core';
import { Link, useLocation } from 'react-router';
import { NAV_GROUPS, ROUTES, type AppRoute } from '../routes';
import { useHasSession } from '../state/session';
import { useLibrary } from '../library';

export function NavMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const hasSession = useHasSession();
  const { mode } = useLibrary();

  const blocked = (r: AppRoute): string | null => {
    if (r.needsSession && !hasSession) return 'Abra uma sessão primeiro (página Sessões ou o exemplo)';
    if (r.serverOnly && mode !== 'remote') return 'Só com o servidor da equipe (configure em Preferências)';
    return null;
  };

  return (
    <ScrollArea type="auto" style={{ flex: 1 }} className="bt-nav">
      <Stack gap={14} p="sm" pb="lg">
        {NAV_GROUPS.map(g => (
          <div key={g}>
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="sm" mb={4} className="bt-nav-group">{g}</Text>
            {ROUTES.filter(r => r.group === g).map(r => {
              const why = blocked(r);
              const Ico = r.icon;
              const item = (
                <NavLink
                  key={r.path}
                  component={Link}
                  to={why ? '#' : r.path}
                  label={r.label}
                  leftSection={<Ico size={19} stroke={1.7} />}
                  active={pathname === r.path}
                  disabled={!!why}
                  onClick={e => { if (why) { e.preventDefault(); return; } onNavigate?.(); }}
                  className="bt-nav-link"
                  aria-disabled={why ? true : undefined}
                />
              );
              return why ? (
                <Tooltip key={r.path} label={why} position="right" withinPortal>
                  <div>{item}</div>
                </Tooltip>
              ) : item;
            })}
          </div>
        ))}
      </Stack>
    </ScrollArea>
  );
}
