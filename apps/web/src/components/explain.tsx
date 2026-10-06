/* Cards de explicação (docs/ARQUITETURA.md 4.6): todo gráfico, número e linha da ficha tem
 * um botão ⓘ (e o próprio título clicável) que abre o card dizendo o que é, de quais sensores
 * saiu, como é calculado e como usar no projeto do carro do ano que vem.
 *
 * Aqui fica só o "fio": o contexto com open(id, { sensors }) e o botão ⓘ. Sem provider, open()
 * não faz nada. No app, explain/ExplainHost.tsx monta o ExplainProvider com o card
 * (explain/ExplainDrawer.tsx, catálogo EXPLAIN do core). */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import type { SensorId } from '@baja/core';

export interface ExplainOptions {
  /** sensores que DE FATO entraram na conta nesta sessão (ex.: aceleração pela roda ou pelo GPS) */
  sensors?: SensorId[];
  /** título do gráfico/número que pediu o card (para o cabeçalho do card) */
  title?: string;
}
export type OnExplain = (id: string, opts?: ExplainOptions) => void;

export interface ExplainApi {
  /** abre o card de explicação `id` (chave do catálogo EXPLAIN do core) */
  open: OnExplain;
  /** false enquanto ninguém ligou o catálogo (o botão ⓘ continua aparecendo) */
  enabled: boolean;
}

const noop: OnExplain = () => { /* catálogo ainda não ligado */ };
const ExplainContext = createContext<ExplainApi>({ open: noop, enabled: false });

export function ExplainProvider({ onExplain, children }: { onExplain?: OnExplain; children: ReactNode }) {
  const api = useMemo<ExplainApi>(() => ({ open: onExplain ?? noop, enabled: !!onExplain }), [onExplain]);
  return <ExplainContext.Provider value={api}>{children}</ExplainContext.Provider>;
}

/** useExplain().open('susp.naturalFreq', { sensors: ['shock_fl'] }) */
export const useExplain = (): ExplainApi => useContext(ExplainContext);

/** Botão ⓘ que abre o card `explain`. */
export function InfoButton({ explain, sensors, title, size = 'md' }: {
  explain: string; sensors?: SensorId[]; title?: string; size?: 'sm' | 'md' | 'lg';
}) {
  const { open } = useExplain();
  const px = size === 'sm' ? 16 : size === 'lg' ? 22 : 18;
  return (
    <Tooltip label="O que é isto, de quais sensores sai e como usar no projeto">
      <ActionIcon
        variant="subtle" color="gray" size={size} radius="xl"
        aria-label={title ? `Explicação: ${title}` : 'Explicação'}
        onClick={e => { e.stopPropagation(); open(explain, { sensors, title }); }}
      >
        <IconInfoCircle size={px} stroke={1.8} />
      </ActionIcon>
    </Tooltip>
  );
}
