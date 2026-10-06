/* Página /suspensao (docs/ARQUITETURA.md 4.2): porte de renderSusp (legacy/js/analysisui.js) e
 * renderSuspExtra (legacy/js/vehicleui.js). Só desenha o suspensionReport do core:
 * controles (compressão aumenta/diminui, lenta/rápida, só andando), tabela por canto, histogramas
 * de velocidade e de curso (pequenos múltiplos com a mesma escala), rolagem e arfagem × acelerações,
 * saltos (clique = ir ao salto) e batidas no fim de curso. */
import { useMemo, useState } from 'react';
import { Group, Paper, SegmentedControl, SimpleGrid, Stack, Switch, Text } from '@mantine/core';
import { suspensionReport, type BottomOut, type SuspCornerRow, type SuspensionReport, type SuspJumpRow } from '@baja/core';
import {
  ChartCard, DataTable, InfoButton, PageHeader, Section, StatTile, useExplain, type Column, type XYSpec,
} from '../components';
import { routeByPath } from '../routes';
import { useCtx, useRange, useSessionReady, useSessionStore } from '../state/session';
import { CORNER_LABEL, type Corner } from '../theme';
import {
  Callout, CarButton, CommitNumber, CornerSwatch, NoSession, NoShocks, Num, PlotCard, RangeBadge,
} from './suspensao/shared';
import classes from './suspensao/susp.module.css';

export default function SuspensaoPage() {
  const r = routeByPath('/suspensao')!;
  const ready = useSessionReady();
  const ctx = useCtx();
  const range = useRange();
  const rep = useMemo(() => (ctx && range ? suspensionReport(ctx, range[0], range[1]) : null), [ctx, range]);

  const header = (
    <PageHeader
      title={r.label} subtitle={r.question}
      actions={<>{range && <RangeBadge label={range[2]} />}<CarButton /></>}
    />
  );
  if (!ready || !rep || !range) return <>{header}<NoSession what="curso, velocidade dos amortecedores, rolagem e saltos" /></>;
  if (!rep.hasShocks) {
    return (
      <>
        {header}
        <NoShocks text={rep.empty ?? ''} sensors={rep.emptySensors}
          need="Esta página precisa do curso de pelo menos um amortecedor (rolagem: os dois de um eixo; arfagem: um na frente e um atrás)." />
      </>
    );
  }
  return (
    <>
      {header}
      <Stack gap={0}>
        <Controls rep={rep} />
        <CornerSection rep={rep} />
        <HistSection rep={rep} kind="vel" />
        <HistSection rep={rep} kind="pos" />
        <BodySection rep={rep} />
        <JumpsSection rep={rep} />
        <BottomSection rep={rep} />
      </Stack>
    </>
  );
}

/* ---------------------------------------------------------------- controles */
function Controls({ rep }: { rep: SuspensionReport }) {
  const updateConfig = useSessionStore(s => s.updateConfig);
  const busy = useSessionStore(s => s.busy);
  const o = rep.options;
  return (
    <Section>
      <Paper withBorder radius="md" p="md">
        <div className={classes.controls}>
          <div>
            <div className={classes.controlLabel}>Compressão quando a posição</div>
            <SegmentedControl
              size="md" disabled={busy} value={o.compPos ? '1' : '0'}
              data={[{ value: '1', label: 'aumenta' }, { value: '0', label: 'diminui' }]}
              onChange={v => updateConfig({ susp: { compPos: v === '1' } })}
            />
          </div>
          <CommitNumber
            label="Lenta / rápida" suffix=" mm/s" min={1} step={10} w={170} value={o.knee}
            onCommit={v => updateConfig({ susp: { knee: v } })}
          />
          <Stack gap={4}>
            <Switch
              size="md" disabled={busy} checked={o.moving} label="Só com o carro andando"
              onChange={e => updateConfig({ susp: { moving: e.currentTarget.checked } })}
            />
            {o.moving && !o.movingApplied && (
              <Text size="sm" c="dimmed" maw={340}>Sem GPS nem roda para saber quando o carro anda: usando todas as amostras.</Text>
            )}
          </Stack>
        </div>
        <Text size="sm" c="dimmed" mt="sm">
          Se o potenciômetro foi montado ao contrário (a posição cai quando o amortecedor comprime), escolha “diminui”.
          O limite lenta/rápida separa o movimento da carroceria (lento) dos impactos (rápido) nos histogramas e na tabela.
        </Text>
      </Paper>
    </Section>
  );
}

/* ---------------------------------------------------------------- tabela por canto */
function CornerSection({ rep }: { rep: SuspensionReport }) {
  const tb = rep.table;
  const rows = tb.rows;
  const dead = rows.filter(r => !r.active);
  const { open } = useExplain();
  return (
    <Section
      title="Curso e velocidade por canto" explain={tb.explain} sensors={tb.sensors}
      description="Quanto do curso cada canto usa e a que velocidade o amortecedor trabalha: a base para escolher o curso, a mola e as válvulas do amortecedor do carro novo. Clique em qualquer número para ver de onde ele sai."
    >
      <Stack gap="lg">
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md">
          {rows.map(r => {
            /* canal com sinal mas quase parado (< 1 mm no trecho): provável ruído do sensor, não curso */
            const still = r.active && r.used !== undefined && r.used < 1;
            return (
              <StatTile
                key={r.id}
                label={<span className={classes.cornerHead}><CornerSwatch id={r.id as Corner} />{r.id} · curso usado</span>}
                value={r.active ? r.cells[3].replace(/ mm$/, '') : null} unit="mm"
                hint={still
                  ? 'menos de 1 mm no trecho: parece só ruído do sensor (carro parado ou potenciômetro sem medir)'
                  : r.active
                    ? (r.stroke && r.stroke > 0 ? `${r.cells[4]} do curso total` : 'informe o curso total para ver a %')
                    : r.cells[1]}
                status={r.active && !still ? undefined : 'warn'} statusText={still ? 'Quase parado' : r.active ? undefined : 'Sem sinal'}
                explain={r.active ? 'susp.travelUsed' : 'susp.shocksActive'} sensors={r.sensors}
              />
            );
          })}
        </SimpleGrid>

        {dead.length > 0 && (
          <Callout tone="warn" sensors={dead.map(r => r.sensors[0])}>
            <b>Sem sinal em {dead.map(r => r.id).join(', ')}</b>: {dead.some(r => r.cells[1].startsWith('canal'))
              ? 'o canal existe no log mas ficou constante (potenciômetro desligado, conector solto ou calibração zerada no FT Manager?). '
              : 'o log não tem esse canal. '}
            Só {rows.filter(r => r.active).map(r => r.id).join(', ')} entra nas contas.
            A rolagem precisa dos dois amortecedores de um eixo e a arfagem de um na frente e um atrás; o teste é
            empurrar cada canto com o log gravando e ver se o canal mexe.
          </Callout>
        )}

        <ChartCard title="Tabela por canto" explain={tb.explain} sensors={tb.sensors} footer={tb.note}>
          <div className={classes.matrixWrap}>
            <table className={classes.matrix}>
              <thead>
                <tr>
                  <th>Medida</th>
                  {rows.map(r => (
                    <th key={r.id}>
                      <button type="button" className={classes.numLink} style={{ background: 'none', border: 0 }}
                        onClick={() => open(r.explain, { sensors: r.sensors, title: `${r.id} · ${r.label}` })}>
                        <span className={classes.cornerHead}><CornerSwatch id={r.id as Corner} />{r.id}</span>
                      </button>
                      <span className={classes.cornerSub}>{CORNER_LABEL[r.id as Corner]}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tb.columns.slice(1).map((col, ci) => {
                  const c = ci + 1;
                  return (
                    <tr key={col.key}>
                      <td>
                        <Group gap={2} wrap="nowrap">
                          {col.label}
                          {col.explain && <InfoButton explain={col.explain} sensors={tb.sensors} title={col.label} size="sm" />}
                        </Group>
                      </td>
                      {rows.map(r => <MatrixCell key={r.id} row={r} c={c} n={tb.columns.length} explain={col.explain} label={col.label} />)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </Stack>
    </Section>
  );
}

/* célula c da linha do canto: quando há menos células que colunas, a última ocupa as que faltam
 * (o colspan do antigo vira rowSpan na tabela transposta) */
function MatrixCell({ row, c, n, explain, label }: { row: SuspCornerRow; c: number; n: number; explain?: string; label: string }) {
  const last = row.cells.length - 1;
  if (c > last) return null;
  const span = c === last ? n - last : 1;
  const txt = row.cells[c];
  if (!row.active || (span > 1 && last < n - 1)) {
    return <td rowSpan={span} className={classes.off} style={{ textAlign: 'center', verticalAlign: 'middle' }}>{txt}</td>;
  }
  const bold = c === 3 || c === 4;
  return (
    <td>
      <Num explain={explain} sensors={row.sensors} title={`${label} · ${row.id}`} strong={bold}
        dim={txt === 'informe o curso'}>{txt}</Num>
    </td>
  );
}

/* ---------------------------------------------------------------- histogramas */
function HistSection({ rep, kind }: { rep: SuspensionReport; kind: 'vel' | 'pos' }) {
  const plots = kind === 'vel' ? rep.velHist : rep.posHist;
  /* mesma escala Y em todos os cantos (a escala X já vem igual do relatório) */
  const extra = useMemo<Partial<XYSpec>>(() => {
    let m = 0;
    plots.forEach(p => { const y = p.bars?.y; if (y) for (let k = 0; k < y.length; k++) if (y[k] > m) m = y[k]; });
    return m > 0 ? { yRange: [0, m * 1.08] } : {};
  }, [plots]);
  const knee = +rep.options.knee || 100;
  const sensors = useMemo(() => [...new Set(plots.flatMap(p => p.sensors))], [plots]);
  return kind === 'vel' ? (
    <Section
      title="Velocidade do amortecedor (histograma)" explain="susp.velocityHistogram" sensors={sensors}
      description={`Quanto tempo cada amortecedor passa em cada velocidade: compressão à direita, extensão à esquerda. As linhas verticais marcam o limite lenta/rápida (±${knee} mm/s): a parte lenta é o movimento da carroceria (curvas, frenagens), a rápida são os impactos. Mesma escala em todos os cantos para comparar.`}
    >
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        {plots.map(p => <PlotCard key={p.key} plot={p} title={`${p.title} — velocidade`} height={270} extra={extra} />)}
      </SimpleGrid>
    </Section>
  ) : (
    <Section
      title="Curso em relação ao estático" explain="susp.travelHistogram" sensors={sensors}
      description="Quanto tempo cada amortecedor passa em cada posição, medida a partir do carro parado (0 = estático; + = comprimido). Mostra quanto curso sobra para compressão e para extensão: um carro que vive comprimido pede mais mola ou mais pré-carga."
    >
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        {plots.map(p => <PlotCard key={p.key} plot={p} title={`${p.title} — curso`} height={270} extra={extra} />)}
      </SimpleGrid>
    </Section>
  );
}

/* ---------------------------------------------------------------- rolagem e arfagem */
function BodySection({ rep }: { rep: SuspensionReport }) {
  const b = rep.body;
  const missRoll = 'Instale os dois amortecedores de um eixo (FL+FR ou RL+RR) com sinal e grave com GPS ou roda para ter a aceleração lateral.';
  const missPitch = 'Precisa de um amortecedor com sinal na frente e outro atrás, e da aceleração longitudinal (roda ou GPS).';
  return (
    <Section
      title="Rolagem e arfagem da carroceria" explain="susp.rollGradient" sensors={b.noteSensors}
      description="O ângulo da carroceria sai da diferença entre os amortecedores (esquerda × direita para a rolagem, frente × trás para a arfagem) e é comparado com a aceleração do carro. A inclinação da reta (°/g) é o gradiente: quanto a carroceria inclina por g. É o número para dimensionar molas, barra estabilizadora e anti-mergulho do carro novo."
    >
      <Stack gap="lg">
        <Text size="sm" c="dimmed">{b.note}</Text>
        <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="md">
          <StatTile label="Gradiente de rolagem" value={b.roll ? b.roll.slope.toFixed(2) : null} unit="°/g"
            hint={b.roll ? `R² ${b.roll.r2.toFixed(2)}` : 'sem dados para a reta'} explain="susp.rollGradient" sensors={b.rollPlot.sensors} />
          <StatTile label="Arfagem na frenagem" value={b.pitchBrake ? Math.abs(b.pitchBrake.slope).toFixed(2) : null} unit="°/g"
            hint={b.pitchBrake ? `R² ${b.pitchBrake.r2.toFixed(2)}` : 'sem dados para a reta'} explain="susp.pitchGradient" sensors={b.pitchPlot.sensors} />
          <StatTile label="Arfagem na aceleração" value={b.pitchAccel ? Math.abs(b.pitchAccel.slope).toFixed(2) : null} unit="°/g"
            hint={b.pitchAccel ? `R² ${b.pitchAccel.r2.toFixed(2)}` : 'sem dados para a reta'} explain="susp.pitchGradient" sensors={b.pitchPlot.sensors} />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
          <PlotCard plot={b.rollPlot} title="Rolagem × aceleração lateral" height={300} emptyHint={missRoll}
            subtitle={b.rollPlot.empty ? undefined : 'Cada ponto é um instante com o carro andando; a reta é o ajuste por mínimos quadrados.'} />
          <PlotCard plot={b.pitchPlot} title="Arfagem × aceleração longitudinal" height={300} emptyHint={missPitch}
            subtitle={b.pitchPlot.empty ? undefined : 'Uma reta para a frenagem (à esquerda) e outra para a aceleração (à direita).'} />
        </SimpleGrid>
      </Stack>
    </Section>
  );
}

/* ---------------------------------------------------------------- saltos */
function JumpsSection({ rep }: { rep: SuspensionReport }) {
  const jp = rep.jumps;
  const seek = useSessionStore(s => s.seek);
  const [sel, setSel] = useState(-1);
  const { open } = useExplain();
  const cols: Column<SuspJumpRow>[] = jp.columns.map((c, i) => ({
    key: c.key,
    header: c.explain ? (
      <button type="button" className={classes.numLink} style={{ background: 'none', border: 0, fontWeight: 600 }}
        onClick={() => open(c.explain!, { sensors: jp.sensors, title: c.label })}>{c.label}</button>
    ) : c.label,
    numeric: i > 0,
    render: row => {
      /* "vel. · curso" de cada amortecedor em duas linhas (a tabela fica estreita) */
      const parts = c.key.startsWith('shock') ? row.cells[i].split(' · ') : [row.cells[i]];
      return (
        <Num explain={i > 1 ? jp.explain : undefined} sensors={row.sensors} title={`Salto ${row.n} · ${c.label}`}>
          {parts.map((t, k) => <span key={k} style={{ display: 'block' }}>{t}</span>)}
        </Num>
      );
    },
  }));
  return (
    <Section
      title="Saltos e impactos" explain={jp.explain} sensors={jp.sensors}
      description="Salto = todos os amortecedores com sinal perto da extensão total ao mesmo tempo. Altura h = g·t²/8 e velocidade vertical no pouso v = g·t/2 (supõe decolagem e pouso na mesma altura). Clique numa linha para ir ao salto."
    >
      <Stack gap="lg">
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md">
          <StatTile label="Saltos no trecho" value={String(jp.list.length)} explain={jp.explain} sensors={jp.sensors}
            hint={jp.list.length ? 'clique na tabela para ir a cada um' : 'nenhum detectado'} />
        </SimpleGrid>
        <ChartCard title="Lista de saltos" explain={jp.explain} sensors={jp.sensors}>
          <div style={{ overflowX: 'auto' }}>
            <DataTable<SuspJumpRow>
              columns={cols} rows={jp.rows} rowKey={row => row.n} maxHeight={420}
              selected={sel} empty={jp.none ?? 'Nenhum salto detectado neste trecho.'}
              onRowClick={(row, i) => { setSel(i); seek(row.seekT); }}
            />
          </div>
        </ChartCard>
      </Stack>
    </Section>
  );
}

/* ---------------------------------------------------------------- fim de curso */
function BottomSection({ rep }: { rep: SuspensionReport }) {
  const bo = rep.bottom;
  const seek = useSessionStore(s => s.seek);
  const [sel, setSel] = useState(-1);
  const cols: Column<BottomOut>[] = [
    { key: 'id', header: 'Canto', render: b => <span className={classes.cornerHead}><CornerSwatch id={b.id as Corner} />{b.id} · {CORNER_LABEL[b.id as Corner]}</span> },
    { key: 't', header: 't', numeric: true, render: b => <Num explain={bo.explain} sensors={bo.sensors} title={`Fim de curso · ${b.id}`}>{b.t.toFixed(1)} s</Num> },
  ];
  return (
    <Section
      title="Batidas no fim de curso" explain={bo.explain} sensors={bo.sensors}
      description="Instantes em que um amortecedor passou de 95 % do curso total. Batida frequente = curso, mola ou batente insuficiente para a pista; no carro novo, mais curso ou mais progressividade."
    >
      {bo.strokeKnown ? (
        <Stack gap="lg">
          <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md">
            {bo.counts.map(c => (
              <StatTile key={c.id}
                label={<span className={classes.cornerHead}><CornerSwatch id={c.id as Corner} />{c.id} · batidas</span>}
                value={String(c.n)} unit="×" explain={bo.explain} sensors={bo.sensors}
                status={c.n > 0 ? 'warn' : 'good'} statusText={c.n > 0 ? 'Bateu no fim' : 'Não bateu'} />
            ))}
          </SimpleGrid>
          <Text size="sm" c="dimmed">{bo.text}</Text>
          {bo.events.length > 0 && (
            <div style={{ maxWidth: 720 }}><ChartCard title="Quando bateu (clique para ir ao ponto)" explain={bo.explain} sensors={bo.sensors}>
              <DataTable<BottomOut> columns={cols} rows={bo.events} rowKey={(b, i) => `${b.id}${i}`} maxHeight={320}
                selected={sel} onRowClick={(b, i) => { setSel(i); seek(b.t); }} />
            </ChartCard></div>
          )}
        </Stack>
      ) : (
        <Group>
          <Callout sensors={bo.sensors}>{bo.text} É o curso de batente a batente de cada amortecedor (medido na bancada ou na ficha do fabricante).</Callout>
          <CarButton />
        </Group>
      )}
    </Section>
  );
}
