import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT) || 4000,
  supabaseUrl: process.env.SUPABASE_URL || null,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
  googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || null,
  allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
};

export const isSupabaseConfigured = Boolean(
  env.supabaseUrl && env.supabaseServiceRoleKey
);
