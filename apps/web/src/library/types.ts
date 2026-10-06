/* Tipos da biblioteca de sessões (docs/ARQUITETURA.md 4.4 e 5.2/5.3). Os mesmos objetos
 * servem para a biblioteca local (IndexedDB) e para o servidor da equipe. */
import type { CarConfig, SuspConfig, TrackConfig } from '@baja/core';

/* ---------------------------------------------------------------- resumo da sessão
 * Mesmo tipo do core (ARQUITETURA 3.6): o servidor e o navegador usam a mesma conta. */
export type { SessionSummary, SummaryMetric } from '@baja/core';
import type { SessionSummary } from '@baja/core';

export type SessionKind = 'FT' | 'BUSMASTER';

export interface SessionMeta {
  id: string;
  name: string;
  fileName: string;
  kind: SessionKind;
  size: number;                /* bytes do texto do log */
  createdAt: string;           /* ISO */
  uploadedBy?: string;         /* nome de quem enviou (servidor) */
  date?: string;               /* data do teste: AAAA-MM-DD ou AAAA-MM-DDTHH:MM */
  trackId?: string;
  carId?: string;
  driver?: string;
  tags: string[];
  notes?: string;
  summary?: SessionSummary;
  /* só no servidor (ARQUITETURA 5.3) */
  sha256?: string;
  uploadedById?: string;
  summaryVersion?: number;
  summaryError?: string | null;  /* análise falhou (ex.: passou do limite de memória/tempo) */
  summaryOutdated?: boolean;     /* resumo de uma versão antiga das contas */
}

/** Campos que o usuário edita (dados da sessão). */
export type SessionPatch = Partial<Pick<SessionMeta, 'name' | 'date' | 'trackId' | 'carId' | 'driver' | 'tags' | 'notes' | 'summary'>>;

/** Filtros da lista (o servidor aceita q, trackId, carId, tag). */
export interface SessionQuery {
  q?: string;
  trackId?: string;
  carId?: string;
  tag?: string;
}

/** Perfil do carro (ex.: "BJ26 — setup A"): parâmetros do carro + suspensão. */
export interface CarProfileParams extends Partial<CarConfig> {
  susp?: Partial<SuspConfig>;
}
export interface CarProfile {
  id: string;
  name: string;
  params: CarProfileParams;
  createdBy?: string;
  /* só no servidor (ARQUITETURA 5.3): nome de quem criou e quantas sessões usam o perfil */
  createdByName?: string;
  sessions?: number;
  updatedAt?: string;
}

/** Perfil de pista (track_config.h, canais X/Y, formato, linha de largada). */
export interface TrackProfile {
  id: string;
  name: string;
  params: Partial<TrackConfig>;
  createdBy?: string;
  createdByName?: string;
  sessions?: number;
  updatedAt?: string;
}

/** Anotação numa sessão (opcionalmente num instante t do log). */
export interface Comment {
  id: string;
  sessionId: string;
  userId?: string;
  userName?: string;
  t?: number | null;
  text: string;
  createdAt: string;
}

export type Role = 'admin' | 'member' | 'viewer';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  disabled?: boolean;
  createdAt?: string;
}
export interface Invite {
  code: string;
  role: Role;
  createdBy?: string;
  createdByName?: string;
  createdAt: string;
  expiresAt?: string | null;
  usedBy?: string | null;
  usedByName?: string;
  usedAt?: string | null;
  /** situação calculada pelo servidor */
  status?: 'ativo' | 'usado' | 'expirado';
}

/** Usuário recém-criado: sem senha no pedido, o servidor gera uma e a devolve uma única vez. */
export type CreatedUser = User & { tempPassword?: string };

/** Dados de uma sessão nova. allowDuplicate: guarda mesmo que o mesmo log (sha256) já exista. */
export type AddSessionMeta = Partial<Omit<SessionMeta, 'id' | 'createdAt' | 'size' | 'fileName'>> & { allowDuplicate?: boolean };

/** Arquivo a adicionar: um File do navegador ou o texto já lido. */
export type LogInput = File | { name: string; text: string };

export interface Library {
  mode: 'local' | 'remote';
  listSessions(q?: SessionQuery): Promise<SessionMeta[]>;
  getSession(id: string): Promise<SessionMeta>;
  getSessionText(id: string): Promise<string>;
  /** guarda o log; o resumo é calculado por quem chama (local) ou pelo servidor (remoto) */
  addSession(file: LogInput, meta?: AddSessionMeta): Promise<SessionMeta>;
  updateSession(id: string, patch: SessionPatch): Promise<SessionMeta>;
  deleteSession(id: string): Promise<void>;
  listCars(): Promise<CarProfile[]>;
  saveCar(p: Omit<CarProfile, 'id'> & { id?: string }): Promise<CarProfile>;
  deleteCar(id: string): Promise<void>;
  listTracks(): Promise<TrackProfile[]>;
  saveTrack(p: Omit<TrackProfile, 'id'> & { id?: string }): Promise<TrackProfile>;
  deleteTrack(id: string): Promise<void>;
  listComments?(sessionId: string): Promise<Comment[]>;
  addComment?(sessionId: string, c: { t?: number | null; text: string }): Promise<Comment>;
  deleteComment?(id: string): Promise<void>;
}

/** Resposta de GET /api/info. */
export interface ServerInfo {
  name: string;
  version: string;
  needsSetup: boolean;
}
