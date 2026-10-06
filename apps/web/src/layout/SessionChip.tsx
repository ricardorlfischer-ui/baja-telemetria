/* Seletor da sessão aberta no cabeçalho (docs/ARQUITETURA.md 4.2): nome, tipo, duração e um
 * menu (guardar na biblioteca a sessão aberta sem salvar, trocar sessão → biblioteca, abrir o
 * exemplo, fechar — fechar também faz o app não reabrir a sessão ao carregar). Mostra "abrindo…" e
 * "recalculando…" enquanto o core trabalha. */
import { Badge, Box, Button, Group, Loader, Menu, Text, Tooltip } from '@mantine/core';
import { IconChevronDown, IconDatabasePlus, IconFlask, IconFolderOpen, IconX } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { fmtTime } from '@baja/core';
import { useRange, useSessionStore } from '../state/session';
import { useSaveOpenSession } from '../state/useSaveOpenSession';

export function SessionChip() {
  const S = useSessionStore(s => s.S);
  const status = useSessionStore(s => s.status);
  const loadingText = useSessionStore(s => s.loadingText);
  const busy = useSessionStore(s => s.busy);
  const source = useSessionStore(s => s.source);
  const close = useSessionStore(s => s.close);
  const openDemo = useSessionStore(s => s.openDemo);
  const setLap = useSessionStore(s => s.setLap);
  const setRangeMode = useSessionStore(s => s.setRangeMode);
  const selLap = useSessionStore(s => s.selLap);
  const laps = useSessionStore(s => s.ctx?.laps) ?? [];
  const range = useRange();
  const nav = useNavigate();
  const saver = useSaveOpenSession();

  if (status === 'loading') {
    return (
      <Button variant="default" size="sm" leftSection={<Loader size={14} />} className="bt-session-chip" aria-live="polite">
        <Text span size="sm" truncate maw={240}>{loadingText || 'Abrindo…'}</Text>
      </Button>
    );
  }
  if (!S) {
    return (
      <Button variant="default" size="sm" leftSection={<IconFolderOpen size={17} />} onClick={() => nav('/')}>
        Abrir sessão
      </Button>
    );
  }
  const dur = S.t.length ? S.t[S.t.length - 1] - S.t[0] : 0;
  const kind = S.demo ? 'Exemplo' : S.kind === 'BUSMASTER' ? 'CAN' : 'FT';
  const name = source?.name || S.name;
  return (
    <Menu position="bottom-start" width={260} withinPortal>
      <Menu.Target>
        <Tooltip label={`${name} · ${S.info}`} multiline maw={360} openDelay={400}>
          <Button variant="default" size="sm" className="bt-session-chip" rightSection={<IconChevronDown size={14} />}
            leftSection={busy ? <Loader size={14} /> : (
              <Badge size="xs" variant="light" color={S.demo ? 'grape' : 'brand'} style={{ flexShrink: 0, overflow: 'visible' }}
                styles={{ label: { overflow: 'visible' } }}>{kind}</Badge>
            )}>
            <Text span size="sm" fw={600} truncate maw={200}>{name}</Text>
            <Text span size="sm" c="dimmed" ml={8} className="bt-num" visibleFrom="lg">{busy ? 'recalculando…' : fmtTime(dur)}</Text>
          </Button>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>
          <Group gap={6} wrap="nowrap">
            <Text size="xs" truncate>{S.info}</Text>
          </Group>
        </Menu.Label>
        {/* no celular o seletor de trecho do cabeçalho não cabe: fica aqui */}
        <Box hiddenFrom="md">
          <Menu.Label>Trecho: {range ? range[2] : '—'}</Menu.Label>
          <Menu.Item onClick={() => { setLap(-1); setRangeMode('session'); }}>Sessão inteira</Menu.Item>
          {laps.map((l, k) => (
            <Menu.Item key={k} onClick={() => { setLap(k); setRangeMode('lap'); }}>
              Volta {l.n} · {fmtTime(l.time)}{k === selLap ? ' ✓' : ''}
            </Menu.Item>
          ))}
          <Menu.Divider />
        </Box>
        {saver.canSave && (
          <Menu.Item leftSection={<IconDatabasePlus size={16} />} disabled={saver.saving} onClick={() => { void saver.save(); }}>
            Guardar na biblioteca
          </Menu.Item>
        )}
        <Menu.Item leftSection={<IconFolderOpen size={16} />} onClick={() => nav('/')}>Trocar sessão</Menu.Item>
        {!S.demo && <Menu.Item leftSection={<IconFlask size={16} />} onClick={() => void openDemo()}>Abrir o exemplo</Menu.Item>}
        <Menu.Divider />
        <Menu.Item leftSection={<IconX size={16} />} color="red" onClick={() => { close(); nav('/'); }}>Fechar sessão</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
