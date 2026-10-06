/* Página /aquisicao (docs/ARQUITETURA.md 4.2 e 4.6): quais sensores este log tem, se os dados
 * prestam e o que cada sensor permite decidir no projeto do carro.
 *
 * Abas: Canais do log · Qualidade · Sensores e projeto (para os juízes) · Fórmulas ·
 * Calibração e testes. Todas as contas são do core (dataQuality, sensorAvailability,
 * sensorMatrix, validateFormula/evalFormula, trackConfigInfo); a página só desenha.
 * Sem sessão: Sensores, Fórmulas e Calibração continuam úteis (catálogo, editor, textos). */
import { useMemo, useState } from 'react';
import { Badge, Group, Tabs, Text } from '@mantine/core';
import { IconCalculator, IconChecklist, IconCpu, IconListDetails, IconShieldCheck } from '@tabler/icons-react';
import { dataQuality, SENSOR_IDS } from '@baja/core';
import { PageHeader } from '../components';
import { routeByPath } from '../routes';
import { useCtx, useRange, useSessionStore } from '../state/session';
import { lsGet, lsSet } from '../state/prefs';
import { NoSession } from './aquisicao/common';
import { CanaisTab } from './aquisicao/CanaisTab';
import { QualidadeTab } from './aquisicao/QualidadeTab';
import { SensoresTab } from './aquisicao/SensoresTab';
import { FormulasTab } from './aquisicao/FormulasTab';
import { CalibracaoTab } from './aquisicao/CalibracaoTab';
import './aquisicao/aquisicao.css';

type Tab = 'canais' | 'qualidade' | 'sensores' | 'formulas' | 'calibracao';
const TABS: Tab[] = ['canais', 'qualidade', 'sensores', 'formulas', 'calibracao'];
const K_TAB = 'baja:aquisicao:aba';

export default function AquisicaoPage() {
  const r = routeByPath('/aquisicao')!;
  const ctx = useCtx();
  const ready = useSessionStore(s => s.status === 'ready' && s.ctx !== null);
  const availability = useSessionStore(s => s.availability);
  const source = useSessionStore(s => s.source);
  const range = useRange();
  const [tab, setTab] = useState<Tab>(() => {
    const t = lsGet(K_TAB) as Tab | null;
    return t && TABS.includes(t) ? t : 'canais';
  });
  const pick = (t: string | null) => { if (t && TABS.includes(t as Tab)) { setTab(t as Tab); lsSet(K_TAB, t); } };

  /* qualidade do log inteiro (dataQuality do core) */
  const quality = useMemo(() => (ctx ? dataQuality(ctx.S, ctx) : null), [ctx]);
  const present = SENSOR_IDS.filter(id => availability?.[id] === 'present');
  const nWarn = quality ? quality.issues.filter(i => i.level !== 'info').length : 0;
  const c = ready ? ctx : null;

  return (
    <>
      <PageHeader title={r.label} subtitle={r.question} explain="design.sensorCoverage" sensors={present.length ? present : undefined} />
      {c && (
        <Group gap="xs" mt={-8} mb="lg">
          <Text c="dimmed">Log aberto:</Text>
          <Text fw={600}>{source?.name ?? c.S.name}</Text>
          <Text c="dimmed">· {c.S.kind === 'BUSMASTER' ? 'CAN (BUSMASTER)' : 'FT450 (FT Manager)'} · {c.S.channels.length} canais · {c.S.t.length} amostras</Text>
        </Group>
      )}
      <Tabs value={tab} onChange={pick} className="bt-acq-tabs" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="canais" leftSection={<IconListDetails size={18} />}>Canais do log</Tabs.Tab>
          <Tabs.Tab value="qualidade" leftSection={<IconShieldCheck size={18} />}
            rightSection={nWarn ? <Badge size="sm" color="yellow" variant="filled" circle={nWarn < 10}>{nWarn}</Badge> : undefined}>
            Qualidade
          </Tabs.Tab>
          <Tabs.Tab value="sensores" leftSection={<IconCpu size={18} />}>Sensores e projeto</Tabs.Tab>
          <Tabs.Tab value="formulas" leftSection={<IconCalculator size={18} />}>Fórmulas</Tabs.Tab>
          <Tabs.Tab value="calibracao" leftSection={<IconChecklist size={18} />}>Calibração e testes</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="canais">
          {c && quality ? <CanaisTab ctx={c} quality={quality} /> : (
            <NoSession description="Abra um log para ver cada canal gravado, o sensor que o app reconheceu nele, as amostras válidas, a taxa e se ele travou. Enquanto isso, a aba Sensores e projeto mostra o catálogo completo." />
          )}
        </Tabs.Panel>
        <Tabs.Panel value="qualidade">
          {c && quality ? <QualidadeTab quality={quality} availability={availability} /> : (
            <NoSession description="Abra um log para conferir os dados: sensores sem sinal ou travados, saltos impossíveis, GPS na borda da área, dados do carro faltando — cada aviso com o que fazer." />
          )}
        </Tabs.Panel>
        <Tabs.Panel value="sensores">
          <SensoresTab availability={c ? availability : null} quality={c ? quality : null} sessionName={c ? (source?.name ?? c.S.name) : null} />
        </Tabs.Panel>
        <Tabs.Panel value="formulas">
          <FormulasTab ctx={c} range={c ? range : null} roles={c && quality ? quality.roles : null} />
        </Tabs.Panel>
        <Tabs.Panel value="calibracao">
          <CalibracaoTab ctx={c} quality={c ? quality : null} />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
