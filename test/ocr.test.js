import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/config/env.js', () => ({
  env: { port: 4000, allowedOrigin: '*' },
  isSupabaseConfigured: false,
  isTextractConfigured: false,
  isAnthropicConfigured: false,
}));

const { createApp } = await import('../src/app.js');

describe('POST /api/ocr/bol', () => {
  it('rejects a request with no bearer token before touching Supabase or Textract', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/ocr/bol')
      .send({ loadId: 'x', checklistId: 'y', storagePath: 'z' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/bearer token/i);
  });
});

describe('POST /api/ocr/bol/preview', () => {
  it('rejects a request with no bearer token before touching Supabase or Textract', async () => {
    const app = createApp();
    const res = await request(app).post('/api/ocr/bol/preview').send({ storagePath: 'z' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/bearer token/i);
  });
});

describe('POST /api/ocr/bol/attach', () => {
  it('rejects a request with no bearer token before touching Supabase', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/ocr/bol/attach')
      .send({ loadId: 'x', checklistId: 'y', storagePath: 'z', fields: {} });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/bearer token/i);
  });
});
