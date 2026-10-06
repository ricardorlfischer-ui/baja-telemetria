/* Página /suspensao — PLACEHOLDER: outro agente preenche (docs/ARQUITETURA.md 4.2).
 * Título e frase vêm do registro em routes.tsx. */
import { IconTool } from '@tabler/icons-react';
import { EmptyState, PageHeader } from '../components';
import { routeByPath } from '../routes';

export default function SuspensaoPage() {
  const r = routeByPath('/suspensao')!;
  return (
    <>
      <PageHeader title={r.label} subtitle={r.question} />
      <EmptyState icon={IconTool} title="Em construção" description="Esta página ainda está sendo escrita na versão nova do app." />
    </>
  );
}
