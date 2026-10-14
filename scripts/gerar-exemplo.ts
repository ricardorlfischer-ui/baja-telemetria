/* Grava o log do exemplo (o mesmo do botão "Dados de exemplo") como um CSV do FT Manager,
 * para enviar na página Sessões como qualquer outro log.
 *
 *   npm run exemplo                → exemplos/Teste Chacara 12-10.csv
 *   npm run exemplo -- <pasta>     → <pasta>/Teste Chacara 12-10.csv
 *
 * O Windows não aceita "/" no nome do arquivo: depois de enviar, o nome da sessão pode ser
 * trocado para DEMO_NAME ("Teste Chacara 12/10") e a data é DEMO_DATE. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoCSV, DEMO_DATE, DEMO_FILE, DEMO_NAME } from '../packages/core/src/demo';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.argv[2] || path.join(root, 'exemplos'));
mkdirSync(dir, { recursive: true });
const out = path.join(dir, DEMO_FILE);
const text = demoCSV();
writeFileSync(out, text, 'utf8');
console.log(`${out}\n${(text.length / 1e6).toFixed(1)} MB · sessão "${DEMO_NAME}" · data ${DEMO_DATE.replace('T', ' ')}`);
