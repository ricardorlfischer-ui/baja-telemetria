/* Página /mapa (docs/ARQUITETURA.md 4.2): mapa grande colorido por qualquer canal, legenda,
 * satélite, seguir o carro, linha de largada e valores no cursor; aba "Mapas por canal" (um
 * mini-mapa por canal). Porte do card Mapa + card Agora + aba "Mapas por canal" do antigo.
 * As peças ficam em pages/mapa/. */
import { useState } from 'react';
import { Group, Tabs, Text } from '@mantine/core';
import { IconLayoutGrid, IconMap2 } from '@tabler/icons-react';
import { PageHeader } from '../components';
import { routeByPath } from '../routes';
import { useCtx, useRange, useSessionReady } from '../state/session';
import { lsGet, lsSet } from '../state/prefs';
import { NoSession } from './mapa/common';
import { MainMap } from './mapa/MainMap';
import { ChannelMaps } from './mapa/ChannelMaps';
import './mapa/mapa.css';

type Tab = 'mapa' | 'canais';
const TAB_KEY = 'bt.mapa.tab';

export default function MapaPage() {
  const r = routeByPath('/mapa')!;
  const ready = useSessionReady();
  const ctx = useCtx();
  const range = useRange();
  const [tab, setTabState] = useState<Tab>(() => (lsGet(TAB_KEY) === 'canais' ? 'canais' : 'mapa'));
  const setTab = (t: Tab) => { setTabState(t); lsSet(TAB_KEY, t); };

  const header = <PageHeader title={r.label} subtitle={r.question} explain="chart.trackMap" sensors={['gps']} />;
  if (!ready || !ctx) return <>{header}<NoSession what="O mapa mostra a trajetória do GPS colorida por qualquer canal." /></>;

  return (
    <>
      {header}
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm" mb="md">
        <Tabs value={tab} onChange={v => v && setTab(v as Tab)} className="bt-mapa-tabs">
          <Tabs.List>
            <Tabs.Tab value="mapa" leftSection={<IconMap2 size={18} />}>Mapa</Tabs.Tab>
            <Tabs.Tab value="canais" leftSection={<IconLayoutGrid size={18} />}>Mapas por canal</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        {range && (
          <Text size="sm" c="dimmed">Trecho colorido: <b>{range[2]}</b> · mude em “Trecho” no cabeçalho</Text>
        )}
      </Group>
      {tab === 'mapa'
        ? <MainMap ctx={ctx} />
        : <ChannelMaps ctx={ctx} onPicked={() => setTab('mapa')} />}
    </>
  );
}
