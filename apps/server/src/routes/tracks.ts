/* Perfis de pista: track_config.h, canais X/Y, formato e linha de largada (TrackConfig). */
import type { FastifyInstance } from 'fastify';
import { profileRoutes, TRACK_PARAMS } from './profiles';

export default async function tracksRoutes(app: FastifyInstance): Promise<void> {
  profileRoutes(app, { table: 'tracks', route: 'tracks', column: 'track_id', params: TRACK_PARAMS, label: 'Pista', genero: 'a' });
}
