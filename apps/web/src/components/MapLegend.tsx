/* Legenda da escala de cor da pista (rampa "calor" do app antigo, A.setLegend).
 * lo/hi vêm do TrackMap (onLegend) ou de pctRange(valores, i0, i1, 0.02). As casas decimais
 * seguem o antigo: decimalsFor(canal.lo, canal.hi) − 1. */
import { Group, Text } from '@mantine/core';
import { fmtVal, heatGradientCss } from '@baja/core';

export interface MapLegendProps {
  lo: number;
  hi: number;
  /** rampa do fundo escuro (tema escuro ou satélite) */
  dark: boolean;
  /** nome do canal que colore a pista */
  label?: string;
  unit?: string;
  /** decimalsFor(canal.lo, canal.hi) do canal (padrão 1, como sem canal no antigo) */
  decimals?: number;
}

export function MapLegend({ lo, hi, dark, label, unit, decimals = 1 }: MapLegendProps) {
  const d = Math.max(0, decimals - 1);
  return (
    <div className="bt-map-legend">
      {label && <Text size="sm" fw={500} mb={4}>{label}</Text>}
      <div className="bt-map-legend-bar" style={{ background: heatGradientCss(dark) }} />
      <Group justify="space-between" mt={4} gap="xs" className="bt-num">
        <Text size="sm" c="dimmed">{fmtVal(lo, d)}</Text>
        <Text size="sm" c="dimmed">{fmtVal(hi, d)}{unit ? ' ' + unit : ''}</Text>
      </Group>
    </div>
  );
}
