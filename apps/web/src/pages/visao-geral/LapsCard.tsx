/* Tabela de voltas (lapTable do core = buildLaps do app antigo): clique numa volta para ver
 * só ela (janela na volta, cursor no começo, play dentro dela); "Sessão inteira" desfaz. */
import { useMemo } from 'react';
import { Button, Group, Stack, Text } from '@mantine/core';
import { IconFlag, IconMap2, IconRoute } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { lapTable, type SessionContext } from '@baja/core';
import { ChartCard, DataTable, EmptyState, type Column } from '../../components';
import { useSessionStore } from '../../state/session';
import type { LapTableRow } from '@baja/core';

export function LapsCard({ ctx }: { ctx: SessionContext }) {
  const nav = useNavigate();
  const selLap = useSessionStore(s => s.selLap);
  const setLap = useSessionStore(s => s.setLap);
  const rangeMode = useSessionStore(s => s.rangeMode);
  const rep = useMemo(() => lapTable(ctx, selLap), [ctx, selLap]);

  const columns: Column<LapTableRow>[] = rep.columns.map((h, c) => ({
    key: String(c),
    header: h,
    numeric: c > 0,
    render: (r: LapTableRow) => (c === 1 && r.best
      ? <Text component="span" fw={700} c="var(--bt-good)" className="bt-num">{r.cells[c]}</Text>
      : r.cells[c]),
  }));

  return (
    <ChartCard title="Voltas" explain={rep.explain} sensors={rep.sensors}
      subtitle={rep.ok ? 'km/h pelo GPS · clique numa volta para ver só ela (mapa, gráficos e play)' : undefined}
      actions={rep.ok && selLap >= 0 ? <Button size="xs" variant="light" onClick={() => setLap(-1)}>Sessão inteira</Button> : undefined}>
      {rep.ok ? (
        <Stack gap="sm">
          <DataTable<LapTableRow> columns={columns} rows={rep.rows} rowKey={r => r.k}
            onRowClick={r => setLap(r.k)} selected={r => r.sel} maxHeight={400} />
          {selLap >= 0 && rangeMode === 'session' && (
            <Text size="sm" c="dimmed">
              Os números acima continuam da sessão inteira: escolha “Volta” no Trecho do cabeçalho para as análises valerem só para esta volta.
            </Text>
          )}
        </Stack>
      ) : (
        <EmptyState bare icon={IconFlag} title="Sem voltas" description={rep.empty}
          action={(
            <Group gap="sm" justify="center">
              {ctx.track?.ok
                ? <Button variant="light" leftSection={<IconMap2 size={16} />} onClick={() => nav('/mapa')}>Linha de largada no Mapa</Button>
                : <Button variant="light" leftSection={<IconRoute size={16} />} onClick={() => nav('/pista')}>Pista e GPS</Button>}
            </Group>
          )} />
      )}
    </ChartCard>
  );
}
