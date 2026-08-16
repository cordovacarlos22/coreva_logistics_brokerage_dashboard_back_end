import { supabaseAdmin } from '../../config/supabaseAdmin.js';
import { AppError } from '../../middleware/errorHandler.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Fires for every load_messages insert (see notifications.routes.js's
// webhook handler) -- only the 'driver' channel is a driver's own thread
// (see schema.sql's load_messages comment), and only when the driver isn't
// the one who just sent it (no self-notify).
export async function sendPushForLoadMessage(record) {
  if (record.channel !== 'driver') return;
  if (!supabaseAdmin) throw new AppError('Supabase is not configured', 503);

  const { data: load, error: loadError } = await supabaseAdmin
    .from('loads')
    .select('driver_id, load_number')
    .eq('id', record.load_id)
    .single();
  if (loadError || !load?.driver_id || record.sender_id === load.driver_id) return;

  const { data: driverProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('expo_push_token')
    .eq('id', load.driver_id)
    .single();
  if (profileError || !driverProfile?.expo_push_token) return;

  await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: driverProfile.expo_push_token,
      title: `New message — Load #${load.load_number}`,
      body: record.body,
      data: { loadId: record.load_id },
    }),
  });
}

// Fires for every driver_messages insert -- simpler than the load-message
// version since driver_id lives directly on the row, no loads lookup
// needed. data.dispatchMessage (not data.loadId) is what lets the driver
// app's notification-tap handler tell the two apart.
export async function sendPushForDriverMessage(record) {
  if (!supabaseAdmin) throw new AppError('Supabase is not configured', 503);
  if (record.sender_id === record.driver_id) return;

  const { data: driverProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('expo_push_token')
    .eq('id', record.driver_id)
    .single();
  if (profileError || !driverProfile?.expo_push_token) return;

  await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: driverProfile.expo_push_token,
      title: 'New message from Dispatch',
      body: record.body,
      data: { dispatchMessage: true },
    }),
  });
}
