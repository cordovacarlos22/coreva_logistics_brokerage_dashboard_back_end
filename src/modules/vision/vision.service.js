import { supabaseAdmin } from '../../config/supabaseAdmin.js';
import { anthropicClient } from '../../config/anthropicClient.js';
import { AppError } from '../../middleware/errorHandler.js';

const MODEL = 'claude-haiku-4-5-20251001';
const SUPPORTED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// Deliberately one criterion, per Carlos's call ("let's not over
// complicate it") -- not a general "is this load secure" judgment call.
const PROMPT = `You are reviewing a photo of a load inside a semi trailer, taken by a truck driver during a pre-departure inspection. Your only job: determine whether straps or wrap are VISIBLY CROSSING OVER the load in the photo.

Respond with ONLY a JSON object, no other text: {"compliant": true or false, "reason": "one short sentence explaining what you see"}`;

const REFERENCE_BUCKET = 'compliance-reference-photos';
const REFERENCE_SAMPLE_SIZE = 5;

// Real example photos of a correctly strapped load, uploaded by hand to a
// private bucket (Carlos curates these directly in the Supabase
// dashboard -- no code change needed to add/replace them). Purely
// optional: if the bucket doesn't exist yet or is empty, the check still
// runs on the text prompt alone, same as before this existed.
//
// The whole pool (Carlos uploaded 52) is downloaded once and cached for
// the life of this process -- sending all 52 on every single check would
// make each one slow and expensive for no real accuracy benefit past a
// handful of examples. Instead, a fresh random REFERENCE_SAMPLE_SIZE is
// drawn from the cached pool on every check, so requests see varied
// examples without re-downloading the whole pool each time.
let referencePoolCache = null;

async function fetchReferencePool() {
  if (referencePoolCache) return referencePoolCache;

  const { data: files, error: listError } = await supabaseAdmin.storage.from(REFERENCE_BUCKET).list();
  if (listError || !files?.length) {
    if (listError) console.warn('[vision] reference photos list failed:', listError.message);
    referencePoolCache = [];
    return referencePoolCache;
  }

  const images = [];
  for (const file of files) {
    const { data, error } = await supabaseAdmin.storage.from(REFERENCE_BUCKET).download(file.name);
    if (error) {
      console.warn(`[vision] reference photo download failed (${file.name}):`, error.message);
      continue;
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    const mediaType = SUPPORTED_MEDIA_TYPES.has(data.type) ? data.type : 'image/jpeg';
    images.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') } });
  }

  referencePoolCache = images;
  return images;
}

function sampleReferenceImages(pool, count) {
  if (pool.length <= count) return pool;
  return [...pool].sort(() => Math.random() - 0.5).slice(0, count);
}

// storagePath is a path within the `load-photos` Supabase Storage bucket
// (client already uploaded it there before calling this route).
export async function checkLoadSecuredCompliance(storagePath) {
  if (!supabaseAdmin) throw new AppError('Supabase is not configured', 503);
  if (!anthropicClient) throw new AppError('Vision check is not configured', 503);

  const { data: file, error: downloadError } = await supabaseAdmin.storage
    .from('load-photos')
    .download(storagePath);
  if (downloadError) throw new AppError(`load-photos download: ${downloadError.message}`, 500);

  const imageBuffer = Buffer.from(await file.arrayBuffer());
  const mediaType = SUPPORTED_MEDIA_TYPES.has(file.type) ? file.type : 'image/jpeg';
  const referencePool = await fetchReferencePool();
  const referenceImages = sampleReferenceImages(referencePool, REFERENCE_SAMPLE_SIZE);

  const content = [];
  if (referenceImages.length > 0) {
    content.push({
      type: 'text',
      text: `Here ${referenceImages.length === 1 ? 'is an example' : 'are examples'} of a load that IS properly secured -- straps/wrap visibly crossing over the load:`,
    });
    content.push(...referenceImages);
  }
  content.push({ type: 'text', text: 'Now evaluate this photo:' });
  content.push({
    type: 'image',
    source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') },
  });
  content.push({ type: 'text', text: PROMPT });

  const response = await anthropicClient.messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [{ role: 'user', content }],
  });

  const text = response.content.find((block) => block.type === 'text')?.text ?? '';
  let parsed;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    throw new AppError('Vision check returned an unparseable response', 502);
  }
  if (typeof parsed.compliant !== 'boolean') {
    throw new AppError('Vision check response missing "compliant"', 502);
  }

  return { compliant: parsed.compliant, reason: parsed.reason ?? '' };
}
