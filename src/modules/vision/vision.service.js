import { supabaseAdmin } from '../../config/supabaseAdmin.js';
import { anthropicClient } from '../../config/anthropicClient.js';
import { AppError } from '../../middleware/errorHandler.js';

const MODEL = 'claude-haiku-4-5-20251001';
const SUPPORTED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// Deliberately one criterion, per Carlos's call ("let's not over
// complicate it") -- not a general "is this load secure" judgment call.
const PROMPT = `You are reviewing a photo of a load inside a semi trailer, taken by a truck driver during a pre-departure inspection. Your only job: determine whether straps or wrap are VISIBLY CROSSING OVER the load in the photo.

Respond with ONLY a JSON object, no other text: {"compliant": true or false, "reason": "one short sentence explaining what you see"}`;

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

  const response = await anthropicClient.messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
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
