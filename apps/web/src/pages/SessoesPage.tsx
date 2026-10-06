/* Página / — Sessões: a biblioteca de logs da equipe (docs/ARQUITETURA.md 4.2 e 4.4).
 * Enviar vários logs de uma vez (com data, pista, carro, piloto, etiquetas e notas), a lista
 * com busca e filtros, os números principais de cada sessão (resumo do core, com o card de
 * explicação de cada um) e as ações: abrir, editar dados, baixar o log original, apagar.
 * No modo local tudo fica no IndexedDB deste navegador; no servidor, na biblioteca da equipe. */
import './sessoes/sessoes.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Anchor, Box, Button, Group, Loader, Modal, Paper, Select, SimpleGrid, Stack, Text, TextInput, ThemeIcon, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCloud, IconCloudOff, IconDatabase, IconFileSearch, IconFilterOff, IconFlask, IconFolderOpen, IconLogin,
  IconSearch, IconTrash, IconUpload,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { computeSession, parseLog } from '@baja/core';
import { PageHeader, Section } from '../components';
import { BrandHero } from '../brand';
import { routeByPath } from '../routes';
import { ApiError, useLibrary, type SessionMeta } from '../library';
import { useSessionStore } from '../state/session';
import { useProfiles } from '../state/profiles';
import { trySummary } from '../state/librarySave';
import { UploadPanel } from './sessoes/UploadPanel';
import { SessionCard } from './sessoes/SessionCard';
import { MetaFields } from './sessoes/MetaFields';
import { configFor, downloadLog, draftOf, msgOf, patchOf, type MetaDraft } from './sessoes/meta';

const sortKey = (m: SessionMeta) => m.date || m.createdAt;

export default function SessoesPage() {
  const r = routeByPath('/')!;
  const nav = useNavigate();
  const { lib, mode, user, remote, info, offline, loading: libLoading, version, bump } = useLibrary();
  const openFile = useSessionStore(s => s.openFile);
  const openDemo = useSessionStore(s => s.openDemo);
  const openFromLibrary = useSessionStore(s => s.openFromLibrary);
  const sessionLoading = useSessionStore(s => s.status === 'loading');
  const cars = useProfiles(s => s.cars);
  const tracks = useProfiles(s => s.tracks);
  const fileRef = useRef<HTMLInputElement>(null);

  const [list, setList] = useState<SessionMeta[] | null>(null);
  const [listError, setListError] = useState<{ msg: string; status: number } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SessionMeta | null>(null);
  const [editDraft, setEditDraft] = useState<MetaDraft>(() => draftOf(null));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<SessionMeta | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  /* filtros */
  const [q, setQ] = useState('');
  const [fTrack, setFTrack] = useState<string | null>(null);
  const [fCar, setFCar] = useState<string | null>(null);
  const [fTag, setFTag] = useState<string | null>(null);
  const [fDriver, setFDriver] = useState<string | null>(null);

  const local = mode === 'local';
  const loggedOut = mode === 'remote' && !user;

  useEffect(() => {
    if (!lib || libLoading) return;
    /* servidor sem ninguém conectado: nem pede a lista (seria 401); a tela mostra "entrar" */
    if (loggedOut) { setList([]); setListError(null); return; }
    let alive = true;
    setListError(null);
    lib.listSessions()
      .then(l => { if (alive) setList(l); })
      .catch(e => {
        if (!alive) return;
        setList([]);
        setListError({ msg: msgOf(e), status: e instanceof ApiError ? e.status : 0 });
      });
    return () => { alive = false; };
  }, [lib, version, user?.id, loggedOut, libLoading]);

  const all = useMemo(() => [...(list ?? [])].sort((a, b) => sortKey(b).localeCompare(sortKey(a))), [list]);
  const drivers = useMemo(() => [...new Set(all.map(m => m.driver).filter((d): d is string => !!d))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [all]);
  const tags = useMemo(() => [...new Set(all.flatMap(m => m.tags || []))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [all]);
  const trackName = (id?: string) => (id ? tracks.find(t => t.id === id)?.name : undefined);
  const carName = (id?: string) => (id ? cars.find(c => c.id === id)?.name : undefined);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter(m => {
      if (fTrack && m.trackId !== fTrack) return false;
      if (fCar && m.carId !== fCar) return false;
      if (fTag && !(m.tags || []).includes(fTag)) return false;
      if (fDriver && m.driver !== fDriver) return false;
      if (s) {
        const hay = [m.name, m.fileName, m.driver, m.notes, m.uploadedBy, ...(m.tags || []), trackName(m.trackId), carName(m.carId)]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, fTrack, fCar, fTag, fDriver, tracks, cars]);
  const filtering = !!(q.trim() || fTrack || fCar || fTag || fDriver);
  const clearFilters = () => { setQ(''); setFTrack(null); setFCar(null); setFTag(null); setFDriver(null); };

  /* permissões (servidor): leitor só lê; membro edita o que é seu; admin tudo */
  const canUpload = local || (!!user && user.role !== 'viewer');
  const canEdit = (m: SessionMeta) => local || (!!user && (user.role === 'admin' || (user.role === 'member' && m.uploadedById === user.id)));

  /* ------------------------------------------------------------ ações */
  const open = async (m: SessionMeta) => {
    setOpeningId(m.id);
    const ok = await openFromLibrary(m, lib);
    setOpeningId(null);
    if (ok) nav('/sessao');
  };
  const openId = (id: string) => {
    const m = all.find(x => x.id === id);
    if (m) void open(m);
    else if (lib) void lib.getSession(id).then(open).catch(e => notifications.show({ color: 'red', title: 'Não achei a sessão', message: msgOf(e) }));
  };

  const download = async (m: SessionMeta) => {
    if (!lib) return;
    try { await downloadLog(lib, m); } catch (e) { notifications.show({ color: 'red', title: 'Não consegui baixar o log', message: msgOf(e) }); }
  };

  const recompute = async (m: SessionMeta) => {
    if (!lib) return;
    setBusyId(m.id);
    try {
      if (remote && !local) {
        const n = await remote.recomputeSummary(m.id);
        if (n.summaryError) notifications.show({ color: 'yellow', title: 'O servidor recalculou, mas o resumo falhou', message: n.summaryError, autoClose: 8000 });
      }
      else {
        const text = await lib.getSessionText(m.id);
        const S = parseLog(text, m.fileName || m.name);
        const summary = trySummary(computeSession(S, configFor(m.carId, m.trackId), {}));
        if (!summary) throw new Error('a conta do resumo falhou neste log (veja o console)');
        await lib.updateSession(m.id, { summary });
      }
      bump();
    } catch (e) {
      notifications.show({ color: 'red', title: 'Não consegui calcular o resumo', message: msgOf(e) });
    } finally { setBusyId(null); }
  };

  const startEdit = (m: SessionMeta) => { setEditDraft(draftOf(m)); setEditing(m); };
  const saveEdit = async () => {
    if (!lib || !editing) return;
    setSaving(true);
    try {
      const upd = await lib.updateSession(editing.id, patchOf(editDraft));
      useSessionStore.getState().setSourceMeta(upd);   /* se for a sessão aberta */
      /* local: carro/pista mudaram → refaz o resumo guardado com eles (o servidor faz sozinho) */
      const profChanged = (editDraft.carId || null) !== (editing.carId || null) || (editDraft.trackId || null) !== (editing.trackId || null);
      if (local && profChanged) await recompute(upd);
      bump();
      setEditing(null);
      notifications.show({ color: 'green', title: 'Dados da sessão salvos', message: editDraft.name || editing.name });
    } catch (e) {
      notifications.show({ color: 'red', title: 'Não consegui salvar', message: msgOf(e) });
    } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    if (!lib || !deleting) return;
    setDelBusy(true);
    try {
      await lib.deleteSession(deleting.id);
      /* a sessão aberta continua na memória até fechar, mas deixa de ser da biblioteca */
      useSessionStore.getState().detachFromLibrary(deleting.id);
      bump();
      notifications.show({ title: 'Sessão apagada', message: deleting.name });
      setDeleting(null);
    } catch (e) {
      notifications.show({ color: 'red', title: 'Não consegui apagar', message: msgOf(e) });
    } finally { setDelBusy(false); }
  };

  const demo = async () => { if (await openDemo()) nav('/sessao'); };
  const openNoSave = async (f: File | undefined) => {
    if (!f) return;
    if (await openFile(f)) nav('/sessao');
  };

  /* ------------------------------------------------------------ tela */
  return (
    <>
      <Box mb="xl">
        <BrandHero compact subtitle="Os logs do carro em gráficos e números para projetar o carro do ano que vem. Envie, filtre e abra as sessões da equipe aqui.">
          <Button size="md" leftSection={<IconFlask size={18} />} disabled={sessionLoading} onClick={() => { void demo(); }}>
            Dados de exemplo
          </Button>
          <Button size="md" variant="white" color="dark" leftSection={<IconFileSearch size={18} />} loading={sessionLoading && !openingId}
            onClick={() => fileRef.current?.click()} title="Só analisa: o arquivo não vai para a biblioteca">
            Abrir arquivo sem salvar
          </Button>
        </BrandHero>
      </Box>
      <PageHeader title={r.label} subtitle={r.question} />
      <input ref={fileRef} type="file" accept=".csv,.txt,.log" hidden
        onChange={e => { void openNoSave(e.target.files?.[0]); e.target.value = ''; }} />

      <ModeBanner mode={mode} loading={libLoading} offline={offline} serverName={info?.name} userName={user?.name}
        role={user?.role} onLogin={() => nav('/login', { state: { from: '/' } })} onPrefs={() => nav('/config')} />

      <Section title="Enviar logs" description="Cada arquivo vira uma sessão da biblioteca, com o resumo dos números (voltas, velocidade, suspensão, CVT) já calculado.">
        {lib ? (
          <UploadPanel lib={lib} remote={remote} existing={all} drivers={drivers} tags={tags}
            canUpload={canUpload && !offline}
            disabledReason={offline ? 'O servidor da equipe não respondeu. Confira o endereço em Preferências ou use “Abrir arquivo sem salvar”.'
              : loggedOut ? 'Entre no servidor da equipe para enviar logs (ou use “Abrir arquivo sem salvar” para só analisar).'
                : 'Seu papel no servidor é “leitor”: você vê e abre as sessões, mas não envia. Peça a um administrador para mudar.'}
            onSaved={() => bump()} onOpen={m => { void open(m); }} onOpenId={openId} />
        ) : (
          <Group gap="sm" c="dimmed"><Loader size="sm" /> <Text>Preparando a biblioteca…</Text></Group>
        )}
      </Section>

      <Section
        title={local ? 'Sessões neste navegador' : 'Sessões da equipe'}
        description={list && all.length ? `${filtering ? `${shown.length} de ${all.length}` : all.length} ${all.length === 1 ? 'sessão' : 'sessões'} · mais recentes primeiro. Clique num número para ver de quais sensores ele saiu.` : undefined}
      >
        {list === null ? (
          <Group gap="sm" py="xl" justify="center"><Loader /> <Text c="dimmed">Carregando as sessões…</Text></Group>
        ) : listError || loggedOut ? (
          loggedOut || listError?.status === 401 ? (
            <Alert color="blue" variant="light" icon={<IconLogin size={20} />} title="Entre para ver as sessões da equipe">
              <Stack gap="sm">
                <Text>As sessões ficam no servidor da equipe{info?.name ? ` (${info.name})` : ''}. Entre com a sua conta ou um convite.</Text>
                <Button w="fit-content" leftSection={<IconLogin size={17} />} onClick={() => nav('/login', { state: { from: '/' } })}>Entrar</Button>
              </Stack>
            </Alert>
          ) : (
            <Alert color="red" variant="light" title="Não consegui carregar as sessões">
              <Stack gap="sm">
                <Text>{listError?.msg}</Text>
                <Button w="fit-content" variant="default" onClick={() => bump()}>Tentar de novo</Button>
              </Stack>
            </Alert>
          )
        ) : all.length === 0 ? (
          <EmptyLibrary local={local} onDemo={() => { void demo(); }} onOpenFile={() => fileRef.current?.click()} />
        ) : (
          <Stack gap="lg">
            <Paper withBorder radius="md" p="md">
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 5 }} spacing="sm">
                <TextInput size="md" leftSection={<IconSearch size={17} />} placeholder="buscar (nome, notas, etiquetas…)" aria-label="Buscar"
                  value={q} onChange={e => setQ(e.currentTarget.value)} />
                <Select size="md" placeholder="Pista" aria-label="Filtrar por pista" clearable searchable
                  data={tracks.filter(t => all.some(m => m.trackId === t.id)).map(t => ({ value: t.id, label: t.name }))}
                  value={fTrack} onChange={setFTrack} nothingFoundMessage="nenhuma sessão com pista" />
                <Select size="md" placeholder="Carro" aria-label="Filtrar por carro" clearable searchable
                  data={cars.filter(c => all.some(m => m.carId === c.id)).map(c => ({ value: c.id, label: c.name }))}
                  value={fCar} onChange={setFCar} nothingFoundMessage="nenhuma sessão com carro" />
                <Select size="md" placeholder="Piloto" aria-label="Filtrar por piloto" clearable searchable data={drivers}
                  value={fDriver} onChange={setFDriver} nothingFoundMessage="nenhum piloto informado" />
                <Select size="md" placeholder="Etiqueta" aria-label="Filtrar por etiqueta" clearable searchable data={tags}
                  value={fTag} onChange={setFTag} nothingFoundMessage="nenhuma etiqueta" />
              </SimpleGrid>
              {filtering && (
                <Group justify="space-between" mt="sm">
                  <Text size="sm" c="dimmed">{shown.length} de {all.length} sessões</Text>
                  <Button size="sm" variant="subtle" leftSection={<IconFilterOff size={16} />} onClick={clearFilters}>Limpar filtros</Button>
                </Group>
              )}
            </Paper>

            {shown.length === 0 ? (
              <Paper withBorder radius="md" p="xl">
                <Stack align="center" gap="sm">
                  <Text size="lg" fw={600}>Nenhuma sessão com esses filtros</Text>
                  <Button variant="default" leftSection={<IconFilterOff size={16} />} onClick={clearFilters}>Limpar filtros</Button>
                </Stack>
              </Paper>
            ) : (
              <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg" verticalSpacing="lg">
                {shown.map(m => (
                  <SessionCard key={m.id} m={m} trackName={trackName(m.trackId)} carName={carName(m.carId)} local={local}
                    canEdit={canEdit(m)} canRecompute={canUpload} opening={openingId === m.id} busy={busyId === m.id}
                    onOpen={() => { void open(m); }} onEdit={() => startEdit(m)} onDownload={() => { void download(m); }}
                    onDelete={() => setDeleting(m)} onRecompute={() => { void recompute(m); }} />
                ))}
              </SimpleGrid>
            )}
          </Stack>
        )}
      </Section>

      {/* editar dados */}
      <Modal opened={!!editing} onClose={() => !saving && setEditing(null)} title="Dados da sessão" size="xl" centered styles={{ title: { fontSize: 20, fontWeight: 650 } }}>
        {editing && (
          <Stack gap="md">
            <Text size="sm" c="dimmed">Arquivo: {editing.fileName}</Text>
            <MetaFields value={editDraft} onChange={p => setEditDraft(d => ({ ...d, ...p }))} drivers={drivers} tags={tags} withName disabled={saving} />
            {local && (editDraft.carId !== (editing.carId || null) || editDraft.trackId !== (editing.trackId || null)) && editing.summary && (
              <Text size="sm" c="dimmed">Mudou o carro ou a pista: ao salvar, o resumo desta sessão é calculado de novo com eles.</Text>
            )}
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button>
              <Button onClick={() => { void saveEdit(); }} loading={saving}>Salvar</Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* apagar */}
      <Modal opened={!!deleting} onClose={() => !delBusy && setDeleting(null)} title="Apagar sessão?" centered size="md" styles={{ title: { fontSize: 20, fontWeight: 650 } }}>
        {deleting && (
          <Stack gap="md">
            <Text>
              “<b>{deleting.name}</b>” será apagada {local ? 'deste navegador' : 'do servidor da equipe'}: o log, o resumo e as anotações.
              Não dá para desfazer.
            </Text>
            <Text size="sm" c="dimmed">Se quiser guardar uma cópia, baixe o log original antes.</Text>
            <Group justify="space-between" gap="sm">
              <Button variant="subtle" onClick={() => { void download(deleting); }} disabled={delBusy}>Baixar o log</Button>
              <Group gap="sm">
                <Button variant="default" onClick={() => setDeleting(null)} disabled={delBusy}>Cancelar</Button>
                <Button color="red" leftSection={<IconTrash size={16} />} loading={delBusy} onClick={() => { void confirmDelete(); }}>Apagar</Button>
              </Group>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- modo da biblioteca */
function ModeBanner({ mode, loading, offline, serverName, userName, role, onLogin, onPrefs }: {
  mode: 'local' | 'remote' | null; loading: boolean; offline: boolean; serverName?: string; userName?: string; role?: string;
  onLogin: () => void; onPrefs: () => void;
}) {
  if (loading || !mode) return null;
  if (mode === 'local') {
    return (
      <Alert variant="light" color="gray" radius="md" icon={<IconDatabase size={22} />} mb="xl"
        title={<Text fw={650} size="md">Biblioteca local · neste navegador</Text>}>
        <Group justify="space-between" gap="sm" wrap="wrap">
          <Text size="md" maw={760} style={{ flex: '1 1 240px', minWidth: 0 }}>
            As sessões ficam guardadas só neste navegador (e somem se os dados do site forem apagados). Para dividir com a equipe,
            ligue o servidor da equipe em Preferências.
          </Text>
          <Button variant="default" onClick={onPrefs}>Preferências</Button>
        </Group>
      </Alert>
    );
  }
  if (offline) {
    return (
      <Alert variant="light" color="red" radius="md" icon={<IconCloudOff size={22} />} mb="xl" title={<Text fw={650} size="md">Servidor da equipe fora do ar</Text>}>
        <Group justify="space-between" gap="sm" wrap="wrap">
          <Text size="md" style={{ flex: '1 1 240px', minWidth: 0 }}>O servidor salvo em Preferências não respondeu. Dá para abrir um arquivo sem salvar enquanto isso.</Text>
          <Button variant="default" onClick={onPrefs}>Preferências</Button>
        </Group>
      </Alert>
    );
  }
  return (
    <Alert variant="light" color="blue" radius="md" icon={<IconCloud size={22} />} mb="xl"
      title={<Text fw={650} size="md">Servidor da equipe{serverName ? ` · ${serverName}` : ''}</Text>}>
      <Group justify="space-between" gap="sm" wrap="wrap">
        <Text size="md" style={{ flex: '1 1 240px', minWidth: 0 }}>
          {userName
            ? <>Conectado como <b>{userName}</b>{role === 'viewer' ? ' (leitor: vê e abre, não envia)' : role === 'admin' ? ' (administrador)' : ''}. As sessões ficam no servidor, para toda a equipe.</>
            : 'Entre para ver e enviar as sessões da equipe.'}
        </Text>
        {!userName && <Button leftSection={<IconLogin size={17} />} onClick={onLogin}>Entrar</Button>}
      </Group>
    </Alert>
  );
}

/* ---------------------------------------------------------------- biblioteca vazia */
function EmptyLibrary({ local, onDemo, onOpenFile }: { local: boolean; onDemo: () => void; onOpenFile: () => void }) {
  const items = [
    {
      icon: IconUpload, title: 'Guarde os logs dos testes',
      text: `Arraste acima o CSV do FT Manager ou o log do BUSMASTER. Cada teste vira uma sessão com data, pista, carro e piloto, ${local ? 'guardada neste navegador' : 'compartilhada com a equipe'}.`,
    },
    {
      icon: IconFlask, title: 'Veja como fica com o exemplo',
      text: 'Uma sessão simulada com GPS, amortecedores, roda e CVT mostra todas as páginas funcionando: mapa, voltas, suspensão, CVT e a ficha do carro.',
      action: <Button variant="light" leftSection={<IconFlask size={16} />} onClick={onDemo}>Dados de exemplo</Button>,
    },
    {
      icon: IconFolderOpen, title: 'Só quer olhar um arquivo?',
      text: 'Abra sem salvar: o log é analisado aqui no navegador e não vai para a biblioteca.',
      action: <Button variant="light" leftSection={<IconFileSearch size={16} />} onClick={onOpenFile}>Abrir arquivo sem salvar</Button>,
    },
  ];
  return (
    <Paper withBorder radius="md" p="xl">
      <Stack gap="lg">
        <div>
          <Title order={3}>Nenhuma sessão {local ? 'neste navegador' : 'na biblioteca da equipe'} ainda</Title>
          <Text c="dimmed" mt={4}>
            Com os logs guardados aqui dá para comparar testes, setups e pilotos ao longo da temporada e levar os números para o
            projeto do carro do ano que vem.
          </Text>
        </div>
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
          {items.map(it => (
            <Stack key={it.title} gap="sm" align="flex-start">
              <ThemeIcon size={44} radius="md" variant="light"><it.icon size={24} /></ThemeIcon>
              <Text fw={650} size="lg">{it.title}</Text>
              <Text c="dimmed">{it.text}</Text>
              {it.action}
            </Stack>
          ))}
        </SimpleGrid>
        {!local && <Text size="sm" c="dimmed">Dica: <Anchor href="#/comparar">Comparar sessões</Anchor> usa os resumos guardados aqui.</Text>}
      </Stack>
    </Paper>
  );
}
