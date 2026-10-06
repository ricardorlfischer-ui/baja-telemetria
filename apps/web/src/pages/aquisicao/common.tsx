/* Peças pequenas das páginas Aquisição e Dispersão: estado vazio sem sessão (com os botões de
 * abrir), número/texto clicável que abre o card de explicação e formatação de números. */
import type { ReactNode } from 'react';
import { UnstyledButton } from '@mantine/core';
import { IconPlugConnectedX, type Icon } from '@tabler/icons-react';
import type { SensorId } from '@baja/core';
import { NoSessionState, useExplain } from '../../components';
import { useSessionStore } from '../../state/session';

/** Número com casas fixas (toFixed, como o antigo); NaN/±Infinity = "—". */
export const fmtN = (v: number | null | undefined, d = 1): string =>
  v === null || v === undefined || !isFinite(v) ? '—' : v.toFixed(d);

/** Casas decimais adequadas à faixa (mesma ideia do decimalsFor do core, mais curta para tabelas). */
export const decFor = (lo: number, hi: number): number => {
  const r = Math.max(Math.abs(lo), Math.abs(hi), Math.abs(hi - lo));
  if (!isFinite(r) || r === 0) return 0;
  return r >= 1000 ? 0 : r >= 100 ? 1 : r >= 10 ? 2 : 3;
};

/** Estado vazio sem sessão: diz o que fazer e oferece abrir o exemplo ou ir para Sessões. */
export function NoSession({ title, description, icon = IconPlugConnectedX }: {
  title?: string; description?: ReactNode; icon?: Icon;
}) {
  return <NoSessionState icon={icon} title={title} description={description} />;
}

/** Texto ou número clicável que abre o card de explicação (requisito central 4.6). */
export function ExplainText({ explain, sensors, title, children, strong }: {
  explain: string; sensors?: SensorId[]; title?: string; children: ReactNode; strong?: boolean;
}) {
  const { open } = useExplain();
  return (
    <UnstyledButton
      className="bt-card-title--link bt-acq-link" data-strong={strong || undefined}
      onClick={e => { e.stopPropagation(); open(explain, { sensors, title }); }}
      title="Abrir explicação: o que é, de quais sensores sai e como usar no projeto"
    >
      {children}
    </UnstyledButton>
  );
}

/** Vai para o instante t: move o cursor e, se ele sair da janela dos gráficos, recentra a
 *  janela (mesma largura) — para "ir ao ponto" a partir de listas fora da página Canais. */
export function goToTime(t: number): void {
  const st = useSessionStore.getState();
  if (!st.S) return;
  st.seek(t);
  const v = st.view;
  if (v && (t < v[0] || t > v[1])) {
    const w = v[1] - v[0];
    st.setView([t - w / 2, t + w / 2]);
  }
}
