/* Página /sessao — Visão geral (docs/ARQUITETURA.md 4.2): o resumo do teste. Blocos grandes
 * com os números do resumo da sessão (sessionSummary do core), mini-mapa colorido pela
 * velocidade, voltas, pontos de atenção para o projeto (designReport), resumo da qualidade dos
 * dados (dataQuality), dados da sessão e anotações no tempo.
 *
 * A página só desenha: as contas são do @baja/core. O trecho do cabeçalho (useRange) vale
 * para o mapa, os pontos de atenção e os blocos: sessionSummary(ctx, ficha do trecho, trecho)
 * marca cada métrica com scope — 'range' segue o trecho (v máx, distância, CVT, curso,
 * saltos...), 'session' é sempre da sessão inteira (duração, voltas, melhor volta) e o bloco
 * diz isso. */
import './sessoes/sessoes.css';
import { Alert, Badge, Box, Group, Loader, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconLayoutDashboard } from '@tabler/icons-react';
import {
  SENSOR_IDS, designReport, sessionSummary, type DesignReport, type SessionSummary,
} from '@baja/core';
import { ComputingState, NoSessionState, PageHeader, Section, SensorChips, InfoButton } from '../components';
import { routeByPath } from '../routes';
import { useRange, useSessionStore } from '../state/session';
import { useComputed, useQuality } from '../state/heavy';
import { Tiles } from './visao-geral/Tiles';
import { MiniMap } from './visao-geral/MiniMap';
import { LapsCard } from './visao-geral/LapsCard';
import { DesignRecs, QualitySummary } from './visao-geral/Attention';
import { Comments, SessionData } from './visao-geral/SessionInfo';
import { kindLabel } from './sessoes/meta';

function safe<T>(f: () => T): { v: T | null; err: string | null } {
  try { return { v: f(), err: null }; } catch (e) { console.error(e); return { v: null, err: e instanceof Error ? e.message : String(e) }; }
}

export default function VisaoGeralPage() {
  const r = routeByPath('/sessao')!;
  const ctx = useSessionStore(s => s.ctx);
  const source = useSessionStore(s => s.source);
  const busy = useSessionStore(s => s.busy);
  const range = useRange();

  const i0 = range ? range[0] : 0, i1 = range ? range[1] : 0;
  const rangeLabel = range ? range[2] : '';
  const whole = !!ctx && i0 === 0 && i1 === ctx.S.t.length - 1;

  /* ficha do trecho e o resumo do trecho com a ficha do MESMO trecho: as métricas scope 'range'
   * seguem o trecho (inclusive distância, força trativa e GPS válido); as scope 'session' ficam
   * da sessão inteira. Log grande: primeiro o aviso "Calculando…" (useComputed). */
  const calc = useComputed(() => {
    if (!ctx) return null;
    const design = safe<DesignReport>(() => designReport(ctx, i0, i1));
    const summary = design.v ? safe<SessionSummary>(() => sessionSummary(ctx, design.v!, [i0, i1])) : null;
    return { design, summary };
  }, [ctx, i0, i1]);
  const design = calc?.design ?? null, summary = calc?.summary ?? null;
  /* qualidade dos dados: calculada uma vez por sessão e compartilhada com as outras páginas */
  const quality = useQuality();
  const dq = quality ? { v: quality.dq, err: quality.err } : null;

  const header = (
    <PageHeader title={r.label} subtitle={r.question} />
  );

  /* ------------------------------------------------------------ sem sessão */
  if (!ctx || !source) {
    return (
      <>
        {header}
        <NoSessionState icon={IconLayoutDashboard}
          description="Abra um log (CSV do FT Manager ou BUSMASTER), escolha um da biblioteca ou carregue os dados de exemplo para ver os números do teste, o mapa, as voltas e os pontos de atenção para o projeto." />
      </>
    );
  }

  const S = ctx.S;
  const errs = [design?.err, summary?.err, dq?.err].filter(Boolean);
  const shocks = design?.v ? design.v.facts.shocks.length : 0;

  return (
    <>
      {header}

      {/* qual sessão e qual trecho */}
      <Paper withBorder radius="md" p="md" mb="xl">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text fw={650} size="lg" style={{ wordBreak: 'break-word' }}>{source.name}</Text>
            <Text size="sm" c="dimmed">{kindLabel(S.kind)} · {S.info}</Text>
          </Stack>
          <Group gap="xs">
            {busy && <Badge variant="light" color="gray" size="lg" leftSection={<Loader size={12} />}>recalculando</Badge>}
            <Badge variant="light" size="lg" radius="sm" style={{ textTransform: 'none' }}>Trecho: {rangeLabel}</Badge>
          </Group>
        </Group>
        <Group gap={8} mt="sm" wrap="wrap" align="center">
          <Group gap={2} wrap="nowrap">
            <Text size="sm" c="dimmed">Sensores neste log</Text>
            <InfoButton explain="design.sensorCoverage" sensors={SENSOR_IDS} title="Sensores neste log" size="sm" />
          </Group>
          <Box style={{ flex: '1 1 240px', minWidth: 0 }}><SensorChips sensors={SENSOR_IDS} size="sm" /></Box>
        </Group>
      </Paper>

      {errs.length > 0 && (
        <Alert color="red" variant="light" mb="xl" title="Parte das contas falhou neste log">
          {errs.join(' · ')}
        </Alert>
      )}

      <Section title="Números do teste" description="Clique em qualquer número (ou no ⓘ) para ver o que ele é, de quais sensores saiu e como usar no projeto do carro do ano que vem.">
        {!calc ? <ComputingState what="os números do trecho" /> : summary?.v && design?.v
          ? <Tiles ctx={ctx} summary={summary.v} design={design.v} rangeLabel={rangeLabel} whole={whole} />
          : <Text c="dimmed">Sem resumo para este log.</Text>}
      </Section>

      <Section title="Pista e voltas">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg" verticalSpacing="lg">
          <MiniMap ctx={ctx} i0={i0} i1={i1} rangeLabel={rangeLabel} />
          <LapsCard ctx={ctx} />
        </SimpleGrid>
      </Section>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing={48} verticalSpacing={0} className="bt-section bt-ss-pair">
        <Section title="Pontos de atenção para o projeto" explain="design.recommendations"
          description={`O que os números deste trecho (${rangeLabel}) pedem para o carro do ano que vem.`}>
          {!calc ? <ComputingState what="os pontos de atenção" /> : design?.v ? <DesignRecs design={design.v} rangeLabel={rangeLabel} shocks={shocks} /> : <Text c="dimmed">Sem ficha para este log.</Text>}
        </Section>
        <Section title="Qualidade dos dados" explain="quality.validSamples"
          description="Se os sensores mandaram sinal e se dá para confiar nos números (detalhes em Aquisição).">
          {!quality ? <ComputingState what="a qualidade dos dados" /> : dq?.v ? <QualitySummary dq={dq.v} /> : <Text c="dimmed">Não deu para avaliar a qualidade deste log.</Text>}
        </Section>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing={48} verticalSpacing={0} className="bt-section bt-ss-pair">
        <Section title="Dados da sessão" description="Data, pista, carro, piloto, etiquetas e notas do teste.">
          <SessionData key={source.libraryId ?? source.name} source={source} ctx={ctx} />
        </Section>
        <Section title="Anotações" description="Marque instantes do teste; clique numa anotação para levar o cursor até ela.">
          <Comments key={source.libraryId ?? source.name} source={source} ctx={ctx} />
        </Section>
      </SimpleGrid>
    </>
  );
}
