import { supabaseAdmin } from '../config/supabaseAdmin.js';
import { AppError } from './errorHandler.js';

// Verifies the Supabase-issued JWT sent by the client and attaches the
// caller's auth user + profile (role, customer_company, ...) to req.user.
export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) throw new AppError('Missing bearer token', 401);
    if (!supabaseAdmin) throw new AppError('Supabase is not configured', 503);

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) throw new AppError('Invalid or expired token', 401);

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, role, full_name, customer_company')
      .eq('id', userData.user.id)
      .single();
    if (profileError || !profile) throw new AppError('No profile found for this user', 403);

    req.user = { ...userData.user, profile };
    next();
  } catch (err) {
    next(err);
  }
}
