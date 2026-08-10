import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from './env.js';

// Service-role client for backend use only — bypasses RLS, never expose
// this key or client to the browser.
export const supabaseAdmin = isSupabaseConfigured
  ? createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
