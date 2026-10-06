/* Tema do app (docs/ARQUITETURA.md 4.5): Mantine + tokens dos gráficos.
 *
 * - Escuro por padrão (como MoTeC/RaceStudio), claro disponível.
 * - Fonte do sistema, base 15 px; títulos de página 24 px, de seção 18 px, números 28 px.
 * - Cores das séries: paleta validada, ordem fixa (slot 1..8), nunca cíclica.
 * - Os canvas (XYPlot, TrackMap, UPlotChart) não leem CSS: pegam as cores de useChartTheme().
 */
import { createTheme, rem, useComputedColorScheme, type MantineColorsTuple } from '@mantine/core';
import { useMemo } from 'react';

/* Laranja da pintura do carro da Mauá Racing Baja (preto com faixas amarela/laranja/vermelha).
 * É a cor da interface (botões, item ativo do menu, foco), não de dados: as séries dos
 * gráficos seguem a paleta fixa abaixo. Shade 7 no claro e 6 no escuro para o texto branco
 * dos botões ter contraste. */
const brand: MantineColorsTuple = [
  '#fff7ed', '#ffedd5', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12',
];

/* Neutros escuros um pouco frios: corpo dark[7] = #1a1b1e, superfície dos gráficos dark[8] = #141517. */
const dark: MantineColorsTuple = [
  '#c1c2c5', '#a6a7ab', '#909296', '#5c5f66', '#373a40', '#2c2e33', '#25262b', '#1a1b1e', '#141517', '#101113',
];

export const FONT = 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 7, dark: 6 },
  colors: { brand, dark },
  fontFamily: FONT,
  fontFamilyMonospace: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
  defaultRadius: 'md',
  fontSizes: {
    xs: rem(12),
    sm: rem(13.5),
    md: rem(15),
    lg: rem(17),
    xl: rem(20),
  },
  lineHeights: { md: '1.5' },
  headings: {
    fontFamily: FONT,
    fontWeight: '650',
    sizes: {
      h1: { fontSize: rem(24), lineHeight: '1.25' },
      h2: { fontSize: rem(18), lineHeight: '1.3' },
      h3: { fontSize: rem(16), lineHeight: '1.35' },
      h4: { fontSize: rem(15), lineHeight: '1.4' },
    },
  },
  components: {
    Tooltip: { defaultProps: { withArrow: true, openDelay: 250, multiline: true, maw: 320 } },
  },
});

/* ---------------------------------------------------------------- tokens das séries */

/** Slots 1..8 (índice 0..7). Tabela 4.5: claro / escuro. */
export const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'] as const;
export const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] as const;

export type Corner = 'FL' | 'FR' | 'RL' | 'RR';
export const CORNER_SLOT: Record<Corner, number> = { FL: 0, FR: 1, RL: 2, RR: 3 };
export const CORNER_LABEL: Record<Corner, string> = {
  FL: 'Dianteira esquerda', FR: 'Dianteira direita', RL: 'Traseira esquerda', RR: 'Traseira direita',
};

/** Status (bom / atenção / sério / crítico): sempre com ícone + texto, nunca só a cor. */
export type Status = 'good' | 'warn' | 'serious' | 'crit';
export const STATUS_COLOR: Record<Status, string> = { good: '#0ca30c', warn: '#fab219', serious: '#ec835a', crit: '#d03b3b' };
export const STATUS_LABEL: Record<Status, string> = { good: 'Bom', warn: 'Atenção', serious: 'Sério', crit: 'Crítico' };

/** Cores que os canvas usam (equivalente às variáveis --fg, --grid... do app antigo). */
export interface ChartTheme {
  dark: boolean;
  surface: string;      /* fundo do gráfico */
  card: string;         /* contorno de pontos sobre o gráfico (--card no antigo) */
  fg: string;           /* texto forte, marcadores sem cor */
  fg2: string;          /* escala do mapa */
  text: string;         /* texto dos eixos */
  muted: string;        /* rótulos discretos, cruz de leitura */
  grid: string;
  axis: string;
  mutedLine: string;    /* sessão inteira apagada no mapa */
  sel: string;          /* faixa selecionada */
  cursor: string;       /* cursor do tempo: branco no escuro, preto no claro */
  car: string;
  series: readonly string[];
  corner: Record<Corner, string>;
  status: Record<Status, string>;
  pos: string;          /* compressão / positivo (vermelho) */
  neg: string;          /* extensão / negativo (azul) */
  font: string;
}

const mk = (d: boolean): ChartTheme => {
  const series = d ? SERIES_DARK : SERIES_LIGHT;
  return {
    dark: d,
    surface: d ? '#141517' : '#ffffff',
    card: d ? '#1a1b1e' : '#ffffff',
    fg: d ? '#f1f3f5' : '#141517',
    fg2: d ? '#c1c2c5' : '#373a40',
    text: d ? '#a6a7ab' : '#5c5f66',
    muted: d ? '#868e96' : '#868e96',
    grid: d ? '#25262b' : '#eceef1',
    axis: d ? '#4a4c52' : '#c3c6cc',
    mutedLine: d ? '#4a4c52' : '#cfd2d6',
    sel: d ? 'rgba(57, 135, 229, .22)' : 'rgba(42, 120, 214, .14)',
    cursor: d ? '#ffffff' : '#000000',
    car: d ? '#ffffff' : '#141517',
    series,
    corner: { FL: series[0], FR: series[1], RL: series[2], RR: series[3] },
    status: STATUS_COLOR,
    pos: series[7],
    neg: series[0],
    font: FONT,
  };
};
export const CHART_LIGHT = mk(false);
export const CHART_DARK = mk(true);

/** Tema dos gráficos para o esquema atual (re-renderiza quando o tema muda). */
export function useChartTheme(): ChartTheme {
  const scheme = useComputedColorScheme('dark', { getInitialValueInEffect: false });
  return useMemo(() => (scheme === 'dark' ? CHART_DARK : CHART_LIGHT), [scheme]);
}

/** Cor de uma série pelo slot (1..8). Fora da paleta: cinza (nunca repetir cores). */
export const slotColor = (th: ChartTheme, slot: number): string => th.series[slot - 1] ?? th.muted;

/* Nomes aceitos onde um spec pede cor sem trazer hex: os relatórios do core devolvem
 * séries com `id`/`role` em vez de cor (ARQUITETURA 3.4), e a página/componente resolve aqui. */
const ROLE: Record<string, (th: ChartTheme) => string> = {
  FL: th => th.corner.FL, FR: th => th.corner.FR, RL: th => th.corner.RL, RR: th => th.corner.RR,
  cmp: th => th.series[0], ref: th => th.series[1], single: th => th.series[0], series: th => th.series[0],
  c1: th => th.series[0], c2: th => th.series[1], c3: th => th.series[2], c4: th => th.series[3],
  c5: th => th.series[4], c6: th => th.series[5], c7: th => th.series[6], c8: th => th.series[7],
  pos: th => th.pos, neg: th => th.neg,
  fg: th => th.fg, fg2: th => th.fg2, muted: th => th.muted, axis: th => th.axis, grid: th => th.grid,
  cursor: th => th.cursor, mutedLine: th => th.mutedLine,
  good: th => th.status.good, warn: th => th.status.warn, serious: th => th.status.serious, crit: th => th.status.crit,
};

/** Resolve uma cor: hex/rgb/hsl passam direto; nome de papel (FL, ref, pos, muted, c3...) vira a
 *  cor do tema; senão undefined. */
export function resolveColor(th: ChartTheme, c: string | undefined | null): string | undefined {
  if (!c) return undefined;
  if (c[0] === '#' || c.startsWith('rgb') || c.startsWith('hsl') || c.startsWith('var(')) return c;
  const f = ROLE[c];
  return f ? f(th) : undefined;
}
