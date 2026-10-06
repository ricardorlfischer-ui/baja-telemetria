/* Página / — VERSÃO MÍNIMA para testar o estado da sessão (abrir log, exemplo, arrastar
 * arquivo, abrir da biblioteca).
 * TODO(página Sessões): o agente desta página refaz tudo (docs/ARQUITETURA.md 4.2: enviar
 * vários logs, lista com filtros, métricas por sessão, editar dados, apagar). As ações da
 * store a usar estão em src/README.md (openFile(file, { saveTo: lib }), openFromLibrary, openDemo). */
import { useEffect, useRef, useState } from 'react';
import { Button, Group, Paper, Stack, Text } from '@mantine/core';
import { IconFileUpload, IconFlask, IconFolderOpen, IconUpload } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { DataTable, EmptyState, PageHeader, Section } from '../components';
import { routeByPath } from '../routes';
import { useLibrary, type SessionMeta } from '../library';
import { useSessionStore } from '../state/session';

export default function SessoesPage() {
  const r = routeByPath('/')!;
  const nav = useNavigate();
  const { lib, version, bump } = useLibrary();
  const openFile = useSessionStore(s => s.openFile);
  const openDemo = useSessionStore(s => s.openDemo);
  const openFromLibrary = useSessionStore(s => s.openFromLibrary);
  const loading = useSessionStore(s => s.status === 'loading');
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [list, setList] = useState<SessionMeta[]>([]);

  useEffect(() => {
    if (!lib) return;
    let alive = true;
    lib.listSessions().then(l => { if (alive) setList(l); }).catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, [lib, version]);

  const open = async (f: File | undefined) => {
    if (!f) return;
    const ok = await openFile(f, { saveTo: lib });
    if (ok) { bump(); nav('/sessao'); }
  };

  return (
    <>
      <PageHeader title={r.label} subtitle={r.question} actions={(
        <>
          <Button leftSection={<IconFileUpload size={17} />} loading={loading} onClick={() => fileRef.current?.click()}>Abrir log</Button>
          <Button variant="default" leftSection={<IconFlask size={17} />} disabled={loading}
            onClick={async () => { if (await openDemo()) nav('/sessao'); }}>Dados de exemplo</Button>
        </>
      )} />
      <input ref={fileRef} type="file" accept=".csv,.txt,.log" hidden
        onChange={e => { void open(e.target.files?.[0]); e.target.value = ''; }} />

      <Section>
        <Paper
          withBorder radius="md" p="xl"
          style={{ borderStyle: 'dashed', borderWidth: 2, textAlign: 'center', background: over ? 'var(--bt-sel-row)' : undefined }}
          onDragOver={e => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); void open(e.dataTransfer.files[0]); }}
        >
          <Stack align="center" gap={6}>
            <IconUpload size={32} stroke={1.5} />
            <Text fw={600}>Arraste um log aqui</Text>
            <Text size="sm" c="dimmed">CSV do FT Manager (FT450) ou log CAN do BUSMASTER. O log abre e fica guardado na biblioteca.</Text>
          </Stack>
        </Paper>
      </Section>

      <Section title="Biblioteca" description="Sessões guardadas (versão provisória da lista).">
        {list.length ? (
          <DataTable<SessionMeta>
            rows={list} rowKey={m => m.id}
            onRowClick={m => { void openFromLibrary(m).then(ok => { if (ok) nav('/sessao'); }); }}
            columns={[
              { key: 'name', header: 'Sessão', render: m => m.name },
              { key: 'kind', header: 'Tipo', render: m => (m.kind === 'BUSMASTER' ? 'CAN' : 'FT') },
              { key: 'date', header: 'Data', render: m => (m.date || m.createdAt.slice(0, 10)) },
              {
                key: 'size', header: 'Tamanho', numeric: true,
                render: m => `${(m.size / 1048576).toFixed(1)} MB`,
              },
            ]}
          />
        ) : (
          <EmptyState icon={IconFolderOpen} title="Nenhuma sessão guardada"
            description="Abra um log (botão acima ou arrastando) ou use os dados de exemplo." />
        )}
      </Section>
    </>
  );
}
