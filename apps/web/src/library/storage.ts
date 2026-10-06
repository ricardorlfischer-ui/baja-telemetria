/* Armazenamento do navegador para a biblioteca local (IndexedDB): quanto espaço os logs usam,
 * quanto o navegador deixa usar e se o site está protegido contra a limpeza automática
 * (navigator.storage.persist). Sem proteção, o navegador pode apagar os dados do site quando
 * falta espaço no disco; com ela, só a pessoa apaga (limpar os dados do site).
 *
 * Tudo com try/catch: navegador antigo, http sem TLS ou aba anônima podem não ter a API. */

export interface StorageStatus {
  /** o navegador tem navigator.storage (estimate/persist) */
  supported: boolean;
  /** protegido contra limpeza automática; null = o navegador não informa */
  persisted: boolean | null;
  /** bytes usados por este site (aproximado, inclui o cache do app) */
  usage: number | null;
  /** bytes que o navegador deixa este site usar */
  quota: number | null;
}

const manager = (): StorageManager | null => {
  try {
    return typeof navigator !== 'undefined' && navigator.storage ? navigator.storage : null;
  } catch { return null; }
};

/** Espaço usado/disponível e se está protegido. */
export async function storageStatus(): Promise<StorageStatus> {
  const sm = manager();
  if (!sm) return { supported: false, persisted: null, usage: null, quota: null };
  let persisted: boolean | null = null, usage: number | null = null, quota: number | null = null;
  try { if (typeof sm.persisted === 'function') persisted = await sm.persisted(); } catch { /* sem a API */ }
  try {
    if (typeof sm.estimate === 'function') {
      const e = await sm.estimate();
      usage = typeof e.usage === 'number' ? e.usage : null;
      quota = typeof e.quota === 'number' ? e.quota : null;
    }
  } catch { /* sem a API */ }
  return { supported: true, persisted, usage, quota };
}

/** Pede ao navegador a proteção contra limpeza automática. true = protegido; false = o
 *  navegador recusou (o Chrome decide sozinho pelo uso do site; o Firefox pergunta);
 *  null = sem a API. */
export async function requestPersist(): Promise<boolean | null> {
  const sm = manager();
  if (!sm || typeof sm.persist !== 'function') return null;
  try { if (typeof sm.persisted === 'function' && await sm.persisted()) return true; } catch { /* sem a resposta: pede assim mesmo */ }
  try { return await sm.persist(); } catch { return null; }
}

/* uma vez por carga da página: o Firefox mostra uma pergunta a cada pedido */
let askedThisLoad = false;

/** Pede a proteção sem a pessoa clicar (ao guardar a 1ª sessão, ao abrir a página Sessões com
 *  sessões guardadas): no máximo uma vez por carga da página. */
export async function ensurePersisted(): Promise<boolean | null> {
  if (askedThisLoad) return null;
  askedThisLoad = true;
  return requestPersist();
}

/** Só para os testes: permite pedir de novo. */
export const _resetPersistAsk = (): void => { askedThisLoad = false; };

/* ---------------------------------------------------------------- sem espaço */
export const QUOTA_MESSAGE =
  'Não há mais espaço neste navegador para guardar logs. Apague sessões antigas na página Sessões ' +
  '(se quiser ficar com elas, exporte antes um backup em Preferências → Backup) e tente de novo.';

/** O navegador não deixou gravar: acabou o espaço do site. */
export class LocalQuotaError extends Error {
  constructor(message = QUOTA_MESSAGE) {
    super(message);
    this.name = 'LocalQuotaError';
  }
}

/** Erro de falta de espaço (IndexedDB/localStorage), em qualquer navegador. */
export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  if (e instanceof LocalQuotaError) return true;
  const { name, code } = e as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

/** Mensagem para a tela: a de falta de espaço é sempre a mesma, clara; as outras, a do erro. */
export function storageErrorMessage(e: unknown): string {
  if (isQuotaError(e)) return QUOTA_MESSAGE;
  return e instanceof Error ? e.message : String(e);
}

/** Tamanho em bytes para a tela (ponto decimal, como o resto do app). */
export function fmtBytes(b: number): string {
  if (!(b >= 1024)) return `${Math.max(0, Math.round(b || 0))} B`;
  /* a unidade sai do valor já arredondado: 1048575 B é "1.0 MB", não "1024 kB" */
  const kb = Math.round(b / 1024);
  if (kb < 1024) return `${kb} kB`;
  const mb = (b / 1048576).toFixed(1);
  if (+mb < 1024) return `${mb} MB`;
  return `${(b / 1073741824).toFixed(1)} GB`;
}
