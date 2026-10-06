/* Partes da Ficha do carro (#/projeto): tabela de um grupo da ficha, pontos de atenção e a
 * matriz "de onde saiu cada número" (sensor → grandezas). Só desenham o que o designReport
 * do core devolveu; nenhuma conta aqui. */
import { useEffect } from 'react';
import { Group, Paper, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { SENSORS, SENSOR_IDS, type DesignRec, type DesignRow, type SensorId, type SensorState } from '@baja/core';
import { InfoButton, SensorChips, SENSOR_STATE_TEXT, useExplain } from '../../components';
import './projeto.css';

/** Valor que não é medida ("—", "sem canal", "nenhum com sinal"): aparece apagado. */
export const isMissingVal = (v: string): boolean => v === '—' || /^(sem |nenhum)/.test(v);

/* ---------------------------------------------------------------- tabela de um grupo */
export function FichaTable({ rows }: { rows: DesignRow[] }) {
  const { open } = useExplain();
  const openRow = (r: DesignRow) => open(r.explain, { sensors: r.sensors, title: r.item });
  return (
    <Paper withBorder radius="md" className="bt-ficha-group">
      <table className="bt-ficha-table">
        <colgroup>
          <col className="bt-ficha-col-item" /><col className="bt-ficha-col-val" /><col className="bt-ficha-col-how" />
          <col className="bt-ficha-col-read" /><col className="bt-ficha-col-sens" />
        </colgroup>
        <thead>
          <tr>
            <th>Grandeza</th><th>Valor</th><th>Como foi medido</th><th>Leitura para o projeto</th><th>Sensores</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.item + i} tabIndex={0} title="Abrir a explicação: o que é, de quais sensores saiu e como usar no projeto"
              onClick={() => openRow(r)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRow(r); } }}>
              <td>
                <Group gap={4} wrap="nowrap" align="flex-start" justify="space-between">
                  <span className="bt-ficha-item">{r.item}</span>
                  <InfoButton explain={r.explain} sensors={r.sensors} title={r.item} size="sm" />
                </Group>
              </td>
              <td>
                <span className="bt-ficha-cell-label">Valor</span>
                <span className={isMissingVal(r.val) ? 'bt-ficha-val bt-ficha-val--missing' : 'bt-ficha-val'}>{r.val}</span>
              </td>
              <td className="bt-ficha-how">{r.how && <><span className="bt-ficha-cell-label">Como foi medido</span>{r.how}</>}</td>
              <td>{r.read && <><span className="bt-ficha-cell-label">Leitura para o projeto</span>{r.read}</>}</td>
              <td>
                {r.sensors.length > 0
                  ? <SensorChips sensors={r.sensors} size="sm" />
                  : <Text size="sm" c="dimmed">nenhum sensor entrou</Text>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Paper>
  );
}

/* ---------------------------------------------------------------- pontos de atenção */
export function FichaRecs({ recs }: { recs: DesignRec[] }) {
  const { open } = useExplain();
  return (
    <div className="bt-ficha-recs">
      {recs.map((r, i) => (
        <div key={i} className="bt-ficha-rec" role="button" tabIndex={0} title="Abrir a explicação deste ponto"
          onClick={() => open(r.explain, { sensors: r.sensors, title: 'Ponto de atenção' })}
          onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(r.explain, { sensors: r.sensors, title: 'Ponto de atenção' }); } }}>
          <IconAlertTriangle size={22} stroke={1.9} className="bt-ficha-rec-icon" aria-hidden />
          <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
            <span className="bt-ficha-rec-text">{r.text}</span>
            {r.sensors.length > 0 && <SensorChips sensors={r.sensors} size="sm" />}
          </Stack>
          <InfoButton explain={r.explain} sensors={r.sensors} title="Ponto de atenção" size="sm" />
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- o que falta medir */
/** Linhas da ficha sem medida neste trecho, com o que fazer (o "como" da própria linha). */
export function FichaMissing({ rows }: { rows: DesignRow[] }) {
  const { open } = useExplain();
  const miss = rows.filter(r => isMissingVal(r.val));
  if (!miss.length) return null;
  return (
    <Paper withBorder radius="md" p="lg" mt="md">
      <Stack gap="sm">
        <Text fw={650} size="md">O que falta medir neste trecho ({miss.length})</Text>
        {miss.map((r, i) => (
          <Group key={r.item + i} gap="sm" wrap="nowrap" align="flex-start">
            <InfoButton explain={r.explain} sensors={r.sensors} title={r.item} size="sm" />
            <Text style={{ flex: 1, minWidth: 0 }}>
              <button type="button" className="bt-ficha-link" onClick={() => open(r.explain, { sensors: r.sensors, title: r.item })}><b>{r.item}</b></button>
              {' — '}{r.val === '—' ? 'sem valor' : r.val}{r.how ? `: ${r.how}` : ''}
            </Text>
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}

/* ---------------------------------------------------------------- matriz de sensores */
interface MatrixItem { item: string; explain: string; sensors: SensorId[] }

/** Sensor → grandezas da ficha que ele alimentou (agrupamento das linhas do relatório). */
export function sensorUse(rows: DesignRow[]): { id: SensorId; items: MatrixItem[] }[] {
  const by = new Map<SensorId, MatrixItem[]>();
  rows.forEach(r => r.sensors.forEach(s => {
    const l = by.get(s) ?? [];
    if (!l.some(x => x.item === r.item)) l.push({ item: r.item, explain: r.explain, sensors: r.sensors });
    by.set(s, l);
  }));
  return SENSOR_IDS.filter(id => by.has(id)).map(id => ({ id, items: by.get(id)! }));
}

export function SensorMatrix({ rows, availability }: { rows: DesignRow[]; availability: Partial<Record<SensorId, SensorState>> | null }) {
  const { open } = useExplain();
  const used = sensorUse(rows);
  /* sensores que não entraram em nada: ausentes neste log ou sugeridos (o que destravariam) */
  const missing = SENSOR_IDS.filter(id => !used.some(u => u.id === id) && availability?.[id] !== 'present');
  return (
    <Stack gap="lg">
      {used.length === 0 && (
        <Paper withBorder radius="md" p="lg"><Text>Nenhum sensor entrou nos números da ficha neste trecho: o log não tem os sinais que as contas precisam (veja abaixo o que falta).</Text></Paper>
      )}
      {used.length > 0 && <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
        <table className="bt-ficha-matrix">
          <thead><tr><th className="bt-ficha-matrix-sensor">Sensor</th><th>Grandezas da ficha que saíram dele</th></tr></thead>
          <tbody>
            {used.map(u => (
              <tr key={u.id}>
                <td>
                  <Stack gap={4}>
                    <SensorChips sensors={[u.id]} size="sm" />
                    <Text size="sm" c="dimmed">{SENSORS[u.id].name}{availability?.[u.id] ? ` — ${SENSOR_STATE_TEXT[availability[u.id]!]}` : ''}</Text>
                  </Stack>
                </td>
                <td>
                  {u.items.map((it, k) => (
                    <span key={it.item}>
                      {k > 0 && ' · '}
                      <button type="button" className="bt-ficha-link" onClick={() => open(it.explain, { sensors: it.sensors, title: it.item })}>{it.item}</button>
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Paper>}
      {missing.length > 0 && (
        <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
          <table className="bt-ficha-matrix">
            <thead><tr><th className="bt-ficha-matrix-sensor">Sensor que falta neste log</th><th>O que ele destravaria no projeto</th></tr></thead>
            <tbody>
              {missing.map(id => (
                <tr key={id}>
                  <td>
                    <Stack gap={4}>
                      <SensorChips sensors={[id]} size="sm" />
                      <Text size="sm" c="dimmed">{SENSORS[id].name}{SENSORS[id].planned ? ' — sugerido, ainda não instalado' : ' — ausente neste log'}</Text>
                    </Stack>
                  </td>
                  <td>{(SENSORS[id].unlocks ?? [SENSORS[id].purpose]).slice(0, 3).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Paper>
      )}
    </Stack>
  );
}

/* ---------------------------------------------------------------- impressão */
/** Enquanto a ficha está na tela: a impressão (botão ou Ctrl+P) sai sem menu, cabeçalho e
 *  rodapé do app, em fundo branco (tema claro só durante a impressão). */
export function usePrintMode(): void {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('bt-print-ficha');
    let prev: string | null = null;
    const before = () => {
      prev = html.getAttribute('data-mantine-color-scheme');
      html.setAttribute('data-mantine-color-scheme', 'light');
    };
    const after = () => { if (prev) html.setAttribute('data-mantine-color-scheme', prev); prev = null; };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      html.classList.remove('bt-print-ficha');
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      after();
    };
  }, []);
}
