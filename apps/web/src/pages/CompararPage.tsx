/* Página /comparar — Comparar sessões (docs/ARQUITETURA.md 4.2): escolher 2+ sessões da
 * biblioteca → métricas lado a lado (resumo da sessão, diferença para a primeira), uma métrica
 * ao longo das datas, e os gráficos sobrepostos que precisam do log inteiro (histogramas de
 * velocidade do amortecedor e a melhor volta), carregados com os perfis de cada sessão.
 * Ideia: comparar setups e testes para decidir o carro do ano que vem. A página só desenha. */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Center, Checkbox, Group, Loader, Paper, Progress, Stack, Switch, Text, TextInput,
} from '@mantine/core';
import { IconAlertTriangle, IconFolderOpen, IconGitCompare, IconSearch, IconX } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { SENSORS, SENSOR_IDS, SUMMARY_VERSION, fmtTime, summaryMetric, type SensorId, type SessionSummary } from '@baja/core';
import { DataTable, EmptyState, InfoButton, PageHeader, Section, SensorChips, type Column } from '../components';
import { routeByPath } from '../routes';
import { sessionDateText, useLibrary, type SessionMeta } from '../library';
import { useProfiles } from '../state/profiles';
import { lsGet, lsSet } from '../state/prefs';
import { loadSession, yieldFrame, type LoadedSession } from './comparar/loader';
import { LapOverlay, MetricsTable, ShockOverlay, Swatch, TrendChart, metricRows, type CmpSession } from './comparar/Parts';

const K_SEL = 'baja:compare:ids';
const MAX = 8;   /* uma cor da paleta por sessão, nunca repetida */

const dateKey = (m: SessionMeta) => m.date || m.createdAt;
const dateText = (m: SessionMeta) => sessionDateText(m);   /* dd/mm/aaaa [hh:mm] */
/** resumo guardado na biblioteca, se é da versão atual das contas */
const storedSummary = (m: SessionMeta): SessionSummary | null =>
  m.summary && m.summary.version === SUMMARY_VERSION && !m.summaryOutdated ? m.summary : null;
const presentOf = (s: SessionSummary | null): SensorId[] | null => {
  const q = s ? summaryMetric(s, 'quality.sensors') : undefined;
  return q ? q.sensors : null;
};

function readSel(): string[] {
  try { const v = JSON.parse(lsGet(K_SEL) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch { return []; }
}

export default function CompararPage() {
  const r = routeByPath('/comparar')!;
  const nav = useNavigate();
  const { lib, version, loading: libLoading, mode, user, info, pc } = useLibrary();
  /* servidor sem ninguém conectado: a biblioteca da equipe pede login (a lista daria 401) */
  const loggedOut = mode === 'remote' && !user;
  const cars = useProfiles(s => s.cars), tracks = useProfiles(s => s.tracks);
  const profRev = useProfiles(s => s.rev);
  const [list, setList] = useState<SessionMeta[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>(readSel);
  const [loaded, setLoaded] = useState<Record<string, LoadedSession>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [metric, setMetric] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);

  /* lista da biblioteca */
  useEffect(() => {
    if (!lib || libLoading) return;
    setListErr(null);
    if (loggedOut) { setList([]); return; }
    let alive = true;
    lib.listSessions().then(l => { if (alive) setList(l); }).catch(e => { if (alive) { setList([]); setListErr((e as Error).message); } });
    return () => { alive = false; };
  }, [lib, version, libLoading, loggedOut, user?.id]);

  const toggle = (id: string) => setSel(s => {
    const n = s.includes(id) ? s.filter(x => x !== id) : s.length >= MAX ? s : [...s, id];
    lsSet(K_SEL, JSON.stringify(n));
    return n;
  });
  const clearSel = () => { setSel([]); lsSet(K_SEL, '[]'); };

  /* sessões escolhidas, na ordem das datas (a primeira é a referência das diferenças) */
  const chosen = useMemo(() => (list ?? []).filter(m => sel.includes(m.id)).sort((a, b) => dateKey(a).localeCompare(dateKey(b))), [list, sel]);

  /* carrega o texto das escolhidas (uma de cada vez, com progresso; cache em memória) */
  useEffect(() => {
    if (!lib || chosen.length < 2) { setProgress(null); return; }
    let alive = true;
    (async () => {
      for (let k = 0; k < chosen.length; k++) {
        const m = chosen[k];
        if (!alive) return;
        setProgress({ done: k, total: chosen.length, name: m.name });
        await yieldFrame();
        try {
          const L = await loadSession(lib, m);
          if (!alive) return;
          setLoaded(o => (o[m.id] === L ? o : { ...o, [m.id]: L }));
          setErrors(o => { if (!(m.id in o)) return o; const n = { ...o }; delete n[m.id]; return n; });
        } catch (e) {
          if (!alive) return;
          setErrors(o => ({ ...o, [m.id]: (e as Error).message }));
        }
      }
      if (alive) setProgress(null);
    })();
    return () => { alive = false; };
  }, [lib, chosen, profRev, cars, tracks]);

  const sessions: CmpSession[] = useMemo(() => chosen.map((m, idx) => {
    const st = storedSummary(m), L = loaded[m.id] ?? null;
    /* depois de carregar, vale o resumo recalculado com os perfis da própria sessão (o mesmo
     * dos gráficos sobrepostos); antes, o guardado na biblioteca */
    const summary = L?.summary ?? st ?? null;
    return {
      meta: m, idx, role: `c${idx + 1}`, dateText: dateText(m), summary,
      summarySrc: L?.summary ? 'recalculado' : st ? 'guardado' : null, loaded: L, error: errors[m.id] ?? null,
    };
  }), [chosen, loaded, errors]);

  const rows = useMemo(() => metricRows(sessions), [sessions]);
  const shownRows = showEmpty ? rows : rows.filter(x => x.hasValue);
  const metricKey = metric && rows.some(x => x.key === metric) ? metric
    : (rows.find(x => x.key === 'session.bestLap' && x.hasValue) ?? rows.find(x => x.hasValue))?.key ?? null;

  /* sensores diferentes entre as sessões */
  const sensorDiff = useMemo(() => {
    const per = sessions.map(s => ({ s, p: presentOf(s.summary) }));
    const known = per.filter(x => x.p !== null);
    if (known.length < 2) return null;
    const union = SENSOR_IDS.filter(id => known.some(x => x.p!.includes(id)));
    const lacks = known.map(x => ({ s: x.s, miss: union.filter(id => !x.p!.includes(id)) })).filter(x => x.miss.length);
    return lacks.length ? { union, lacks } : null;
  }, [sessions]);

  const missAll = sensorDiff ? SENSOR_IDS.filter(id => sensorDiff.lacks.some(x => x.miss.includes(id))) : [];
  const carName = (id?: string) => (id ? cars.find(c => c.id === id)?.name ?? '—' : '—');
  const trackName = (id?: string) => (id ? tracks.find(t => t.id === id)?.name ?? '—' : '—');

  const header = <PageHeader title={r.label} subtitle={r.question} explain="design.compareSessions" />;

  /* ------------------------------------------------------------ estados vazios */
  if (libLoading || !lib || list === null) {
    return <>{header}<Center py={80}><Stack align="center"><Loader /><Text c="dimmed">Lendo a biblioteca…</Text></Stack></Center></>;
  }
  if (loggedOut) {
    return (
      <>
        {header}
        <EmptyState icon={IconGitCompare} title="Entre para comparar as sessões da equipe"
          description={`As sessões ficam no servidor da equipe${info?.name ? ` (${info.name})` : ''}. Entre com a sua conta ou um convite para escolher quais comparar.`}
          action={<Button size="md" onClick={() => nav('/login', { state: { from: '/comparar' } })}>Entrar</Button>} />
      </>
    );
  }
  if (list.length < 2) {
    return (
      <>
        {header}
        {listErr && <Alert color="red" mb="lg" title="Não consegui ler a biblioteca">{listErr}</Alert>}
        <EmptyState icon={IconGitCompare} title={list.length ? 'Só há 1 sessão na biblioteca' : 'Nenhuma sessão na biblioteca'}
          description={`Para comparar, guarde pelo menos 2 logs na biblioteca ${pc ? 'deste computador' : mode === 'remote' ? 'da equipe' : 'deste navegador'} (página Sessões: abrir ou arrastar um log já guarda). Compare testes na mesma pista: antes e depois de uma mudança de mola, clicks, CVT, pneu ou piloto.`}
          action={<Button size="md" leftSection={<IconFolderOpen size={18} />} onClick={() => nav('/')}>Ir para Sessões</Button>} />
      </>
    );
  }

  /* ------------------------------------------------------------ escolha */
  const ql = q.trim().toLowerCase();
  const filtered = ql ? list.filter(m => [m.name, m.fileName, m.driver, m.notes, dateText(m), carName(m.carId), trackName(m.trackId), ...m.tags]
    .filter(Boolean).join(' ').toLowerCase().includes(ql)) : list;
  const sorted = [...filtered].sort((a, b) => dateKey(b).localeCompare(dateKey(a)));
  const head = (label: string, explain: string) => (
    <span className="bt-cmp-colhead">{label}<InfoButton explain={explain} title={label} size="sm" /></span>
  );
  const metricCell = (m: SessionMeta, key: string, fmt?: (v: number) => string) => {
    const x = m.summary ? summaryMetric(m.summary, key) : undefined;
    if (!x || x.value === null) return <Text c="dimmed" span>—</Text>;
    return <span>{fmt ? fmt(x.value) : x.text ?? x.value} {fmt ? '' : x.unit}</span>;
  };
  const cols: Column<SessionMeta>[] = [
    {
      key: 'pick', header: '', width: 52,
      render: m => {
        const i = chosen.findIndex(c => c.id === m.id);
        return (
          <Group gap={6} wrap="nowrap">
            <Checkbox size="md" checked={sel.includes(m.id)} disabled={!sel.includes(m.id) && sel.length >= MAX}
              onChange={() => toggle(m.id)} onClick={e => e.stopPropagation()} aria-label={`Comparar ${m.name}`} />
            {i >= 0 && <Swatch role={`c${i + 1}`} />}
          </Group>
        );
      },
    },
    {
      key: 'name', header: 'Sessão',
      render: m => (
        <Stack gap={1}>
          <span className="bt-cmp-name">{m.name}</span>
          <span className="bt-cmp-sub">{[m.kind === 'BUSMASTER' ? 'CAN' : 'FT450', m.driver, carName(m.carId) !== '—' ? carName(m.carId) : '', trackName(m.trackId) !== '—' ? trackName(m.trackId) : '']
            .filter(Boolean).join(' · ')}</span>
        </Stack>
      ),
    },
    { key: 'date', header: 'Data', width: 150, render: m => dateText(m) },
    { key: 'best', header: head('Melhor volta', 'laps.lapTimes'), numeric: true, width: 150, render: m => metricCell(m, 'session.bestLap', fmtTime) },
    { key: 'vmax', header: head('V máx', 'power.vmax'), numeric: true, width: 130, render: m => metricCell(m, 'session.vmax') },
    { key: 'cvt', header: head('T máx CVT', 'cvt.maxTemp'), numeric: true, width: 140, render: m => metricCell(m, 'cvt.tmax') },
    {
      key: 'sens', header: head('Sensores', 'design.sensorCoverage'),
      render: m => {
        const p = presentOf(m.summary ?? null);
        if (!p) return <Text size="sm" c="dimmed">sem resumo{m.summaryError ? ` (${m.summaryError})` : ''}</Text>;
        return <SensorChips sensors={p} availability={Object.fromEntries(p.map(id => [id, 'present']))} />;
      },
    },
  ];

  const loadedCount = sessions.filter(s => s.loaded).length;

  return (
    <>
      {header}

      <Section title="Sessões para comparar" explain="design.compareSessions"
        description={`Escolha de 2 a ${MAX} sessões. A mais antiga é a referência das diferenças. Compare testes na mesma pista e do mesmo tipo: pista e clima também mudam os números.`}
        actions={(
          <>
            <Badge size="xl" variant="light" color={sel.length >= 2 ? 'blue' : 'gray'}>{chosen.length} escolhida{chosen.length === 1 ? '' : 's'}</Badge>
            {sel.length > 0 && <Button size="md" variant="subtle" leftSection={<IconX size={17} />} onClick={clearSel}>Limpar</Button>}
          </>
        )}>
        <Stack gap="md">
          <TextInput size="md" leftSection={<IconSearch size={18} />} placeholder="Buscar por nome, data, piloto, carro, pista, etiqueta…"
            value={q} onChange={e => setQ(e.currentTarget.value)} aria-label="Buscar sessões" />
          <DataTable<SessionMeta> rows={sorted} rowKey={m => m.id} columns={cols} maxHeight={440}
            onRowClick={m => toggle(m.id)} selected={m => sel.includes(m.id)}
            empty="Nenhuma sessão com esse texto." />
        </Stack>
      </Section>

      {chosen.length < 2 ? (
        <Section>
          <EmptyState icon={IconGitCompare} title="Escolha pelo menos 2 sessões"
            description="Marque as sessões na lista acima (clique na linha). Aparecem a tabela de métricas lado a lado, a métrica ao longo das datas, os histogramas de velocidade do amortecedor e a melhor volta sobrepostos." />
        </Section>
      ) : (
        <>
          {(progress || Object.keys(errors).length > 0) && (
            <Section>
              <Paper withBorder radius="md" p="lg">
                <Stack gap="sm">
                  {progress && (
                    <>
                      <Group justify="space-between" wrap="wrap">
                        <Text fw={600}>Carregando os logs para os gráficos sobrepostos: {progress.done + 1} de {progress.total} — {progress.name}</Text>
                        <Text c="dimmed" size="sm">cada log é lido e calculado com os perfis de carro e pista dele</Text>
                      </Group>
                      <Progress size="lg" value={(progress.done / progress.total) * 100} animated />
                    </>
                  )}
                  {Object.entries(errors).filter(([id]) => sel.includes(id)).map(([id, e]) => (
                    <Alert key={id} color="red" icon={<IconAlertTriangle size={18} />} title={`Não consegui carregar ${list.find(m => m.id === id)?.name ?? id}`}>{e}</Alert>
                  ))}
                </Stack>
              </Paper>
            </Section>
          )}

          {sensorDiff && missAll.length > 0 && (
            <Section>
              <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={20} />} title="As sessões não têm os mesmos sensores">
                <Stack gap={8}>
                  {sensorDiff.lacks.map(x => (
                    <Group key={x.s.meta.id} gap={8} wrap="wrap">
                      <Swatch role={x.s.role} /><Text span fw={600}>{x.s.idx + 1} · {x.s.meta.name}</Text><Text span>não tem:</Text>
                      <SensorChips sensors={x.miss} availability={Object.fromEntries(x.miss.map(id => [id, 'absent']))} size="sm" />
                    </Group>
                  ))}
                  <Text size="sm">As métricas desses sensores aparecem como “—” nessas sessões: compare só o que todas mediram. Antes de um teste A/B, confira em
                    {' '}<b>Aquisição</b> se {missAll.map(id => SENSORS[id].short).join(', ')} {missAll.length > 1 ? 'estão' : 'está'} gravando.</Text>
                </Stack>
              </Alert>
            </Section>
          )}

          <Section title="Métricas lado a lado" explain="design.compareSessions"
            description="Resumo de cada sessão inteira (as mesmas contas da ficha do carro). Abaixo de cada valor, a diferença para a sessão 1, com cor só quando “melhor” é óbvio (volta mais curta, CVT mais fria...). Clique no valor para ver os sensores daquela sessão; clique na linha para o gráfico ao longo das datas."
            actions={<Switch size="md" checked={showEmpty} onChange={e => setShowEmpty(e.currentTarget.checked)} label="Mostrar métricas sem valor" />}>
            {sessions.some(s => !s.summary) && (
              <Text c="dimmed" mb="sm">
                {sessions.filter(s => !s.summary).map(s => `${s.idx + 1} · ${s.meta.name}`).join(', ')}: sem resumo guardado{progress ? ' — calculando agora…' : '.'}
              </Text>
            )}
            {shownRows.length ? (
              <MetricsTable sessions={sessions} rows={shownRows} selected={metricKey} onSelect={setMetric} />
            ) : (
              <EmptyState bare title="Sem métricas para comparar ainda" description={progress ? 'Calculando os resumos…' : 'As sessões escolhidas não têm resumo.'} />
            )}
            <Text size="sm" c="dimmed" mt="sm">
              {sessions.every(s => s.summarySrc === 'recalculado')
                ? 'Valores recalculados agora, cada sessão com os perfis de carro e pista guardados com ela (sem perfil: a configuração em uso).'
                : 'Valores do resumo guardado na biblioteca; são recalculados com os perfis de cada sessão assim que os logs terminam de carregar.'}
            </Text>
          </Section>

          <Section title="Uma métrica ao longo das datas" explain="design.metricTrend"
            description="Tendências entre testes: efeito de cada versão do carro, desgaste (Crr subindo, amortecedor perdendo ζ) e se uma mudança se manteve. Uma sessão atípica (pista molhada, outro piloto) parece tendência: anote o contexto.">
            <TrendChart sessions={sessions} rows={rows} metric={metricKey} onMetric={setMetric} />
          </Section>

          <Section title="Histogramas de velocidade do amortecedor sobrepostos" explain="chart.shockHistOverlay"
            description="O efeito de uma mudança de amortecedor, clicks ou mola: histograma mais estreito = mais controle, mais largo = mais macio. Perto de zero ficam as velocidades baixas (rolagem, arfagem, piloto); nas pontas, os impactos da pista. Só compara bem sessões na mesma pista e em ritmo parecido.">
            {loadedCount === 0 ? (
              <EmptyState bare title="Carregando os logs…" description="Os histogramas aparecem quando os logs escolhidos terminarem de carregar." />
            ) : (
              <div className="bt-cmp-grid">
                {(['FL', 'FR', 'RL', 'RR'] as const).map(c => <ShockOverlay key={c} sessions={sessions} corner={c} />)}
              </div>
            )}
          </Section>

          <Section title="Melhor volta sobreposta" explain="laps.speedTrace"
            description="Velocidade mínima de curva baixa: aderência lateral (pneu, bitola, CG). Saída lenta: tração e CVT. Reta lenta: potência e arrasto. É onde está o tempo do carro novo.">
            {loadedCount === 0 ? (
              <EmptyState bare title="Carregando os logs…" description="O gráfico aparece quando os logs escolhidos terminarem de carregar." />
            ) : <LapOverlay sessions={sessions} />}
          </Section>

        </>
      )}
    </>
  );
}
