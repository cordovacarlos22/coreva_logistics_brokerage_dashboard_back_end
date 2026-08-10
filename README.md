# Coreva Logistics Brokerage — Backend API

Express modular monolith API for the Coreva Logistics Brokerage dashboard. Split out from the [main dashboard repo](https://github.com/cordovacarlos22/coreva_logistics_brokerage_dashboard) so it can be deployed independently (Render). See that repo's `CLAUDE.md` for full product context.

Most of the app's data access goes straight from the browser to Supabase via Row-Level Security — this API is intentionally minimal, used for things that shouldn't run in the browser (e.g. eventually, BOL photo OCR via Google Cloud Vision).

## Getting started

```bash
npm install
cp .env.example .env   # fill in Supabase + Google Vision creds
npm run dev
```

Without real Supabase credentials, the server still boots — `GET /api/health` reports a `degraded` status instead of crashing.

## Scripts

- `npm run dev` — dev server with file watching
- `npm start` — production start
- `npm test` — vitest
- `npm run lint` — eslint

## Deploying

`render.yaml` is a Render Blueprint — connect this repo via Render's "New +" → "Blueprint" flow and it pre-fills build/start commands and the health check path. You'll be prompted for `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` during setup (use the **secret** key, not the publishable/anon one — this client bypasses RLS).
