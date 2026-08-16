import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/config/env.js', () => ({
  env: { port: 4000, allowedOrigin: '*' },
  isSupabaseConfigured: false,
  isTextractConfigured: false,
  isAnthropicConfigured: false,
}));

const { createApp } = await import('../src/app.js');

describe('POST /api/vision/load-secured', () => {
  it('rejects a request with no bearer token before touching Supabase or Anthropic', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/vision/load-secured')
      .send({ loadId: 'x', checklistId: 'y', storagePath: 'z' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/bearer token/i);
  });
});

describe('POST /api/vision/load-secured/override', () => {
  it('rejects a request with no bearer token', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/vision/load-secured/override')
      .send({ checklistPhotoId: 'x' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/bearer token/i);
  });
});
