import { supabaseAdmin } from '../../config/supabaseAdmin.js';
import { isSupabaseConfigured } from '../../config/env.js';

export async function getHealthStatus() {
  if (!isSupabaseConfigured) {
    return {
      status: 'degraded',
      supabase: 'not_configured',
      message: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — fill in apps/server/.env.',
    };
  }

  try {
    const { error } = await supabaseAdmin.from('profiles').select('id').limit(1);
    if (error) {
      return { status: 'degraded', supabase: 'unreachable', message: error.message };
    }
    return { status: 'ok', supabase: 'connected' };
  } catch (err) {
    return { status: 'degraded', supabase: 'unreachable', message: err.message };
  }
}
