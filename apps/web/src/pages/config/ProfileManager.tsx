/* Perfis de carro ou de pista (biblioteca ativa): listar, escolher o ativo, salvar o que está
 * em uso no perfil, salvar como novo, duplicar, renomear e apagar. No servidor da equipe só
 * quem criou (ou um administrador) muda/apaga um perfil — o servidor responde 403 — então os
 * botões já ficam desligados com o motivo ("criado por X"). */
import { useRef, useState, type ReactNode } from 'react';
import {
  ActionIcon, Alert, Badge, Button, Group, Modal, Paper, Stack, Text, TextInput, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCheck, IconCopy, IconDeviceFloppy, IconLock, IconPencil, IconPlus, IconTrash,
} from '@tabler/icons-react';
import { DataTable, InfoButton } from '../../components';
import { useLibrary, type CarProfile, type TrackProfile } from '../../library';
import { useProfiles } from '../../state/profiles';
import { fmtDate, msgOf, useProfilePerms, type ProfileLike } from './parts';

type Kind = 'car' | 'track';
type Item = (CarProfile | TrackProfile) & ProfileLike;

const NOUN: Record<Kind, { one: string; art: string; example: string }> = {
  car: { one: 'carro', art: 'o', example: 'BJ26 — setup A' },
  track: { one: 'pista', art: 'a', example: 'Pista da faculdade' },
};

type Dialog =
  | { type: 'new' }
  | { type: 'dup'; p: Item }
  | { type: 'rename'; p: Item }
  | { type: 'delete'; p: Item }
  | { type: 'switch'; id: string | null };

export function ProfileManager({ kind, explain, intro }: { kind: Kind; explain: string; intro?: ReactNode }) {
  const { lib, bump } = useLibrary();
  const perms = useProfilePerms();
  const N = NOUN[kind];
  const list = useProfiles(s => (kind === 'car' ? s.cars : s.tracks)) as Item[];
  const activeId = useProfiles(s => (kind === 'car' ? s.activeCarId : s.activeTrackId));
  const dirty = useProfiles(s => (kind === 'car' ? s.carDirty : s.trackDirty));
  const loadError = useProfiles(s => s.loadError);
  const active = activeId ? list.find(p => p.id === activeId) ?? null : null;
  const [dlg, setDlg] = useState<Dialog | null>(null);
  /* o último diálogo continua desenhado enquanto o modal fecha (sem trocar o título no meio) */
  const lastDlg = useRef<Dialog | null>(null);
  if (dlg) lastDlg.current = dlg;
  const shown = dlg ?? lastDlg.current;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const P = () => useProfiles.getState();
  const setActive = (id: string | null) => (kind === 'car' ? P().setActiveCar(id) : P().setActiveTrack(id));
  const reload = async () => { if (lib) await P().load(lib); bump(); };

  const run = async (what: string, fn: () => Promise<void>): Promise<boolean> => {
    if (!lib) return false;
    setBusy(true);
    try {
      await fn();
      setDlg(null);
      return true;
    } catch (e) {
      notifications.show({ color: 'red', title: `Não deu para ${what}`, message: msgOf(e), autoClose: 8000 });
      return false;
    } finally { setBusy(false); }
  };

  const saveActive = () => run('salvar o perfil', async () => {
    const saved = kind === 'car' ? await P().saveCarProfile(lib!) : await P().saveTrackProfile(lib!);
    notifications.show({ color: 'green', title: 'Perfil salvo', message: `"${saved.name}" atualizado.`, autoClose: 3000 });
    bump();
  });
  const saveNew = (nm: string) => run('criar o perfil', async () => {
    const saved = kind === 'car' ? await P().saveCarProfile(lib!, nm) : await P().saveTrackProfile(lib!, nm);
    notifications.show({ color: 'green', title: 'Perfil criado', message: `"${saved.name}" está em uso.`, autoClose: 3000 });
    bump();
  });
  const duplicate = (p: Item, nm: string) => run('duplicar o perfil', async () => {
    const saved = kind === 'car'
      ? await lib!.saveCar({ name: nm, params: { ...(p as CarProfile).params } })
      : await lib!.saveTrack({ name: nm, params: { ...(p as TrackProfile).params } });
    await reload();
    setActive(saved.id);
    notifications.show({ color: 'green', title: 'Cópia criada', message: `"${saved.name}" está em uso e pode ser editada.`, autoClose: 3500 });
  });
  const rename = (p: Item, nm: string) => run('renomear o perfil', async () => {
    if (kind === 'car') await lib!.saveCar({ id: p.id, name: nm, params: (p as CarProfile).params });
    else await lib!.saveTrack({ id: p.id, name: nm, params: (p as TrackProfile).params });
    await reload();
  });
  const remove = (p: Item) => run('apagar o perfil', async () => {
    if (kind === 'car') await P().deleteCarProfile(lib!, p.id);
    else await P().deleteTrackProfile(lib!, p.id);
    bump();
    notifications.show({ title: 'Perfil apagado', message: `"${p.name}" foi apagado. A configuração em uso continua a mesma.`, autoClose: 3500 });
  });
  const choose = (id: string | null) => {
    if (id === activeId) return;
    if (dirty && id) { setDlg({ type: 'switch', id }); return; }
    setActive(id);
  };

  const openName = (d: Dialog, initial: string) => { setName(initial); setDlg(d); };
  const nameOk = name.trim().length > 0 && name.trim().length <= 120;
  const submitName = () => {
    if (!dlg || !nameOk) return;
    const nm = name.trim();
    if (dlg.type === 'new') void saveNew(nm);
    else if (dlg.type === 'dup') void duplicate(dlg.p, nm);
    else if (dlg.type === 'rename') void rename(dlg.p, nm);
  };

  const editable = perms.canEdit(active);
  const lockMsg = active ? perms.whyNot(active) : '';

  return (
    <Stack gap="md">
      <Paper withBorder radius="md" p="lg">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
            <Stack gap={4} style={{ minWidth: 0, flex: '1 1 320px' }}>
              <Group gap={6} wrap="wrap">
                <Text fw={600} size="lg">Em uso:</Text>
                <Text fw={700} size="lg" style={{ overflowWrap: 'anywhere' }}>
                  {active ? active.name : 'sem perfil (valores só neste navegador)'}
                </Text>
                <InfoButton explain={explain} sensors={kind === 'car' ? ['car_data'] : ['gps']} title={`Perfil d${N.art} ${N.one}`} />
              </Group>
              <Group gap="xs">
                {active && dirty && <Badge tt="none" color="yellow" variant="light" size="lg">alterado — não salvo no perfil</Badge>}
                {active && !dirty && <Badge tt="none" color="green" variant="light" size="lg" leftSection={<IconCheck size={13} />}>igual ao perfil</Badge>}
                {active?.createdByName && <Badge tt="none" color="gray" variant="light" size="lg">criado por {active.createdByName}</Badge>}
                {!editable && active && <Badge tt="none" color="gray" variant="outline" size="lg" leftSection={<IconLock size={13} />}>só leitura</Badge>}
              </Group>
              {intro && <Text size="sm" c="dimmed" maw={760}>{intro}</Text>}
            </Stack>
            <Group gap="xs" wrap="wrap">
              {active && (
                <Tooltip label={!editable ? lockMsg : dirty ? 'Grava os valores em uso neste perfil' : 'Nada mudou desde o último salvamento'}>
                  <Button className="cfg-wrap-btn" size="md" leftSection={<IconDeviceFloppy size={18} />} disabled={!editable || !dirty || !lib} loading={busy && !dlg}
                    onClick={() => void saveActive()}>
                    Salvar no perfil
                  </Button>
                </Tooltip>
              )}
              <Tooltip label={perms.canCreate ? `Novo perfil com os valores em uso (ex.: "${N.example}")` : perms.whyNot({ id: '', name: '' }) || 'Sem permissão'}>
                <Button className="cfg-wrap-btn" size="md" variant={active ? 'default' : 'filled'} leftSection={<IconPlus size={18} />} disabled={!perms.canCreate || !lib}
                  onClick={() => openName({ type: 'new' }, active ? `${active.name} (novo)` : '')}>
                  Salvar como novo perfil
                </Button>
              </Tooltip>
            </Group>
          </Group>
          {active && !editable && (
            <Alert color="gray" variant="light" icon={<IconLock size={18} />} title="Este perfil é só para leitura">
              {lockMsg} {perms.canCreate
                ? 'Para mudar os números, duplique o perfil (a cópia é sua) ou use sem perfil (os valores ficam só neste navegador).'
                : 'Você pode usar sem perfil: os valores ficam só neste navegador.'}
              <Group gap="xs" mt="sm">
                {perms.canCreate && (
                  <Button size="sm" leftSection={<IconCopy size={16} />} onClick={() => openName({ type: 'dup', p: active }, `${active.name} (cópia)`)}>
                    Duplicar para editar
                  </Button>
                )}
                <Button size="sm" variant="default" onClick={() => setActive(null)}>Usar sem perfil</Button>
              </Group>
            </Alert>
          )}
          {loadError && (
            <Alert color="red" variant="light" title="Não consegui carregar os perfis">{loadError}</Alert>
          )}
        </Stack>
      </Paper>

      <div className="cfg-table-scroll">
      <DataTable<Item>
        rows={list}
        rowKey={p => p.id}
        selected={(p) => p.id === activeId}
        onRowClick={p => choose(p.id)}
        empty={`Nenhum perfil de ${N.one} ainda. Ajuste os valores abaixo e use "Salvar como novo perfil" (ex.: "${N.example}").`}
        columns={[
          {
            key: 'name', header: 'Perfil',
            render: p => (
              <Group gap={8} wrap="nowrap">
                <Text fw={p.id === activeId ? 700 : 500} style={{ overflowWrap: 'anywhere' }}>{p.name}</Text>
                {p.id === activeId && <Badge tt="none" size="sm" variant="filled">em uso</Badge>}
              </Group>
            ),
          },
          ...(perms.remote ? [{ key: 'by', header: 'Criado por', render: (p: Item) => p.createdByName || '—' }] : []),
          ...(perms.remote ? [{ key: 'sessions', header: 'Sessões', numeric: true, render: (p: Item) => (p.sessions ?? '—') }] : []),
          { key: 'upd', header: 'Atualizado', render: p => fmtDate(p.updatedAt) },
          {
            key: 'act', header: '', width: 190,
            render: p => {
              const can = perms.canEdit(p);
              const why = perms.whyNot(p);
              return (
                <Group gap={4} wrap="nowrap" justify="flex-end" onClick={e => e.stopPropagation()}>
                  <Tooltip label={p.id === activeId ? 'Já está em uso' : 'Usar este perfil'}>
                    <ActionIcon size="lg" variant={p.id === activeId ? 'filled' : 'default'} aria-label="Usar este perfil" onClick={() => choose(p.id)}>
                      <IconCheck size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={perms.canCreate ? 'Duplicar' : 'Sem permissão para criar perfis'}>
                    <ActionIcon size="lg" variant="default" aria-label="Duplicar" disabled={!perms.canCreate}
                      onClick={() => openName({ type: 'dup', p }, `${p.name} (cópia)`)}>
                      <IconCopy size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={can ? 'Renomear' : why}>
                    <ActionIcon size="lg" variant="default" aria-label="Renomear" disabled={!can}
                      onClick={() => openName({ type: 'rename', p }, p.name)}>
                      <IconPencil size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={can ? 'Apagar' : why}>
                    <ActionIcon size="lg" variant="default" color="red" aria-label="Apagar" disabled={!can}
                      onClick={() => setDlg({ type: 'delete', p })}>
                      <IconTrash size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              );
            },
          },
        ]}
      />
      </div>
      {active && (
        <Group>
          <Button className="cfg-wrap-btn" variant="subtle" size="sm" onClick={() => choose(null)}>Parar de usar o perfil (manter os valores só neste navegador)</Button>
        </Group>
      )}

      {/* nome: novo / duplicar / renomear */}
      <Modal
        opened={!!dlg && (dlg.type === 'new' || dlg.type === 'dup' || dlg.type === 'rename')}
        onClose={() => setDlg(null)} size="md" centered
        title={<Text fw={700} size="lg">
          {shown?.type === 'new' ? `Novo perfil de ${N.one}` : shown?.type === 'dup' ? 'Duplicar perfil' : 'Renomear perfil'}
        </Text>}
      >
        <form onSubmit={e => { e.preventDefault(); submitName(); }}>
          <Stack>
            {shown?.type === 'new' && <Text size="sm" c="dimmed">O perfil novo guarda os valores que estão em uso agora e passa a ser o perfil em uso.</Text>}
            {shown?.type === 'dup' && <Text size="sm" c="dimmed">A cópia guarda os valores salvos de "{shown.p.name}" e passa a ser o perfil em uso{perms.remote ? ' (criada por você: pode editar)' : ''}.</Text>}
            <TextInput label="Nome" size="md" data-autofocus value={name} onChange={e => setName(e.currentTarget.value)}
              placeholder={N.example} maxLength={120} error={name.length > 0 && !nameOk ? 'Nome vazio' : null} />
            <Group justify="flex-end">
              <Button variant="default" size="md" onClick={() => setDlg(null)}>Cancelar</Button>
              <Button type="submit" size="md" loading={busy} disabled={!nameOk}>
                {shown?.type === 'rename' ? 'Renomear' : shown?.type === 'dup' ? 'Duplicar' : 'Criar'}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* apagar */}
      <Modal opened={dlg?.type === 'delete'} onClose={() => setDlg(null)} centered size="md"
        title={<Text fw={700} size="lg">Apagar o perfil?</Text>}>
        {shown?.type === 'delete' && (
          <Stack>
            <Text>
              Apagar <b>{shown.p.name}</b>? Isso não tem volta.
              {perms.remote && (shown.p.sessions ?? 0) > 0 && ` ${shown.p.sessions} sessão(ões) usam este perfil: elas ficam sem ${N.one} e os resumos são recalculados com os valores padrão.`}
            </Text>
            <Text size="sm" c="dimmed">Os valores em uso neste navegador não mudam.</Text>
            <Group justify="flex-end">
              <Button variant="default" size="md" onClick={() => setDlg(null)}>Cancelar</Button>
              <Button color="red" size="md" loading={busy} leftSection={<IconTrash size={17} />} onClick={() => void remove(shown.p)}>Apagar</Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* trocar com alterações não salvas */}
      <Modal opened={dlg?.type === 'switch'} onClose={() => setDlg(null)} centered size="md"
        title={<Text fw={700} size="lg">Trocar de perfil?</Text>}>
        {shown?.type === 'switch' && (
          <Stack>
            <Text>Os valores em uso foram alterados e não foram salvos em <b>{active?.name}</b>. Ao trocar, eles são substituídos pelos do outro perfil.</Text>
            <Group justify="flex-end" wrap="wrap">
              <Button variant="default" size="md" onClick={() => setDlg(null)}>Cancelar</Button>
              {editable && (
                <Button variant="light" size="md" loading={busy} onClick={async () => {
                  const id = shown.id;
                  if (await saveActive()) setActive(id);
                }}>Salvar e trocar</Button>
              )}
              <Button color="red" size="md" onClick={() => { setActive(shown.id); setDlg(null); }}>Trocar sem salvar</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
