/* Estado das páginas que precisam de uma sessão aberta (needsSession), igual em todas:
 * enquanto abre, o aviso de carregando; sem sessão, o que a página mostra e os três caminhos
 * (dados de exemplo, abrir um arquivo sem salvar, ou escolher um log da biblioteca). */
import { useRef, type ReactNode } from 'react';
import { Alert, Button, Group, Loader, Paper, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconFileSearch, IconFlask, IconFolderOpen, type Icon } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { useSessionStore } from '../state/session';
import { BrandHero } from '../brand';

export interface NoSessionStateProps {
  /** o que a página mostra / precisa (uma ou duas frases) */
  description?: ReactNode;
  /** ignorado: a faixa com a foto do carro substituiu o ícone */
  icon?: Icon;
  title?: ReactNode;
}

export function NoSessionState({ description, title = 'Nenhuma sessão aberta' }: NoSessionStateProps) {
  const status = useSessionStore(s => s.status);
  const loadingText = useSessionStore(s => s.loadingText);
  const error = useSessionStore(s => s.error);
  const clearError = useSessionStore(s => s.clearError);
  const openDemo = useSessionStore(s => s.openDemo);
  const openFile = useSessionStore(s => s.openFile);
  const fileRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  if (status === 'loading') {
    return (
      <Paper withBorder radius="md" p={48} className="bt-empty">
        <Stack align="center" gap="sm"><Loader /><Text c="dimmed">{loadingText || 'Abrindo…'}</Text></Stack>
      </Paper>
    );
  }
  return (
    <>
      {/* o log que não abriu: o motivo fica na página (o aviso do canto some sozinho) */}
      {status === 'error' && error && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={20} />} title="Não consegui abrir o log" mb="lg"
          withCloseButton closeButtonLabel="Fechar o aviso" onClose={clearError}>
          <Text>{error}</Text>
          <Text size="sm" c="dimmed" mt={6}>
            O app lê o CSV exportado pelo FT Manager (FT450) e o log do BUSMASTER (.txt/.log). Confira se o arquivo é um desses
            e se ele abre num editor de texto.
          </Text>
        </Alert>
      )}
      <BrandHero
        compact
        title={title}
        subtitle={description ?? 'Abra um log da FT450 ou do BUSMASTER, escolha um da biblioteca na página Sessões, ou carregue os dados de exemplo para ver como fica.'}
      >
        <Group gap="sm">
          <Button size="md" leftSection={<IconFlask size={18} />} onClick={() => { void openDemo(); }}>Dados de exemplo</Button>
          <Button size="md" variant="white" color="dark" leftSection={<IconFileSearch size={18} />} onClick={() => fileRef.current?.click()}
            title="Abre um CSV do FT Manager ou um log do BUSMASTER só para analisar (não guarda na biblioteca)">
            Abrir arquivo…
          </Button>
          <Button size="md" variant="white" color="dark" leftSection={<IconFolderOpen size={18} />} onClick={() => nav('/')}>Sessões da biblioteca</Button>
        </Group>
      </BrandHero>
      <input
        ref={fileRef} type="file" accept=".csv,.txt,.log" hidden
        onChange={e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void openFile(f); }}
      />
    </>
  );
}
