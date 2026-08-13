import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { AppError } from '../../middleware/errorHandler.js';
import { supabaseAdmin } from '../../config/supabaseAdmin.js';
import { extractBolFields } from './ocr.service.js';

export const ocrRouter = Router();

const FIELD_TO_COLUMN = {
  trailerNumber: 'bol_trailer_number',
  mfo: 'bol_mfo',
  poNumber: 'bol_po_number',
  weightLbs: 'weight_lbs',
  commodity: 'commodity',
};

ocrRouter.post('/bol', requireAuth, requireRole('driver', 'dispatcher', 'admin'), async (req, res, next) => {
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
    // driver can't write onto another driver's load via a crafted request.
    if (req.user.profile.role === 'driver' && load.driver_id !== req.user.id) {
      throw new AppError('Forbidden', 403);
    }

    const { fields, verificationStatus, raw } = await extractBolFields(storagePath);

    // Only write columns OCR actually found a value for -- a field it
    // missed shouldn't clobber a value dispatch (or an earlier photo)
    // already entered correctly.
    const loadUpdate = { bol_verification_status: verificationStatus };
    for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
      if (fields[field] != null) loadUpdate[column] = fields[field];
    }

    const { error: updateError } = await supabaseAdmin.from('loads').update(loadUpdate).eq('id', loadId);
    if (updateError) throw new AppError(`loads update: ${updateError.message}`, 500);

    const { data: photo, error: photoError } = await supabaseAdmin
      .from('checklist_photos')
      .insert({ checklist_id: checklistId, type: 'bol', storage_path: storagePath, ocr_raw: raw })
      .select('*')
      .single();
    if (photoError) throw new AppError(`checklist_photos insert: ${photoError.message}`, 500);

    res.json({ fields, verificationStatus, photo });
  } catch (err) {
    next(err);
  }
});
