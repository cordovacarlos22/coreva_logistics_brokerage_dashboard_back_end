import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/config/env.js', () => ({
  env: { port: 4000, allowedOrigin: '*', webhookSecret: 'test-secret' },
  isSupabaseConfigured: false,
  isTextractConfigured: false,
}));

const { createApp } = await import('../src/app.js');

describe('POST /api/notifications/load-message-webhook', () => {
  it('rejects a request with no webhook secret header', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/notifications/load-message-webhook')
      .send({ record: { id: 'x' } });

    expect(res.status).toBe(401);
  });

  it('rejects a request with the wrong webhook secret', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/notifications/load-message-webhook')
      .set('X-Webhook-Secret', 'wrong')
      .send({ record: { id: 'x' } });

    expect(res.status).toBe(401);
  });
});
