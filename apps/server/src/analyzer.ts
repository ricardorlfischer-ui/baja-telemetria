/* Análise dos logs num processo à parte (src/analysis-worker.ts), um log por vez, em fila.
 *
 * Por quê: um log denso de 28 MB leva ~6 s de conta e ~550 MB; um de 95 MB, ~20 s. No processo
 * do servidor isso parava tudo (login, listas, health) durante a conta, e um log com um valor
 * absurdo (ex.: roda a 6e8 km/h num único ponto) fazia o core alocar até estourar a memória e
 * o Node morria levando o servidor junto. Uma worker_thread com resourceLimits não basta: uma
 * alocação grande de uma vez dá "CALL_AND_RETRY_LAST" e derruba o processo inteiro. Por isso
 * um processo filho, com --max-old-space-size (ANALYSIS_MEMORY_MB) e tempo máximo
 * (ANALYSIS_TIMEOUT_S): estourou, só ele morre, o pedido recebe uma mensagem em português e a
 * próxima análise sobe outro processo.
 *
 * O filho lê o log direto do arquivo guardado (DATA_DIR/sessions/<id>.gz): os bytes não
 * passam pelo canal entre os processos. Uma análise por vez: a memória fica limitada. */
import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import type { Socket } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { FastifyBaseLogger } from 'fastify';
import type { SessionSummary } from '@baja/core';
import type { AnalyzeMsg, Params } from './analysis';
import { badRequest, HttpError } from './errors';

export interface AnalyzeInput {
  /** caminho do .gz guardado (Storage.path) */
  file: string;
  fileName: string;
  track: Params | null;
  car: Params | null;
  now?: number;
}

export interface AnalyzeResult {
  kind: 'FT' | 'BUSMASTER';
  date: string | null;
  summary: SessionSummary | null;
  summaryError: string | null;
}

export interface AnalyzerOptions {
  /** heap máximo do processo de análise (MB) */
  memoryMb: number;
  /** tempo máximo de uma análise (ms) */
  timeoutMs: number;
  log: FastifyBaseLogger;
}

interface Job {
  id: number;
  input: AnalyzeInput;
  resolve(r: AnalyzeResult): void;
  reject(e: Error): void;
  parsed?: { kind: AnalyzeResult['kind']; date: string | null };
  timer?: NodeJS.Timeout;
}

type ChildMsg = { id: number } & AnalyzeMsg;

const closing = () => new HttpError(503, 'O servidor está encerrando: tente de novo em instantes');
const OOM = /heap out of memory|Allocation failed|Reached heap limit|ERR_WORKER_OUT_OF_MEMORY/i;

export class Analyzer {
  private child: ChildProcess | null = null;
  private stderrTail = '';
  private queue: Job[] = [];
  private current: Job | null = null;
  private seq = 0;
  private closed = false;

  constructor(private opts: AnalyzerOptions) {}

  /** Lê o log e calcula o resumo. Log ilegível → HttpError 400 (mensagem do parser). Resumo
   *  que falhou (erro, memória, tempo) → summary null e summaryError em português. Arquivo
   *  que não dá para ler → Error com `code` (ex.: ENOENT). */
  run(input: AnalyzeInput): Promise<AnalyzeResult> {
    if (this.closed) return Promise.reject(closing());
    return new Promise<AnalyzeResult>((resolve, reject) => {
      this.queue.push({ id: ++this.seq, input, resolve, reject });
      this.next();
    });
  }

  /** Análises na fila + a que está rodando. */
  get pending(): number { return this.queue.length + (this.current ? 1 : 0); }

  async close(): Promise<void> {
    this.closed = true;
    for (const j of this.queue.splice(0)) j.reject(closing());
    const cur = this.current;
    this.current = null;
    if (cur) { clearTimeout(cur.timer); cur.reject(closing()); }
    const c = this.child;
    this.child = null;
    if (c && c.exitCode === null && c.signalCode === null) {
      /* ref de novo: parado, o processo estava solto (unref) e o 'exit' nunca chegaria */
      this.hold(c, true);
      let timer: NodeJS.Timeout | undefined;
      const exited = new Promise<void>(res => { c.once('exit', () => res()); timer = setTimeout(res, 3000); });
      c.kill();
      await exited;
      clearTimeout(timer);
    }
  }

  /* ------------------------------------------------------------ processo */
  private spawn(): ChildProcess {
    const here = import.meta.url;
    /* rodando do fonte (tsx no desenvolvimento, vitest nos testes): o filho carrega o .ts pelo
     * tsx (devDependency). No build (dist/) o filho é o analysis-worker.js do tsup. */
    const fromSource = new URL(here).pathname.endsWith('.ts');
    const entry = fileURLToPath(new URL(fromSource ? './analysis-worker.ts' : './analysis-worker.js', here));
    const execArgv = [`--max-old-space-size=${Math.max(64, Math.round(this.opts.memoryMb))}`];
    if (fromSource) execArgv.unshift('--import', pathToFileURL(createRequire(here).resolve('tsx')).href);
    const c = fork(entry, [], { execArgv, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'json' });
    this.stderrTail = '';
    c.stderr?.setEncoding('utf8');
    c.stderr?.on('data', (d: string) => { if (this.child === c) this.stderrTail = (this.stderrTail + d).slice(-4000); });
    c.on('message', (m: ChildMsg) => { if (this.child === c) this.onMessage(m); });
    c.on('error', e => {
      if (this.child !== c) return;
      this.opts.log.error({ err: e }, 'erro no processo de análise');
      this.fail('error');
    });
    /* 'close' (não 'exit'): só depois do stderr inteiro lido, para achar o "heap out of memory" */
    c.on('close', (code, signal) => {
      if (this.child !== c) return;
      this.child = null;
      if (!this.current) return;
      const oom = OOM.test(this.stderrTail);
      if (!oom) this.opts.log.error(`processo de análise saiu (código ${code}, sinal ${signal}): ${this.stderrTail.slice(-800)}`);
      this.fail(oom ? 'memory' : 'error');
    });
    return c;
  }

  /* processo parado não segura o servidor (nem os testes) abertos */
  private hold(c: ChildProcess, on: boolean): void {
    const s = c.stderr as Socket | null;
    if (on) { c.ref(); c.channel?.ref(); s?.ref?.(); } else { c.unref(); c.channel?.unref(); s?.unref?.(); }
  }

  private next(): void {
    if (this.current || this.closed) return;
    const job = this.queue.shift();
    if (!job) { if (this.child) this.hold(this.child, false); return; }
    this.current = job;
    let c: ChildProcess;
    try {
      c = this.child ??= this.spawn();
    } catch (e) {
      this.opts.log.error({ err: e }, 'não consegui criar o processo de análise');
      this.current = null;
      job.reject(new HttpError(500, 'Não consegui iniciar a análise do log no servidor'));
      setImmediate(() => this.next());
      return;
    }
    this.hold(c, true);
    job.timer = setTimeout(() => this.fail('timeout'), this.opts.timeoutMs);
    const { file, fileName, track, car, now } = job.input;
    c.send({ id: job.id, file, fileName, track, car, now: now ?? Date.now() }, err => {
      if (err && this.child === c && this.current === job) {
        this.opts.log.error({ err }, 'não consegui mandar o log para o processo de análise');
        this.fail('error');
      }
    });
  }

  private onMessage(m: ChildMsg): void {
    const job = this.current;
    if (!job || job.id !== m.id) return;
    if (m.type === 'parsed') { job.parsed = { kind: m.kind, date: m.date }; return; }
    this.done();
    if (m.type === 'readError') job.reject(Object.assign(new Error(`não consegui ler o arquivo guardado (${m.code})`), { code: m.code }));
    else if (m.type === 'parseError') job.reject(badRequest(m.message));
    else if (!job.parsed) job.reject(new HttpError(500, 'A análise do log terminou sem ler o log'));
    else job.resolve({ ...job.parsed, summary: m.summary, summaryError: m.summaryError });
  }

  private done(): void {
    clearTimeout(this.current?.timer);
    this.current = null;
    setImmediate(() => this.next());
  }

  /* o processo morreu (memória, erro) ou passou do tempo: descarta e responde o que der */
  private fail(why: 'memory' | 'timeout' | 'error'): void {
    const job = this.current;
    const c = this.child;
    this.child = null;
    if (c && c.exitCode === null && c.signalCode === null) c.kill();
    if (!job) return;
    this.done();
    const limit = why === 'memory' ? `passou do limite de memória da análise (${this.opts.memoryMb} MB)`
      : why === 'timeout' ? `passou do tempo limite da análise (${+(this.opts.timeoutMs / 1000).toFixed(1)} s)`
        : 'a análise falhou no servidor';
    this.opts.log.warn(`análise de "${job.input.fileName}": ${limit}`);
    if (job.parsed) job.resolve({ ...job.parsed, summary: null, summaryError: `Não deu para calcular o resumo: ${limit}` });
    else job.reject(badRequest(`Não consegui ler o log "${job.input.fileName}": ${limit}`));
  }
}
