/* Bloco de número: rótulo, valor grande (28 px), unidade, status (ícone + texto, nunca só
 * cor), sensores e card de explicação (rótulo clicável + ⓘ). */
import type { ReactNode } from 'react';
import { Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconAlertTriangle, IconCircleCheck, IconAlertOctagon, IconAlertCircle, type Icon } from '@tabler/icons-react';
import type { SensorId } from '@baja/core';
import { InfoButton, useExplain } from './explain';
import { SensorChips } from './SensorChips';
import { STATUS_COLOR, STATUS_LABEL, type Status } from '../theme';

const STATUS_ICON: Record<Status, Icon> = {
  good: IconCircleCheck, warn: IconAlertTriangle, serious: IconAlertCircle, crit: IconAlertOctagon,
};

export interface StatTileProps {
  label: ReactNode;
  /** número já formatado (string) ou número cru; null/NaN = "—" */
  value: ReactNode | number | null | undefined;
  unit?: string;
  /** casas decimais quando value é número (toFixed, como no app antigo) */
  decimals?: number;
  /** linha pequena abaixo (ex.: "volta 3", "no FL") */
  hint?: ReactNode;
  status?: Status;
  /** texto do status (padrão: Bom / Atenção / Sério / Crítico) */
  statusText?: string;
  explain?: string;
  sensors?: SensorId[];
}

export function StatTile({ label, value, unit, decimals, hint, status, statusText, explain, sensors }: StatTileProps) {
  const { open } = useExplain();
  const t = typeof label === 'string' ? label : undefined;
  let shown: ReactNode = value as ReactNode;
  if (value === null || value === undefined || (typeof value === 'number' && !isFinite(value))) shown = '—';
  else if (typeof value === 'number' && decimals !== undefined) shown = value.toFixed(decimals);
  const missing = shown === '—';
  const SIco = status ? STATUS_ICON[status] : null;
  return (
    <Paper withBorder radius="md" p="md" className="bt-stat">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" gap={4} align="flex-start">
          {explain ? (
            <UnstyledButton className="bt-stat-label bt-card-title--link" onClick={() => open(explain, { sensors, title: t })}>
              {label}
            </UnstyledButton>
          ) : <span className="bt-stat-label">{label}</span>}
          {explain && <InfoButton explain={explain} sensors={sensors} title={t} size="sm" />}
        </Group>
        <div className="bt-stat-value">
          <span className={missing ? 'bt-stat-num bt-stat-num--missing' : 'bt-stat-num'}>{shown}</span>
          {unit && !missing && <span className="bt-stat-unit">{unit}</span>}
        </div>
        {(hint || status) && (
          <Group gap={8} wrap="wrap">
            {status && SIco && (
              <span className="bt-status" style={{ ['--bt-status' as string]: STATUS_COLOR[status] }}>
                <SIco size={15} stroke={2} aria-hidden />
                {statusText ?? STATUS_LABEL[status]}
              </span>
            )}
            {hint && <Text size="sm" c="dimmed">{hint}</Text>}
          </Group>
        )}
        <SensorChips sensors={sensors} />
      </Stack>
    </Paper>
  );
}
