import { Router } from 'express';
import { requireWebhookSecret } from '../../middleware/requireWebhookSecret.js';
import { AppError } from '../../middleware/errorHandler.js';
import { sendPushForLoadMessage } from './notifications.service.js';

export const notificationsRouter = Router();

// Supabase Database Webhook target, configured by hand in the Supabase
// dashboard (Database -> Webhooks) on load_messages INSERT -- fires
// server-side on every insert regardless of which client (web or driver
// app) wrote it, so the push-send logic only lives in one place.
notificationsRouter.post('/load-message-webhook', requireWebhookSecret, async (req, res, next) => {
  try {
    const record = req.body?.record;
    if (!record) throw new AppError('Missing record in webhook payload', 400);

    await sendPushForLoadMessage(record);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
