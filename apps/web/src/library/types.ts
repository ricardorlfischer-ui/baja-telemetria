/* Tipos da biblioteca de sessões (docs/ARQUITETURA.md 4.4 e 5.2/5.3). Os mesmos objetos
 * servem para a biblioteca local (IndexedDB) e para o servidor da equipe. */
import type { CarConfig, SensorId, SuspConfig, TrackConfig } from '@baja/core';

/* ---------------------------------------------------------------- resumo da sessão
 * TODO: trocar por `import type { SessionSummary } from '@baja/core'` quando summary.ts existir
 * (ARQUITETURA 3.6). Este tipo local é compatível com o contrato. */
export interface SummaryMetric {
  key: string;                 /* estável: 'susp.travel.FL', 'cvt.tmax'... */
  group: string;
  label: string;
  value: number | null;
  unit: string;
  text?: string;
  explain?: string;
  sensors?: SensorId[];
}
export interface SessionSummary {
  version: number;             /* SUMMARY_VERSION do core */
  metrics: SummaryMetric[];
}

export type SessionKind = 'FT' | 'BUSMASTER';

export interface SessionMeta {
  id: string;
  name: string;
  fileName: string;
  kind: SessionKind;
  size: number;                /* bytes do texto do log */
  createdAt: string;           /* ISO */
  uploadedBy?: string;         /* nome de quem enviou (servidor) */
  date?: string;               /* data do teste (AAAA-MM-DD) */
  trackId?: string;
  carId?: string;
  driver?: string;
  tags: string[];
  notes?: string;
  summary?: SessionSummary;
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
  updatedAt?: string;
}

/** Perfil de pista (track_config.h, canais X/Y, formato, linha de largada). */
export interface TrackProfile {
  id: string;
  name: string;
  params: Partial<TrackConfig>;
  createdBy?: string;
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
  createdAt: string;
  expiresAt?: string | null;
  usedBy?: string | null;
}

/** Arquivo a adicionar: um File do navegador ou o texto já lido. */
export type LogInput = File | { name: string; text: string };

export interface Library {
  mode: 'local' | 'remote';
  listSessions(q?: SessionQuery): Promise<SessionMeta[]>;
  getSession(id: string): Promise<SessionMeta>;
  getSessionText(id: string): Promise<string>;
  /** guarda o log; o resumo é calculado por quem chama (local) ou pelo servidor (remoto) */
  addSession(file: LogInput, meta?: Partial<Omit<SessionMeta, 'id' | 'createdAt' | 'size' | 'fileName'>>): Promise<SessionMeta>;
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
