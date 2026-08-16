import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { AppError } from '../../middleware/errorHandler.js';
import { supabaseAdmin } from '../../config/supabaseAdmin.js';
import { extractBolFields, applyBolFields, computeVerificationStatus } from './ocr.service.js';

export const ocrRouter = Router();

// supabaseAdmin bypasses RLS entirely -- re-check ownership here so a
// driver can't write onto another driver's load via a crafted request.
async function assertLoadOwnership(loadId, user) {
  const { data: load, error } = await supabaseAdmin.from('loads').select('id, driver_id').eq('id', loadId).single();
  if (error || !load) throw new AppError('Load not found', 404);
  if (user.profile.role === 'driver' && load.driver_id !== user.id) {
    throw new AppError('Forbidden', 403);
  }
}

ocrRouter.post('/bol', requireAuth, requireRole('driver', 'dispatcher', 'admin'), async (req, res, next) => {
  try {
    const { loadId, checklistId, storagePath } = req.body || {};
    if (!loadId || !checklistId || !storagePath) {
      throw new AppError('loadId, checklistId, and storagePath are required', 400);
    }
    if (!supabaseAdmin) throw new AppError('Supabase is not configured', 503);

    await assertLoadOwnership(loadId, req.user);

    const { fields, verificationStatus, raw } = await extractBolFields(storagePath);
    const { photo } = await applyBolFields({ loadId, checklistId, storagePath, fields, verificationStatus, raw });

    res.json({ fields, verificationStatus, photo });
  } catch (err) {
    next(err);
  }
});

// Runs Textract on a photo before any load exists yet -- the Scan New
// Shipment flow's "photo first" step. No loadId to own-check: nothing has
// been created yet, so there's nothing to write either.
ocrRouter.post('/bol/preview', requireAuth, requireRole('driver', 'dispatcher', 'admin'), async (req, res, next) => {
  try {
    const { storagePath } = req.body || {};
    if (!storagePath) throw new AppError('storagePath is required', 400);

    const { fields, verificationStatus, raw } = await extractBolFields(storagePath);
    res.json({ fields, verificationStatus, raw });
  } catch (err) {
    next(err);
  }
});

// Applies fields already extracted by an earlier POST /bol/preview call to
// a load that's now been created -- deliberately doesn't re-run Textract
// (that already happened at preview time for this same photo).
ocrRouter.post('/bol/attach', requireAuth, requireRole('driver', 'dispatcher', 'admin'), async (req, res, next) => {
  try {
    const { loadId, checklistId, storagePath, fields, raw } = req.body || {};
    if (!loadId || !checklistId || !storagePath || !fields) {
      throw new AppError('loadId, checklistId, storagePath, and fields are required', 400);
    }
    if (!supabaseAdmin) throw new AppError('Supabase is not configured', 503);

    await assertLoadOwnership(loadId, req.user);

    // Recomputed server-side rather than trusting a client-supplied status.
    const verificationStatus = computeVerificationStatus(fields);
    const { photo } = await applyBolFields({ loadId, checklistId, storagePath, fields, verificationStatus, raw });

    res.json({ fields, verificationStatus, photo });
  } catch (err) {
    next(err);
  }
});
