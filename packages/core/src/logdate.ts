/* Data do teste a partir do arquivo do log (novo): o nome do arquivo que a FT450/FT Manager
 * grava e o cabeçalho do BUSMASTER. Usado quando a pessoa não informou a data ao guardar a
 * sessão (servidor e biblioteca local usam a mesma regra).
 *
 *   FT:        "Log 3_20261005-1644.csv"                      → 2026-10-05T16:44
 *   BUSMASTER: "***START DATE AND TIME 5:10:2026 16:34:30:698***" (dia:mês:ano) → 2026-10-05T16:34
 *   solta:     "teste 2026-03-02.csv" ou "..._20260302.csv"   → 2026-03-02
 *
 * Datas impossíveis (mês 13, 25 h...) e anos fora de 2000–2100 são ignorados. */

const pad = (n: number | string) => String(n).padStart(2, '0');
const okDate = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h < 24 && mi >= 0 && mi < 60;

/** Data do teste: 'AAAA-MM-DDTHH:MM', 'AAAA-MM-DD' ou null. `text` = o começo do log (só os
 *  primeiros 2000 caracteres são lidos; basta passar o cabeçalho). Ordem: data e hora no nome
 *  do arquivo (FT), cabeçalho do BUSMASTER, data solta no nome. */
export function guessDate(fileName: string, text = ''): string | null {
  const base = fileName.replace(/^.*[\\/]/, '');
  let m = /(20\d{2})(\d{2})(\d{2})[-_ T]?(\d{2})(\d{2})/.exec(base);
  if (m && okDate(+m[1], +m[2], +m[3], +m[4], +m[5])) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  m = /START DATE AND TIME\s+(\d{1,2}):(\d{1,2}):(\d{4})\s+(\d{1,2}):(\d{1,2})/.exec(text.slice(0, 2000));
  if (m && okDate(+m[3], +m[2], +m[1], +m[4], +m[5])) return `${m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4])}:${pad(m[5])}`;
  m = /(20\d{2})-(\d{2})-(\d{2})/.exec(base);
  if (m && okDate(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /(20\d{2})(\d{2})(\d{2})/.exec(base);
  if (m && okDate(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
