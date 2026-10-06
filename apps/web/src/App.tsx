/* Raiz do app: tema Mantine (escuro por padrão), notificações, biblioteca, estado da sessão
 * (perfis, disponibilidade dos sensores), cards de explicação e o roteador (HashRouter:
 * funciona no GitHub Pages sem configuração). */
import { Suspense } from 'react';
import { Center, Loader, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { HashRouter, Route, Routes } from 'react-router';
import { IconMapQuestion } from '@tabler/icons-react';
import { theme } from './theme';
import { prefsColorSchemeManager } from './state/prefs';
import { LibrarySync, SessionSensorProvider } from './state/SessionSync';
import { LibraryProvider } from './library';
import { ExplainHost } from './explain';
import { EmptyState } from './components/EmptyState';
import { AppLayout } from './layout/AppLayout';
import { ROUTES } from './routes';

const schemeManager = prefsColorSchemeManager();

function NotFound() {
  return <EmptyState icon={IconMapQuestion} title="Página não encontrada" description="Use o menu à esquerda para escolher uma página." />;
}

export function App() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="dark" colorSchemeManager={schemeManager}>
      <Notifications position="top-right" />
      <LibraryProvider>
        <LibrarySync />
        {/* chips dos sensores com o estado neste log (sensorAvailability da sessão aberta) */}
        <SessionSensorProvider>
          {/* useExplain().open(id, { sensors }) abre o card de explicação (explain/ExplainDrawer) */}
          <ExplainHost>
            <HashRouter>
              <Routes>
                {/* login em tela cheia, fora da casca (menu e cabeçalho não ficam por trás) */}
                {ROUTES.filter(r => r.path === '/login').map(r => {
                  const C = r.component;
                  return (
                    <Route key={r.path} path={r.path.slice(1)} element={
                      <Suspense fallback={<Center h="100vh"><Loader /></Center>}><C /></Suspense>
                    } />
                  );
                })}
                <Route element={<AppLayout />}>
                  {ROUTES.filter(r => r.path !== '/login').map(r => {
                    const C = r.component;
                    return r.path === '/'
                      ? <Route key={r.path} index element={<C />} />
                      : <Route key={r.path} path={r.path.slice(1)} element={<C />} />;
                  })}
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </HashRouter>
          </ExplainHost>
        </SessionSensorProvider>
      </LibraryProvider>
    </MantineProvider>
  );
}
