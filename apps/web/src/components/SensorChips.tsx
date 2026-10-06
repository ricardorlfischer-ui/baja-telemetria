/* Chips dos sensores que alimentam um gráfico/número (docs/ARQUITETURA.md 3.8 e 4.6).
 *
 *   verde (cheio)   = presente neste log
 *   cinza riscado   = ausente neste log
 *   tracejado       = sugerido (ainda não instalado no carro)
 *   neutro          = sem sessão aberta / disponibilidade desconhecida
 *
 * Rótulos e nomes vêm do catálogo SENSORS do core (sensors.ts); aqui só os ícones. A
 * disponibilidade vem do SensorAvailabilityProvider, que o App alimenta com
 * sensorAvailability(ctx) da sessão aberta (state/SessionSync.tsx).
 * Clicar num chip abre o card do sensor ('sensor.<id>'), a não ser que onClick seja passado. */
import { createContext, useContext, type ReactNode } from 'react';
import { Group, Tooltip, UnstyledButton } from '@mantine/core';
import {
  IconAntenna, IconArrowsVertical, IconBolt, IconClock, IconDeviceSdCard, IconEngine, IconGauge,
  IconHandStop, IconRuler, IconSteeringWheel, IconTemperature, IconCompass, type Icon,
} from '@tabler/icons-react';
import { SENSORS, type SensorId } from '@baja/core';
import { useExplain } from './explain';

export type SensorState = 'present' | 'absent' | 'planned';

interface SensorLabel { short: string; name: string; icon: Icon; planned?: boolean }

const ICONS: Record<SensorId, Icon> = {
  gps: IconAntenna,
  shock_fl: IconArrowsVertical, shock_fr: IconArrowsVertical, shock_rl: IconArrowsVertical, shock_rr: IconArrowsVertical,
  wheel: IconGauge, cvt_temp: IconTemperature, logger: IconClock, car_data: IconRuler,
  engine_rpm: IconEngine, imu: IconCompass, brake_pressure: IconHandStop, steering: IconSteeringWheel, throttle: IconBolt,
};

/** Rótulo curto, nome e ícone de cada sensor (do catálogo SENSORS do core). */
export const SENSOR_LABELS: Record<SensorId, SensorLabel> = Object.fromEntries(
  (Object.keys(SENSORS) as SensorId[]).map(id => {
    const s = SENSORS[id];
    return [id, { short: s.short, name: s.planned ? `${s.name} (sugerido)` : s.name, icon: ICONS[id] ?? IconDeviceSdCard, planned: !!s.planned }];
  }),
) as Record<SensorId, SensorLabel>;
/* ícone genérico se aparecer um id fora do catálogo */
const FALLBACK: SensorLabel = { short: '?', name: 'Sensor fora do catálogo', icon: IconDeviceSdCard };

/** Ícone do sensor (para listas fora dos chips). */
export const sensorIcon = (id: SensorId): Icon => ICONS[id] ?? IconDeviceSdCard;

/* ---------------------------------------------------------------- disponibilidade */
type Availability = Partial<Record<SensorId, SensorState>> | null;
const AvailabilityContext = createContext<Availability>(null);

/** Disponibilidade dos sensores na sessão aberta (sensorAvailability(ctx) do core). */
export function SensorAvailabilityProvider({ value, children }: { value: Availability; children: ReactNode }) {
  return <AvailabilityContext.Provider value={value}>{children}</AvailabilityContext.Provider>;
}
export const useSensorAvailability = (): Availability => useContext(AvailabilityContext);

export const SENSOR_STATE_TEXT: Record<SensorState | 'unknown', string> = {
  present: 'presente neste log',
  absent: 'ausente neste log',
  planned: 'sugerido: ainda não instalado',
  unknown: '',
};

export interface SensorChipsProps {
  sensors: readonly SensorId[] | undefined;
  /** estado por sensor; sem isto usa o SensorAvailabilityProvider; sem os dois, neutro */
  availability?: Partial<Record<SensorId, SensorState>>;
  size?: 'xs' | 'sm';
  /** clique num chip; padrão: abre o card do sensor ('sensor.<id>'). false = chips sem clique */
  onClick?: ((id: SensorId) => void) | false;
}

export function SensorChips({ sensors, availability, size = 'xs', onClick }: SensorChipsProps) {
  const ctxAvail = useSensorAvailability();
  const { open } = useExplain();
  if (!sensors || !sensors.length) return null;
  const avail = availability ?? ctxAvail;
  const click = onClick === false ? null : onClick ?? ((id: SensorId) => open('sensor.' + id));
  return (
    <Group gap={4} wrap="wrap" className="bt-sensor-chips">
      {sensors.map(id => {
        const L = (Object.hasOwn(SENSOR_LABELS, id) ? SENSOR_LABELS[id] : undefined) ?? { ...FALLBACK, short: String(id) };
        const st: SensorState | 'unknown' = avail?.[id] ?? (L.planned ? 'planned' : 'unknown');
        const Ico = L.icon;
        const tip = `${L.name}${SENSOR_STATE_TEXT[st] ? ' — ' + SENSOR_STATE_TEXT[st] : ''}`;
        const body = (
          <>
            <Ico size={size === 'xs' ? 12 : 14} stroke={1.9} aria-hidden />
            <span>{L.short}</span>
          </>
        );
        return (
          <Tooltip key={id} label={tip}>
            {click ? (
              <UnstyledButton className={`bt-sensor-chip bt-sensor-chip--${size}`} data-state={st}
                onClick={e => { e.stopPropagation(); click(id); }} aria-label={tip}>
                {body}
              </UnstyledButton>
            ) : (
              <span className={`bt-sensor-chip bt-sensor-chip--${size}`} data-state={st} aria-label={tip}>{body}</span>
            )}
          </Tooltip>
        );
      })}
    </Group>
  );
}
