/* Aba "Fórmulas": canais calculados pela equipe (formulas.ts do core, sem eval).
 *  - lista das fórmulas salvas (nome, unidade, expressão, estado, sensores de onde saem);
 *  - editor com validateFormula ao digitar (mensagem e posição do erro), prévia no trecho do
 *    cabeçalho (mín/média/máx + gráfico no tempo), inserir canal/função clicando;
 *  - exemplos prontos com os canais deste log; salvar → updateConfig({ formulas }) (perfis). */
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import {
  Badge, Button, Code, Grid, Group, Paper, ScrollArea, SimpleGrid, Stack, Text, TextInput, Textarea, Title, Tooltip, UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceFloppy, IconEdit, IconPlus, IconSearch, IconSparkles, IconTrash } from '@tabler/icons-react';
import {
  evalFormula, FORMULA_CONSTS, FORMULA_FUNCS, FormulaError, formulaKey, getChannel, parseFormula, formulaRefs, sensorsOfChannel,
  validateFormula, type Formula, type FormulaCheck, type RoleMap, type SensorId, type SessionContext,
} from '@baja/core';
import { ChartCard, DataTable, Section, SensorChips, StatTile, XYPlot, type XYPlotHandle, type XYSpec } from '../../components';
import { useProfiles } from '../../state/profiles';
import { useCursorEffect, useSessionStore } from '../../state/session';
import { ExplainText, decFor, fmtN } from './common';

interface Example { name: string; unit: string; expr: string; why: string }

/* exemplos com as chaves dos canais deste log (pelos papéis detectados; sem sessão, os nomes do log de 05/10) */
function examples(roles: RoleMap | null): Example[] {
  const K = (r: keyof RoleMap, d: string) => roles?.[r] ?? d;
  const FL = K('shock_pos_FL', 'Shock_-_Front_Left'), FR = K('shock_pos_FR', 'Shock_-_Front_Right');
  const RL = K('shock_pos_RL', 'Shock_-_Rear_Left'), RR = K('shock_pos_RR', 'Shock_-_Rear_Right');
  const vFL = K('shock_vel_FL', 'Shock_velocity_FL'), cvt = K('cvt_temp', 'CVT_temp'), wheel = K('wheel', 'Wheel_speed');
  return [
    { name: 'Rolagem diant. (mm)', unit: 'mm', expr: `[${FL}] - [${FR}]`, why: 'Esquerda − direita na frente: positivo = esquerda mais comprimida. Em graus o app já calcula (Rolagem diant.) quando há bitola e relação roda/amortecedor.' },
    { name: 'Rolagem tras. (mm)', unit: 'mm', expr: `[${RL}] - [${RR}]`, why: 'O mesmo para o eixo traseiro: compare com a dianteira para ver a distribuição da rigidez de rolagem.' },
    { name: 'Arfagem (mm)', unit: 'mm', expr: `([${FL}] + [${FR}]) / 2 - ([${RL}] + [${RR}]) / 2`, why: 'Frente − traseira: positivo = frente mais comprimida (frenagem, mergulho).' },
    { name: 'Vel. amortecedor diant. esq. (m/s)', unit: 'm/s', expr: `[${vFL}] / 1000`, why: 'A FT grava em mm/s; em m/s fica na unidade do catálogo do amortecedor.' },
    { name: 'Velocidade (m/s)', unit: 'm/s', expr: '[gps:speed] / 3.6', why: 'Velocidade do GPS em m/s, para fórmulas de energia e força.' },
    { name: 'Carro andando', unit: '', expr: 'if([gps:speed] > 5, 1, 0)', why: '1 acima de 5 km/h, 0 parado: multiplique outro canal por ele para ver só o carro andando.' },
    { name: 'Aquecimento da CVT (°C/min)', unit: '°C/min', expr: `deriv(smooth([${cvt}], 5)) * 60`, why: 'Taxa de aquecimento: onde a CVT esquenta na pista (pinte o mapa com ela).' },
    { name: 'Roda − GPS (km/h)', unit: 'km/h', expr: `[${wheel}] - [gps:speed]`, why: 'Diferença crua entre a roda e o GPS: patinação na largada ou erro da circunferência do pneu.' },
  ];
}

/* linha e coluna do caractere pos (1 = primeiro) para o marcador do erro */
function caretAt(expr: string, pos: number): { line: string; col: number; lineNo: number } {
  const before = expr.slice(0, Math.max(0, pos - 1)).split('\n');
  const lineNo = before.length - 1;
  return { line: expr.split('\n')[lineNo] ?? '', col: before[lineNo].length, lineNo };
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function check(expr: string, keys: string[] | null): FormulaCheck {
  if (keys) return validateFormula(expr, keys);
  try { return { ok: true, refs: formulaRefs(parseFormula(expr)) }; } catch (e) {
    if (e instanceof FormulaError) return { ok: false, msg: e.message, pos: e.pos };
    throw e;
  }
}

export function FormulasTab({ ctx, range, roles }: { ctx: SessionContext | null; range: [number, number, string] | null; roles: RoleMap | null }) {
  const formulas = useProfiles(s => s.formulas);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [expr, setExpr] = useState('');
  const [chq, setChq] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const plotRef = useRef<XYPlotHandle>(null);
  const dexpr = useDeferredValue(expr);

  /* canais que a fórmula em edição enxerga: tudo menos ela mesma e as que vêm depois dela */
  const keys = useMemo(() => {
    if (!ctx) return null;
    const idx = editId ? formulas.findIndex(f => f.id === editId) : -1;
    const hide = new Set((idx >= 0 ? formulas.slice(idx) : []).map(f => formulaKey(f)));
    return ctx.all.map(c => c.key).filter(k => !hide.has(k));
  }, [ctx, editId, formulas]);

  const chk = useMemo(() => (dexpr.trim() ? check(dexpr, keys) : null), [dexpr, keys]);

  /* prévia no trecho */
  const preview = useMemo(() => {
    if (!ctx || !range || !chk || !chk.ok || !keys) return null;
    const allow = new Set(keys);
    let data: Float64Array;
    try {
      data = evalFormula(dexpr, { t: ctx.S.t, channel: k => (allow.has(k) ? getChannel(ctx, k)?.data : undefined) });
    } catch (e) {
      if (e instanceof FormulaError) return { error: e.message } as const;
      throw e;
    }
    const [i0, i1] = range, t = ctx.S.t;
    let n = 0, sum = 0, lo = Infinity, hi = -Infinity;
    for (let i = i0; i <= i1; i++) { const v = data[i]; if (v === v && isFinite(v)) { n++; sum += v; if (v < lo) lo = v; if (v > hi) hi = v; } }
    const step = Math.max(1, Math.ceil((i1 - i0 + 1) / 3000));
    const xs: number[] = [], ys: number[] = [];
    for (let i = i0; i <= i1; i += step) { xs.push(t[i]); ys.push(isFinite(data[i]) ? data[i] : NaN); }
    const seen = new Set<SensorId>();
    chk.refs.forEach(r => sensorsOfChannel(ctx, r).forEach(s => seen.add(s)));
    return { n, mean: n ? sum / n : NaN, lo, hi, xs, ys, sensors: [...seen] as SensorId[], total: i1 - i0 + 1 };
  }, [ctx, range, chk, dexpr, keys]);

  const okPreview = preview && !('error' in preview) ? preview : null;
  const spec = useMemo<XYSpec>(() => okPreview ? {
    series: [{ x: okPreview.xs, y: okPreview.ys, label: name || 'fórmula', id: 'single' }],
    xLabel: 'Tempo (s)', yLabel: (name || 'fórmula') + (unit ? ` (${unit})` : ''),
    onClick: x => useSessionStore.getState().seek(x),
    tipX: x => `<b>t = ${x.toFixed(2)} s</b>`,
    markers: [{ x: useSessionStore.getState().cursor, color: 'cursor' }],
    empty: okPreview.n ? undefined : 'A fórmula não tem nenhum valor válido neste trecho.',
  } : { series: [] }, [okPreview, name, unit]);
  useCursorEffect(t => plotRef.current?.update({ markers: [{ x: t, color: 'cursor' }] }));

  const insert = (txt: string) => {
    const el = taRef.current;
    const a = el ? el.selectionStart : expr.length, b = el ? el.selectionEnd : expr.length;
    const next = expr.slice(0, a) + txt + expr.slice(b);
    setExpr(next);
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(a + txt.length, a + txt.length); } });
  };

  const edit = (f: Formula | null, ex?: Example) => {
    setEditId(f ? f.id : null);
    setName(f ? f.name : ex?.name ?? '');
    setUnit(f ? f.unit : ex?.unit ?? '');
    setExpr(f ? f.expr : ex?.expr ?? '');
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const saveOk = !!expr.trim() && !!chk && chk.ok && expr === dexpr;
  const save = () => {
    if (!saveOk) return;
    const f: Formula = { id: editId ?? newId(), name: name.trim() || expr.trim(), unit: unit.trim(), expr: expr.trim() };
    const list = editId ? formulas.map(x => (x.id === editId ? f : x)) : [...formulas, f];
    useSessionStore.getState().updateConfig({ formulas: list });
    notifications.show({ title: editId ? 'Fórmula atualizada' : 'Fórmula salva', message: `${f.name}: o canal aparece no grupo "Fórmulas" em Canais, Mapa e Dispersão.`, autoClose: 4000 });
    setEditId(f.id);
  };
  const remove = (id: string) => {
    useSessionStore.getState().updateConfig({ formulas: formulas.filter(f => f.id !== id) });
    if (editId === id) edit(null);
    setConfirmDel(null);
  };

  const errById = new Map((ctx?.formulaErrors ?? []).map(e => [e.id, e.msg]));
  const exs = useMemo(() => examples(roles), [roles]);
  const allKeys = useMemo(() => (ctx ? ctx.all.map(c => c.key) : null), [ctx]);

  const chans = useMemo(() => {
    if (!ctx) return [];
    const s = chq.trim().toLowerCase();
    return ctx.all.filter(c => !s || c.name.toLowerCase().includes(s) || c.key.toLowerCase().includes(s));
  }, [ctx, chq]);

  const caret = chk && !chk.ok ? caretAt(expr, chk.pos) : null;
  /* canais da fórmula que ficaram constantes neste log (sensor sem sinal) */
  const deadOf = (refs: string[]) => (ctx ? refs.filter(k => { const c = getChannel(ctx, k); return !!c && (c.constant || !c.count); }) : []);
  const deadRefs = chk && chk.ok ? deadOf(chk.refs) : [];
  const sensorsOfF = (f: Formula): SensorId[] => (ctx ? sensorsOfChannel(ctx, formulaKey(f)) : ['logger']);

  return (
    <div>
      <Section
        title={`Canais da equipe (${formulas.length})`}
        description="Um canal novo feito de outros canais: vira um canal como os do log (grupo “Fórmulas”) em Canais, Mapa e Dispersão. Ficam salvos neste navegador junto com a configuração do carro."
        explain="channel.formula" sensors={['logger']}
        actions={<Button size="md" leftSection={<IconPlus size={18} />} onClick={() => edit(null)}>Nova fórmula</Button>}
      >
        <div className="bt-acq-hscroll">
          <div style={{ minWidth: 760 }}>
            <DataTable<Formula>
              rows={formulas} rowKey={f => f.id} selected={(f) => f.id === editId}
              empty="Nenhuma fórmula ainda. Comece por um dos exemplos abaixo."
              columns={[
                { key: 'name', header: 'Nome', render: f => <ExplainText explain="channel.formula" sensors={sensorsOfF(f)} title={f.name} strong>{f.name}</ExplainText> },
                { key: 'unit', header: 'Unidade', render: f => f.unit || '—' },
                { key: 'expr', header: 'Expressão', render: f => <Code className="bt-acq-expr">{f.expr}</Code> },
                {
                  key: 'state', header: 'Estado', render: f => {
                    const err = errById.get(f.id);
                    if (err) return <Text size="sm" c="red">{err}</Text>;
                    if (!ctx) return <Text size="sm" c="dimmed">abra uma sessão</Text>;
                    const c = getChannel(ctx, formulaKey(f));
                    const d = c ? decFor(c.lo, c.hi) : 0;
                    return c ? (
                      <Stack gap={2}>
                        <Text size="sm">{c.count ? `${fmtN(c.lo, d)} – ${fmtN(c.hi, d)} ${f.unit}` : 'sem nenhum valor válido'}</Text>
                        <SensorChips sensors={sensorsOfF(f)} />
                      </Stack>
                    ) : <Text size="sm" c="dimmed">—</Text>;
                  },
                },
                {
                  key: 'act', header: '', width: 210, render: f => (
                    <Group gap={6} wrap="nowrap" justify="flex-end">
                      <Button size="sm" variant="light" leftSection={<IconEdit size={16} />} onClick={() => edit(f)}>Editar</Button>
                      {confirmDel === f.id ? (
                        <Button size="sm" color="red" onClick={() => remove(f.id)} onBlur={() => setConfirmDel(null)}>Confirmar</Button>
                      ) : (
                        <Button size="sm" variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={() => setConfirmDel(f.id)}>Apagar</Button>
                      )}
                    </Group>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section title={editId ? 'Editar fórmula' : 'Nova fórmula'}
        description="Canais entre colchetes pela chave, ex. [Shock_-_Front_Left] ou [gps:speed]. Operadores + − * / ^, comparações (dão 1 ou 0) e as funções abaixo. A conta é conferida enquanto você digita.">
        <Grid gap="lg">
          <Grid.Col span={{ base: 12, lg: 7 }}>
            <Paper withBorder radius="md" p="lg">
              <Stack gap="md">
                <Group grow align="flex-start" wrap="wrap">
                  <TextInput size="md" label="Nome" placeholder="ex.: Rolagem diant. (mm)" value={name} onChange={e => setName(e.currentTarget.value)} />
                  <TextInput size="md" label="Unidade" placeholder="ex.: mm" value={unit} onChange={e => setUnit(e.currentTarget.value)} maw={180} />
                </Group>
                <Textarea
                  ref={taRef} size="md" label="Expressão" autosize minRows={3} maxRows={8} spellCheck={false}
                  classNames={{ input: 'bt-acq-mono' }} placeholder="[Shock_-_Front_Left] - [Shock_-_Front_Right]"
                  value={expr} onChange={e => setExpr(e.currentTarget.value)}
                  error={chk && !chk.ok ? chk.msg : undefined}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}
                />
                {caret && (
                  <pre className="bt-acq-caret" aria-label="Posição do erro">
                    {caret.line}{'\n'}{' '.repeat(caret.col)}<span>^</span> posição {chk && !chk.ok ? chk.pos : ''}{caret.lineNo ? ` (linha ${caret.lineNo + 1})` : ''}
                  </pre>
                )}
                {chk && chk.ok && (
                  <Group gap="sm">
                    <Badge color="green" variant="light" size="lg">Fórmula válida</Badge>
                    {chk.refs.length > 0 && <Text size="sm" c="dimmed">usa {chk.refs.map(r => `[${r}]`).join(', ')}</Text>}
                    {!ctx && <Text size="sm" c="dimmed">(sem sessão: só a sintaxe foi conferida)</Text>}
                  </Group>
                )}
                {deadRefs.length > 0 && (
                  <Text c="orange">Sem sinal neste log: {deadRefs.map(k => `[${k}]`).join(', ')} ficou constante (sensor sem sinal), então o resultado não diz nada sobre o carro. Confira o sensor na aba Qualidade.</Text>
                )}
                {preview && 'error' in preview && <Text c="red">{preview.error}</Text>}
                <Group gap="sm">
                  <Button size="md" leftSection={<IconDeviceFloppy size={18} />} disabled={!saveOk} onClick={save}>
                    {editId ? 'Salvar alterações' : 'Salvar fórmula'}
                  </Button>
                  {(editId || expr) && <Button size="md" variant="default" onClick={() => edit(null)}>Limpar</Button>}
                  <Text size="sm" c="dimmed">Ctrl+Enter salva</Text>
                </Group>
              </Stack>
            </Paper>

            <Title order={3} mt="lg" mb="xs">Funções e constantes (clique para inserir)</Title>
            <Group gap={6} wrap="wrap">
              {Object.entries(FORMULA_FUNCS).map(([k, f]) => (
                <Tooltip key={k} label={f.desc}>
                  <Button size="sm" variant="default" className="bt-acq-mono" onClick={() => insert(k + '(')}>{k}()</Button>
                </Tooltip>
              ))}
              {Object.entries(FORMULA_CONSTS).map(([k, c]) => (
                <Tooltip key={k} label={c.desc}>
                  <Button size="sm" variant="light" color="gray" className="bt-acq-mono" onClick={() => insert(k)}>{k}</Button>
                </Tooltip>
              ))}
            </Group>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 5 }}>
            <Paper withBorder radius="md" p="lg" h="100%">
              <Text fw={650} size="lg" mb={4}>Canais (clique para inserir)</Text>
              {ctx ? (
                <>
                  <TextInput size="md" mb="sm" placeholder="Procurar canal" leftSection={<IconSearch size={17} />} value={chq} onChange={e => setChq(e.currentTarget.value)} />
                  <ScrollArea h={380} type="auto" offsetScrollbars>
                    <Stack gap={2}>
                      {chans.map(c => (
                        <UnstyledButton key={c.key} className="bt-acq-chan" onClick={() => insert(`[${c.key}]`)} data-const={c.constant || undefined}>
                          <Text size="md" fw={500} lh={1.3}>{c.name}{c.unit ? ` (${c.unit})` : ''}{c.constant ? ' · constante' : ''}</Text>
                          <Text size="xs" c="dimmed" ff="monospace" style={{ wordBreak: 'break-all' }}>[{c.key}] · {c.group}</Text>
                        </UnstyledButton>
                      ))}
                      {!chans.length && <Text c="dimmed">Nenhum canal com esse nome.</Text>}
                    </Stack>
                  </ScrollArea>
                </>
              ) : (
                <Text c="dimmed">Abra uma sessão para listar os canais do log. Sem sessão dá para escrever a fórmula com as chaves entre colchetes (ex. [Shock_-_Front_Left]); a conferência dos canais e a prévia aparecem quando um log estiver aberto.</Text>
              )}
            </Paper>
          </Grid.Col>
        </Grid>
      </Section>

      {ctx && chk && chk.ok && okPreview && (
        <Section title={`Prévia no trecho: ${range?.[2] ?? ''}`} description="Os números e o gráfico usam o trecho escolhido no cabeçalho (Sessão / Volta / Janela). Clique no gráfico para mover o cursor.">
          <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md" mb="lg">
            <StatTile label="Mínimo" value={fmtN(okPreview.lo, decFor(okPreview.lo, okPreview.hi))} unit={unit} explain="channel.formula" sensors={okPreview.sensors} />
            <StatTile label="Média" value={fmtN(okPreview.mean, decFor(okPreview.lo, okPreview.hi))} unit={unit} explain="channel.formula" sensors={okPreview.sensors} />
            <StatTile label="Máximo" value={fmtN(okPreview.hi, decFor(okPreview.lo, okPreview.hi))} unit={unit} explain="channel.formula" sensors={okPreview.sensors} />
            <StatTile label="Amostras válidas" value={`${okPreview.n} de ${okPreview.total}`} explain="quality.validSamples" sensors={okPreview.sensors} />
          </SimpleGrid>
          <ChartCard title={name || 'Fórmula'} subtitle={expr} explain="channel.formula" sensors={okPreview.sensors}>
            <XYPlot ref={plotRef} spec={spec} height={300} />
          </ChartCard>
        </Section>
      )}

      <Section title="Exemplos prontos" description="Com os canais deste log. Clique para levar ao editor; nada é salvo até você apertar Salvar.">
        <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }} spacing="md">
          {exs.map(ex => {
            const c = allKeys ? validateFormula(ex.expr, allKeys) : null;
            const off = !!c && !c.ok;
            return (
              <Paper key={ex.name} withBorder radius="md" p="md" className="bt-acq-example" data-off={off || undefined}>
                <Stack gap={8} h="100%">
                  <Group gap={8} wrap="nowrap"><IconSparkles size={18} aria-hidden /><Text fw={650}>{ex.name}</Text></Group>
                  <Code block className="bt-acq-expr">{ex.expr}</Code>
                  <Text size="sm" c="dimmed" style={{ flex: 1 }}>{ex.why}</Text>
                  {off && c && !c.ok && <Text size="sm" c="orange">Este log não tem o canal: {c.msg.replace(/ na posição \d+/, '')}.</Text>}
                  {c && c.ok && deadOf(c.refs).length > 0 && <Text size="sm" c="orange">Sem sinal neste log: {deadOf(c.refs).map(k => `[${k}]`).join(', ')}.</Text>}
                  <Button size="sm" variant={off ? 'default' : 'light'} onClick={() => edit(null, ex)}>Usar no editor</Button>
                </Stack>
              </Paper>
            );
          })}
        </SimpleGrid>
      </Section>
    </div>
  );
}
