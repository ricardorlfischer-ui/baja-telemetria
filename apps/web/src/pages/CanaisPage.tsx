/* Página /canais — PLACEHOLDER: outro agente preenche (docs/ARQUITETURA.md 4.2).
 * Título e frase vêm do registro em routes.tsx. */
import { IconTool } from '@tabler/icons-react';
import { EmptyState, PageHeader } from '../components';
import { routeByPath } from '../routes';

export default function CanaisPage() {
  const r = routeByPath('/canais')!;
  return (
    <>
      <PageHeader title={r.label} subtitle={r.question} />
      <EmptyState icon={IconTool} title="Em construção" description="Esta página ainda está sendo escrita na versão nova do app." />
    </>
  );
}
