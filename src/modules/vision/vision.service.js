import sharp from 'sharp';
import { supabaseAdmin } from '../../config/supabaseAdmin.js';
import { anthropicClient } from '../../config/anthropicClient.js';
import { AppError } from '../../middleware/errorHandler.js';

const MODEL = 'claude-haiku-4-5-20251001';
// Hit this directly: Anthropic rejects a multi-image request outright if
// any image's longest edge is too large ("image dimensions exceed max
// allowed size for many-image requests: 2000 pixels") -- a normal phone
// camera photo is 3000-4000px+. 1568px is Anthropic's own documented
// recommendation; resizing to it also cuts upload time/token cost (was
// separately making every check slow) and, just as importantly, keeps the
// in-memory reference photo cache small -- caching 52 full-resolution
// originals is what exhausted Render's free-tier memory.
const MAX_DIMENSION = 1568;

// Deliberately one criterion, per Carlos's call ("let's not over
// complicate it") -- not a general "is this load secure" judgment call.
const PROMPT = `You are reviewing a photo of a load inside a semi trailer, taken by a truck driver during a pre-departure inspection. Your only job: determine whether straps or wrap are VISIBLY CROSSING OVER the load in the photo.

Respond with ONLY a JSON object, no other text: {"compliant": true or false, "reason": "one short sentence explaining what you see"}`;

const REFERENCE_BUCKET = 'compliance-reference-photos';
const REFERENCE_SAMPLE_SIZE = 5;

// Also normalizes everything to JPEG regardless of the source format, so
// there's no need to track/pass through each file's original media type.
async function resizeForVision(buffer) {
  return sharp(buffer)
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

function toImageBlock(buffer) {
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buffer.toString('base64') } };
}

// Real example photos of a correctly strapped load, uploaded by hand to a
// private bucket (Carlos curates these directly in the Supabase
// dashboard -- no code change needed to add/replace them). Purely
// optional: if the bucket doesn't exist yet or is empty, the check still
// runs on the text prompt alone, same as before this existed.
//
// The whole pool (Carlos uploaded 52) is downloaded and resized once, then
// cached (already-shrunk) for the life of this process. A fresh random
// REFERENCE_SAMPLE_SIZE is drawn from the cached pool on every check, so
// requests see varied examples without re-downloading or re-resizing the
// whole pool each time.
//
// Deliberately ONE AT A TIME, not Promise.all -- this is what actually
// OOM-killed the Render instance (512MB limit). Resizing needs to decode
// each full-resolution original into memory before it shrinks down;
// downloading+decoding 52 phone photos concurrently meant dozens of
// full-size raw buffers existing at once, well before any of them got
// small. Sequential keeps peak memory bounded to roughly one photo's
// decode overhead at a time, at the cost of this one-time (cached
// afterward) pass taking longer.
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
    try {
      const buffer = Buffer.from(await data.arrayBuffer());
      images.push(toImageBlock(await resizeForVision(buffer)));
    } catch (err) {
      console.warn(`[vision] reference photo resize failed (${file.name}):`, err.message);
    }
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

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const resizedBuffer = await resizeForVision(rawBuffer);

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
  content.push(toImageBlock(resizedBuffer));
  content.push({ type: 'text', text: PROMPT });

  let response;
  try {
    response = await anthropicClient.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    throw new AppError(`Vision check request failed: ${err.message}`, 502);
  }

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
