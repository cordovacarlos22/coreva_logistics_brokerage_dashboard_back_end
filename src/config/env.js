import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT) || 4000,
  supabaseUrl: process.env.SUPABASE_URL || null,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
  awsRegion: process.env.AWS_REGION || null,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || null,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || null,
  allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
};

export const isSupabaseConfigured = Boolean(
  env.supabaseUrl && env.supabaseServiceRoleKey
);

export const isTextractConfigured = Boolean(
  env.awsRegion && env.awsAccessKeyId && env.awsSecretAccessKey
);
