/* Datas da biblioteca em pt-BR (docs/ARQUITETURA.md 5.3): a data do teste vem como
 * AAAA-MM-DD ou AAAA-MM-DDTHH:MM (tirada do nome do arquivo da FT ou do cabeçalho do
 * BUSMASTER, ou digitada); as datas de envio/atualização vêm em ISO com fuso. */

const pad = (n: number | string) => String(n).padStart(2, '0');

/** Data do teste: "2026-10-05T16:44" → "05/10/2026 16:44"; "2026-10-05" → "05/10/2026".
 *  Texto em outro formato volta como veio; vazio → ''. */
export function fmtSessionDate(d: string | null | undefined): string {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(d);
  if (!m) return d;
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
}

/** Instante ISO (envio, atualização) em dd/mm/aaaa hh:mm no fuso do navegador. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Data de uma sessão para listas: a do teste ou, sem ela, o dia em que foi guardada. */
export const sessionDateText = (m: { date?: string | null; createdAt: string }): string =>
  m.date ? fmtSessionDate(m.date) : `${fmtDateTime(m.createdAt).slice(0, 10)} (guardada)`;
