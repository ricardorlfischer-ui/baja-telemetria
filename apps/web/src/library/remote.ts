/* Cliente da API do servidor da equipe (docs/ARQUITETURA.md 5.3). Token Bearer guardado no
 * localStorage; erros sempre em português (mensagem do servidor quando vier, senão pelo status). */
import { lsGet, lsSet } from '../state/prefs';
import type {
  CarProfile, Comment, Invite, Library, LogInput, Role, ServerInfo, SessionMeta, SessionPatch, SessionQuery,
  TrackProfile, User,
} from './types';

const TOKEN_KEY = 'baja:token';

export const getToken = (): string | null => lsGet(TOKEN_KEY);
export const setToken = (t: string | null): void => lsSet(TOKEN_KEY, t);

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const STATUS_MSG: Record<number, string> = {
  400: 'Pedido inválido',
  401: 'Você não está conectado (ou a sessão expirou): entre de novo',
  403: 'Sem permissão para isso',
  404: 'Não encontrado no servidor',
  409: 'Conflito: isso já existe',
  413: 'Arquivo grande demais para o servidor',
  415: 'Tipo de arquivo não aceito',
  429: 'Muitas tentativas: espere um pouco e tente de novo',
  500: 'Erro interno no servidor',
  502: 'O servidor não respondeu (proxy)',
  503: 'Servidor indisponível no momento',
};

export interface AuthResult { token: string; user: User }

/** Cliente da API. baseUrl '' = mesma origem (app servido pelo próprio servidor). */
export class RemoteLibrary implements Library {
  readonly mode = 'remote' as const;
  readonly baseUrl: string;
  /** chamado quando o servidor responde 401 (token inválido): a interface volta ao login */
  onUnauthorized: (() => void) | null = null;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  url(path: string): string { return `${this.baseUrl}/api${path}`; }

  private async req<T>(method: string, path: string, body?: unknown, opts: { raw?: boolean; form?: FormData; auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    const tok = getToken();
    if (tok && opts.auth !== false) headers.Authorization = `Bearer ${tok}`;
    let payload: BodyInit | undefined;
    if (opts.form) payload = opts.form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    let res: Response;
    try {
      res = await fetch(this.url(path), { method, headers, body: payload });
    } catch {
      throw new ApiError(`Não consegui falar com o servidor${this.baseUrl ? ` (${this.baseUrl})` : ''}: sem internet ou servidor desligado`, 0);
    }
    if (!res.ok) {
      let msg = '';
      try {
        const j = await res.json() as { error?: string; message?: string };
        msg = j.error || j.message || '';
      } catch { /* sem corpo JSON */ }
      if (res.status === 401 && tok) { setToken(null); this.onUnauthorized?.(); }
      throw new ApiError(msg || STATUS_MSG[res.status] || `Erro ${res.status} no servidor`, res.status);
    }
    if (opts.raw) return res as unknown as T;
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get('content-type') || '';
    return (ct.includes('json') ? await res.json() : await res.text()) as T;
  }

  /* ------------------------------------------------------------ servidor e contas */
  info(): Promise<ServerInfo> { return this.req('GET', '/info', undefined, { auth: false }); }
  health(): Promise<{ ok: boolean }> { return this.req('GET', '/health', undefined, { auth: false }); }

  private async auth(path: string, body: unknown): Promise<AuthResult> {
    const r = await this.req<AuthResult>('POST', path, body, { auth: false });
    setToken(r.token);
    return r;
  }
  /** primeiro administrador (só quando o servidor não tem usuários) */
  setup(b: { name: string; email: string; password: string }): Promise<AuthResult> { return this.auth('/auth/setup', b); }
  login(email: string, password: string): Promise<AuthResult> { return this.auth('/auth/login', { email, password }); }
  register(b: { code: string; name: string; email: string; password: string }): Promise<AuthResult> { return this.auth('/auth/register', b); }
  logout(): void { setToken(null); }
  get loggedIn(): boolean { return !!getToken(); }
  me(): Promise<User> { return this.req<User | { user: User }>('GET', '/auth/me').then(r => ('user' in r ? r.user : r)); }
  changePassword(oldPassword: string, newPassword: string): Promise<void> {
    return this.req('POST', '/auth/password', { oldPassword, newPassword });
  }

  /* ------------------------------------------------------------ sessões */
  listSessions(q?: SessionQuery): Promise<SessionMeta[]> {
    const p = new URLSearchParams();
    if (q?.q) p.set('q', q.q);
    if (q?.trackId) p.set('trackId', q.trackId);
    if (q?.carId) p.set('carId', q.carId);
    if (q?.tag) p.set('tag', q.tag);
    const s = p.toString();
    return this.req('GET', `/sessions${s ? '?' + s : ''}`);
  }
  getSession(id: string): Promise<SessionMeta> { return this.req('GET', `/sessions/${encodeURIComponent(id)}`); }

  /** texto do log (o servidor manda gzip com Content-Encoding, o navegador descomprime) */
  async getSessionText(id: string): Promise<string> {
    const res = await this.req<Response>('GET', `/sessions/${encodeURIComponent(id)}/file`, undefined, { raw: true });
    const enc = res.headers.get('content-type') || '';
    if (/gzip/.test(enc) && typeof DecompressionStream !== 'undefined' && res.body) {
      /* arquivo .gz servido como application/gzip (sem Content-Encoding): descomprime aqui */
      return new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
    }
    return res.text();
  }

  /** envio multipart: campo `file` + campo `meta` (JSON) */
  async addSession(file: LogInput, meta: Parameters<Library['addSession']>[1] = {}): Promise<SessionMeta> {
    const fd = new FormData();
    fd.append('meta', JSON.stringify(meta));
    if (typeof File !== 'undefined' && file instanceof File) fd.append('file', file, file.name);
    else {
      const f = file as { name: string; text: string };
      fd.append('file', new Blob([f.text], { type: 'text/plain' }), f.name);
    }
    return this.req('POST', '/sessions', undefined, { form: fd });
  }
  updateSession(id: string, patch: SessionPatch): Promise<SessionMeta> { return this.req('PATCH', `/sessions/${encodeURIComponent(id)}`, patch); }
  deleteSession(id: string): Promise<void> { return this.req('DELETE', `/sessions/${encodeURIComponent(id)}`); }
  /** recalcula o resumo com o carro/pista da sessão */
  recomputeSummary(id: string): Promise<SessionMeta> { return this.req('POST', `/sessions/${encodeURIComponent(id)}/summary`); }

  /* ------------------------------------------------------------ carros e pistas */
  listCars(): Promise<CarProfile[]> { return this.req('GET', '/cars'); }
  saveCar(p: Omit<CarProfile, 'id'> & { id?: string }): Promise<CarProfile> {
    const body = { name: p.name, params: p.params };
    return p.id ? this.req('PUT', `/cars/${encodeURIComponent(p.id)}`, body) : this.req('POST', '/cars', body);
  }
  deleteCar(id: string): Promise<void> { return this.req('DELETE', `/cars/${encodeURIComponent(id)}`); }

  listTracks(): Promise<TrackProfile[]> { return this.req('GET', '/tracks'); }
  saveTrack(p: Omit<TrackProfile, 'id'> & { id?: string }): Promise<TrackProfile> {
    const body = { name: p.name, params: p.params };
    return p.id ? this.req('PUT', `/tracks/${encodeURIComponent(p.id)}`, body) : this.req('POST', '/tracks', body);
  }
  deleteTrack(id: string): Promise<void> { return this.req('DELETE', `/tracks/${encodeURIComponent(id)}`); }

  /* ------------------------------------------------------------ anotações */
  listComments(sessionId: string): Promise<Comment[]> { return this.req('GET', `/sessions/${encodeURIComponent(sessionId)}/comments`); }
  addComment(sessionId: string, c: { t?: number | null; text: string }): Promise<Comment> {
    return this.req('POST', `/sessions/${encodeURIComponent(sessionId)}/comments`, c);
  }
  deleteComment(id: string): Promise<void> { return this.req('DELETE', `/comments/${encodeURIComponent(id)}`); }

  /* ------------------------------------------------------------ equipe (admin) */
  listUsers(): Promise<User[]> { return this.req('GET', '/users'); }
  createUser(b: { name: string; email: string; password: string; role: Role }): Promise<User> { return this.req('POST', '/users', b); }
  updateUser(id: string, patch: Partial<Pick<User, 'name' | 'role' | 'disabled'>> & { password?: string }): Promise<User> {
    return this.req('PATCH', `/users/${encodeURIComponent(id)}`, patch);
  }
  deleteUser(id: string): Promise<void> { return this.req('DELETE', `/users/${encodeURIComponent(id)}`); }
  listInvites(): Promise<Invite[]> { return this.req('GET', '/invites'); }
  createInvite(b: { role: Role; days?: number }): Promise<Invite> { return this.req('POST', '/invites', b); }
  deleteInvite(code: string): Promise<void> { return this.req('DELETE', `/invites/${encodeURIComponent(code)}`); }
}
