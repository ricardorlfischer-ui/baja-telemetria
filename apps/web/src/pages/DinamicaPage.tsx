/* Página /dinamica (renderDyn de legacy/js/analysisui.js): de onde vêm as acelerações,
 * blocos (velocidade, acelerações, raio), diagrama g-g quadrado com os círculos e o ponto do
 * cursor, e o tempo por faixa de velocidade.
 *
 * Tudo vem de dynamicsReport (core); a página só desenha. */
import { useRef } from 'react';
import { Alert, Button, Stack, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { IconActivity, IconAlertTriangle, IconMapPin } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { dynamicsReport, idxAt, type SessionContext } from '@baja/core';
import { PageHeader, Section, type XYPlotHandle } from '../components';
import { routeByPath } from '../routes';
import { useCtx, useCursorEffect, useRange, useSessionStore } from '../state/session';
import { ComputingPage, MissingState, Grid2, NeedSensors, NoSession, RangeBadge, RepChart, RepTiles, SourceNote, VehStyles } from './veiculo/shared';
import { useComputed } from '../state/heavy';

const ROUTE = '/dinamica';

export default function DinamicaPage() {
  const r = routeByPath(ROUTE)!;
  const ctx = useCtx();
  const range = useRange();
  if (!ctx || !range) return <NoSession title={r.label} subtitle={r.question} what="as acelerações (g-g) e o tempo por faixa de velocidade" />;
  return <Body ctx={ctx} i0={range[0]} i1={range[1]} label={range[2]} />;
}

function Body({ ctx, i0, i1, label }: { ctx: SessionContext; i0: number; i1: number; label: string }) {
  /* log grande: primeiro o aviso "Calculando…" (useComputed), depois a conta */
  const rep = useComputed(() => dynamicsReport(ctx, i0, i1), [ctx, i0, i1]);
  const r = routeByPath(ROUTE)!;
  if (!rep) return <ComputingPage title={r.label} subtitle={r.question} label={label} what="as acelerações e o g-g" />;
  return <Content ctx={ctx} label={label} rep={rep} />;
}

function Content({ ctx, label, rep }: { ctx: SessionContext; label: string; rep: ReturnType<typeof dynamicsReport> }) {
  const r = routeByPath(ROUTE)!;
  const nav = useNavigate();
  /* lado do g-g: largura da coluna menos o padding do cartão (24 px), entre 300 e 620 px */
  const { ref, width } = useElementSize();
  const side = Math.max(300, Math.min((width || 504) - 24, 620));
  const header = (
    <PageHeader title={r.label} subtitle={r.question} explain="dyn.gg" sensors={rep.ok ? rep.src.sensors : undefined}
      actions={<RangeBadge label={label} />} />
  );

  if (!rep.ok) {
    return (
      <>
        <VehStyles />
        {header}
        <MissingState
          icon={IconMapPin} title="Sem trajetória de GPS neste log"
          action={<Button size="md" variant="default" leftSection={<IconMapPin size={18} />} onClick={() => nav('/pista')}>Pista e GPS</Button>}
        >
            <Stack gap="md">
              <Text c="dimmed">
                {rep.empty} A dinâmica (acelerações lateral e longitudinal, raio de curva e tempo por faixa de velocidade)
                sai da trajetória do GPS: sem posição válida não há curva nem velocidade para contar.
              </Text>
              <Text fw={600}>O que medir:</Text>
              <NeedSensors sensors={['gps', 'wheel', 'imu']} why={{
                gps: 'GPS com fix durante o teste (confira a antena e espere o fix antes de sair). Se o log tem GPS mas a posição não aparece, confira o track_config.h e os canais X/Y na página Pista e GPS.',
                wheel: 'Velocidade da roda: melhora muito a aceleração longitudinal e, com o GPS, a lateral.',
                imu: 'Sugerido: acelerômetro de 3 eixos mede as acelerações direto, sem depender do GPS.',
              }} />
            </Stack>
        </MissingState>
      </>
    );
  }

  const vmax = rep.tiles.find(t => t.key === 'vmax')?.value ?? null;
  return (
    <>
      <VehStyles />
      {header}

      <Section>
        <SourceNote src={rep.src} label="Fonte das acelerações" icon={IconActivity}>
          <Text size="sm" c="dimmed">
            Pelo GPS (passos de 0,86 m a 4 Hz) é ordem de grandeza; com a velocidade da roda a longitudinal fica bem melhor.
          </Text>
        </SourceNote>
        {vmax !== null && vmax < 15 && (
          <Alert mt="md" color="yellow" variant="light" icon={<IconAlertTriangle size={20} />} title="O carro quase não andou neste trecho">
            Velocidade máxima de {vmax.toFixed(1)} km/h: o g-g e o raio de curva só dizem algo com o carro andando de verdade.
            Grave voltas na pista (ou um skidpad: círculo de raio constante acelerando aos poucos) para medir a aderência lateral.
          </Alert>
        )}
      </Section>

      <Section title="Números do trecho" description="Cada número abre o card com a conta e os sensores de onde saiu.">
        <RepTiles tiles={rep.tiles} />
      </Section>

      <Section title="Aceleração e velocidade" description="Quanto de aderência o carro usa (g-g) e em que velocidades passa o tempo: os dois definem a relação da transmissão, o pneu e o acerto da suspensão para a pista.">
        <Grid2>
          <div ref={ref}><GG rep={rep} side={side} /></div>
          <RepChart
            plot={rep.speed} title="Tempo por faixa de velocidade" height={side - 22}
            subtitle="Porcentagem do tempo andando em cada faixa. Onde a barra é alta é onde o carro precisa render: relação da CVT e da caixa para essa velocidade."
          />
        </Grid2>
      </Section>
    </>
  );
}

/* Diagrama g-g: quadrado (largura = altura da área do gráfico), mesma escala nos dois eixos
 * (equal do spec), círculos de 0,25 a 1,5 g e o ponto do cursor (frame() do antigo). */
function GG({ rep, side }: { rep: ReturnType<typeof dynamicsReport>; side: number }) {
  const plotRef = useRef<XYPlotHandle>(null);
  const cur = rep.cursor;
  const hiAt = (t: number) => {
    const S = useSessionStore.getState().S;
    if (!cur || !S || !S.t.length) return null;
    const i = idxAt(S.t, t);
    return { x: cur.lat[i], y: cur.lon[i] };
  };
  useCursorEffect(t => plotRef.current?.setHi(hiAt(t)));
  /* margens do XYPlot: esquerda 64 + direita 16 = 80; cima 12 + baixo 46 = 58 → altura = lado − 22 */
  return (
    <RepChart
      plot={rep.gg} title="Diagrama g-g" height={side - 22} plotRef={plotRef}
      extra={{ hi: hiAt(useSessionStore.getState().cursor) }}
      boxStyle={{ maxWidth: side, margin: '0 auto' }}
      subtitle="Cada ponto é um instante: para cima acelerando, para baixo freando, para os lados em curva. O ponto destacado é o cursor."
    />
  );
}
