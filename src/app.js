import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env.js';
import { healthRouter } from './modules/health/health.routes.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.allowedOrigin }));
  app.use(express.json());
  app.use(morgan('dev'));

  app.use('/api/health', healthRouter);

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(errorHandler);

  return app;
}
