/* Arrastar canal da lista para um painel (HTML5 drag and drop). O dataTransfer só pode ser
 * lido no drop; durante o arraste o painel precisa saber a unidade do canal para avisar
 * "vai sobrepor" ou "unidade diferente, painel novo", então a chave fica aqui também. */
import type { DragEvent } from 'react';

export const DND_TYPE = 'application/x-baja-channel';

export const drag = { key: null as string | null };

export function startDrag(e: DragEvent, key: string): void {
  drag.key = key;
  e.dataTransfer.setData(DND_TYPE, key);
  e.dataTransfer.setData('text/plain', key);
  e.dataTransfer.effectAllowed = 'copy';
}

export function endDrag(): void { drag.key = null; }

export const isChannelDrag = (e: DragEvent): boolean => Array.from(e.dataTransfer.types).includes(DND_TYPE);

export const droppedKey = (e: DragEvent): string | null => e.dataTransfer.getData(DND_TYPE) || drag.key;
