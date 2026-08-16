import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT) || 4000,
  supabaseUrl: process.env.SUPABASE_URL || null,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
  awsRegion: process.env.AWS_REGION || null,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || null,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || null,
  allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
  // Shared secret the Supabase Database Webhook (load_messages insert ->
  // /api/notifications/load-message-webhook) sends back on every call, so
  // that endpoint can tell it's really Supabase and not an arbitrary
  // caller -- there's no logged-in user/JWT for a webhook to verify via
  // requireAuth.
  webhookSecret: process.env.SUPABASE_WEBHOOK_SECRET || null,
};

export const isSupabaseConfigured = Boolean(
  env.supabaseUrl && env.supabaseServiceRoleKey
);

export const isTextractConfigured = Boolean(
  env.awsRegion && env.awsAccessKeyId && env.awsSecretAccessKey
);
