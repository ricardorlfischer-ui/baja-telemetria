/* Peças compartilhadas pelas páginas de configuração (Carro, Pista e GPS, Equipe,
 * Preferências, Login): campo numérico que aceita vírgula, grupo de campos com ⓘ, links
 * "usado em" para os cards, lista de avisos da qualidade dos dados e permissões dos perfis.
 * Só desenho: as contas são do @baja/core. */
import { useEffect, useState, type ReactNode } from 'react';
import {
  Button, Group, Paper, Select, Stack, Text, TextInput, Title, UnstyledButton,
} from '@mantine/core';
import { IconAlertOctagon, IconAlertTriangle, IconInfoCircle, IconPlayerPlay, type Icon } from '@tabler/icons-react';
import { getExplain, type QualityIssue, type SensorId } from '@baja/core';
import { InfoButton, SensorChips, useExplain } from '../../components';
import { useLibrary, type User } from '../../library';
import { STATUS_COLOR } from '../../theme';
import './config.css';

/* ---------------------------------------------------------------- campo numérico */

const show = (v: number | undefined | null): string => (v === undefined || v === null || !isFinite(v) ? '' : String(v));

export interface NumFieldProps {
  label: ReactNode;
  value: number | undefined | null;
  unit?: string;
  description?: ReactNode;
  min?: number;
  max?: number;
  /** grava (só números válidos, ao sair do campo ou com Enter) */
  onCommit: (v: number) => void;
  disabled?: boolean;
  placeholder?: string;
}

/** Campo numérico: aceita vírgula ou ponto (como o app antigo), grava ao sair do campo ou com
 *  Enter — recalcular a cada tecla com um log de 28 MB travaria a tela. */
export function NumField({ label, value, unit, description, min, max, onCommit, disabled, placeholder }: NumFieldProps) {
  const [txt, setTxt] = useState(show(value));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setTxt(show(value)); setErr(null); }, [value]);
  const commit = () => {
    const s = txt.trim();
    if (s === '') { setTxt(show(value)); setErr(null); return; }
    const v = parseFloat(s.replace(',', '.'));
    if (!isFinite(v)) { setErr('Digite um número (ex.: 1.6 ou 1,6)'); return; }
    if (min !== undefined && v < min) { setErr(`Mínimo: ${min}${unit ? ' ' + unit : ''}`); return; }
    if (max !== undefined && v > max) { setErr(`Máximo: ${max}${unit ? ' ' + unit : ''}`); return; }
    setErr(null);
    setTxt(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <TextInput
      label={label} description={description} size="md" inputMode="decimal" disabled={disabled}
      value={txt} error={err} placeholder={placeholder}
      onChange={e => { setTxt(e.currentTarget.value); if (err) setErr(null); }}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { setTxt(show(value)); setErr(null); } }}
      rightSection={unit ? <Text size="sm" c="dimmed" pr={8} style={{ whiteSpace: 'nowrap' }}>{unit}</Text> : undefined}
      rightSectionWidth={unit ? Math.max(40, unit.length * 8 + 22) : undefined}
      rightSectionPointerEvents="none"
    />
  );
}

/** Lista de opções com "nenhum/automático" + os canais do log. */
export function ChannelSelect({ label, value, onChange, options, description, disabled, firstLabel }: {
  label: ReactNode; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
  description?: ReactNode; disabled?: boolean;
  /** rótulo da opção vazia ('automático (canal achado)', '— nenhum —') */
  firstLabel: string;
}) {
  /* valor salvo que não existe neste log: mostra mesmo assim (não some sem avisar) */
  const data = [{ value: '', label: firstLabel }, ...options];
  if (value && !options.some(o => o.value === value)) data.push({ value, label: `${value} (não está neste log)` });
  return (
    <Select
      label={label} description={description} size="md" disabled={disabled}
      style={{ gridColumn: '1 / -1' }}
      data={data} value={value} allowDeselect={false} searchable={data.length > 12}
      onChange={v => onChange(v ?? '')} comboboxProps={{ withinPortal: true }} maxDropdownHeight={360}
      nothingFoundMessage="Nenhum canal com esse nome"
    />
  );
}

/* ---------------------------------------------------------------- grupo de campos */

/** Links para os cards das análises que usam os campos ("usado em"). */
export function UsedIn({ ids, sensors, label = 'Entra em:' }: { ids: string[]; sensors?: SensorId[]; label?: string }) {
  const { open } = useExplain();
  const items = ids.map(id => ({ id, title: getExplain(id)?.title ?? id }));
  if (!items.length) return null;
  return (
    <div className="cfg-used-in">
      <Text size="sm" c="dimmed" fw={500}>{label}</Text>
      {items.map(it => (
        <UnstyledButton key={it.id} className="cfg-link" onClick={() => open(it.id, { sensors, title: it.title })}
          title="Abrir explicação">
          {it.title}
        </UnstyledButton>
      ))}
    </div>
  );
}

export interface FieldGroupProps {
  title: string;
  description?: ReactNode;
  /** card do ⓘ do grupo (padrão: o "sensor" medidas do carro) */
  explain?: string;
  sensors?: SensorId[];
  /** cards das análises que usam estes campos */
  usedIn?: string[];
  /** nota abaixo dos campos (textos de ajuda do app antigo) */
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

/** Cartão com o título do grupo (clicável → card), ⓘ, chips, campos em grade e nota. */
export function FieldGroup({ title, description, explain = 'sensor.car_data', sensors = ['car_data'], usedIn, note, actions, children }: FieldGroupProps) {
  const { open } = useExplain();
  return (
    <Paper withBorder radius="md" p="lg" className="cfg-group">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
          <Stack gap={4} style={{ minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <UnstyledButton className="bt-card-title--link" onClick={() => open(explain, { sensors, title })} title="Abrir explicação">
                <Title order={3} fz={17}>{title}</Title>
              </UnstyledButton>
              <InfoButton explain={explain} sensors={sensors} title={title} />
            </Group>
            <SensorChips sensors={sensors} />
          </Stack>
          {actions && <Group gap={6} wrap="nowrap">{actions}</Group>}
        </Group>
        {description && <Text c="dimmed" size="sm">{description}</Text>}
        <div className="cfg-fields">{children}</div>
        {note && <div className="cfg-note">{note}</div>}
        {usedIn && usedIn.length > 0 && <UsedIn ids={usedIn} sensors={sensors} />}
      </Stack>
    </Paper>
  );
}

/* ---------------------------------------------------------------- avisos da qualidade */

const LEVEL: Record<QualityIssue['level'], { color: string; label: string; icon: Icon }> = {
  error: { color: STATUS_COLOR.crit, label: 'Problema', icon: IconAlertOctagon },
  warn: { color: STATUS_COLOR.warn, label: 'Atenção', icon: IconAlertTriangle },
  info: { color: 'var(--mantine-color-dimmed)', label: 'Informação', icon: IconInfoCircle },
};

/** Avisos do dataQuality do core (texto, o que fazer, sensores, ⓘ e "ir ao ponto"). */
export function IssueList({ issues, onSeek, seekLabel = 'Ir ao ponto', empty }: {
  issues: QualityIssue[];
  onSeek?: (t: number) => void;
  seekLabel?: string;
  empty?: ReactNode;
}) {
  const { open } = useExplain();
  if (!issues.length) return empty ? <>{empty}</> : null;
  return (
    <Stack gap="sm">
      {issues.map(q => {
        const L = LEVEL[q.level];
        const Ico = L.icon;
        return (
          <Paper key={q.id} withBorder radius="md" p="md" className="cfg-issue" style={{ ['--cfg-issue' as string]: L.color }}>
            <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
              <Stack gap={6} style={{ minWidth: 0 }}>
                <Group gap={10} wrap="wrap">
                  <span className="cfg-issue-level"><Ico size={16} stroke={2} aria-hidden />{L.label}</span>
                  <UnstyledButton className="bt-card-title--link" onClick={() => open(q.explain, { sensors: q.sensors })}>
                    <Text fw={600}>{q.text}</Text>
                  </UnstyledButton>
                </Group>
                <Text size="sm" c="dimmed">{q.action}</Text>
                <SensorChips sensors={q.sensors} />
              </Stack>
              <Group gap={4} wrap="nowrap">
                {onSeek && q.t !== undefined && (
                  <Button size="sm" variant="light" leftSection={<IconPlayerPlay size={15} />} onClick={() => onSeek(q.t!)}>
                    {seekLabel}
                  </Button>
                )}
                <InfoButton explain={q.explain} sensors={q.sensors} />
              </Group>
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}

/* ---------------------------------------------------------------- permissões */

/** Perfil como vem da biblioteca (o servidor manda também quem criou e quantas sessões usam). */
export interface ProfileLike {
  id: string;
  name: string;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: string;
  sessions?: number;
}

export interface ProfilePerms {
  remote: boolean;
  user: User | null;
  /** pode criar perfis (local: sempre; servidor: membro ou admin conectado) */
  canCreate: boolean;
  /** pode mudar/apagar este perfil (servidor: quem criou ou admin — PUT de outro dá 403) */
  canEdit: (p: ProfileLike | null | undefined) => boolean;
  /** por que não pode (para a mensagem) */
  whyNot: (p: ProfileLike | null | undefined) => string;
}

export function useProfilePerms(): ProfilePerms {
  const { mode, user } = useLibrary();
  const remote = mode === 'remote';
  const canCreate = !remote || (!!user && user.role !== 'viewer');
  const canEdit = (p: ProfileLike | null | undefined) => {
    if (!p) return false;
    if (!remote) return true;
    if (!user) return false;
    return user.role === 'admin' || (user.role === 'member' && !!p.createdBy && p.createdBy === user.id);
  };
  const whyNot = (p: ProfileLike | null | undefined) => {
    if (!remote || !p) return '';
    if (!user) return 'Entre no servidor da equipe para mudar perfis.';
    if (user.role === 'viewer') return 'Seu papel é "leitor": só lê os perfis da equipe.';
    if (canEdit(p)) return '';
    return `Criado por ${p.createdByName || 'outra pessoa'}: só quem criou (ou um administrador) pode mudar ou apagar.`;
  };
  return { remote, user, canCreate, canEdit, whyNot };
}

/* ---------------------------------------------------------------- utilidades */

/** Copia para a área de transferência (com recurso para navegador sem clipboard API). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

/** Data/hora curta em português. */
export const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
