import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { AppError } from '../../middleware/errorHandler.js';
import { supabaseAdmin } from '../../config/supabaseAdmin.js';
import { checkLoadSecuredCompliance } from './vision.service.js';

export const visionRouter = Router();

// Mirrors /api/ocr/bol's shape exactly: the backend does the AI work and
// inserts the checklist_photos row itself, rather than the client
// inserting it directly (checklist_photos has no UPDATE policy, so the
// verdict has to land at INSERT time). A "fail" is a normal 200 response,
// not an HTTP error -- see lib/uploadQueue.js in the driver app for why
// that distinction matters (only network-looking failures get queued for
// retry).
visionRouter.post('/load-secured', requireAuth, requireRole('driver', 'dispatcher', 'admin'), async (req, res, next) => {
  try {
    const { loadId, checklistId, storagePath } = req.body || {};
    if (!loadId || !checklistId || !storagePath) {
      throw new AppError('loadId, checklistId, and storagePath are required', 400);
    }
    if (!supabaseAdmin) throw new AppError('Supabase is not configured', 503);

    const { data: load, error: loadError } = await supabaseAdmin
      .from('loads')
      .select('id, driver_id')
      .eq('id', loadId)
      .single();
    if (loadError || !load) throw new AppError('Load not found', 404);

    // supabaseAdmin bypasses RLS entirely -- re-check ownership here so a
    // driver can't run (and pay for) a vision check against another
    // driver's load via a crafted request.
    if (req.user.profile.role === 'driver' && load.driver_id !== req.user.id) {
      throw new AppError('Forbidden', 403);
    }

    const { compliant, reason } = await checkLoadSecuredCompliance(storagePath);

    const { data: photo, error: photoError } = await supabaseAdmin
      .from('checklist_photos')
      .insert({
        checklist_id: checklistId,
        type: 'load_secured',
        storage_path: storagePath,
        compliance_status: compliant ? 'pass' : 'fail',
        compliance_reason: reason,
      })
      .select('*')
      .single();
    if (photoError) throw new AppError(`checklist_photos insert: ${photoError.message}`, 500);

    res.json({ compliant, reason, photo });
  } catch (err) {
    next(err);
  }
});

// Dispatch-only -- lets staff clear a hard-gated load whose photo the AI
// got wrong, without needing a phone call to sort it out.
visionRouter.post('/load-secured/override', requireAuth, requireRole('dispatcher', 'admin'), async (req, res, next) => {
  try {
    const { checklistPhotoId } = req.body || {};
    if (!checklistPhotoId) throw new AppError('checklistPhotoId is required', 400);
    if (!supabaseAdmin) throw new AppError('Supabase is not configured', 503);

    const { data: photo, error } = await supabaseAdmin
      .from('checklist_photos')
      .update({
        compliance_status: 'overridden',
        overridden_at: new Date().toISOString(),
        overridden_by: req.user.id,
      })
      .eq('id', checklistPhotoId)
      .select('*')
      .single();
    if (error) throw new AppError(`checklist_photos update: ${error.message}`, 500);

    res.json({ photo });
  } catch (err) {
    next(err);
  }
});
