/* Página /config — Preferências: tema, servidor da equipe (endereço, testar /api/info,
 * conectar/desconectar), conta (sair), backup da biblioteca local (JSON com o texto das
 * sessões) e sobre (versões). Tudo fica neste navegador (state/prefs). */
import { useRef, useState } from 'react';
import {
  Alert, Badge, Button, Checkbox, Group, Modal, Paper, Progress, SegmentedControl, Stack, Text, TextInput,
  useMantineColorScheme,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCloud, IconCloudOff, IconDatabase, IconDeviceDesktop, IconDownload, IconLogin, IconLogout, IconMoon, IconPlugConnected,
  IconSun, IconUpload, IconUsers,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { SUMMARY_VERSION } from '@baja/core';
import { PageHeader, Section } from '../components';
import { routeByPath } from '../routes';
import { RemoteLibrary, useLibrary, type ServerInfo } from '../library';
import { DEFAULT_SERVER_URL, normalizeServerUrl, serverUrlInUse, usePrefs, type ThemePref } from '../state/prefs';
import { useProfiles } from '../state/profiles';
import { fmtDate, msgOf, saveTextFile } from './config/parts';
import { ROLE_LABEL } from './config/team';
import { exportBackup, importBackup, parseBackup, type Backup, type BackupCounts, type ImportOptions } from './config/backup';
import webPkg from '../../package.json';
import './config/config.css';

const APP_VERSION: string = (webPkg as { version?: string }).version ?? '?';

export default function PreferenciasPage() {
  const r = routeByPath('/config')!;
  return (
    <>
      <PageHeader title={r.label} subtitle={r.question} />
      <Section>
        <div className="cfg-groups">
          <ThemeCard />
          <AboutCard />
        </div>
      </Section>
      <ServerSection />
      <BackupSection />
    </>
  );
}

/* ---------------------------------------------------------------- tema */
function ThemeCard() {
  const theme = usePrefs(s => s.theme);
  const { setColorScheme } = useMantineColorScheme();
  return (
    <Paper withBorder radius="md" p="lg">
      <Stack gap="sm">
        <Text fw={650} size="lg">Tema</Text>
        <Text size="sm" c="dimmed">Escuro é o padrão (como MoTeC/RaceStudio, bom na pista e à noite). Automático segue o sistema.</Text>
        <SegmentedControl size="md" fullWidth value={theme}
          onChange={v => setColorScheme(v as ThemePref)}
          data={[
            { value: 'dark', label: <Group gap={6} justify="center" wrap="nowrap"><IconMoon size={16} />Escuro</Group> },
            { value: 'light', label: <Group gap={6} justify="center" wrap="nowrap"><IconSun size={16} />Claro</Group> },
            { value: 'auto', label: <Group gap={6} justify="center" wrap="nowrap"><IconDeviceDesktop size={16} />Automático</Group> },
          ]} />
      </Stack>
    </Paper>
  );
}

/* ---------------------------------------------------------------- sobre */
function AboutCard() {
  const { info, mode } = useLibrary();
  return (
    <Paper withBorder radius="md" p="lg">
      <Stack gap="xs">
        <Text fw={650} size="lg">Sobre</Text>
        <Text>Baja Telemetria — app <b>{APP_VERSION}</b> · contas do resumo versão <b>{SUMMARY_VERSION}</b></Text>
        <Text>{mode === 'remote' && info ? <>Servidor: <b>{info.name} {info.version}</b></> : 'Sem servidor da equipe (modo local)'}</Text>
        <Text size="sm" c="dimmed">
          Lê o CSV do FT Manager (FT450) e o log CAN do BUSMASTER e faz todas as contas no navegador, as mesmas do app
          antigo (validadas com o modelo físico). Funciona sem internet na pista; o servidor é só a biblioteca da equipe.
        </Text>
      </Stack>
    </Paper>
  );
}

/* ---------------------------------------------------------------- servidor */
function ServerSection() {
  const nav = useNavigate();
  const savedUrl = usePrefs(s => s.serverUrl);
  const localOnly = usePrefs(s => s.localOnly);
  /* em uso: o salvo aqui ou, sem ele, o servidor padrão do build (VITE_API_URL) */
  const saved = serverUrlInUse({ serverUrl: savedUrl, localOnly });
  const fromBuild = !normalizeServerUrl(savedUrl) && !!saved;
  const setPrefs = usePrefs(s => s.set);
  const { mode, info, offline, user, remote, redetect, logout, loading } = useLibrary();
  const [url, setUrl] = useState(saved);
  const [test, setTest] = useState<{ ok: true; info: ServerInfo } | { ok: false; msg: string } | null>(null);
  const [busy, setBusy] = useState<'test' | 'connect' | null>(null);
  const norm = normalizeServerUrl(url);
  const urlBad = norm !== '' && !/^https?:\/\/[^\s/]+/i.test(norm);
  const sameOrigin = mode === 'remote' && remote && !remote.baseUrl;

  const doTest = async () => {
    if (!norm || urlBad) return;
    setBusy('test'); setTest(null);
    try {
      const i = await new RemoteLibrary(norm).info();
      if (!i || typeof i !== 'object' || !('name' in i)) throw new Error('O endereço respondeu, mas não é um servidor do Baja Telemetria.');
      setTest({ ok: true, info: i });
    } catch (e) {
      setTest({ ok: false, msg: msgOf(e) });
    } finally { setBusy(null); }
  };
  const connect = async () => {
    if (!norm || urlBad) return;
    setBusy('connect');
    try {
      if (norm !== saved) logout();
      setPrefs({ serverUrl: norm, localOnly: false });
      await redetect();
      notifications.show({ color: 'green', title: 'Servidor configurado', message: 'Entre com a sua conta para ver a biblioteca da equipe.', autoClose: 4000 });
    } finally { setBusy(null); }
  };
  const disconnect = async () => {
    logout();
    /* localOnly: não volta sozinho para o servidor padrão do build */
    setPrefs({ serverUrl: '', localOnly: true });
    setUrl(DEFAULT_SERVER_URL);
    setTest(null);
    await redetect();
    notifications.show({ title: 'Modo local', message: 'As sessões e perfis voltam a ficar só neste navegador.', autoClose: 4000 });
  };

  const status = loading ? <Badge size="lg" tt="none" variant="light" color="gray">verificando…</Badge>
    : mode === 'remote'
      ? (offline
        ? <Badge size="lg" tt="none" variant="light" color="red" leftSection={<IconCloudOff size={14} />}>servidor fora do ar</Badge>
        : <Badge size="lg" tt="none" variant="light" leftSection={<IconCloud size={14} />}>conectado{info ? ` · ${info.name} ${info.version}` : ''}</Badge>)
      : <Badge size="lg" tt="none" variant="light" color="gray" leftSection={<IconDatabase size={14} />}>local (só neste navegador)</Badge>;

  return (
    <Section title="Servidor da equipe"
      description="Com o servidor, a equipe inteira vê as mesmas sessões, carros e pistas. Sem ele, tudo fica neste navegador e o app funciona igual (inclusive sem internet).">
      <div className="cfg-groups">
        <Paper withBorder radius="md" p="lg">
          <Stack gap="md">
            <Group justify="space-between" wrap="wrap" gap="xs">
              <Text fw={650} size="lg">Endereço</Text>
              {status}
            </Group>
            {sameOrigin && (
              <Alert color="blue" variant="light">
                Este app está sendo servido pelo próprio servidor da equipe ({window.location.host}): não precisa de endereço.
              </Alert>
            )}
            <TextInput size="md" label="Endereço do servidor" placeholder="https://telemetria.suaequipe.com.br"
              value={url} onChange={e => { setUrl(e.currentTarget.value); setTest(null); }}
              error={urlBad ? 'Comece com http:// ou https://' : null}
              description={fromBuild
                ? 'Servidor padrão desta instalação (vem com o app). Troque se a equipe usar outro endereço.'
                : DEFAULT_SERVER_URL && localOnly
                  ? `Modo local escolhido. O servidor padrão desta instalação é ${DEFAULT_SERVER_URL}: conecte para voltar a ele.`
                  : 'O endereço que o administrador do servidor passou (sem /api no fim).'} />
            {test && (test.ok
              ? <Alert color="green" variant="light" title="O servidor respondeu">
                  {test.info.name} {test.info.version}{test.info.needsSetup ? ' — ainda sem usuários: ao conectar, crie a conta de administrador.' : '.'}
                </Alert>
              : <Alert color="red" variant="light" title="Não deu certo">{test.msg}. Confira o endereço e se o servidor aceita este app (CORS_ORIGINS).</Alert>)}
            <Group gap="xs" wrap="wrap">
              <Button size="md" variant="default" leftSection={<IconPlugConnected size={18} />} loading={busy === 'test'} disabled={!norm || urlBad}
                onClick={() => void doTest()}>Testar conexão</Button>
              <Button size="md" leftSection={<IconCloud size={18} />} loading={busy === 'connect'} disabled={!norm || urlBad}
                onClick={() => void connect()}>{saved && norm === saved ? 'Reconectar' : 'Conectar'}</Button>
              {saved && (
                <Button size="md" variant="light" color="red" leftSection={<IconCloudOff size={18} />} onClick={() => void disconnect()}>
                  Desconectar (usar só este navegador)
                </Button>
              )}
            </Group>
          </Stack>
        </Paper>

        <Paper withBorder radius="md" p="lg">
          <Stack gap="md">
            <Text fw={650} size="lg">Conta</Text>
            {mode !== 'remote' ? (
              <Text c="dimmed">No modo local não há conta: tudo fica neste navegador. Conecte um servidor para entrar.</Text>
            ) : user ? (
              <>
                <Text size="lg"><b>{user.name}</b> · {ROLE_LABEL[user.role]}</Text>
                <Text c="dimmed" style={{ overflowWrap: 'anywhere' }}>{user.email}</Text>
                <Group gap="xs" wrap="wrap">
                  <Button size="md" variant="default" leftSection={<IconUsers size={18} />} onClick={() => nav('/equipe')}>Equipe e trocar a senha</Button>
                  <Button size="md" color="red" variant="light" leftSection={<IconLogout size={18} />}
                    onClick={() => { logout(); notifications.show({ title: 'Você saiu', message: 'Entre de novo para ver a biblioteca da equipe.', autoClose: 3000 }); }}>
                    Sair
                  </Button>
                </Group>
              </>
            ) : (
              <>
                <Text c="dimmed">Você não entrou no servidor{offline ? ' (e ele não está respondendo agora)' : ''}.</Text>
                <Group><Button size="md" leftSection={<IconLogin size={18} />} disabled={offline} onClick={() => nav('/login', { state: { from: '/config' } })}>Entrar</Button></Group>
              </>
            )}
          </Stack>
        </Paper>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- backup local */
function BackupSection() {
  const { lib, mode, bump } = useLibrary();
  const fileRef = useRef<HTMLInputElement>(null);
  const [prog, setProg] = useState<{ what: string; done: number; total: number } | null>(null);
  const [pending, setPending] = useState<{ backup: Backup; counts: BackupCounts; name: string } | null>(null);
  const [opts, setOpts] = useState<ImportOptions>({ profiles: true, sessions: true, config: false });

  const doExport = async () => {
    setProg({ what: 'Lendo as sessões', done: 0, total: 0 });
    try {
      const b = await exportBackup(APP_VERSION, (done, total) => setProg({ what: 'Lendo as sessões', done, total }));
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      saveTextFile(`baja-backup-${stamp}.json`, JSON.stringify(b));
      notifications.show({ color: 'green', title: 'Backup pronto', message: `${b.sessions.length} sessão(ões), ${b.cars.length} carro(s), ${b.tracks.length} pista(s).`, autoClose: 5000 });
    } catch (e) {
      notifications.show({ color: 'red', title: 'Não deu para exportar', message: msgOf(e), autoClose: 8000 });
    } finally { setProg(null); }
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      const { backup, counts } = parseBackup(await f.text());
      setOpts({ profiles: counts.cars + counts.tracks > 0, sessions: counts.sessions > 0, config: false });
      setPending({ backup, counts, name: f.name });
    } catch (e) {
      notifications.show({ color: 'red', title: 'Não deu para ler o backup', message: msgOf(e), autoClose: 8000 });
    }
  };

  const doImport = async () => {
    if (!pending) return;
    const { backup } = pending;
    setPending(null);
    setProg({ what: 'Gravando', done: 0, total: 0 });
    try {
      const r = await importBackup(backup, opts, (done, total) => setProg({ what: 'Gravando as sessões', done, total }));
      if (mode === 'local' && lib) await useProfiles.getState().load(lib);
      bump();
      notifications.show({
        color: 'green', title: 'Backup importado',
        message: `${r.sessions} sessão(ões) nova(s)${r.skipped ? `, ${r.skipped} já existiam` : ''}; ${r.cars} carro(s) e ${r.tracks} pista(s).`,
        autoClose: 6000,
      });
    } catch (e) {
      notifications.show({ color: 'red', title: 'Não deu para importar', message: msgOf(e), autoClose: 8000 });
    } finally { setProg(null); }
  };

  return (
    <Section title="Backup deste navegador"
      description="Um arquivo JSON com a biblioteca local: sessões (com o log inteiro), anotações, perfis de carro e pista, a configuração em uso, fórmulas e layouts da página Canais. Use para levar tudo para outro computador ou antes de limpar o navegador.">
      <Paper withBorder radius="md" p="lg">
        <Stack gap="md">
          {mode === 'remote' && (
            <Alert color="blue" variant="light">
              Você está no servidor da equipe: o backup é da biblioteca <b>local</b> deste navegador (o que foi guardado no modo local),
              não do servidor. O backup do servidor é a pasta de dados dele (docs/IMPLANTACAO.md, seção 6).
            </Alert>
          )}
          <Group gap="sm" wrap="wrap">
            <Button size="md" leftSection={<IconDownload size={18} />} loading={!!prog && prog.what.startsWith('Lendo')} disabled={!!prog}
              onClick={() => void doExport()}>Exportar backup</Button>
            <Button size="md" variant="default" leftSection={<IconUpload size={18} />} disabled={!!prog}
              onClick={() => fileRef.current?.click()}>Importar backup…</Button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden
              onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          </Group>
          {prog && (
            <Stack gap={4}>
              <Text size="sm">{prog.what}{prog.total ? ` (${prog.done} de ${prog.total})` : '…'}</Text>
              <Progress value={prog.total ? (prog.done / prog.total) * 100 : 100} animated={!prog.total} size="lg" />
            </Stack>
          )}
        </Stack>
      </Paper>

      <Modal opened={!!pending} onClose={() => setPending(null)} centered size="md" title={<Text fw={700} size="lg">Importar backup</Text>}>
        {pending && (
          <Stack>
            <Text style={{ overflowWrap: 'anywhere' }}><b>{pending.name}</b> — exportado em {fmtDate(pending.backup.exportedAt)}</Text>
            <Text c="dimmed" size="sm">
              {pending.counts.sessions} sessão(ões) ({(pending.counts.bytes / 1048576).toFixed(1)} MB de log), {pending.counts.comments} anotação(ões),
              {' '}{pending.counts.cars} carro(s), {pending.counts.tracks} pista(s).
            </Text>
            <Checkbox size="md" checked={opts.sessions} disabled={!pending.counts.sessions} onChange={e => setOpts(o => ({ ...o, sessions: e.currentTarget.checked }))}
              label="Sessões e anotações" description="Sessões que já existem aqui (mesmo arquivo e tamanho) são puladas." />
            <Checkbox size="md" checked={opts.profiles} disabled={!pending.counts.cars && !pending.counts.tracks} onChange={e => setOpts(o => ({ ...o, profiles: e.currentTarget.checked }))}
              label="Perfis de carro e pista" description="Perfis com o mesmo identificador são substituídos." />
            <Checkbox size="md" checked={opts.config} disabled={!pending.backup.config && !pending.backup.formulas} onChange={e => setOpts(o => ({ ...o, config: e.currentTarget.checked }))}
              label="Configuração em uso, fórmulas e layouts" description="Troca os dados do carro e da pista em uso pelos do backup e recalcula a sessão aberta." />
            <Group justify="flex-end">
              <Button variant="default" size="md" onClick={() => setPending(null)}>Cancelar</Button>
              <Button size="md" disabled={!opts.sessions && !opts.profiles && !opts.config} onClick={() => void doImport()}>Importar</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Section>
  );
}
