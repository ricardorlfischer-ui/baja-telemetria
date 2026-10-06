/* Rótulo do trecho analisado no cabeçalho das páginas de análise (o seletor fica no
 * cabeçalho do app: Sessão / Volta / Janela). Antes havia duas versões com visuais diferentes
 * (Suspensão/Ressonância e Trem de força/CVT/Dinâmica). */
import { Badge, Tooltip } from '@mantine/core';

export function RangeBadge({ label }: { label: string }) {
  return (
    <Tooltip label="Trecho analisado: escolha Sessão, Volta ou Janela no seletor Trecho, no topo da página">
      <Badge size="lg" variant="light" color="gray" radius="sm" tt="none" fw={500}>Trecho: {label}</Badge>
    </Tooltip>
  );
}
