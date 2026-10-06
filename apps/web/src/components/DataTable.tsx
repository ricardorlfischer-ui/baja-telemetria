/* Tabela simples: cabeçalho fixo, linhas clicáveis (linha selecionada destacada), números
 * alinhados à direita com algarismos de largura fixa (tabular-nums). */
import type { CSSProperties, ReactNode } from 'react';
import { ScrollArea, Table } from '@mantine/core';

export interface Column<R> {
  key: string;
  header: ReactNode;
  /** conteúdo da célula; padrão: (row as any)[key] */
  render?: (row: R, index: number) => ReactNode;
  /** número: alinhado à direita, tabular-nums */
  numeric?: boolean;
  width?: number | string;
  /** dica no cabeçalho */
  title?: string;
}

export interface DataTableProps<R> {
  columns: Column<R>[];
  rows: R[];
  rowKey?: (row: R, index: number) => string | number;
  onRowClick?: (row: R, index: number) => void;
  /** índice (ou predicado) da linha selecionada */
  selected?: number | ((row: R, index: number) => boolean);
  /** altura máxima com rolagem (cabeçalho fica fixo) */
  maxHeight?: number | string;
  empty?: ReactNode;
  dense?: boolean;
  style?: CSSProperties;
}

export function DataTable<R>({ columns, rows, rowKey, onRowClick, selected, maxHeight, empty, dense, style }: DataTableProps<R>) {
  const isSel = (r: R, i: number) => (typeof selected === 'function' ? selected(r, i) : selected === i);
  const table = (
    <Table
      stickyHeader highlightOnHover={!!onRowClick} verticalSpacing={dense ? 4 : 'xs'} horizontalSpacing="sm"
      className="bt-table" style={style}
    >
      <Table.Thead>
        <Table.Tr>
          {columns.map(c => (
            <Table.Th key={c.key} title={c.title} style={{ width: c.width, textAlign: c.numeric ? 'right' : undefined }}>
              {c.header}
            </Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.length === 0 && empty !== undefined && (
          <Table.Tr><Table.Td colSpan={columns.length} className="bt-table-empty">{empty}</Table.Td></Table.Tr>
        )}
        {rows.map((r, i) => (
          <Table.Tr
            key={rowKey ? rowKey(r, i) : i}
            onClick={onRowClick ? () => onRowClick(r, i) : undefined}
            data-clickable={onRowClick ? '' : undefined}
            data-selected={isSel(r, i) ? '' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onKeyDown={onRowClick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(r, i); } } : undefined}
          >
            {columns.map(c => (
              <Table.Td key={c.key} className={c.numeric ? 'bt-num' : undefined}>
                {c.render ? c.render(r, i) : ((r as Record<string, unknown>)[c.key] as ReactNode)}
              </Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
  if (maxHeight === undefined) return <div className="bt-table-wrap">{table}</div>;
  return <ScrollArea.Autosize mah={maxHeight} type="auto" className="bt-table-wrap">{table}</ScrollArea.Autosize>;
}
