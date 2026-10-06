/* Erro numa página não derruba o app. Sem isto, uma exceção ao desenhar (um relatório do core
 * que falha num log estranho, por exemplo) desmontava o React inteiro: tela em branco, sem
 * menu e sem mensagem. Agora a página mostra o erro e o resto (menu, cabeçalho, play) continua;
 * trocar de página, abrir outra sessão ou recalcular tenta de novo. */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert, Button, Code, Group, Stack, Text } from '@mantine/core';
import { IconAlertOctagon, IconRefresh } from '@tabler/icons-react';
import { useSessionStore } from '../state/session';

interface Props { children: ReactNode; route: string; ctx: unknown }
interface State { error: Error | null; route: string; ctx: unknown }

class Boundary extends Component<Props, State> {
  override state: State = { error: null, route: this.props.route, ctx: this.props.ctx };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  /* página, sessão ou conta nova: tenta desenhar de novo */
  static getDerivedStateFromProps(p: Props, s: State): Partial<State> | null {
    return p.route !== s.route || p.ctx !== s.ctx ? { route: p.route, ctx: p.ctx, error: null } : null;
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Erro ao desenhar a página', error, info.componentStack);
  }

  override render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    /* o código da página não baixou (sem internet, ou o app foi atualizado no servidor) */
    if (/dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(e.message)) {
      return (
        <Alert color="yellow" variant="light" icon={<IconAlertOctagon size={22} />} title="Não consegui carregar esta página" mt="md">
          <Stack gap="sm">
            <Text>
              O código desta página não chegou (sem conexão, ou o app foi atualizado desde que esta aba abriu).
              Recarregue a página (F5); a sessão aberta precisa ser aberta de novo.
            </Text>
            <Code block>{e.message}</Code>
            <Group>
              <Button leftSection={<IconRefresh size={17} />} onClick={() => window.location.reload()}>Recarregar</Button>
            </Group>
          </Stack>
        </Alert>
      );
    }
    return (
      <Alert color="red" variant="light" icon={<IconAlertOctagon size={22} />} title="Esta página não conseguiu mostrar este log" mt="md">
        <Stack gap="sm">
          <Text>
            Uma conta ou um gráfico falhou com os dados desta sessão. As outras páginas continuam funcionando e os
            dados da sessão não foram alterados.
          </Text>
          <Code block>{e.message || String(e)}</Code>
          <Text size="sm" c="dimmed">
            Confira em Aquisição se os canais do log estão certos (canais vazios, constantes ou com valores absurdos).
            Se continuar, guarde o log e mande para quem cuida do app junto com esta mensagem.
          </Text>
          <Group>
            <Button variant="default" leftSection={<IconRefresh size={17} />} onClick={() => this.setState({ error: null })}>
              Tentar de novo
            </Button>
          </Group>
        </Stack>
      </Alert>
    );
  }
}

/** Envolve o conteúdo da página (no AppLayout, em volta do Outlet). */
export function PageErrorBoundary({ children, route }: { children: ReactNode; route: string }) {
  const ctx = useSessionStore(s => s.ctx);
  return <Boundary route={route} ctx={ctx}>{children}</Boundary>;
}
