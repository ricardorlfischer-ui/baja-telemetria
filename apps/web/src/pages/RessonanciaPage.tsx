/* Página /ressonancia (docs/ARQUITETURA.md 4.2): porte de renderFreq, showDrop, showPsd,
 * analyzeManual (legacy/js/analysisui.js) e renderRoadRes (legacy/js/vehicleui.js). Só desenha
 * o resonanceReport do core: banda da carroceria, teste de queda (evento, trecho escolhido nos
 * gráficos, fₙ/ζ/k/c por canto, decaimento), regra de Olley e faixa de ζ, espectro andando
 * (todos ou devagar × rápido), picos, pista × ressonância (λ e velocidades críticas). */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Button, Group, Paper, Select, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconCircleCheck, IconPlayerTrackNext, IconZoomScan } from '@tabler/icons-react';
import {
  resonanceReport, resRoadTip,
  type ResDropRow, type ResonanceReport, type ResPeakRow, type ResRoadRow, type SensorId, type SuspColumn,
} from '@baja/core';
import {
  ChartCard, DataTable, PageHeader, Section, SensorChips, StatTile, useExplain, type Column, type XYSpec,
} from '../components';
import { routeByPath } from '../routes';
import { useCtx, useRange, useSessionReady, useSessionStore } from '../state/session';
import { CORNER_LABEL, STATUS_COLOR, useChartTheme, type Corner } from '../theme';
import {
  Callout, CarButton, CommitNumber, CornerSwatch, DeadShocks, NoSession, NoShocks, Num, PlotCard, RangeBadge,
} from './suspensao/shared';
import { ShockTimeChart } from './ressonancia/ShockTimeChart';
import classes from './suspensao/susp.module.css';

type DropSel = number | 'manual' | undefined;

export default function RessonanciaPage() {
  const r = routeByPath('/ressonancia')!;
  const ready = useSessionReady();
  const ctx = useCtx();
  const range = useRange();
  const [dropIndex, setDropIndex] = useState<DropSel>(undefined);
  const [manual, setManual] = useState<[number, number] | null>(null);
  const [psdMode, setPsdMode] = useState('all');
  /* sessão nova: esquece o trecho manual e a escolha do evento */
  const S = ctx?.S;
  useEffect(() => { setManual(null); setDropIndex(undefined); setPsdMode('all'); }, [S]);

  const rep = useMemo(
    () => (ctx && range ? resonanceReport(ctx, range[0], range[1], { dropIndex, manual, psdMode }) : null),
    [ctx, range, dropIndex, manual, psdMode],
  );

  const header = (
    <PageHeader
      title={r.label} subtitle={r.question}
      actions={<>{range && <RangeBadge label={range[2]} />}<CarButton /></>}
    />
  );
  if (!ready || !rep || !range || !ctx) return <>{header}<NoSession what="a frequência natural, o amortecimento e o espectro da suspensão" /></>;
  if (!rep.hasShocks) {
    return (
      <>
        {header}
        <NoShocks text={rep.empty ?? ''} sensors={rep.emptySensors}
          need="A ressonância é medida no curso dos amortecedores: o teste de queda (carro parado) e o espectro andando precisam de pelo menos um amortecedor com sinal; para a regra de Olley, um na frente e um atrás." />
      </>
    );
  }
  return (
    <>
      {header}
      <Stack gap={0}>
        <BandControls rep={rep} />
        {ctx.susp.shocks.some(k => !k.active) && (
          <Section><DeadShocks shocks={ctx.susp.shocks} why="O teste de queda e o espectro saem só dos cantos com sinal; a regra de Olley precisa de um amortecedor na frente e outro atrás." /></Section>
        )}
        <DropSection rep={rep} i0={range[0]} i1={range[1]}
          onSelect={v => setDropIndex(v)} onManual={w => { setManual(w); setDropIndex('manual'); }} />
        <OlleySection rep={rep} />
        <PsdSection rep={rep} mode={psdMode} onMode={setPsdMode} />
        <RoadSection rep={rep} />
        <RateSection rep={rep} />
      </Stack>
    </>
  );
}

/* ---------------------------------------------------------------- banda */
function BandControls({ rep }: { rep: ResonanceReport }) {
  const updateConfig = useSessionStore(s => s.updateConfig);
  return (
    <Section>
      <Paper withBorder radius="md" p="md">
        <div className={classes.controls}>
          <CommitNumber label="Banda da carroceria: de" suffix=" Hz" min={0} step={0.1} decimalScale={2} w={190}
            value={rep.band.fmin} onCommit={v => updateConfig({ susp: { fmin: v } })} />
          <CommitNumber label="até" suffix=" Hz" min={0} step={0.1} decimalScale={2} w={150}
            value={rep.band.fmax} onCommit={v => updateConfig({ susp: { fmax: v } })} />
          <Text size="sm" c="dimmed" maw={560} pb={6}>
            Faixa onde procurar a frequência da carroceria sobre as molas (massa suspensa). Os picos do espectro
            só são procurados nesta faixa; ela aparece como duas linhas verticais no gráfico.
          </Text>
        </div>
      </Paper>
    </Section>
  );
}

/* ---------------------------------------------------------------- teste de queda */
const selKey = (v: number | 'manual' | null) => (v === null ? 'none' : String(v));

function DropSection({ rep, i0, i1, onSelect, onManual }: {
  rep: ResonanceReport; i0: number; i1: number; onSelect: (v: DropSel) => void; onManual: (w: [number, number]) => void;
}) {
  const ctx = useCtx()!;
  const view = useSessionStore(s => s.view);
  const seek = useSessionStore(s => s.seek);
  const availability = useSessionStore(s => s.availability);
  const d = rep.drop;
  const noStop = availability && availability.gps !== 'present' && availability.wheel !== 'present';
  const options = rep.eventOptions.map(o => ({ value: selKey(o.value), label: o.label }));
  const selected = selKey(rep.selected);
  return (
    <Section
      title="Teste de queda (carro parado) → frequência natural e amortecimento" explain={d.explain} sensors={d.sensors}
      description="Com o log gravando e o carro parado, empurre a dianteira ou a traseira para baixo e solte (ou deixe o carro cair uns 5 cm). O app acha o evento sozinho e mede pelo decaimento: período entre picos e decremento logarítmico."
    >
      <Stack gap="lg">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
          <ChartCard
            title="Curso dos amortecedores no trecho" explain="freq.dropTest" sensors={rep.drop.sensors}
            subtitle="Arraste para escolher a janela do evento, duplo clique volta ao todo, clique vai ao ponto."
          >
            <Stack gap="sm">
              <Group gap="sm" wrap="wrap" align="flex-end">
                <Select
                  label="Evento" size="md" w={300} allowDeselect={false} data={options} value={selected}
                  disabled={rep.selected === null}
                  onChange={v => { if (v && v !== 'none') onSelect(v === 'manual' ? 'manual' : +v); }}
                />
                <Button variant="default" size="md" leftSection={<IconPlayerTrackNext size={17} />}
                  disabled={d.t === null} onClick={() => d.t !== null && seek(d.t)}>Ir ao evento</Button>
                <Tooltip label={view ? `Usa a janela ${view[0].toFixed(1)}–${view[1].toFixed(1)} s` : 'Arraste no gráfico abaixo (ou em Canais) para escolher a janela do evento'}>
                  <Button size="md" leftSection={<IconZoomScan size={17} />} disabled={!view}
                    onClick={() => view && onManual([view[0], view[1]])}>Analisar trecho dos gráficos</Button>
                </Tooltip>
              </Group>
              <ShockTimeChart ctx={ctx} i0={i0} i1={i1} height={260} />
            </Stack>
          </ChartCard>
          <PlotCard
            plot={d.plot} title="Decaimento depois do pico" height={330}
            subtitle={d.plot.empty ? undefined : 'Cada curva é um amortecedor, a partir do maior pico; os pontos são os extremos usados na conta.'}
            emptyHint="Escolha um evento ou analise um trecho dos gráficos."
          />
        </SimpleGrid>

        {d.message ? (
          <Callout sensors={d.sensors}>
            {d.message}
            {noStop ? ' Este log não tem GPS com sinal nem roda: o app não sabe quando o carro está parado, então só o trecho escolhido nos gráficos funciona.' : ''}
          </Callout>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, xl: Math.min(4, Math.max(2, d.rows.length)) }} spacing="md">
            {d.rows.map(row => <DropCard key={row.id} row={row} columns={d.columns} />)}
          </SimpleGrid>
        )}
      </Stack>
    </Section>
  );
}

/* faixa de ζ do app antigo (vehicleui.js): < 0,2 pouco amortecida, > 0,6 muito; referência 0,25–0,5 */
function zetaStatus(z: number | null): { color: string; text: string; good: boolean } | null {
  if (z === null || !(z === z)) return null;
  if (z < 0.2) return { color: STATUS_COLOR.warn, text: 'pouco amortecida', good: false };
  if (z > 0.6) return { color: STATUS_COLOR.warn, text: 'muito amortecida', good: false };
  if (z >= 0.25 && z <= 0.5) return { color: STATUS_COLOR.good, text: 'na faixa usual (0,25–0,5)', good: true };
  return null;
}

function DropCard({ row, columns }: { row: ResDropRow; columns: SuspColumn[] }) {
  const th = useChartTheme();
  const id = row.id as Corner;
  const zs = zetaStatus(row.zeta);
  const ZI = zs?.good ? IconCircleCheck : IconAlertTriangle;
  const col = (k: number) => columns[k];
  return (
    <Paper withBorder radius="md" p="md" className={classes.cornerCard} style={{ '--corner': th.corner[id] } as CSSProperties}>
      <Stack gap="sm">
        <Group gap={8} wrap="nowrap">
          <CornerSwatch id={id} size={14} />
          <Text fw={650} size="lg">{row.id}</Text>
          <Text c="dimmed" size="sm">{CORNER_LABEL[id]}</Text>
        </Group>
        {row.ok ? (
          <>
            <div className={classes.bigRow}>
              <div>
                <Text size="sm" c="dimmed">fₙ (f natural)</Text>
                <Num explain={col(1).explain} sensors={row.sensors} title={`f natural · ${row.id}`}>
                  <span className={classes.big}>{row.cells[1].replace(/ Hz$/, '')}</span><span className={classes.bigUnit}>Hz</span>
                </Num>
              </div>
              <div>
                <Text size="sm" c="dimmed">ζ (amortecimento)</Text>
                <Num explain={col(2).explain} sensors={row.sensors} title={`ζ · ${row.id}`}>
                  <span className={classes.big}>{row.cells[2]}</span>
                </Num>
              </div>
            </div>
            {zs && (
              <span className="bt-status" style={{ ['--bt-status' as string]: zs.color }}>
                <ZI size={15} stroke={2} aria-hidden />{zs.text}
              </span>
            )}
            <dl className={classes.kv}>
              {[3, 4, 5, 6, 7].map(k => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt>{col(k).label}</dt>
                  <dd><Num explain={col(k).explain} sensors={row.sensors} title={`${col(k).label} · ${row.id}`}
                    dim={row.cells[k] === 'informe a massa'}>{row.cells[k]}</Num></dd>
                </div>
              ))}
            </dl>
            {!row.rates && (
              <Text size="sm" c="dimmed">Para ter rigidez e amortecimento em N/mm e N·s/m, informe a massa suspensa por roda (e a relação roda/amortecedor) em Dados do carro.</Text>
            )}
          </>
        ) : (
          <Text c="dimmed">{row.cells[1]}</Text>
        )}
        <SensorChips sensors={row.sensors} />
      </Stack>
    </Paper>
  );
}

/* ---------------------------------------------------------------- Olley e ζ */
function OlleySection({ rep }: { rep: ResonanceReport }) {
  const rd = rep.road;
  const ok = (v: number) => v === v && isFinite(v);
  const both = ok(rd.fnF) && ok(rd.fnR);
  /* razão tras./diant. só para mostrar (o relatório dá as duas fₙ dos eixos) */
  const ratio = both ? rd.fnR / rd.fnF : NaN;
  const olley = !both ? undefined : ratio < 1 ? 'warn' : ratio > 1.3 ? 'warn' : ratio >= 1.1 && ratio <= 1.2 ? 'good' : undefined;
  const olleyText = !both ? undefined : ratio < 1 ? 'traseira mais lenta: galopa' : ratio > 1.3 ? 'traseira muito acima' : ratio >= 1.1 && ratio <= 1.2 ? 'dentro da regra' : 'perto da regra';
  const s: SensorId[] = rd.sensors;
  /* cada eixo: sem os amortecedores do outro eixo */
  const sF = s.filter(x => x !== 'shock_rl' && x !== 'shock_rr'), sR = s.filter(x => x !== 'shock_fl' && x !== 'shock_fr');
  const why = !rep.events.length
    ? 'Sem teste de queda achado neste trecho.'
    : !rd.spectrum ? 'As fₙ por eixo saem junto com o espectro da pista, que não deu neste trecho (precisa de distância e trechos andando).' : 'Precisa de teste de queda com amortecedor na frente e atrás.';
  return (
    <Section
      title="Regra de Olley e faixa de amortecimento" explain="susp.naturalFreq" sensors={s}
      description="Como ler fₙ e ζ para escolher a mola e o amortecedor do carro novo."
    >
      <Stack gap="lg">
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <StatTile label="fₙ dianteira" value={ok(rd.fnF) ? rd.fnF.toFixed(2) : null} unit="Hz"
            hint={ok(rd.fnF) ? 'média FL/FR, 1º teste do trecho' : 'sem teste na dianteira'} explain="susp.naturalFreq" sensors={sF} />
          <StatTile label="fₙ traseira" value={ok(rd.fnR) ? rd.fnR.toFixed(2) : null} unit="Hz"
            hint={ok(rd.fnR) ? 'média RL/RR, 1º teste do trecho' : 'sem teste na traseira'} explain="susp.naturalFreq" sensors={sR} />
          <StatTile label="Traseira ÷ dianteira" value={both ? ratio.toFixed(2) : null} unit="×"
            hint={both ? 'meta: 1,10–1,20' : 'precisa das duas'} status={olley} statusText={olleyText}
            explain="susp.naturalFreq" sensors={s} />
        </SimpleGrid>
        {!both && <Callout sensors={s}>{why} Faça o teste de queda empurrando a dianteira e depois a traseira, com o log gravando e o carro parado.</Callout>}
        <Paper withBorder radius="md" p="lg">
          <div className={classes.prose}>
            <p><b>Regra de Olley (“flat ride”).</b> A traseira deve ter frequência natural 10–20 % acima da dianteira.
              Numa lombada a dianteira sobe primeiro e a traseira logo depois; com a traseira um pouco mais “rápida” ela
              alcança a dianteira e o carro sobe e desce por igual. Traseira mais lenta que a dianteira = o carro
              “galopa” (arfa) nas lombadas.</p>
            <p><b>Faixa de ζ.</b> ζ é a fração do amortecimento crítico (ζ = 1 volta sem oscilar). Em fora-de-estrada a
              referência é ~0,25–0,5: abaixo de 0,2 a carroceria continua oscilando depois de cada obstáculo; acima de
              0,6 fica dura nos impactos.</p>
            <p><b>Para o carro novo.</b> Mola: k_roda = m·(2π·fₙ)² e k_mola = k_roda·MR² (a medida inclui o pneu em
              série). Amortecedor: o c medido é o valor de baixa velocidade para especificar a válvula/clicks. E compare
              fₙ com as ondulações da pista (abaixo): v = fₙ·λ não pode cair na velocidade típica da prova.</p>
          </div>
        </Paper>
      </Stack>
    </Section>
  );
}

/* ---------------------------------------------------------------- espectro andando */
function PsdSection({ rep, mode, onMode }: { rep: ResonanceReport; mode: string; onMode: (m: string) => void }) {
  const ps = rep.psd, pk = rep.peaks;
  const noSplit = !(ps.vlo === ps.vlo);
  const { open } = useExplain();
  const cols: Column<ResPeakRow>[] = pk.columns.map((c, i) => ({
    key: c.key,
    header: c.explain ? (
      <button type="button" className={classes.numLink} style={{ background: 'none', border: 0, fontWeight: 600 }}
        onClick={() => open(c.explain!, { sensors: pk.sensors, title: c.label })}>{c.label}</button>
    ) : c.label,
    numeric: i > 0,
    render: row => i === 0
      ? <span className={classes.cornerHead}><CornerSwatch id={row.id as Corner} />{row.cells[0]}</span>
      : <Num explain={c.explain} sensors={row.sensors} title={`${c.label} · ${row.id}`} strong={i === 4} wrap={i < 4}>{row.cells[i]}</Num>,
  }));
  const modeSel = ps.modeOptions.length > 1 && (
    <Select size="md" w={280} label="Mostrar" allowDeselect={false} value={ps.mode}
      data={ps.modeOptions.map(o => ({ value: o.value, label: o.label }))} onChange={v => v && onMode(v)} />
  );
  return (
    <Section
      title="Espectro com o carro andando" explain={ps.explain} sensors={ps.sensors} actions={modeSel}
      description="Picos que aparecem devagar e rápido na mesma frequência são do carro (ressonância). Picos que mudam com a velocidade vêm da pista (costelas, ondulações)."
    >
      <Stack gap="lg">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
          <PlotCard
            plot={ps.plot} height={320}
            subtitle={ps.plot.empty ? undefined : `Escala log. Linhas cinza: banda ${rep.band.fmin}–${rep.band.fmax} Hz; linhas coloridas: fₙ do teste de queda escolhido.`}
            emptyHint={mode !== 'all' && noSplit
              ? 'Sem velocidade do GPS não dá para separar devagar × rápido: volte para “todos os amortecedores” ou grave com GPS.'
              : 'Grave trechos andando de pelo menos 5 s seguidos.'}
          />
          <ChartCard title="Picos na banda da carroceria" explain={pk.explain} sensors={pk.sensors}
            subtitle="Os até 3 picos mais fortes de cada canto (Hz), do mais forte para o mais fraco."
            footer={noSplit ? 'Sem velocidade do GPS: as colunas devagar e rápido ficam vazias.' : undefined}>
            <div style={{ overflowX: 'auto' }}>
              <DataTable<ResPeakRow> columns={cols} rows={pk.rows} rowKey={row => row.id} />
            </div>
          </ChartCard>
        </SimpleGrid>
      </Stack>
    </Section>
  );
}

/* ---------------------------------------------------------------- pista × ressonância */
function RoadSection({ rep }: { rep: ResonanceReport }) {
  const rd = rep.road;
  const { open } = useExplain();
  const extra = useMemo<Partial<XYSpec>>(() => ({ tipX: (x: number) => { const t = resRoadTip(x); return `<b>${t.title}</b> ${t.note}`; } }), []);
  const cols: Column<ResRoadRow>[] = rd.columns.map((c, i) => ({
    key: c.key,
    header: c.explain ? (
      <button type="button" className={classes.numLink} style={{ background: 'none', border: 0, fontWeight: 600 }}
        onClick={() => open(c.explain!, { sensors: rd.sensors, title: c.label })}>{c.label}</button>
    ) : c.label,
    numeric: i > 0 && i < 3,
    render: row => <Num explain={c.explain} sensors={rd.sensors} title={c.label} strong={i === 0} dim={i === 3}>{row.cells[i] || '—'}</Num>,
  }));
  return (
    <Section
      title="Pista × ressonância (espectro em distância)" explain={rd.explain} sensors={rd.sensors}
      description={<>O curso dos amortecedores reamostrado por distância percorrida: ondulações da pista (costelas, valetas) viram picos num comprimento de onda λ fixo. Uma ondulação de λ metros excita a carroceria quando v = fₙ · λ; evite que essa velocidade caia na faixa em que o carro anda naquele trecho.</>}
    >
      {rd.message ? (
        <Callout sensors={rd.sensors}>{rd.message}</Callout>
      ) : (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
          <PlotCard plot={rd.plot} height={320} extra={extra}
            subtitle="Escala log. Os rótulos marcam o comprimento de onda dos picos." />
          <ChartCard title="Ondulações e velocidades críticas" explain="freq.criticalSpeed" sensors={rd.sensors} footer={rd.note}>
            <div style={{ overflowX: 'auto' }}>
              <DataTable<ResRoadRow> columns={cols} rows={rd.rows} rowKey={(row, i) => `${row.lambda}-${i}`}
                empty="Nenhum pico de ondulação no trecho." />
            </div>
          </ChartCard>
        </SimpleGrid>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- taxa do log */
function RateSection({ rep }: { rep: ResonanceReport }) {
  const n = rep.note;
  return (
    <Section title="O que a taxa do log deixa ver" explain={n.explain} sensors={n.sensors}>
      <Group align="stretch" gap="md" wrap="wrap">
        <div style={{ flex: '0 1 300px', minWidth: 240 }}>
          <StatTile label="Taxa do log no trecho" value={n.fs === n.fs ? n.fs.toFixed(0) : null} unit="Hz"
            hint="amostras ÷ duração do trecho" explain={n.explain} sensors={n.sensors} />
        </div>
        <div style={{ flex: '1 1 420px', minWidth: 0 }}>
          <Callout sensors={n.sensors}>{n.text}</Callout>
        </div>
      </Group>
    </Section>
  );
}

