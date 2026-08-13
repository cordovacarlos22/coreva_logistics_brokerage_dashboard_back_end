import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT) || 4000,
  supabaseUrl: process.env.SUPABASE_URL || null,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
  // Raw service-account JSON as a string, not a file path -- Render's web
  // services have no persistent disk, so the usual
  // GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json convention has nowhere
  // to point. Paste the whole JSON key file's contents into this var.
  googleCloudCredentialsJson: process.env.GOOGLE_CLOUD_CREDENTIALS_JSON || null,
  allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
};

export const isSupabaseConfigured = Boolean(
  env.supabaseUrl && env.supabaseServiceRoleKey
);

export const isVisionConfigured = Boolean(env.googleCloudCredentialsJson);
