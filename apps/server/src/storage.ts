/* Arquivos dos logs: DATA_DIR/sessions/<id>.gz com os bytes originais comprimidos (gzip do
 * node:zlib). O download devolve exatamente o arquivo enviado, em stream (um log de 100 MB não
 * vai inteiro para a memória a cada download). */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline, type Readable } from 'node:stream';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const gzip = promisify(zlib.gzip);

export class Storage {
  readonly dir: string;
  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'sessions');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /* o id vira nome de arquivo: só letras, dígitos, _ e - (nada de ../) */
  private file(id: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('id de sessão inválido');
    return path.join(this.dir, `${id}.gz`);
  }

  /** Caminho do .gz da sessão (o processo de análise lê direto dele). */
  pathOf(id: string): string { return this.file(id); }

  /** Comprime e grava (arquivo temporário + rename: nunca fica um .gz pela metade). */
  async save(id: string, raw: Buffer): Promise<number> {
    const gz = await gzip(raw, { level: 6 });
    const f = this.file(id), tmp = `${f}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, gz);
    await fs.promises.rename(tmp, f);
    return gz.length;
  }

  /** Tamanho do .gz no disco, ou null se o arquivo não existe. */
  async gzSize(id: string): Promise<number | null> {
    try { return (await fs.promises.stat(this.file(id))).size; } catch { return null; }
  }

  /** Stream dos bytes comprimidos. */
  gzStream(id: string): Readable { return fs.createReadStream(this.file(id)); }

  /** Stream dos bytes originais (descomprime no caminho). */
  rawStream(id: string): Readable {
    return pipeline(fs.createReadStream(this.file(id)), zlib.createGunzip(), () => { /* erro vai para o stream final */ });
  }

  async remove(id: string): Promise<void> {
    await fs.promises.rm(this.file(id), { force: true });
  }
}
