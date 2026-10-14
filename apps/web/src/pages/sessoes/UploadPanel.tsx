/* Área de enviar logs: arrastar vários arquivos de uma vez, formulário rápido (pista, carro,
 * piloto, etiquetas, notas para todos; data por arquivo, tirada do nome da FT ou do cabeçalho
 * do BUSMASTER) e a fila com o progresso de cada arquivo. Cada arquivo vira uma sessão ou,
 * com "Juntar numa sessão só", os CSV da FT viram um log só (mergeLogs do core). */
import { useRef, useState } from 'react';
import {
  ActionIcon, Badge, Button, Group, Paper, Progress, Stack, Switch, Text, TextInput, ThemeIcon, Title, Tooltip,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle, IconArrowMerge, IconCalendar, IconCheck, IconClock, IconCopy, IconFileText, IconPlayerPlay, IconRefresh,
  IconUpload, IconX,
} from '@tabler/icons-react';
import type { Library, RemoteLibrary, SessionMeta } from '../../library';
import { useProfiles } from '../../state/profiles';
import { MetaFields } from './MetaFields';
import { guessDate, looksBinary, mergeLogs, mergeOrder } from '@baja/core';
import { lsGet, lsSet } from '../../state/prefs';
import { draftOf, fmtSize, joinDate, msgOf, splitDate, type MetaDraft } from './meta';
import { DuplicateError, saveLocal, uploadRemote, type UploadMeta, type UploadPhase } from './upload';

interface QueueItem {
  key: string;
  file: File;
  day: string;
  time: string;
  /** a data veio do nome/cabeçalho do arquivo */
  guessed: boolean;
  phase: UploadPhase;
  progress: number;
  error?: string;
  existingId?: string | null;
  meta?: SessionMeta;
  /** log juntado: nomes curtos dos arquivos que entraram, na ordem, e o nome da sessão */
  mergedFrom?: string[];
  mergedName?: string;
}

const OK_EXT = /\.(csv|txt|log)$/i;
const K_MERGE = 'baja:envio:juntar';

const PHASE_TEXT: Record<UploadPhase, string> = {
  pending: 'na fila',
  reading: 'lendo o arquivo…',
  analyzing: 'analisando no navegador (voltas, suspensão, resumo)…',
  saving: 'guardando na biblioteca…',
  uploading: 'enviando',
  server: 'o servidor está analisando o log…',
  done: 'guardado',
  duplicate: 'já está na biblioteca',
  error: 'erro',
  skipped: 'pulado',
};

export interface UploadPanelProps {
  lib: Library;
  remote: RemoteLibrary | null;
  existing: SessionMeta[];
  drivers: string[];
  tags: string[];
  /** false = sem permissão de enviar (leitor) ou sem login */
  canUpload: boolean;
  disabledReason?: string;
  /** uma sessão foi guardada (recarregar a lista) */
  onSaved: (m: SessionMeta) => void;
  onOpen: (m: SessionMeta) => void;
  /** abrir a sessão existente (duplicado) pelo id */
  onOpenId: (id: string) => void;
}

export function UploadPanel({ lib, remote, existing, drivers, tags, canUpload, disabledReason, onSaved, onOpen, onOpenId }: UploadPanelProps) {
  const activeCarId = useProfiles(s => s.activeCarId);
  const activeTrackId = useProfiles(s => s.activeTrackId);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [shared, setShared] = useState<MetaDraft>(() => ({ ...draftOf(null), carId: activeCarId, trackId: activeTrackId }));
  const [running, setRunning] = useState(false);
  /* juntar os logs da fila numa sessão só (lembra a escolha) */
  const [merge, setMerge] = useState(() => lsGet(K_MERGE) !== '0');
  const openRef = useRef<() => void>(null);
  const keyN = useRef(0);
  const local = lib.mode === 'local';
  /* modo "este computador" (servidor deste PC, sem contas) */
  const pc = !!remote?.localMode;

  const upd = (key: string, patch: Partial<QueueItem>) => setQueue(q => q.map(x => (x.key === key ? { ...x, ...patch } : x)));

  const addFiles = async (files: File[]) => {
    const ok = files.filter(f => OK_EXT.test(f.name));
    const bad = files.filter(f => !OK_EXT.test(f.name));
    if (bad.length) {
      const ftml = bad.some(f => /\.ftml$/i.test(f.name));
      notifications.show({
        color: 'yellow', title: 'Arquivo não aceito',
        message: `${bad.map(f => f.name).join(', ')}: use o CSV do FT Manager (.csv) ou o log do BUSMASTER (.txt / .log).` +
          (ftml ? ' O .ftml é o formato próprio do FT Manager: abra-o no FT Manager e exporte em CSV.' : ''),
      });
    }
    if (!ok.length) return;
    const read = await Promise.all(ok.map(async f => {
      let head = '';
      try { head = await f.slice(0, 2000).text(); } catch { /* sem cabeçalho */ }
      return { f, head };
    }));
    /* binário com nome de .csv (o .ftml renomeado): avisa já, em vez de errar no envio */
    const bin = read.filter(x => looksBinary(x.head));
    if (bin.length) {
      notifications.show({
        color: 'yellow', title: 'Arquivo binário, não CSV', autoClose: 12_000,
        message: `${bin.map(x => x.f.name).join(', ')}: parece o .ftml do FT Manager com outro nome. Abra no FT Manager e exporte em CSV (com todos os canais: RPM, GPS, tensão da bateria...).`,
      });
    }
    const good = read.filter(x => !looksBinary(x.head));
    if (!good.length) return;
    if (!queue.length) setShared(s => ({ ...s, carId: s.carId ?? activeCarId, trackId: s.trackId ?? activeTrackId }));
    const items: QueueItem[] = good.map(({ f, head }) => {
      const g = guessDate(f.name, head);
      const { day, time } = splitDate(g);
      return { key: `q${++keyN.current}`, file: f, day, time, guessed: !!g, phase: 'pending' as UploadPhase, progress: 0 };
    });
    setQueue(q => [...q.filter(x => x.phase !== 'done' && x.phase !== 'skipped'), ...items]);
  };

  const metaFor = (it: QueueItem, allowDuplicate = false): UploadMeta => {
    const date = joinDate(it.day, it.time);
    return {
      ...(it.mergedName ? { name: it.mergedName } : {}),
      ...(date ? { date } : {}),
      ...(shared.trackId ? { trackId: shared.trackId } : {}),
      ...(shared.carId ? { carId: shared.carId } : {}),
      ...(shared.driver.trim() ? { driver: shared.driver.trim() } : {}),
      ...(shared.tags.length ? { tags: shared.tags } : {}),
      ...(shared.notes.trim() ? { notes: shared.notes.trim() } : {}),
      ...(allowDuplicate ? { allowDuplicate: true } : {}),
    };
  };

  /* um arquivo; devolve a sessão guardada (ou null) */
  const sendOne = async (it: QueueItem, allowDuplicate = false, known: SessionMeta[] = existing): Promise<SessionMeta | null> => {
    const onPhase = (phase: UploadPhase, progress?: number) => upd(it.key, { phase, ...(progress !== undefined ? { progress } : {}), error: undefined });
    try {
      const meta = metaFor(it, allowDuplicate);
      const m = local || !remote
        ? await saveLocal(lib, it.file, meta, known, onPhase)
        : await uploadRemote(remote, it.file, meta, onPhase);
      upd(it.key, { phase: 'done', progress: 1, meta: m });
      onSaved(m);
      return m;
    } catch (e) {
      if (e instanceof DuplicateError) upd(it.key, { phase: 'duplicate', error: e.message, existingId: e.existingId });
      else upd(it.key, { phase: 'error', error: msgOf(e) });
      return null;
    }
  };

  /* junta os arquivos pendentes num log só e põe ele no lugar deles na fila; null = erro */
  const mergeQueue = async (items: QueueItem[]): Promise<QueueItem | null> => {
    try {
      const inputs = await Promise.all(items.map(async it => ({ name: it.file.name, text: await it.file.text(), it })));
      const r = mergeLogs(inputs);
      const first = mergeOrder(inputs)[0].it;
      const file = new File([r.text], r.fileName, { type: 'text/csv' });
      const m: QueueItem = {
        key: `q${++keyN.current}`, file, day: first.day, time: first.time, guessed: first.guessed,
        phase: 'pending', progress: 0, mergedFrom: r.parts.map(p => p.label), mergedName: r.name,
      };
      const gone = new Set(items.map(x => x.key));
      setQueue(q => [...q.filter(x => !gone.has(x.key)), m]);
      return m;
    } catch (e) {
      notifications.show({ color: 'red', title: 'Não deu para juntar os logs', message: msgOf(e), autoClose: 12_000 });
      return null;
    }
  };

  const sendAll = async () => {
    setRunning(true);
    const known = [...existing];
    const waiting = queue.filter(x => (x.phase === 'pending' || x.phase === 'error') && !x.mergedFrom);
    if (merge && waiting.length >= 2) {
      const m = await mergeQueue(waiting);
      if (!m) { setRunning(false); return; }
      const saved = await sendOne(m, false, known);
      setRunning(false);
      if (saved) {
        notifications.show({
          color: 'green', title: `${m.mergedFrom!.length} logs juntados numa sessão`,
          message: `“${saved.name}” ${local ? 'guardada neste navegador.' : pc ? 'guardada na pasta deste computador.' : 'guardada no servidor da equipe.'}`,
        });
      }
      return;
    }
    let ok = 0;
    for (const it of queue) {
      if (it.phase !== 'pending' && it.phase !== 'error') continue;
      const m = await sendOne(it, false, known);
      if (m) { ok++; known.push(m); }
    }
    setRunning(false);
    if (ok) notifications.show({ color: 'green', title: ok === 1 ? 'Sessão guardada' : `${ok} sessões guardadas`, message: local ? 'Guardadas neste navegador.' : pc ? 'Guardadas na pasta deste computador.' : 'Guardadas no servidor da equipe.' });
  };

  const retry = async (it: QueueItem, allowDuplicate: boolean) => {
    setRunning(true);
    await sendOne(it, allowDuplicate);
    setRunning(false);
  };

  const pending = queue.filter(x => x.phase === 'pending' || x.phase === 'error').length;
  const mergeable = queue.filter(x => (x.phase === 'pending' || x.phase === 'error') && !x.mergedFrom).length;
  const willMerge = merge && mergeable >= 2;

  return (
    <Stack gap="md">
      <Dropzone
        onDrop={files => { void addFiles(files); }}
        openRef={openRef}
        multiple
        disabled={!canUpload || running}
        radius="md"
        className="bt-dropzone"
        style={{ borderWidth: 2 }}
      >
        <Group justify="center" gap="xl" mih={170} style={{ pointerEvents: 'none' }} wrap="nowrap" px="md">
          <Dropzone.Accept><ThemeIcon size={64} radius="xl" variant="light"><IconUpload size={36} /></ThemeIcon></Dropzone.Accept>
          <Dropzone.Reject><ThemeIcon size={64} radius="xl" variant="light" color="red"><IconX size={36} /></ThemeIcon></Dropzone.Reject>
          <Dropzone.Idle><ThemeIcon size={64} radius="xl" variant="light" color="gray"><IconUpload size={36} stroke={1.5} /></ThemeIcon></Dropzone.Idle>
          <Stack gap={6} style={{ minWidth: 0 }}>
            <Title order={3}>{canUpload ? 'Arraste os logs aqui ou clique para escolher' : 'Envio de logs indisponível'}</Title>
            <Text c="dimmed" size="md">
              {canUpload
                ? 'CSV do FT Manager (FT450) ou log CAN do BUSMASTER (.txt / .log). Pode mandar vários de uma vez: cada arquivo vira uma sessão, ou junte todos os logs do dia numa sessão só.'
                : disabledReason}
            </Text>
            {canUpload && (
              <Text c="dimmed" size="sm">
                {local
                  ? 'A análise (voltas, suspensão, resumo) é feita aqui no navegador, sem internet.'
                  : pc
                    ? 'O arquivo vai para a pasta deste computador; o app analisa e guarda o resumo (sem internet).'
                    : 'O arquivo vai para o servidor da equipe, que analisa e guarda o resumo para todos.'}
              </Text>
            )}
          </Stack>
        </Group>
      </Dropzone>

      {queue.length > 0 && (
        <Paper withBorder radius="md" p="lg">
          <Stack gap="lg">
            <Group justify="space-between" align="flex-end" wrap="wrap">
              <div>
                <Title order={3}>Dados do teste</Title>
                <Text c="dimmed" size="sm">Valem para {queue.length === 1 ? 'o arquivo' : `os ${queue.length} arquivos`} abaixo; a data é de cada arquivo. Dá para editar tudo depois.</Text>
              </div>
            </Group>
            <MetaFields value={shared} onChange={p => setShared(s => ({ ...s, ...p }))} drivers={drivers} tags={tags}
              withDate={false} disabled={running} />

            {mergeable >= 2 && (
              <Paper withBorder radius="md" p="md" style={{ background: 'var(--mantine-color-body)' }}>
                <Group gap="md" wrap="nowrap" align="flex-start">
                  <ThemeIcon size={40} radius="md" variant="light"><IconArrowMerge size={22} /></ThemeIcon>
                  <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
                    <Switch size="md" checked={merge} disabled={running} label={`Juntar os ${mergeable} logs numa sessão só`}
                      onChange={e => { const v = e.currentTarget.checked; setMerge(v); lsSet(K_MERGE, v ? '1' : '0'); }} />
                    <Text size="sm" c="dimmed">
                      {merge
                        ? 'Os logs entram um atrás do outro, na ordem do nome (Log 1, Log 2, …), e todas as contas (mapa, voltas, bateria, resumo) saem de uma vez. O tempo com o carro desligado entre um log e outro não conta. Só CSV da FT450.'
                        : 'Cada arquivo vira uma sessão separada.'}
                    </Text>
                  </Stack>
                </Group>
              </Paper>
            )}

            <Stack gap="sm">
              {queue.map(it => (
                <QueueRow key={it.key} it={it} running={running}
                  onDate={(day, time) => upd(it.key, { day, time, guessed: false })}
                  onRemove={() => setQueue(q => q.filter(x => x.key !== it.key))}
                  onRetry={dup => { void retry(it, dup); }}
                  onSkip={() => upd(it.key, { phase: 'skipped' })}
                  onOpen={() => it.meta && onOpen(it.meta)}
                  onOpenExisting={() => it.existingId && onOpenId(it.existingId)}
                  local={local} />
              ))}
            </Stack>

            <Group justify="space-between" wrap="wrap">
              <Button variant="subtle" color="gray" disabled={running} onClick={() => setQueue([])}>Limpar a fila</Button>
              <Group gap="sm">
                <Button variant="default" disabled={running} onClick={() => openRef.current?.()}>Adicionar arquivos</Button>
                <Button size="md" leftSection={<IconUpload size={18} />} loading={running} disabled={!pending}
                  onClick={() => { void sendAll(); }}>
                  {willMerge ? `Juntar e guardar ${mergeable} logs` : pending ? (pending === 1 ? 'Guardar 1 arquivo' : `Guardar ${pending} arquivos`) : 'Tudo guardado'}
                </Button>
              </Group>
            </Group>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

/* ---------------------------------------------------------------- uma linha da fila */
function QueueRow({ it, running, local, onDate, onRemove, onRetry, onSkip, onOpen, onOpenExisting }: {
  it: QueueItem; running: boolean; local: boolean;
  onDate: (day: string, time: string) => void; onRemove: () => void; onRetry: (allowDuplicate: boolean) => void;
  onSkip: () => void; onOpen: () => void; onOpenExisting: () => void;
}) {
  const busy = ['reading', 'analyzing', 'saving', 'uploading', 'server'].includes(it.phase);
  const editable = it.phase === 'pending' || it.phase === 'error' || it.phase === 'duplicate';
  const color = it.phase === 'done' ? 'green' : it.phase === 'error' ? 'red' : it.phase === 'duplicate' ? 'yellow' : 'brand';
  const pct = Math.round(it.progress * 100);
  const status = it.phase === 'uploading' ? `${PHASE_TEXT.uploading} ${pct} %` : PHASE_TEXT[it.phase];
  return (
    <Paper withBorder radius="md" p="md" style={{ background: 'var(--mantine-color-body)' }}>
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap" gap="sm" align="flex-start">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: '1 1 260px' }}>
            <ThemeIcon size={40} radius="md" variant="light" color={color}>
              {it.phase === 'done' ? <IconCheck size={22} /> : it.phase === 'error' ? <IconX size={22} />
                : it.phase === 'duplicate' ? <IconCopy size={22} /> : <IconFileText size={22} />}
            </ThemeIcon>
            <div style={{ minWidth: 0 }}>
              <Text fw={600} size="md" truncate="end" title={it.file.name}>{it.file.name}</Text>
              <Text size="sm" c="dimmed">{fmtSize(it.file.size)} · {status}</Text>
            </div>
          </Group>
          <Group gap="xs" wrap="nowrap" align="flex-end">
            <TextInput type="date" size="sm" aria-label="Data do teste" leftSection={<IconCalendar size={15} />}
              value={it.day} disabled={!editable || running} onChange={e => onDate(e.currentTarget.value, it.time)} w={170} />
            <TextInput type="time" size="sm" aria-label="Hora" leftSection={<IconClock size={15} />}
              value={it.time} disabled={!editable || running || !it.day} onChange={e => onDate(it.day, e.currentTarget.value)} w={120} />
            {it.phase === 'pending' && (
              <Tooltip label="Tirar da fila">
                <ActionIcon variant="subtle" color="gray" size="lg" onClick={onRemove} disabled={running} aria-label="Tirar da fila"><IconX size={18} /></ActionIcon>
              </Tooltip>
            )}
          </Group>
        </Group>
        {it.mergedFrom && (
          <Text size="sm" c="dimmed">Juntou {it.mergedFrom.length} logs, nesta ordem: {it.mergedFrom.join(', ')}.</Text>
        )}
        {it.guessed && editable && (
          <Text size="sm" c="dimmed">Data tirada {/BUSMASTER|\.log$|\.txt$/i.test(it.file.name) ? 'do arquivo' : 'do nome do arquivo'}: confira.</Text>
        )}
        {!it.day && editable && (
          <Text size="sm" c="dimmed">Sem data no nome do arquivo: {local ? 'informe a data do teste (senão fica só a data de envio).' : 'o servidor tenta tirar do arquivo; ou informe aqui.'}</Text>
        )}
        {(busy || it.phase === 'done') && (
          <Progress value={it.phase === 'done' ? 100 : Math.max(4, pct)} size="lg" radius="xl" color={color}
            striped={it.phase === 'server' || it.phase === 'analyzing'} animated={it.phase === 'server' || it.phase === 'analyzing'} />
        )}
        {it.phase === 'done' && it.meta && (
          <Group gap="sm">
            <Badge color="green" variant="light" size="lg" leftSection={<IconCheck size={14} />} style={{ textTransform: 'none', maxWidth: '100%' }}>Guardado como “{it.meta.name}”</Badge>
            <Button size="sm" variant="light" leftSection={<IconPlayerPlay size={16} />} onClick={onOpen}>Abrir</Button>
          </Group>
        )}
        {it.phase === 'duplicate' && (
          <Group gap="sm" wrap="wrap">
            <Text size="sm" c="yellow" fw={500}><IconAlertTriangle size={15} style={{ verticalAlign: -2 }} /> {it.error}</Text>
            {it.existingId && <Button size="sm" variant="light" onClick={onOpenExisting}>Abrir a que já existe</Button>}
            <Button size="sm" variant="default" disabled={running} onClick={() => onRetry(true)}>Guardar mesmo assim</Button>
            <Button size="sm" variant="subtle" color="gray" disabled={running} onClick={onSkip}>Pular</Button>
          </Group>
        )}
        {it.phase === 'error' && (
          <Group gap="sm" wrap="wrap">
            <Text size="sm" c="red">{it.error}</Text>
            <Button size="sm" variant="default" leftSection={<IconRefresh size={15} />} disabled={running} onClick={() => onRetry(false)}>Tentar de novo</Button>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}
