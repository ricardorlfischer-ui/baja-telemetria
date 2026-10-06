/* Página /login — tela própria, por cima da casca do app (sem menu nem cabeçalho):
 * primeiro acesso (servidor sem usuários → criar o administrador), entrar, ou criar conta com
 * um código de convite (#/login?convite=CÓDIGO, opcionalmente &servidor=ENDEREÇO).
 * Depois de entrar, volta para onde estava (state.from, ?volta= ou a página anterior). */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert, Anchor, Button, Center, Group, Loader, Paper, PasswordInput, SegmentedControl, Stack, Text, TextInput, Title,
} from '@mantine/core';
import { IconArrowLeft, IconCloud, IconLogin, IconServer, IconShieldLock, IconUserPlus } from '@tabler/icons-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { RemoteLibrary, useLibrary, type AuthResult } from '../library';
import { normalizeServerUrl, usePrefs } from '../state/prefs';
import { msgOf } from './config/parts';
import { PASSWORD_MIN, ROLE_LABEL, emailOk } from './config/team';
import { APP_NAME, BrandLogo, TEAM_NAME } from '../brand';
import './config/config.css';

type Tab = 'login' | 'register';

export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const { mode, loading, info, user, remote, offline, setUser, redetect, bump, logout } = useLibrary();
  const invite = (params.get('convite') || '').trim().toUpperCase();
  const linkServer = normalizeServerUrl(params.get('servidor') || '');
  const [tab, setTab] = useState<Tab>(invite ? 'register' : 'login');

  /* para onde voltar depois de entrar */
  const back = useMemo(() => {
    const st = loc.state as { from?: string } | null;
    const v = params.get('volta');
    if (st?.from && st.from !== '/login') return st.from;
    if (v && v.startsWith('/') && !v.startsWith('/login')) return v;
    return null;
  }, [loc.state, params]);
  const goBack = () => {
    if (back) { nav(back, { replace: true }); return; }
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) nav(-1); else nav('/', { replace: true });
  };

  const done = async (r: AuthResult, refresh: boolean) => {
    setUser(r.user);
    if (refresh) await redetect();   /* primeiro acesso: needsSetup muda */
    bump();                           /* perfis e sessões da equipe (agora com permissão) */
    goBack();
  };

  /* o link do convite traz outro servidor: pergunta antes de trocar */
  const currentServer = remote?.baseUrl ?? '';
  const askServer = !!linkServer && linkServer !== currentServer && !(mode === 'remote' && !currentServer && linkServer === normalizeServerUrl(window.location.origin));

  let content: ReactNode;
  if (loading) content = <Center py={60}><Loader /></Center>;
  else if (askServer) content = <UseServer url={linkServer} onUse={async () => { usePrefs.getState().set({ serverUrl: linkServer, localOnly: false }); await redetect(); }} />;
  else if (mode !== 'remote' || !remote) {
    content = (
      <Stack gap="md">
        <Alert color="gray" variant="light" icon={<IconServer size={18} />} title="Sem servidor da equipe">
          O app está no modo local: as sessões ficam só neste navegador e não há login. Para entrar, configure o endereço do
          servidor da equipe em Preferências (ou abra o endereço do próprio servidor).
        </Alert>
        <Group justify="space-between">
          <Button variant="default" size="md" leftSection={<IconArrowLeft size={17} />} onClick={goBack}>Voltar</Button>
          <Button size="md" onClick={() => nav('/config')}>Abrir Preferências</Button>
        </Group>
      </Stack>
    );
  } else if (offline || !info) {
    content = (
      <Stack gap="md">
        <Alert color="red" variant="light" title="O servidor não respondeu">
          {remote.baseUrl || 'O servidor'} não respondeu. Confira a internet e se o servidor está ligado, ou mude o endereço em Preferências.
        </Alert>
        <Group justify="space-between">
          <Button variant="default" size="md" leftSection={<IconArrowLeft size={17} />} onClick={goBack}>Voltar</Button>
          <Group gap="xs">
            <Button variant="default" size="md" onClick={() => void redetect()}>Tentar de novo</Button>
            <Button size="md" onClick={() => nav('/config')}>Preferências</Button>
          </Group>
        </Group>
      </Stack>
    );
  } else if (user) {
    content = (
      <Stack gap="md">
        <Text size="lg">Você já entrou como <b>{user.name}</b> ({ROLE_LABEL[user.role]}).</Text>
        <Group justify="space-between">
          <Button variant="default" size="md" onClick={() => logout()}>Sair e entrar com outra conta</Button>
          <Button size="md" onClick={goBack}>Continuar</Button>
        </Group>
      </Stack>
    );
  } else if (info.needsSetup) {
    content = <SetupForm remote={remote} onDone={r => done(r, true)} />;
  } else {
    content = (
      <Stack gap="lg">
        <SegmentedControl fullWidth size="md" value={tab} onChange={v => setTab(v as Tab)}
          data={[{ value: 'login', label: 'Entrar' }, { value: 'register', label: 'Criar conta com convite' }]} />
        {tab === 'login'
          ? <LoginForm remote={remote} onDone={r => done(r, false)} />
          : <RegisterForm remote={remote} code0={invite} onDone={r => done(r, false)} />}
      </Stack>
    );
  }

  return (
    <div className="cfg-login" role="dialog" aria-label="Entrar no servidor da equipe">
      <Stack className="cfg-login-card" gap="lg">
        <Group gap="md" justify="center" wrap="nowrap" className="cfg-login-brand">
          <BrandLogo size={64} />
          <Stack gap={2}>
            <Text className="cfg-login-kicker">{APP_NAME}</Text>
            <Title order={1} fz={28} c="white">{TEAM_NAME}</Title>
          </Stack>
        </Group>
        <Paper withBorder radius="lg" p="xl" shadow="md">
          <Stack gap="lg">
            <Stack gap={4}>
              <Title order={2} fz={21}>
                {info?.needsSetup && mode === 'remote' && !user ? 'Primeiro acesso' : 'Servidor da equipe'}
              </Title>
              <Group gap={6} c="dimmed">
                <IconCloud size={16} />
                <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                  {mode === 'remote' && remote
                    ? `${info?.name ?? 'Servidor'}${info?.version ? ' ' + info.version : ''} · ${remote.baseUrl || window.location.host}`
                    : 'biblioteca local (sem servidor)'}
                </Text>
              </Group>
            </Stack>
            {content}
          </Stack>
        </Paper>
        <Group justify="center">
          <Anchor component="button" type="button" c="dimmed" size="sm" onClick={goBack}>
            Continuar sem entrar (o app funciona com a biblioteca deste navegador)
          </Anchor>
        </Group>
      </Stack>
    </div>
  );
}

/* ---------------------------------------------------------------- formulários */

function UseServer({ url, onUse }: { url: string; onUse: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    new RemoteLibrary(url).info().then(i => { if (alive) setName(`${i.name} ${i.version}`); }).catch(e => { if (alive) setErr(msgOf(e)); });
    return () => { alive = false; };
  }, [url]);
  return (
    <Stack gap="md">
      <Text>O convite é do servidor <b style={{ overflowWrap: 'anywhere' }}>{url}</b>{name ? ` (${name})` : ''}. Usar este servidor neste navegador?</Text>
      <Text size="sm" c="dimmed">O endereço fica salvo em Preferências; dá para voltar ao modo local depois.</Text>
      {err && <Alert color="red" variant="light" title="O servidor não respondeu">{err}</Alert>}
      <Group justify="flex-end">
        <Button size="md" loading={busy} disabled={!!err} onClick={async () => { setBusy(true); try { await onUse(); } finally { setBusy(false); } }}>
          Usar este servidor
        </Button>
      </Group>
    </Stack>
  );
}

function useSubmit(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(msgOf(e)); setBusy(false); }
  };
  return { busy, err, run, setErr };
}

function LoginForm({ remote, onDone }: { remote: RemoteLibrary; onDone: (r: AuthResult) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const s = useSubmit(async () => onDone(await remote.login(email.trim(), pw)));
  const can = email.trim().length > 0 && pw.length > 0 && !s.busy;
  return (
    <form onSubmit={e => { e.preventDefault(); if (can) void s.run(); }}>
      <Stack gap="md">
        <TextInput label="E-mail" size="md" type="email" autoComplete="username" data-autofocus autoFocus
          value={email} onChange={e => setEmail(e.currentTarget.value)} />
        <PasswordInput label="Senha" size="md" autoComplete="current-password" value={pw} onChange={e => setPw(e.currentTarget.value)} />
        {s.err && <Alert color="red" variant="light">{s.err}</Alert>}
        <Button type="submit" size="md" fullWidth loading={s.busy} disabled={!can} leftSection={<IconLogin size={18} />}>Entrar</Button>
        <Text size="sm" c="dimmed">Esqueceu a senha? Peça a um administrador: em Equipe ele pode criar uma senha nova para você.</Text>
      </Stack>
    </form>
  );
}

function AccountFields({ name, setName, email, setEmail, pw, setPw, pw2, setPw2 }: {
  name: string; setName: (v: string) => void; email: string; setEmail: (v: string) => void;
  pw: string; setPw: (v: string) => void; pw2: string; setPw2: (v: string) => void;
}) {
  return (
    <>
      <TextInput label="Nome" size="md" autoComplete="name" value={name} onChange={e => setName(e.currentTarget.value)} maxLength={120} />
      <TextInput label="E-mail" size="md" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.currentTarget.value)}
        error={email.length > 3 && !emailOk(email) ? 'E-mail inválido' : null} />
      <PasswordInput label="Senha" size="md" autoComplete="new-password" value={pw} onChange={e => setPw(e.currentTarget.value)}
        description={`Pelo menos ${PASSWORD_MIN} caracteres.`}
        error={pw.length > 0 && pw.length < PASSWORD_MIN ? `Pelo menos ${PASSWORD_MIN} caracteres` : null} />
      <PasswordInput label="Repita a senha" size="md" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.currentTarget.value)}
        error={pw2.length > 0 && pw2 !== pw ? 'As senhas não são iguais' : null} />
    </>
  );
}
const accountOk = (name: string, email: string, pw: string, pw2: string) =>
  name.trim().length > 0 && emailOk(email) && pw.length >= PASSWORD_MIN && pw === pw2;

function SetupForm({ remote, onDone }: { remote: RemoteLibrary; onDone: (r: AuthResult) => Promise<void> }) {
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState('');
  const s = useSubmit(async () => onDone(await remote.setup({ name: name.trim(), email: email.trim(), password: pw })));
  const can = accountOk(name, email, pw, pw2) && !s.busy;
  return (
    <form onSubmit={e => { e.preventDefault(); if (can) void s.run(); }}>
      <Stack gap="md">
        <Alert color="blue" variant="light" icon={<IconShieldLock size={18} />} title="Este servidor ainda não tem usuários">
          Crie a conta de <b>administrador</b>: ela convida o resto da equipe (Equipe → Convites) e pode mudar tudo. Guarde bem a senha.
        </Alert>
        <AccountFields {...{ name, setName, email, setEmail, pw, setPw, pw2, setPw2 }} />
        {s.err && <Alert color="red" variant="light">{s.err}</Alert>}
        <Button type="submit" size="md" fullWidth loading={s.busy} disabled={!can} leftSection={<IconShieldLock size={18} />}>Criar administrador e entrar</Button>
      </Stack>
    </form>
  );
}

function RegisterForm({ remote, code0, onDone }: { remote: RemoteLibrary; code0: string; onDone: (r: AuthResult) => Promise<void> }) {
  const [code, setCode] = useState(code0);
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState('');
  const s = useSubmit(async () => onDone(await remote.register({ code: code.trim().toUpperCase(), name: name.trim(), email: email.trim(), password: pw })));
  const can = code.trim().length > 0 && accountOk(name, email, pw, pw2) && !s.busy;
  return (
    <form onSubmit={e => { e.preventDefault(); if (can) void s.run(); }}>
      <Stack gap="md">
        <Text size="sm" c="dimmed">Peça um código de convite a um administrador da equipe (ou abra o link que ele mandou).</Text>
        <TextInput label="Código do convite" size="md" value={code} onChange={e => setCode(e.currentTarget.value.toUpperCase())}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', letterSpacing: '0.08em', fontWeight: 600 } }} maxLength={64} />
        <AccountFields {...{ name, setName, email, setEmail, pw, setPw, pw2, setPw2 }} />
        {s.err && <Alert color="red" variant="light">{s.err}</Alert>}
        <Button type="submit" size="md" fullWidth loading={s.busy} disabled={!can} leftSection={<IconUserPlus size={18} />}>Criar conta e entrar</Button>
      </Stack>
    </form>
  );
}
