/* Trecho (Sessão / Volta / Janela) + seletor de volta, no cabeçalho (docs/ARQUITETURA.md 4.2).
 * Vale para todas as páginas de análise (useRange() → rangeOf do core):
 *   Sessão = o log inteiro · Volta = a volta selecionada · Janela = a janela dos gráficos.
 * Escolher uma volta faz o mesmo que clicar na tabela de voltas do antigo (selectLap): janela
 * na volta ±2 % e cursor no começo dela; o play fica restrito à volta. */
import { useMemo } from 'react';
import { Group, SegmentedControl, Select, Text, Tooltip } from '@mantine/core';
import { fmtTime, type RangeMode } from '@baja/core';
import { useRange, useSessionStore } from '../state/session';

export function RangeControl() {
  const ctx = useSessionStore(s => s.ctx);
  const ready = useSessionStore(s => s.status === 'ready' && s.ctx !== null);
  const mode = useSessionStore(s => s.rangeMode);
  const selLap = useSessionStore(s => s.selLap);
  const setRangeMode = useSessionStore(s => s.setRangeMode);
  const setLap = useSessionStore(s => s.setLap);
  const range = useRange();
  const laps = ctx?.laps ?? [];
  const hasLaps = laps.length > 0;

  const lapData = useMemo(() => {
    if (!laps.length) return [];
    const best = Math.min(...laps.map(l => l.time));
    return [
      { value: '-1', label: 'Todas as voltas' },
      ...laps.map((l, k) => ({ value: String(k), label: `Volta ${l.n} · ${fmtTime(l.time)}${l.time === best ? ' ★' : ''}` })),
    ];
  }, [laps]);

  const onMode = (v: string) => {
    const m = v as RangeMode;
    if (m === 'session') { setLap(-1); setRangeMode('session'); return; }
    if (m === 'lap' && selLap < 0 && hasLaps) {
      /* sem volta escolhida: começa pela melhor */
      let k = 0;
      laps.forEach((l, i) => { if (l.time < laps[k].time) k = i; });
      setLap(k);
    }
    setRangeMode(m);
  };

  const onLap = (v: string | null) => {
    const k = v === null ? -1 : +v;
    setLap(k);
    if (k >= 0 && mode === 'session') setRangeMode('lap');
    if (k < 0 && mode === 'lap') setRangeMode('session');
  };

  const noLapsWhy = !ctx ? '' : !ctx.track.ok ? 'Sem trajetória de GPS neste log' : !ctx.cfg.line
    ? 'Defina a linha de largada (Mapa ou Pista e GPS) para separar as voltas'
    : 'Nenhuma volta completa cruzando a linha';

  return (
    <Group gap={6} wrap="nowrap" className="bt-range">
      <Text size="sm" c="dimmed">Trecho</Text>
      <Tooltip label={range ? `Analisando: ${range[2]}` : 'Abra uma sessão'} openDelay={300}>
        <SegmentedControl
          size="xs" disabled={!ready} value={mode} onChange={onMode}
          data={[
            { value: 'session', label: 'Sessão' },
            { value: 'lap', label: 'Volta', disabled: !hasLaps },
            { value: 'view', label: 'Janela' },
          ]}
        />
      </Tooltip>
      {ready && (hasLaps ? (
        <Select
          size="xs" w={168} aria-label="Volta" allowDeselect={false} comboboxProps={{ withinPortal: true }}
          data={lapData} value={String(selLap)} onChange={onLap}
        />
      ) : (
        <Tooltip label={noLapsWhy}><Text size="xs" c="dimmed">sem voltas</Text></Tooltip>
      ))}
      {ready && mode === 'view' && range && <Text size="xs" c="dimmed" className="bt-num" visibleFrom="lg">{range[2]}</Text>}
    </Group>
  );
}
