/* Peças das páginas Mapa e Voltas: estado "sem sessão", linha de largada automática (botão
 * "Automática" do antigo), volta em que o cursor está e o canal pela chave com os sensores
 * de onde ele sai. Só orquestração: as contas são do @baja/core. */
import { useEffect, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { IconMapOff } from '@tabler/icons-react';
import { autoLine, channelExplainId, sensorsOfChannel, type Channel, type Lap, type RoleMap, type SensorId, type SessionContext } from '@baja/core';
import { NoSessionState } from '../../components';
import { useSessionStore } from '../../state/session';

/** Página que precisa de sessão, sem sessão aberta: carregando, ou os botões para abrir. */
export function NoSession({ what }: { what: string }) {
  return (
    <NoSessionState icon={IconMapOff}
      description={`${what} Abra um log da biblioteca (CSV do FT Manager com os canais X/Y do GPS, ou log do BUSMASTER) ou carregue os dados de exemplo.`} />
  );
}

/** Botão "Automática" do antigo: linha perpendicular ao movimento no primeiro trecho andando. */
export function applyAutoLine(): boolean {
  const st = useSessionStore.getState();
  if (!st.S || !st.ctx) return false;
  const l = autoLine(st.S, st.ctx.track);
  if (l) { st.setLine(l); return true; }
  notifications.show({ color: 'yellow', title: 'Linha automática', message: 'Não achei um trecho com o carro andando para pôr a linha' });
  return false;
}

/** Volta que contém o instante tc (lapAt do antigo). */
export const lapAt = (laps: Lap[], tc: number): Lap | null => laps.find(l => tc >= l.t0 && tc < l.t1) || null;

/** Índice da volta em que o cursor está (-1 = fora das voltas); só re-renderiza quando muda. */
export function useCursorLap(laps: Lap[] | undefined): number {
  const find = (tc: number) => (laps ? laps.findIndex(l => tc >= l.t0 && tc < l.t1) : -1);
  const [k, setK] = useState(() => find(useSessionStore.getState().cursor));
  useEffect(() => {
    setK(find(useSessionStore.getState().cursor));
    return useSessionStore.subscribe((s, p) => { if (s.cursor !== p.cursor) setK(find(s.cursor)); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laps]);
  return k;
}

/** BUSMASTER: hora do relógio do PC no instante tc (clockAt do antigo). */
export function clockAt(clock0: string, tc: number): string {
  const [h, m, s] = clock0.split(':').map(Number);
  const x = Math.floor(h * 3600 + m * 60 + s + tc) % 86400;
  return [x / 3600 | 0, (x % 3600) / 60 | 0, x % 60].map(v => String(v).padStart(2, '0')).join(':');
}

/** Canal e de onde ele sai: sensores (sensorsOfChannel) e o card de explicação do canal. */
export interface ChannelInfo { ch: Channel; sensors: SensorId[]; explain: string }

export function channelInfo(ctx: SessionContext, ch: Channel, roles?: RoleMap): ChannelInfo {
  const sensors = sensorsOfChannel(ctx, ch, roles);
  /* canal do log: abre o card do sensor do papel detectado; sem papel, o card genérico */
  const sensor = ch.src === 'log' && sensors[0] && sensors[0] !== 'logger' ? sensors[0] : null;
  return { ch, sensors, explain: channelExplainId(ch.key, sensor) };
}

/** Grupos do seletor "cor por" (fillColorBy do antigo): por grupo, os constantes no fim. */
export function colorByGroups(all: Channel[]): { group: string; items: { value: string; label: string }[] }[] {
  const groups: { g: string; l: Channel[] }[] = [];
  all.forEach(c => {
    const g = c.constant ? 'Constantes (pintam a pista de uma cor só)' : c.group || 'Do log';
    let G = groups.find(x => x.g === g);
    if (!G) groups.push(G = { g, l: [] });
    G.l.push(c);
  });
  groups.sort((a, b) => Number(a.g.startsWith('Constantes')) - Number(b.g.startsWith('Constantes')));
  return groups.map(G => ({
    group: G.g,
    items: G.l.map(c => ({ value: c.key, label: `${c.name}${c.unit ? ' (' + c.unit + ')' : ''}${c.constant ? ' · constante' : ''}` })),
  }));
}
