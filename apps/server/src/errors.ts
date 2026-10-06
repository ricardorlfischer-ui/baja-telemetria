/* Erros da API, sempre em português: { error: 'mensagem' } (e campos extras, como o id da
 * sessão já existente num 409). */
import type { FastifyError, FastifyInstance } from 'fastify';

export class HttpError extends Error {
  readonly statusCode: number;
  readonly extra?: Record<string, unknown>;
  constructor(statusCode: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.extra = extra;
  }
}

export const badRequest = (msg: string, extra?: Record<string, unknown>) => new HttpError(400, msg, extra);
export const unauthorized = (msg = 'Você não está conectado (ou a sessão expirou): entre de novo') => new HttpError(401, msg);
export const forbidden = (msg = 'Sem permissão para isso') => new HttpError(403, msg);
export const notFound = (msg = 'Não encontrado') => new HttpError(404, msg);
export const conflict = (msg: string, extra?: Record<string, unknown>) => new HttpError(409, msg, extra);

/* nomes dos campos nas mensagens de validação */
const FIELD: Record<string, string> = {
  name: 'nome', email: 'e-mail', password: 'senha', oldPassword: 'senha atual', newPassword: 'nova senha',
  role: 'papel', code: 'código', days: 'dias', disabled: 'desativado', text: 'texto', t: 'tempo',
  params: 'parâmetros', date: 'data', trackId: 'pista', carId: 'carro', driver: 'piloto', tags: 'etiquetas',
  notes: 'notas', q: 'busca', tag: 'etiqueta', id: 'id', allowDuplicate: 'permitir duplicado',
};
const TYPE: Record<string, string> = {
  string: 'um texto', number: 'um número', integer: 'um número inteiro', boolean: 'verdadeiro ou falso',
  object: 'um objeto', array: 'uma lista', null: 'vazio',
};

interface AjvErr { keyword: string; instancePath?: string; params?: Record<string, unknown>; message?: string }

const fieldOf = (e: AjvErr): string => {
  const parts = (e.instancePath || '').split('/').filter(Boolean);
  if (e.keyword === 'required' && e.params?.missingProperty) parts.push(String(e.params.missingProperty));
  if (!parts.length) return '';
  const last = parts[parts.length - 1];
  const nice = FIELD[last] ?? last;
  return parts.length > 1 && /^\d+$/.test(last) ? `${FIELD[parts[parts.length - 2]] ?? parts[parts.length - 2]} (item ${+last + 1})` : nice;
};

/** Uma frase em português para o primeiro erro do JSON Schema. */
export function describeValidation(errors: AjvErr[] | undefined): string {
  const e = errors?.[0];
  if (!e) return 'Dados inválidos';
  const f = fieldOf(e), p = e.params || {};
  const q = f ? `"${f}"` : 'o valor';
  switch (e.keyword) {
    case 'required': return `Falta o campo "${f}"`;
    case 'minLength': return f === 'senha' || f === 'nova senha'
      ? `A ${f} precisa ter pelo menos ${p.limit} caracteres`
      : +(p.limit as number) <= 1 ? `Preencha ${q}` : `${q} precisa ter pelo menos ${p.limit} caracteres`;
    case 'maxLength': return `${q} pode ter no máximo ${p.limit} caracteres`;
    case 'minItems': return `${q} precisa ter pelo menos ${p.limit} itens`;
    case 'maxItems': return `${q} pode ter no máximo ${p.limit} itens`;
    case 'minimum': return `${q} deve ser no mínimo ${p.limit}`;
    case 'maximum': return `${q} deve ser no máximo ${p.limit}`;
    case 'exclusiveMinimum': return `${q} deve ser maior que ${p.limit}`;
    case 'type': {
      const types = String(p.type || '').split(',').map(x => TYPE[x] ?? x);
      return `${q} deve ser ${types.join(' ou ')}`;
    }
    case 'enum': return `${q} deve ser um destes: ${((p.allowedValues as unknown[]) || []).join(', ')}`;
    case 'pattern':
    case 'format': return f === 'e-mail' ? 'E-mail inválido' : `${q} está num formato inválido`;
    case 'additionalProperties': return `Campo desconhecido: "${p.additionalProperty}"`;
    default: return `${q}: valor inválido`;
  }
}

/* mensagens dos erros do Fastify e dos plugins, pelo código */
const CODE_MSG: Record<string, string> = {
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'Tipo de conteúdo não aceito',
  FST_ERR_CTP_BODY_TOO_LARGE: 'Pedido grande demais',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'Corpo JSON vazio: envie {} ou não mande Content-Type',
  FST_ERR_CTP_INVALID_JSON_BODY: 'JSON inválido no corpo do pedido',
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: 'Tamanho do pedido (Content-Length) inválido',
  FST_INVALID_MULTIPART_CONTENT_TYPE: 'Envie o log como multipart/form-data (campo file)',
  FST_FILES_LIMIT: 'Envie um arquivo só por vez',
  FST_FIELDS_LIMIT: 'Campos demais no formulário',
  FST_PARTS_LIMIT: 'Partes demais no formulário',
  FST_PROTO_VIOLATION: 'Nome de campo não permitido',
  FST_MP_PREMATURE_CLOSE: 'O envio foi interrompido antes do fim',
  FST_JWT_NO_AUTHORIZATION_IN_HEADER: 'Você não está conectado: entre de novo',
  FST_JWT_AUTHORIZATION_TOKEN_EXPIRED: 'A sessão expirou: entre de novo',
  FST_JWT_AUTHORIZATION_TOKEN_INVALID: 'Sessão inválida: entre de novo',
  FST_JWT_AUTHORIZATION_TOKEN_UNTRUSTED: 'Sessão inválida: entre de novo',
  FST_JWT_BAD_REQUEST: 'Cabeçalho Authorization inválido (use Bearer <token>)',
  FST_JWT_BAD_COOKIE_REQUEST: 'Sessão inválida: entre de novo',
};
const STATUS_MSG: Record<number, string> = {
  400: 'Pedido inválido', 401: 'Você não está conectado (ou a sessão expirou): entre de novo',
  403: 'Sem permissão para isso', 404: 'Não encontrado', 405: 'Método não permitido', 406: 'Formato não aceito',
  409: 'Conflito', 413: 'Pedido grande demais', 415: 'Tipo de conteúdo não aceito',
  429: 'Muitas tentativas: espere um pouco e tente de novo', 500: 'Erro interno no servidor',
};

/** Instala o tratador de erros (JSON { error } em português). */
export function installErrorHandler(app: FastifyInstance, maxUploadMb: number): void {
  app.setErrorHandler((err: FastifyError & { extra?: Record<string, unknown>; pt?: boolean }, req, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: describeValidation(err.validation as AjvErr[]) });
    }
    let status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    let msg: string;
    if (err instanceof HttpError || err.pt) msg = err.message;
    else if (err.code === 'FST_REQ_FILE_TOO_LARGE') { msg = `Arquivo grande demais (limite de ${maxUploadMb} MB)`; status = 413; }
    /* rede de segurança para corridas que escaparem das conferências das rotas */
    else if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') { msg = 'Isso já existe (mudou ao mesmo tempo): atualize e tente de novo'; status = 409; }
    else if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') { msg = 'O carro, a pista ou a sessão escolhida foi apagada: atualize e tente de novo'; status = 409; }
    else if (err.code && CODE_MSG[err.code]) msg = CODE_MSG[err.code];
    else if (err.code?.startsWith('FST_JWT')) { msg = STATUS_MSG[401]; status = 401; }
    else msg = STATUS_MSG[status] || `Erro ${status}`;
    if (status >= 500) req.log.error({ err }, 'erro no pedido');
    return reply.code(status).send({ error: msg, ...(err instanceof HttpError ? err.extra : undefined) });
  });
}
