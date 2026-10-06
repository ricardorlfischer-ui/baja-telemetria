/* Liga o contexto de explicação (components/explain.tsx) ao card ExplainDrawer: qualquer
 * componente chama useExplain().open(id, { sensors, title }) e o card abre à direita.
 * Links "veja também" e chips dos sensores dentro do card empilham cards (botão voltar). */
import { useCallback, useState, type ReactNode } from 'react';
import { ExplainProvider, type ExplainOptions } from '../components/explain';
import { ExplainDrawer } from './ExplainDrawer';

interface Item { id: string; opts?: ExplainOptions }

export function ExplainHost({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Item[]>([]);
  const [opened, setOpened] = useState(false);

  /* aberto de fora (gráfico, número, ⓘ): começa uma pilha nova */
  const open = useCallback((id: string, opts?: ExplainOptions) => {
    setStack([{ id, opts }]);
    setOpened(true);
  }, []);

  const top = stack.length ? stack[stack.length - 1] : null;
  return (
    <ExplainProvider onExplain={open}>
      {children}
      <ExplainDrawer
        opened={opened}
        id={top?.id ?? null}
        opts={top?.opts}
        onClose={() => setOpened(false)}
        onNavigate={id => { if (id !== top?.id) setStack(s => [...s, { id }]); }}
        canBack={stack.length > 1}
        onBack={() => setStack(s => (s.length > 1 ? s.slice(0, -1) : s))}
      />
    </ExplainProvider>
  );
}
