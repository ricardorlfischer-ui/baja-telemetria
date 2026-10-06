/* Dados da sessão (editáveis quando ela veio da biblioteca) e as anotações no tempo
 * (listComments/addComment da biblioteca): "anotar neste instante" grava o tempo do cursor;
 * clicar numa anotação leva o cursor até ela. */
import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon, Alert, Button, Checkbox, Group, Loader, Paper, Stack, Text, Textarea, Tooltip, UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceFloppy, IconMessagePlus, IconNote, IconPlayerTrackNext, IconTrash } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { computeSession, fmtTime, type SessionContext } from '@baja/core';
import type { Comment, SessionMeta } from '../../library';
import { useLibrary } from '../../library';
import { useCursorTime, useSessionStore, type SessionSource } from '../../state/session';
import { useSaveOpenSession } from '../../state/useSaveOpenSession';
import { useProfiles } from '../../state/profiles';
import { trySummary } from '../../state/librarySave';
import { MetaFields } from '../sessoes/MetaFields';
import { configFor, draftOf, fmtIso, msgOf, patchOf, type MetaDraft } from '../sessoes/meta';

/* ---------------------------------------------------------------- dados da sessão */
export function SessionData({ source, ctx }: { source: SessionSource; ctx: SessionContext }) {
  const nav = useNavigate();
  const { lib, user, mode, bump, version } = useLibrary();
  const id = source.type === 'library' || source.libraryId ? source.libraryId : undefined;
  const [meta, setMeta] = useState<SessionMeta | null>(source.meta ?? null);
  const [draft, setDraft] = useState<MetaDraft>(() => draftOf(source.meta));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [all, setAll] = useState<SessionMeta[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const saver = useSaveOpenSession();

  /* dados atuais da biblioteca (podem ter mudado desde que a sessão abriu) */
  useEffect(() => {
    if (!lib || !id) return;
    let alive = true;
    lib.getSession(id).then(m => {
      if (!alive) return;
      setMeta(m); setErr(null);
      useSessionStore.getState().setSourceMeta(m);
      if (!dirty) setDraft(draftOf(m));
    }).catch(e => { if (alive) setErr(msgOf(e)); });
    lib.listSessions().then(l => { if (alive) setAll(l); }).catch(() => { /* só sugestões */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib, id, version]);

  const drivers = useMemo(() => [...new Set(all.map(m => m.driver).filter((d): d is string => !!d))], [all]);
  const tags = useMemo(() => [...new Set(all.flatMap(m => m.tags || []))], [all]);

  if (!id) {
    return (
      <Paper withBorder radius="md" p="lg">
        <Stack gap="sm">
          <Text fw={600} size="md">{source.type === 'demo' ? 'Sessão de exemplo' : 'Esta sessão não está na biblioteca'}</Text>
          <Text c="dimmed">
            {source.type === 'demo'
              ? 'Os dados de exemplo são simulados e não ficam guardados: não há data, piloto nem anotações para editar.'
              : saver.canSave
                ? `“${source.name}” foi aberta sem salvar. Guarde na biblioteca para editar data, pista, carro, piloto, etiquetas e anotações.`
                : `“${source.name}” foi aberta sem salvar. Para guardar com data, pista, carro, piloto, etiquetas e anotações, envie o arquivo na página Sessões.`}
          </Text>
          {saver.canSave
            ? <Button variant="light" w="fit-content" loading={saver.saving} onClick={() => { void saver.save(); }}>Guardar na biblioteca</Button>
            : <Button variant="light" w="fit-content" onClick={() => nav('/')}>Ir para Sessões</Button>}
        </Stack>
      </Paper>
    );
  }
  if (err && !meta) return <Alert color="red" variant="light" title="Não consegui ler os dados da sessão">{err}</Alert>;
  if (!meta) return <Group gap="sm"><Loader size="sm" /><Text c="dimmed">Carregando…</Text></Group>;

  const local = mode === 'local';
  const canEdit = local || (!!user && (user.role === 'admin' || (user.role === 'member' && meta.uploadedById === user.id)));

  const save = async () => {
    if (!lib) return;
    setSaving(true);
    try {
      const patch = patchOf(draft);
      const carChanged = (draft.carId || null) !== (meta.carId || null);
      const trackChanged = (draft.trackId || null) !== (meta.trackId || null);
      /* local: refaz o resumo guardado com o carro/pista novos (o servidor recalcula sozinho) */
      if (local && (carChanged || trackChanged)) {
        const s = trySummary(computeSession(ctx.S, configFor(draft.carId, draft.trackId), {}));
        if (s) patch.summary = s;
      }
      const m = await lib.updateSession(meta.id, patch);
      setMeta(m); setDraft(draftOf(m)); setDirty(false);
      useSessionStore.getState().setSourceMeta(m);   /* nome e dados no cabeçalho e nas outras páginas */
      bump();
      /* as contas desta tela passam a usar o carro/pista escolhidos (como ao abrir da biblioteca) */
      const P = useProfiles.getState();
      if (carChanged && draft.carId && P.cars.some(c => c.id === draft.carId)) P.setActiveCar(draft.carId);
      if (trackChanged && draft.trackId && P.tracks.some(t => t.id === draft.trackId)) P.setActiveTrack(draft.trackId);
      notifications.show({ color: 'green', title: 'Dados da sessão salvos', message: m.name });
    } catch (e) {
      notifications.show({ color: 'red', title: 'Não consegui salvar', message: msgOf(e) });
    } finally { setSaving(false); }
  };

  return (
    <Paper withBorder radius="md" p="lg">
      <Stack gap="md">
        {err && <Alert color="red" variant="light" title="Não consegui ler os dados atuais da sessão">{err}</Alert>}
        <Text size="sm" c="dimmed">
          Arquivo {meta.fileName}{meta.uploadedBy ? ` · enviado por ${meta.uploadedBy}` : ''} em {fmtIso(meta.createdAt)}
          {!canEdit ? ' · só quem enviou (ou um administrador) pode editar' : ''}
        </Text>
        <MetaFields value={draft} onChange={p => { setDraft(d => ({ ...d, ...p })); setDirty(true); }}
          drivers={drivers} tags={tags} withName disabled={!canEdit || saving} />
        {(draft.carId || null) !== (meta.carId || null) || (draft.trackId || null) !== (meta.trackId || null) ? (
          <Text size="sm" c="dimmed">Ao salvar, as contas desta sessão passam a usar o carro e a pista escolhidos.</Text>
        ) : null}
        <Group justify="flex-end" gap="sm">
          {dirty && <Button variant="default" disabled={saving} onClick={() => { setDraft(draftOf(meta)); setDirty(false); }}>Desfazer</Button>}
          <Button leftSection={<IconDeviceFloppy size={17} />} disabled={!dirty || !canEdit} loading={saving} onClick={() => { void save(); }}>
            Salvar dados
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

/* ---------------------------------------------------------------- anotações */
/** "neste instante: 1:23.45 (volta 2)" — o único pedaço das anotações que segue o cursor
 *  (~10×/s no play). */
function CursorStamp({ laps }: { laps: SessionContext['laps'] }) {
  const cursor = useCursorTime(100);
  const lap = laps.find(l => cursor >= l.t0 && cursor <= l.t1);
  return <>neste instante: <span className="bt-ss-time">{fmtTime(cursor)}</span>{lap ? ` (volta ${lap.n})` : ''}</>;
}

export function Comments({ source, ctx }: { source: SessionSource; ctx: SessionContext }) {
  const { lib, user, mode } = useLibrary();
  const seek = useSessionStore(s => s.seek);
  /* o cursor muda 60×/s no play: só o rótulo "neste instante" (CursorStamp) acompanha; a lista e
   * o campo de texto não re-renderizam com ele. Ao gravar, vale o cursor daquele momento. */
  const id = source.libraryId;
  const [list, setList] = useState<Comment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [atCursor, setAtCursor] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!lib || !id || !lib.listComments) { setList([]); return; }
    let alive = true;
    lib.listComments(id).then(l => { if (alive) { setList(l); setErr(null); } }).catch(e => { if (alive) { setList([]); setErr(msgOf(e)); } });
    return () => { alive = false; };
  }, [lib, id]);

  const sorted = useMemo(() => [...(list ?? [])].sort((a, b) => {
    const ta = a.t ?? Infinity, tb = b.t ?? Infinity;
    return ta - tb || a.createdAt.localeCompare(b.createdAt);
  }), [list]);

  if (!id) {
    return (
      <Paper withBorder radius="md" p="lg">
        <Text c="dimmed">As anotações ficam guardadas com a sessão na biblioteca. Guarde o log na página Sessões para anotar instantes (ex.: “batida no fim de curso aqui”, “CVT patinando”).</Text>
      </Paper>
    );
  }
  if (!lib?.addComment) return <Text c="dimmed">Esta biblioteca não guarda anotações.</Text>;
  const canWrite = mode === 'local' || (!!user && user.role !== 'viewer');

  const lapAt = (t: number) => ctx.laps.find(l => t >= l.t0 && t <= l.t1);

  const add = async () => {
    if (!text.trim() || !lib.addComment) return;
    setBusy(true);
    try {
      const c = await lib.addComment(id, { t: atCursor ? useSessionStore.getState().cursor : null, text: text.trim() });
      setList(l => [...(l ?? []), c]);
      setText('');
    } catch (e) {
      notifications.show({ color: 'red', title: 'Não consegui guardar a anotação', message: msgOf(e) });
    } finally { setBusy(false); }
  };
  const del = async (c: Comment) => {
    if (!lib.deleteComment) return;
    try {
      await lib.deleteComment(c.id);
      setList(l => (l ?? []).filter(x => x.id !== c.id));
    } catch (e) {
      notifications.show({ color: 'red', title: 'Não consegui apagar a anotação', message: msgOf(e) });
    }
  };


  return (
    <Stack gap="md">
      {canWrite && (
        <Paper withBorder radius="md" p="lg">
          <Stack gap="sm">
            <Textarea size="md" autosize minRows={2} maxRows={6} placeholder="O que aconteceu aqui? (ex.: bateu no fim de curso no pouso do salto)"
              value={text} onChange={e => setText(e.currentTarget.value)} disabled={busy}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void add(); } }} />
            <Group justify="space-between" wrap="wrap" gap="sm">
              <Checkbox size="md" checked={atCursor} onChange={e => setAtCursor(e.currentTarget.checked)}
                label={<CursorStamp laps={ctx.laps} />} />
              <Button leftSection={<IconMessagePlus size={17} />} loading={busy} disabled={!text.trim()} onClick={() => { void add(); }}>
                {atCursor ? 'Anotar neste instante' : 'Anotar (sem instante)'}
              </Button>
            </Group>
            <Text size="xs" c="dimmed">Mova o cursor com o play, as setas ou clicando no mapa; Ctrl+Enter grava.</Text>
          </Stack>
        </Paper>
      )}
      {err && <Alert color="red" variant="light">{err}</Alert>}
      {list === null ? (
        <Group gap="sm"><Loader size="sm" /><Text c="dimmed">Carregando as anotações…</Text></Group>
      ) : sorted.length === 0 ? (
        <Group gap="sm" c="dimmed"><IconNote size={20} /><Text c="dimmed">Nenhuma anotação ainda.</Text></Group>
      ) : (
        <Stack gap="xs">
          {sorted.map(c => {
            const has = c.t !== null && c.t !== undefined && isFinite(c.t);
            const lp = has ? lapAt(c.t!) : undefined;
            const mine = mode === 'local' || (!!user && (user.role === 'admin' || c.userId === user.id));
            return (
              <Group key={c.id} wrap="nowrap" gap="xs" align="stretch">
                <UnstyledButton className="bt-ss-item" data-clickable={has ? '' : undefined} style={{ flex: 1, minWidth: 0 }}
                  onClick={has ? () => seek(c.t!) : undefined} title={has ? 'Ir a este instante' : undefined}>
                  <Group gap="md" wrap="nowrap" align="flex-start">
                    <Stack gap={0} w={86} style={{ flexShrink: 0 }}>
                      {has ? (
                        <>
                          <Group gap={4} wrap="nowrap"><IconPlayerTrackNext size={14} /><span className="bt-ss-time">{fmtTime(c.t!)}</span></Group>
                          {lp && <Text size="xs" c="dimmed">volta {lp.n}</Text>}
                        </>
                      ) : <Text size="sm" c="dimmed">geral</Text>}
                    </Stack>
                    <Stack gap={2} style={{ minWidth: 0 }}>
                      <Text size="md" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.text}</Text>
                      <Text size="xs" c="dimmed">{c.userName ? `${c.userName} · ` : ''}{fmtIso(c.createdAt)}</Text>
                    </Stack>
                  </Group>
                </UnstyledButton>
                {mine && lib.deleteComment && (
                  <Tooltip label="Apagar anotação">
                    <ActionIcon variant="subtle" color="gray" size="lg" mt={8} onClick={() => { void del(c); }} aria-label="Apagar anotação"><IconTrash size={17} /></ActionIcon>
                  </Tooltip>
                )}
              </Group>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
