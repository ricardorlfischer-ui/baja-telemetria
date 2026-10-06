/* Perfis do carro (ex.: "BJ26 — setup A"): CarConfig + susp. */
import type { FastifyInstance } from 'fastify';
import { CAR_PARAMS, profileRoutes } from './profiles';

export default async function carsRoutes(app: FastifyInstance): Promise<void> {
  profileRoutes(app, { table: 'cars', route: 'cars', column: 'car_id', params: CAR_PARAMS, label: 'Carro', genero: 'o' });
}
