import { Router } from 'express';
import { getHealthStatus } from './health.service.js';

export const healthRouter = Router();

healthRouter.get('/', async (req, res) => {
  const health = await getHealthStatus();
  const httpStatus = health.status === 'ok' ? 200 : 503;
  res.status(httpStatus).json(health);
});
