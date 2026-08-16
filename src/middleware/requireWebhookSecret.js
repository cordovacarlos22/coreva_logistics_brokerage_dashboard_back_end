import { env } from '../config/env.js';
import { AppError } from './errorHandler.js';

// Supabase Database Webhooks aren't a logged-in user -- there's no JWT for
// requireAuth to verify. Checks a shared secret header instead, set to
// match on both sides (this env var, and a custom header configured on the
// webhook itself in the Supabase dashboard).
export function requireWebhookSecret(req, res, next) {
  const provided = req.headers['x-webhook-secret'];
  if (!env.webhookSecret || provided !== env.webhookSecret) {
    return next(new AppError('Unauthorized', 401));
  }
  next();
}
