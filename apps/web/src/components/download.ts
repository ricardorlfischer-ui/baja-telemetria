/* Baixar um texto como arquivo (BT.download do app antigo): ficha em CSV, backup, log original.
 * Um só lugar para o Blob + link temporário (antes havia três cópias). */

/** O navegador baixa `text` como o arquivo `name` na hora. */
export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* o download já começou; o link temporário pode ser liberado depois */
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
