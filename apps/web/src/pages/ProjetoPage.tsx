/* Página /projeto — Ficha do carro (porte de renderDesign, legacy/js/vehicleui.js; aba
 * "Projeto" do app antigo). Os números de projeto do trecho escolhido (designReport do core),
 * os pontos de atenção, cada linha com os sensores de onde saiu e o card de explicação, a
 * matriz sensor → grandezas, exportar CSV (designCsv, com BOM como o antigo) e imprimir/PDF
 * com cabeçalho da sessão — pensada para entregar aos juízes. A página só desenha. */
import { useMemo } from 'react';
import { Badge, Button, Group, Paper, Stack, Text, ThemeIcon } from '@mantine/core';
import {
  IconCar, IconCarSuspension, IconCheck, IconDownload, IconFileDescription, IconGauge,
  IconPrinter, IconRoute, IconTemperature, type Icon,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { designCsv, designReport, SENSOR_IDS } from '@baja/core';
import { NoSessionState, PageHeader, Section, SensorChips } from '../components';
import { routeByPath } from '../routes';
import { fmtSessionDate, sessionDateText } from '../library';
import { useRange, useSessionStore } from '../state/session';
import { useActiveProfiles } from '../state/profiles';
import { APP_NAME, BrandLogo, TEAM_NAME } from '../brand';
import { FichaMissing, FichaRecs, FichaTable, SensorMatrix, downloadText, usePrintMode } from './projeto/FichaParts';

/* o que cada grupo da ficha decide no carro novo */
const GROUP_INFO: Record<string, { icon: Icon; text: string; need: string }> = {
  'Suspensão': {
    icon: IconCarSuspension,
    text: 'Curso usado, frequência natural e amortecimento, velocidades do amortecedor, rolagem, arfagem e saltos: dimensionam mola, amortecedor, curso, batentes e barra estabilizadora do carro novo.',
    need: 'precisa dos potenciômetros dos amortecedores com sinal (canais Shock na FT450).',
  },
  'Pista': {
    icon: IconRoute,
    text: 'Rugosidade e ondulações dominantes: o que a pista pede da suspensão e em que velocidades ela excita a ressonância da carroceria.',
    need: 'precisa dos amortecedores com sinal (rugosidade) e do GPS com fix (ondulações por distância).',
  },
  'Trem de força': {
    icon: IconGauge,
    text: 'Calibração da roda, velocidade e potência na roda, largada, frenagem e resistências ao movimento: entram no simulador de desempenho, na escolha da CVT e na relação final.',
    need: 'precisa da velocidade do carro: GPS com fix ou o sensor de velocidade da roda.',
  },
  'CVT': {
    icon: IconTemperature,
    text: 'Temperatura medida e o modelo térmico ajustado: se a ventilação da CVT aguenta o enduro inteiro ou se o carro novo precisa de mais troca de calor.',
    need: 'precisa do sensor de temperatura da CVT (escolha o canal em Dados do carro).',
  },
};

export default function ProjetoPage() {
  const r = routeByPath('/projeto')!;
  const nav = useNavigate();
  const ctx = useSessionStore(s => s.ctx);
  const source = useSessionStore(s => s.source);
  const availability = useSessionStore(s => s.availability);
  const range = useRange();
  const { car, track } = useActiveProfiles();
  usePrintMode();

  const i0 = range?.[0] ?? 0, i1 = range?.[1] ?? 0, hasRange = range !== null;
  const rep = useMemo(() => (ctx && hasRange ? designReport(ctx, i0, i1) : null), [ctx, i0, i1, hasRange]);

  const header = <PageHeader title={r.label} subtitle={r.question} explain="design.sheet" />;

  if (!ctx || !rep || !range) {
    return (
      <>
        {header}
        <NoSessionState icon={IconFileDescription} title="Abra uma sessão para montar a ficha"
          description="A ficha junta os números de projeto medidos num log (suspensão, pista, trem de força e CVT), cada um com os sensores de onde saiu. Abra um log, escolha um da biblioteca ou veja com os dados de exemplo." />
      </>
    );
  }

  const S = ctx.S, cfg = ctx.cfg;
  const demo = source?.type === 'demo' || !!S.demo;
  const meta = source?.meta;
  const sessionName = source?.name || S.name;
  const date = meta?.date ? fmtSessionDate(meta.date) : S.clock0 ? `${S.clock0} (hora do 1º quadro do log)` : meta?.createdAt ? sessionDateText(meta) : demo ? 'simulada' : 'não informada';
  const carName = demo ? 'Carro de exemplo (simulado)' : car ? car.name : 'Configuração em uso (sem perfil salvo)';
  const trackName = track ? track.name : demo ? 'Pista do exemplo' : 'Configuração em uso (sem perfil salvo)';
  const present = availability ? SENSOR_IDS.filter(id => availability[id] === 'present') : [];
  const exportCsv = () => { const f = designCsv(rep, S.name); downloadText(f.fileName, f.text); };
  const today = new Date().toLocaleDateString('pt-BR');

  return (
    <>
      {/* cabeçalho só da impressão */}
      <div className="bt-print-only bt-print-head">
        <p className="bt-print-team"><BrandLogo size={40} /> <b>{TEAM_NAME}</b> · {APP_NAME}</p>
        <h1>Ficha do carro — {sessionName}</h1>
        <p>Data do teste: {date} · Carro: {carName} (massa {cfg.car.mass} kg) · Pista: {trackName} · Trecho: {range[2]} · Impresso em {today}</p>
        <p>Cada número abaixo traz os sensores de onde saiu (coluna “Sensores”) e a matriz de sensores no fim.</p>
      </div>

      <div className="bt-noprint">
        <PageHeader title={r.label} subtitle={r.question} explain="design.sheet"
          sensors={present}
          actions={(
            <>
              <Button size="md" leftSection={<IconDownload size={18} />} onClick={exportCsv}>Exportar CSV</Button>
              <Button size="md" variant="default" leftSection={<IconPrinter size={18} />} onClick={() => window.print()}>Imprimir / PDF</Button>
              <Button size="md" variant="subtle" leftSection={<IconCar size={18} />} onClick={() => nav('/carro')}>Dados do carro…</Button>
            </>
          )} />
      </div>

      <Section>
        <Paper withBorder radius="md" p="lg">
          <Stack gap="md">
            <dl className="bt-ficha-info" style={{ margin: 0 }}>
              <div><dt>Sessão</dt><dd>{sessionName}<small>{S.kind === 'BUSMASTER' ? 'log CAN (BUSMASTER)' : 'log da FT450'}{demo ? ' · exemplo' : ''}</small></dd></div>
              <div><dt>Data do teste</dt><dd>{date}</dd></div>
              <div><dt>Carro</dt><dd>{carName}<small>massa {cfg.car.mass} kg com piloto</small></dd></div>
              <div><dt>Pista</dt><dd>{trackName}</dd></div>
              <div><dt>Trecho analisado</dt><dd>{range[2]}<small className="bt-noprint">mude no seletor “Trecho” do cabeçalho</small></dd></div>
            </dl>
            <Text c="dimmed" size="sm" className="bt-noprint">
              Os números do carro medidos neste log, para o projeto do próximo. Várias contas dependem dos dados do carro (massa, geometria): confira.
              Clique em qualquer linha para ver o que é, de quais sensores saiu, como foi calculado e como usar no carro novo.
            </Text>
          </Stack>
        </Paper>
      </Section>

      <Section title="Pontos de atenção para o projeto" explain="design.recommendations"
        description="Conclusões automáticas da ficha, cada uma justificada por uma medida e pelos sensores que a geraram.">
        {rep.recs.length ? <FichaRecs recs={rep.recs} /> : (
          <Paper withBorder radius="md" p="lg">
            <Group gap="md" wrap="nowrap">
              <ThemeIcon variant="light" color="green" size={40} radius="xl"><IconCheck size={22} /></ThemeIcon>
              <Text>Nenhum ponto de atenção neste trecho. Isso também pode querer dizer que faltam dados: confira na ficha abaixo as linhas sem valor
                (teste de queda, curso dos amortecedores, canal da CVT, linha de largada).</Text>
            </Group>
          </Paper>
        )}
        <FichaMissing rows={rep.rows} />
      </Section>

      {rep.groups.map(g => {
        const info = GROUP_INFO[g];
        const rows = rep.rows.filter(x => x.grp === g);
        const Ico = info?.icon;
        return (
          <Section key={g} title={(
            <Group gap={10} wrap="nowrap" component="span">
              {Ico && <Ico size={24} stroke={1.7} aria-hidden />}<span>{g}</span>
              <Badge variant="light" color="gray" size="lg">{rows.length} {rows.length === 1 ? 'grandeza' : 'grandezas'}</Badge>
            </Group>
          )} description={info?.text}>
            <FichaTable rows={rows} />
          </Section>
        );
      })}

      {Object.keys(GROUP_INFO).filter(g => !rep.groups.includes(g)).length > 0 && (
        <Section title="Grupos sem números neste log">
          <Paper withBorder radius="md" p="lg">
            <Stack gap="sm">
              {Object.entries(GROUP_INFO).filter(([g]) => !rep.groups.includes(g)).map(([g, info]) => (
                <Group key={g} gap="sm" wrap="nowrap" align="flex-start">
                  <info.icon size={22} stroke={1.7} aria-hidden style={{ flex: 'none', marginTop: 2 }} />
                  <Text><b>{g}</b>: nenhuma grandeza neste trecho — {info.need}</Text>
                </Group>
              ))}
            </Stack>
          </Paper>
        </Section>
      )}

      <Section title="De onde saiu cada número" explain="design.sensorCoverage" sensors={present}
        description="Matriz dos sensores usados nesta ficha: cada sensor e as grandezas que ele permitiu medir. Embaixo, os sensores que faltam e o que eles destravariam no projeto.">
        <SensorMatrix rows={rep.rows} availability={availability} />
        {present.length > 0 && (
          <Group gap="xs" mt="md" className="bt-noprint">
            <Text size="sm" c="dimmed">Presentes neste log:</Text><SensorChips sensors={present} size="sm" />
          </Group>
        )}
      </Section>
    </>
  );
}
