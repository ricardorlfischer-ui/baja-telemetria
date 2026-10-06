/* Processo da análise (child_process.fork, iniciado por src/analyzer.ts): lê o log guardado
 * (DATA_DIR/sessions/<id>.gz) e calcula o resumo fora do processo do servidor. Um log grande
 * leva segundos de conta e centenas de MB; aqui isso não para o servidor e, se a conta estourar
 * a memória (--max-old-space-size) ou o tempo, só este processo morre.
 * Recebe { id, file, fileName, track, car, now } e responde { id, ...AnalyzeMsg }. */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { analyzeLog, type AnalyzeMsg, type Params } from './analysis';

interface Request { id: number; file: string; fileName: string; track: Params | null; car: Params | null; now: number }

if (!process.send) throw new Error('analysis-worker roda só como processo filho do servidor (src/analyzer.ts)');
const send = (m: { id: number } & AnalyzeMsg) => { process.send!(m); };

process.on('message', (m: Request) => {
  let raw: Buffer;
  try {
    raw = zlib.gunzipSync(fs.readFileSync(m.file));
  } catch (e) {
    const code = (e as { code?: string }).code ?? 'EIO';
    send({ id: m.id, type: 'readError', code });
    return;
  }
  analyzeLog({ raw, fileName: m.fileName, track: m.track, car: m.car, now: m.now }, msg => send({ id: m.id, ...msg }));
});

/* o servidor saiu (ou fechou o canal): sai junto */
process.on('disconnect', () => process.exit(0));
