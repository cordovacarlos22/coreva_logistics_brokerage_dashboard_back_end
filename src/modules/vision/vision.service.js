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
const MAX_REFERENCE_IMAGES = 3;

// Real example photos of a correctly strapped load, uploaded by hand to a
// private bucket (Carlos curates these directly in the Supabase
// dashboard -- no code change needed to add/replace them). Purely
// optional: if the bucket doesn't exist yet or is empty, the check still
// runs on the text prompt alone, same as before this existed. Cached for
// the life of this process -- these change rarely, and a plain restart
// (Render redeploys/cold-starts regularly anyway) picks up any update.
let referenceImagesCache = null;

async function fetchReferenceImages() {
  if (referenceImagesCache) return referenceImagesCache;

  const { data: files, error: listError } = await supabaseAdmin.storage.from(REFERENCE_BUCKET).list();
  if (listError || !files?.length) {
    if (listError) console.warn('[vision] reference photos list failed:', listError.message);
    referenceImagesCache = [];
    return referenceImagesCache;
  }

  const images = [];
  for (const file of files.slice(0, MAX_REFERENCE_IMAGES)) {
    const { data, error } = await supabaseAdmin.storage.from(REFERENCE_BUCKET).download(file.name);
    if (error) {
      console.warn(`[vision] reference photo download failed (${file.name}):`, error.message);
      continue;
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    const mediaType = SUPPORTED_MEDIA_TYPES.has(data.type) ? data.type : 'image/jpeg';
    images.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') } });
  }

  referenceImagesCache = images;
  return images;
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
  const referenceImages = await fetchReferenceImages();

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
