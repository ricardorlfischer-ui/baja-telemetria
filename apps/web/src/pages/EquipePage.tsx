/* Página /equipe — só com o servidor da equipe (docs/ARQUITETURA.md 5.3): usuários (papel,
 * ativo, apagar, criar com senha temporária), convites (criar com papel e validade, copiar
 * código/link, revogar) e minha conta (trocar a senha). No modo local, explica como ligar um
 * servidor; no modo "este computador" (sem contas), diz que não há equipe nesse modo. As regras (último administrador, quem pode o quê) são do servidor; aqui só
 * mostramos e passamos adiante as mensagens dele. */
import { useCallback, useEffect, useState } from 'react';
import {
  ActionIcon, Alert, Badge, Button, Center, Group, List, Loader, Modal, NumberInput, Paper, PasswordInput, Select,
  Stack, Switch, Text, TextInput, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCloudOff, IconCopy, IconDeviceDesktop, IconKey, IconLink, IconLogin, IconMailPlus, IconServer, IconSettings, IconTrash, IconUserPlus,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { DataTable, EmptyState, PageHeader, Section } from '../components';
import { routeByPath } from '../routes';
import { PC_NO_TEAM } from '../layout/NavMenu';
import { useLibrary, type Role, type User } from '../library';
import { copyText, fmtDate, msgOf } from './config/parts';
import {
  PASSWORD_MIN, ROLE_HELP, ROLE_LABEL, ROLE_OPTIONS, emailOk, inviteLink, type CreatedUser, type InviteRow,
} from './config/team';
import './config/config.css';

const copy = async (text: string, what: string) => {
  const ok = await copyText(text);
  notifications.show(ok
    ? { color: 'green', title: `${what} copiado`, message: text.length > 60 ? 'Cole na mensagem para a pessoa.' : text, autoClose: 2500 }
    : { color: 'red', title: 'Não deu para copiar', message: 'Selecione o texto e copie com Ctrl+C.' });
};
const fail = (title: string) => (e: unknown) => notifications.show({ color: 'red', title, message: msgOf(e), autoClose: 8000 });

export default function EquipePage() {
  const r = routeByPath('/equipe')!;
  const nav = useNavigate();
  const { mode, loading, offline, user, remote, info, pc } = useLibrary();

  let body;
  if (loading) body = <Center py={80}><Loader /></Center>;
  else if (pc) {
    body = (
      <EmptyState icon={IconDeviceDesktop} title="Sem equipe neste modo"
        description={<>{PC_NO_TEAM}. Os logs, carros e pistas daqui continuam na pasta deste computador (Preferências → Onde ficam os logs).</>}
        action={<Button leftSection={<IconSettings size={17} />} onClick={() => nav('/config', { state: { section: 'pasta' } })}>Abrir Preferências</Button>} />
    );
  }
  else if (mode !== 'remote' || !remote) body = <NoServer onPrefs={() => nav('/config')} />;
  else if (offline) {
    body = (
      <EmptyState icon={IconCloudOff} title="O servidor da equipe não respondeu"
        description={`O endereço salvo em Preferências (${remote.baseUrl || 'mesma origem'}) não respondeu. Confira a internet e se o servidor está ligado; sem ele, o app continua funcionando com a biblioteca deste navegador.`}
        action={<Button leftSection={<IconSettings size={17} />} onClick={() => nav('/config')}>Abrir Preferências</Button>} />
    );
  } else if (!user) {
    body = (
      <EmptyState icon={IconLogin} title="Entre no servidor da equipe"
        description={`${info?.name ?? 'Servidor'} ${info?.version ?? ''}: entre com a sua conta para ver a equipe e trocar a sua senha.`}
        action={<Button leftSection={<IconLogin size={17} />} onClick={() => nav('/login', { state: { from: '/equipe' } })}>Entrar</Button>} />
    );
  } else {
    body = (
      <>
        <MyAccount />
        {user.role === 'admin' ? (
          <>
            <Users />
            <Invites />
          </>
        ) : (
          <Section title="Usuários e convites">
            <Alert color="gray" variant="light" title="Só administradores gerenciam a equipe">
              Seu papel é <b>{ROLE_LABEL[user.role]}</b>: {ROLE_HELP[user.role]}. Para convidar alguém ou mudar um papel, fale com um administrador.
            </Alert>
          </Section>
        )}
        <Roles />
      </>
    );
  }

  return (
    <>
      <PageHeader title={r.label} subtitle={pc ? 'A equipe (contas, convites, papéis) só existe no servidor da equipe.' : r.question} />
      {body}
    </>
  );
}

/* ---------------------------------------------------------------- sem servidor */
function NoServer({ onPrefs }: { onPrefs: () => void }) {
  return (
    <Stack gap="lg">
      <EmptyState icon={IconServer} title="A equipe só existe com o servidor da equipe"
        description="Agora o app está no modo local: as sessões e os perfis ficam só neste navegador. Com o servidor, todo mundo vê as mesmas sessões, carros e pistas, cada um com a sua conta."
        action={<Button leftSection={<IconSettings size={17} />} onClick={onPrefs}>Configurar o servidor em Preferências</Button>} />
      <Paper withBorder radius="md" p="lg">
        <Text fw={650} size="lg" mb="sm">Como ligar um servidor da equipe</Text>
        <List type="ordered" spacing="sm" size="md">
          <List.Item>
            Num PC da equipe (ou na nuvem), rode o servidor: com Docker, <code>docker compose up -d</code> na pasta do projeto;
            sem Docker, <code>npm run build</code> e <code>node apps/server/dist/index.js</code> (porta 8080). O passo a passo está em
            {' '}<code>docs/IMPLANTACAO.md</code> (PC + Cloudflare Tunnel, Fly.io, Railway, Oracle Cloud).
          </List.Item>
          <List.Item>Abra o endereço do servidor no navegador: ele já serve o app com a biblioteca da equipe ligada. Na primeira vez, crie a conta de administrador.</List.Item>
          <List.Item>Ou, neste app, vá em <b>Preferências → Servidor da equipe</b>, cole o endereço, teste a conexão e conecte.</List.Item>
          <List.Item>Como administrador, crie convites aqui em Equipe e mande o código ou o link para cada pessoa.</List.Item>
        </List>
        <Text size="sm" c="dimmed" mt="md">
          Dica: o que está guardado neste navegador continua aqui no modo local. Antes de trocar de computador ou limpar o navegador, exporte o backup em Preferências.
        </Text>
      </Paper>
    </Stack>
  );
}

/* ---------------------------------------------------------------- minha conta */
function MyAccount() {
  const { user, remote, setUser } = useLibrary();
  const [oldPw, setOld] = useState('');
  const [newPw, setNew] = useState('');
  const [conf, setConf] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!user || !remote) return null;

  const tooShort = newPw.length > 0 && newPw.length < PASSWORD_MIN;
  const mismatch = conf.length > 0 && conf !== newPw;
  const can = oldPw.length > 0 && newPw.length >= PASSWORD_MIN && conf === newPw && !busy;

  const submit = async () => {
    if (!can) return;
    setBusy(true); setErr(null);
    try {
      /* o servidor devolve { token, user } novos: o token antigo deixa de valer */
      const res = await remote.changePassword(oldPw, newPw);   /* guarda o token novo */
      if (res?.user) setUser(res.user);
      setOld(''); setNew(''); setConf('');
      notifications.show({ color: 'green', title: 'Senha trocada', message: 'As outras sessões abertas com a senha antiga foram encerradas.', autoClose: 5000 });
    } catch (e) {
      setErr(msgOf(e));
    } finally { setBusy(false); }
  };

  return (
    <Section title="Minha conta" description="Seus dados no servidor da equipe e a troca de senha.">
      <div className="cfg-groups">
        <Paper withBorder radius="md" p="lg">
          <Stack gap="sm">
            <Text c="dimmed" size="sm">Nome</Text>
            <Text fw={650} size="xl" mt={-8}>{user.name}</Text>
            <Text c="dimmed" size="sm">E-mail</Text>
            <Text size="lg" mt={-8} style={{ overflowWrap: 'anywhere' }}>{user.email}</Text>
            <Text c="dimmed" size="sm">Papel</Text>
            <Group gap="xs" mt={-8}>
              <Badge tt="none" size="lg" variant="light">{ROLE_LABEL[user.role]}</Badge>
            </Group>
            <Text size="sm" c="dimmed">{ROLE_HELP[user.role]}.</Text>
          </Stack>
        </Paper>
        <Paper withBorder radius="md" p="lg">
          <form onSubmit={e => { e.preventDefault(); void submit(); }}>
            <Stack gap="sm">
              <Group gap={8}><IconKey size={20} /><Text fw={650} size="lg">Trocar a senha</Text></Group>
              <PasswordInput label="Senha atual" size="md" value={oldPw} onChange={e => setOld(e.currentTarget.value)} autoComplete="current-password" />
              <PasswordInput label="Senha nova" size="md" value={newPw} onChange={e => setNew(e.currentTarget.value)} autoComplete="new-password"
                description={`Pelo menos ${PASSWORD_MIN} caracteres.`} error={tooShort ? `Pelo menos ${PASSWORD_MIN} caracteres` : null} />
              <PasswordInput label="Repita a senha nova" size="md" value={conf} onChange={e => setConf(e.currentTarget.value)} autoComplete="new-password"
                error={mismatch ? 'As senhas não são iguais' : null} />
              {err && <Alert color="red" variant="light">{err}</Alert>}
              <Group justify="flex-end"><Button type="submit" size="md" loading={busy} disabled={!can}>Trocar a senha</Button></Group>
            </Stack>
          </form>
        </Paper>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- usuários (admin) */
function Users() {
  const { remote, user: me } = useLibrary();
  const [list, setList] = useState<User[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<User | null>(null);
  const [created, setCreated] = useState<CreatedUser | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reset, setReset] = useState<User | null>(null);

  const load = useCallback(async () => {
    if (!remote) return;
    try { setList(await remote.listUsers()); setLoadErr(null); } catch (e) { setLoadErr(msgOf(e)); }
  }, [remote]);
  useEffect(() => { void load(); }, [load]);

  const patch = async (u: User, p: Partial<Pick<User, 'role' | 'disabled'>>) => {
    if (!remote) return;
    setBusyId(u.id);
    try {
      const n = await remote.updateUser(u.id, p);
      setList(l => l?.map(x => (x.id === n.id ? n : x)) ?? null);
    } catch (e) { fail('Não deu para mudar o usuário')(e); } finally { setBusyId(null); }
  };

  return (
    <Section title="Usuários" description="Quem tem conta no servidor. Desativar encerra as sessões abertas da pessoa sem apagar o que ela enviou; apagar remove a conta (as sessões, perfis e anotações dela ficam, sem autor)."
      actions={<Button size="md" leftSection={<IconUserPlus size={18} />} onClick={() => setCreating(true)}>Novo usuário</Button>}>
      {loadErr && <Alert color="red" variant="light" mb="md" title="Não consegui carregar os usuários">{loadErr}</Alert>}
      {!list && !loadErr ? <Center py="xl"><Loader /></Center> : (
        <div className="cfg-table-scroll" style={{ ['--cfg-table-min' as string]: '760px' }}>
        <DataTable<User>
          rows={list ?? []} rowKey={u => u.id} empty="Nenhum usuário."
          columns={[
            {
              key: 'name', header: 'Nome',
              render: u => (
                <Group gap={8} wrap="nowrap">
                  <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{u.name}</Text>
                  {u.id === me?.id && <Badge tt="none" size="sm" variant="light">você</Badge>}
                </Group>
              ),
            },
            { key: 'email', header: 'E-mail', render: u => <Text style={{ overflowWrap: 'anywhere' }}>{u.email}</Text> },
            {
              key: 'role', header: 'Papel', width: 190,
              render: u => (
                <Tooltip label="Use outra conta de administrador para mudar a sua" disabled={u.id !== me?.id}>
                  <Select size="sm" data={ROLE_OPTIONS} value={u.role} allowDeselect={false} w={170}
                    disabled={u.id === me?.id || busyId === u.id} comboboxProps={{ withinPortal: true }}
                    onChange={v => { if (v && v !== u.role) void patch(u, { role: v as Role }); }} aria-label={`Papel de ${u.name}`} />
                </Tooltip>
              ),
            },
            {
              key: 'active', header: 'Ativo', width: 90,
              render: u => (
                <Switch size="md" checked={!u.disabled} disabled={u.id === me?.id || busyId === u.id}
                  onChange={e => void patch(u, { disabled: !e.currentTarget.checked })} aria-label={`${u.name} ativo`} />
              ),
            },
            { key: 'created', header: 'Desde', render: u => fmtDate(u.createdAt) },
            {
              key: 'act', header: '', width: 104,
              render: u => (
                <Group gap={4} wrap="nowrap" justify="flex-end">
                  <Tooltip label={u.id === me?.id ? 'Troque a sua senha em Minha conta' : 'Definir uma senha nova (esqueceu a senha)'}>
                    <ActionIcon size="lg" variant="default" disabled={u.id === me?.id} aria-label={`Senha nova para ${u.name}`} onClick={() => setReset(u)}>
                      <IconKey size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={u.id === me?.id ? 'Você não pode apagar a própria conta aqui' : 'Apagar a conta'}>
                    <ActionIcon size="lg" variant="default" color="red" disabled={u.id === me?.id} aria-label={`Apagar ${u.name}`} onClick={() => setDel(u)}>
                      <IconTrash size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              ),
            },
          ]}
        />
        </div>
      )}

      <NewUserModal opened={creating} onClose={() => setCreating(false)}
        onCreated={u => { setCreating(false); setCreated(u); void load(); }} />
      <ResetPasswordModal user={reset} onClose={() => setReset(null)} />

      <Modal opened={!!created} onClose={() => setCreated(null)} centered size="md" closeOnClickOutside={false}
        title={<Text fw={700} size="lg">Usuário criado</Text>}>
        {created && (
          <Stack>
            <Text><b>{created.name}</b> ({created.email}) entrou como <b>{ROLE_LABEL[created.role]}</b>.</Text>
            {created.tempPassword ? (
              <>
                <Text>Senha temporária — <b>aparece só agora</b>. Mande para a pessoa e peça para trocar em Equipe → Minha conta:</Text>
                <div className="cfg-secret">{created.tempPassword}</div>
                <Group justify="space-between">
                  <Button variant="light" leftSection={<IconCopy size={16} />} onClick={() => void copy(created.tempPassword!, 'Senha')}>Copiar senha</Button>
                  <Button onClick={() => setCreated(null)}>Já anotei</Button>
                </Group>
              </>
            ) : (
              <Group justify="flex-end"><Button onClick={() => setCreated(null)}>Fechar</Button></Group>
            )}
          </Stack>
        )}
      </Modal>

      <Modal opened={!!del} onClose={() => setDel(null)} centered size="md" title={<Text fw={700} size="lg">Apagar a conta?</Text>}>
        {del && (
          <Stack>
            <Text>Apagar a conta de <b>{del.name}</b> ({del.email})? Isso não tem volta.</Text>
            <Text size="sm" c="dimmed">As sessões, perfis e anotações dela continuam na biblioteca, sem autor. Para só tirar o acesso, desative em vez de apagar.</Text>
            <Group justify="flex-end">
              <Button variant="default" size="md" onClick={() => setDel(null)}>Cancelar</Button>
              <Button color="red" size="md" leftSection={<IconTrash size={17} />} loading={busyId === del.id} onClick={async () => {
                if (!remote) return;
                setBusyId(del.id);
                try { await remote.deleteUser(del.id); setDel(null); void load(); } catch (e) { fail('Não deu para apagar')(e); } finally { setBusyId(null); }
              }}>Apagar</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Section>
  );
}

/** Senha gerada no navegador (sem letras que se confundem), para o administrador passar adiante. */
function randomPassword(len = 12): string {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const v = new Uint32Array(len);
  crypto.getRandomValues(v);
  return Array.from(v, x => abc[x % abc.length]).join('');
}

/** Admin define uma senha nova para quem esqueceu (PATCH /users/:id): as sessões abertas dela caem. */
function ResetPasswordModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { remote } = useLibrary();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [last, setLast] = useState<User | null>(null);
  useEffect(() => { if (user) { setLast(user); setPw(randomPassword()); setErr(null); setDone(null); } }, [user]);
  const u = user ?? last;
  const ok = pw.length >= PASSWORD_MIN && !busy;
  const submit = async () => {
    if (!remote || !user || !ok) return;
    setBusy(true); setErr(null);
    try { await remote.updateUser(user.id, { password: pw }); setDone(pw); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  return (
    <Modal opened={!!user} onClose={onClose} centered size="md" closeOnClickOutside={!done}
      title={<Text fw={700} size="lg">Senha nova{u ? ` para ${u.name}` : ''}</Text>}>
      {done ? (
        <Stack>
          <Text>Senha trocada. Mande para a pessoa e peça para trocar em Equipe → Minha conta. Ela aparece <b>só agora</b>:</Text>
          <div className="cfg-secret">{done}</div>
          <Group justify="space-between">
            <Button variant="light" leftSection={<IconCopy size={16} />} onClick={() => void copy(done, 'Senha')}>Copiar senha</Button>
            <Button onClick={onClose}>Já anotei</Button>
          </Group>
        </Stack>
      ) : (
        <form onSubmit={e => { e.preventDefault(); void submit(); }}>
          <Stack>
            <Text size="sm" c="dimmed">Para quem esqueceu a senha. As sessões abertas da pessoa (em outros computadores) são encerradas.</Text>
            <Group align="flex-end" gap="xs" wrap="nowrap">
              <TextInput label="Senha nova" size="md" value={pw} onChange={e => setPw(e.currentTarget.value)} style={{ flex: 1 }}
                error={pw.length > 0 && pw.length < PASSWORD_MIN ? `Pelo menos ${PASSWORD_MIN} caracteres` : null}
                styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }} />
              <Button size="md" variant="default" onClick={() => setPw(randomPassword())}>Gerar</Button>
            </Group>
            {err && <Alert color="red" variant="light">{err}</Alert>}
            <Group justify="flex-end">
              <Button variant="default" size="md" onClick={onClose}>Cancelar</Button>
              <Button type="submit" size="md" loading={busy} disabled={!ok}>Definir a senha</Button>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}

function NewUserModal({ opened, onClose, onCreated }: { opened: boolean; onClose: () => void; onCreated: (u: CreatedUser) => void }) {
  const { remote } = useLibrary();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (opened) { setName(''); setEmail(''); setRole('member'); setPw(''); setErr(null); } }, [opened]);
  const pwBad = pw.length > 0 && pw.length < PASSWORD_MIN;
  const can = name.trim().length > 0 && emailOk(email) && !pwBad && !busy;
  const submit = async () => {
    if (!remote || !can) return;
    setBusy(true); setErr(null);
    try {
      /* sem senha, o servidor gera uma temporária e devolve uma única vez (tempPassword) */
      const body = { name: name.trim(), email: email.trim(), role, ...(pw ? { password: pw } : {}) };
      const u = await remote.createUser(body);
      onCreated(u);
    } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  return (
    <Modal opened={opened} onClose={onClose} centered size="md" title={<Text fw={700} size="lg">Novo usuário</Text>}>
      <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        <Stack>
          <Text size="sm" c="dimmed">Para a pessoa criar a própria conta, prefira um convite (abaixo). Aqui você cria a conta direto.</Text>
          <TextInput label="Nome" size="md" data-autofocus value={name} onChange={e => setName(e.currentTarget.value)} maxLength={120} />
          <TextInput label="E-mail" size="md" type="email" value={email} onChange={e => setEmail(e.currentTarget.value)}
            error={email.length > 3 && !emailOk(email) ? 'E-mail inválido' : null} />
          <Select label="Papel" size="md" data={ROLE_OPTIONS} value={role} allowDeselect={false} onChange={v => setRole((v ?? 'member') as Role)}
            description={ROLE_HELP[role]} />
          <PasswordInput label="Senha (opcional)" size="md" value={pw} onChange={e => setPw(e.currentTarget.value)} autoComplete="new-password"
            description="Deixe vazio para o servidor gerar uma senha temporária (mostrada uma vez)."
            error={pwBad ? `Pelo menos ${PASSWORD_MIN} caracteres` : null} />
          {err && <Alert color="red" variant="light">{err}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" size="md" onClick={onClose}>Cancelar</Button>
            <Button type="submit" size="md" loading={busy} disabled={!can}>Criar usuário</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- convites (admin) */
const STATUS_COLOR: Record<string, string> = { ativo: 'green', usado: 'gray', expirado: 'red' };

function Invites() {
  const { remote } = useLibrary();
  const [list, setList] = useState<InviteRow[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [role, setRole] = useState<Role>('member');
  const [days, setDays] = useState<number | string>(7);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<InviteRow | null>(null);
  const [revoke, setRevoke] = useState<InviteRow | null>(null);

  const load = useCallback(async () => {
    if (!remote) return;
    try { setList(await remote.listInvites()); setLoadErr(null); } catch (e) { setLoadErr(msgOf(e)); }
  }, [remote]);
  useEffect(() => { void load(); }, [load]);
  if (!remote) return null;
  const base = remote.baseUrl;
  const daysN = typeof days === 'number' ? days : parseFloat(String(days).replace(',', '.'));
  const daysOk = isFinite(daysN) && daysN >= 0.01 && daysN <= 365;

  const create = async () => {
    if (!daysOk) return;
    setBusy(true);
    try {
      const inv = await remote.createInvite({ role, days: daysN });
      setCreating(false); setMade(inv); void load();
    } catch (e) { fail('Não deu para criar o convite')(e); } finally { setBusy(false); }
  };

  return (
    <Section title="Convites" description="Código de uso único: a pessoa abre o link (ou digita o código em Entrar → Criar conta) e cria a própria conta com o papel do convite."
      actions={<Button size="md" leftSection={<IconMailPlus size={18} />} onClick={() => { setRole('member'); setDays(7); setCreating(true); }}>Novo convite</Button>}>
      {loadErr && <Alert color="red" variant="light" mb="md" title="Não consegui carregar os convites">{loadErr}</Alert>}
      {!list && !loadErr ? <Center py="xl"><Loader /></Center> : (
        <div className="cfg-table-scroll" style={{ ['--cfg-table-min' as string]: '900px' }}>
        <DataTable<InviteRow>
          rows={list ?? []} rowKey={i => i.code} empty="Nenhum convite ainda."
          columns={[
            { key: 'code', header: 'Código', render: i => <span className="cfg-code">{i.code}</span> },
            { key: 'role', header: 'Papel', render: i => ROLE_LABEL[i.role] },
            { key: 'status', header: 'Situação', render: i => <Badge tt="none" variant="light" color={STATUS_COLOR[i.status ?? 'ativo']}>{i.status ?? '—'}</Badge> },
            { key: 'exp', header: 'Vale até', render: i => fmtDate(i.expiresAt) },
            { key: 'by', header: 'Criado por', render: i => i.createdByName || '—' },
            { key: 'used', header: 'Usado por', render: i => (i.usedByName ? `${i.usedByName} (${fmtDate(i.usedAt)})` : '—') },
            {
              key: 'act', header: '', width: 150,
              render: i => (
                <Group gap={4} wrap="nowrap" justify="flex-end">
                  <Tooltip label="Copiar o código">
                    <ActionIcon size="lg" variant="default" aria-label="Copiar o código" disabled={i.status !== 'ativo'} onClick={() => void copy(i.code, 'Código')}><IconCopy size={18} /></ActionIcon>
                  </Tooltip>
                  <Tooltip label="Copiar o link do convite">
                    <ActionIcon size="lg" variant="default" aria-label="Copiar o link" disabled={i.status !== 'ativo'} onClick={() => void copy(inviteLink(i.code, base), 'Link')}><IconLink size={18} /></ActionIcon>
                  </Tooltip>
                  <Tooltip label={i.status === 'usado' ? 'Já usado' : 'Revogar'}>
                    <ActionIcon size="lg" variant="default" color="red" aria-label="Revogar" disabled={i.status === 'usado'} onClick={() => setRevoke(i)}><IconTrash size={18} /></ActionIcon>
                  </Tooltip>
                </Group>
              ),
            },
          ]}
        />
        </div>
      )}

      <Modal opened={creating} onClose={() => setCreating(false)} centered size="md" title={<Text fw={700} size="lg">Novo convite</Text>}>
        <form onSubmit={e => { e.preventDefault(); void create(); }}>
          <Stack>
            <Select label="Papel de quem usar o convite" size="md" data={ROLE_OPTIONS} value={role} allowDeselect={false}
              onChange={v => setRole((v ?? 'member') as Role)} description={ROLE_HELP[role]} />
            <NumberInput label="Validade" size="md" value={days} onChange={setDays} min={0.01} max={365} decimalScale={2}
              rightSection={<Text size="sm" c="dimmed" pr={8}>dias</Text>} rightSectionWidth={56}
              error={!daysOk ? 'Entre 0,01 e 365 dias' : null} />
            <Group justify="flex-end">
              <Button variant="default" size="md" onClick={() => setCreating(false)}>Cancelar</Button>
              <Button type="submit" size="md" loading={busy} disabled={!daysOk}>Criar convite</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={!!made} onClose={() => setMade(null)} centered size="lg" title={<Text fw={700} size="lg">Convite criado</Text>}>
        {made && (
          <Stack>
            <Text>Mande o código ou o link para a pessoa. Ele vale para <b>uma</b> conta de <b>{ROLE_LABEL[made.role]}</b> até {fmtDate(made.expiresAt)}.</Text>
            <div className="cfg-secret">{made.code}</div>
            <TextInput size="md" readOnly value={inviteLink(made.code, base)} label="Link" onFocus={e => e.currentTarget.select()} />
            <Group justify="space-between" wrap="wrap">
              <Group gap="xs">
                <Button variant="light" leftSection={<IconCopy size={16} />} onClick={() => void copy(made.code, 'Código')}>Copiar código</Button>
                <Button variant="light" leftSection={<IconLink size={16} />} onClick={() => void copy(inviteLink(made.code, base), 'Link')}>Copiar link</Button>
              </Group>
              <Button onClick={() => setMade(null)}>Fechar</Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={!!revoke} onClose={() => setRevoke(null)} centered size="md" title={<Text fw={700} size="lg">Revogar o convite?</Text>}>
        {revoke && (
          <Stack>
            <Text>O código <span className="cfg-code">{revoke.code}</span> deixa de funcionar.</Text>
            <Group justify="flex-end">
              <Button variant="default" size="md" onClick={() => setRevoke(null)}>Cancelar</Button>
              <Button color="red" size="md" loading={busy} onClick={async () => {
                setBusy(true);
                try { await remote.deleteInvite(revoke.code); setRevoke(null); void load(); } catch (e) { fail('Não deu para revogar')(e); } finally { setBusy(false); }
              }}>Revogar</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Section>
  );
}

/* ---------------------------------------------------------------- papéis */
function Roles() {
  return (
    <Section title="Papéis" description="O que cada papel pode fazer no servidor da equipe.">
      <div className="cfg-stats">
        {(['viewer', 'member', 'admin'] as Role[]).map(r => (
          <Paper key={r} withBorder radius="md" p="lg">
            <Text fw={650} size="lg">{ROLE_LABEL[r]}</Text>
            <Text c="dimmed" mt={4}>{ROLE_HELP[r]}.</Text>
          </Paper>
        ))}
      </div>
      <Text size="sm" c="dimmed" mt="md">O último administrador ativo não pode ser rebaixado, desativado nem apagado: promova outra pessoa antes.</Text>
    </Section>
  );
}
