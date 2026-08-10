import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Force the "not configured" branch deterministically, independent of
// whatever real credentials happen to be in the local .env file.
vi.mock('../src/config/env.js', () => ({
  env: { port: 4000, allowedOrigin: '*' },
  isSupabaseConfigured: false,
}));

const { createApp } = await import('../src/app.js');

describe('GET /api/health', () => {
  it('reports a degraded status without crashing when Supabase is not configured', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: 'degraded',
      supabase: 'not_configured',
    });
  });
});
