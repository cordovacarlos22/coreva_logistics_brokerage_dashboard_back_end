import { supabaseAdmin } from '../../config/supabaseAdmin.js';
import { visionClient } from '../../config/visionClient.js';
import { AppError } from '../../middleware/errorHandler.js';

// Fields required for bol_verification_status to auto-flip to 'ai_verified'.
// Deliberately excludes seal # -- the seal isn't placed until the driver
// app's "Seal the Trailer" step, so it's never legible in a BOL photo taken
// this early in the pickup flow. Deliberately excludes commodity too --
// it's the least reliably labeled field on a real BOL, so requiring it would
// make 'pending' (needing dispatch review) the common case instead of the
// exception.
const REQUIRED_FIELDS = ['trailerNumber', 'mfo', 'poNumber'];

// BOLs aren't standardized -- these patterns match common label variants
// (Trailer #, TRAILER NO, MFO#, M.F.O., P.O. #, PO Number, Weight, WT) with
// the value on the same line. Real-world documents will need this tuned
// over time; that's expected, not a sign something's broken.
const FIELD_PATTERNS = {
  trailerNumber: /trailer\s*(?:no\.?|#|number)?\s*:?\s*([A-Z0-9-]{3,})/i,
  mfo: /m\.?f\.?o\.?\s*#?\s*:?\s*([A-Z0-9-]{3,})/i,
  poNumber: /p\.?\s?o\.?\s*(?:#|number)?\s*:?\s*([A-Z0-9-]{3,})/i,
  weightLbs: /weight\s*:?\s*([\d,]{3,})\s*(?:lbs?)?/i,
  commodity: /commodity\s*:?\s*([A-Za-z][A-Za-z ]{2,40})/i,
};

function parseBolText(rawText) {
  const fields = {};
  for (const [key, pattern] of Object.entries(FIELD_PATTERNS)) {
    const match = rawText.match(pattern);
    if (!match) continue;
    const value = match[1].trim();
    fields[key] = key === 'weightLbs' ? Number(value.replace(/,/g, '')) : value;
  }
  return fields;
}

// storagePath is a path within the `bol-photos` Supabase Storage bucket
// (client already uploaded it there before calling this route).
export async function extractBolFields(storagePath) {
  if (!supabaseAdmin) throw new AppError('Supabase is not configured', 503);
  if (!visionClient) throw new AppError('OCR is not configured', 503);

  const { data: file, error: downloadError } = await supabaseAdmin.storage
    .from('bol-photos')
    .download(storagePath);
  if (downloadError) throw new AppError(`bol-photos download: ${downloadError.message}`, 500);

  const imageBuffer = Buffer.from(await file.arrayBuffer());
  const [result] = await visionClient.documentTextDetection({ image: { content: imageBuffer } });
  const rawText = result.fullTextAnnotation?.text || '';

  const fields = parseBolText(rawText);
  const verificationStatus = REQUIRED_FIELDS.every((key) => fields[key] != null)
    ? 'ai_verified'
    : 'pending';

  return { fields, verificationStatus, raw: { text: rawText } };
}
