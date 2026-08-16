import { AnalyzeDocumentCommand } from '@aws-sdk/client-textract';
import { supabaseAdmin } from '../../config/supabaseAdmin.js';
import { textractClient } from '../../config/textractClient.js';
import { AppError } from '../../middleware/errorHandler.js';

// Fields required for bol_verification_status to auto-flip to 'ai_verified'.
// Deliberately excludes seal # -- the seal isn't placed until the driver
// app's "Seal the Trailer" step, so it's never legible in a BOL photo taken
// this early in the pickup flow. Deliberately excludes commodity too --
// it's the least reliably labeled field on a real BOL, so requiring it
// would make 'pending' (needing dispatch review) the common case instead
// of the exception.
const REQUIRED_FIELDS = ['trailerNumber', 'mfo', 'poNumber'];

// Matched against Textract's extracted form *key* text (case-insensitive,
// substring match) -- BOLs aren't standardized, so these are label variants
// (Trailer #, TRAILER NO, MFO#, M.F.O., P.O. #, PO Number, Weight, WT)
// rather than exact strings. Real-world documents will need this tuned over
// time; that's expected, not a sign something's broken.
const FIELD_KEY_PATTERNS = {
  trailerNumber: /trailer/,
  mfo: /m\.?\s?f\.?\s?o\.?/,
  poNumber: /p\.?\s?o\.?\s*(#|no|number)?/,
  weightLbs: /weight|^wt/,
  commodity: /commodity/,
  // Only used by the Scan New Shipment "photo first" flow to pre-fill
  // origin/destination before a load exists -- the regular Pickup BOL step
  // (POST /bol) doesn't map these to a `loads` column since that load
  // already has its addresses by the time the BOL is photographed there.
  shipFrom: /ship\s*from|shipper/,
  shipTo: /ship\s*to|consignee/,
};

// Textract's Block model: every detected word/line/form-field is a Block
// linked to others via `Relationships`. A KEY_VALUE_SET block with
// EntityTypes including 'KEY' has a `Relationships` entry of Type 'VALUE'
// pointing at its paired value block, and both key/value blocks have Type
// 'CHILD' relationships down to the WORD blocks that make up their text.
// See https://docs.aws.amazon.com/textract/latest/dg/how-it-works-kvp.html
function buildKeyValueMap(blocks) {
  const blockMap = new Map(blocks.map((block) => [block.Id, block]));

  function textFor(block) {
    if (!block?.Relationships) return '';
    const childIds = block.Relationships.filter((r) => r.Type === 'CHILD').flatMap(
      (r) => r.Ids ?? []
    );
    return childIds
      .map((id) => blockMap.get(id))
      .filter((child) => child?.BlockType === 'WORD')
      .map((child) => child.Text)
      .join(' ');
  }

  const keyBlocks = blocks.filter(
    (block) => block.BlockType === 'KEY_VALUE_SET' && block.EntityTypes?.includes('KEY')
  );

  const map = {};
  for (const keyBlock of keyBlocks) {
    const valueId = keyBlock.Relationships?.find((r) => r.Type === 'VALUE')?.Ids?.[0];
    const valueBlock = valueId ? blockMap.get(valueId) : null;
    const key = textFor(keyBlock).trim().toLowerCase();
    const value = textFor(valueBlock).trim();
    if (key) map[key] = value;
  }
  return map;
}

function parseBolFields(keyValueMap) {
  const fields = {};
  for (const [field, pattern] of Object.entries(FIELD_KEY_PATTERNS)) {
    const matchedKey = Object.keys(keyValueMap).find((key) => pattern.test(key));
    const value = matchedKey ? keyValueMap[matchedKey] : null;
    if (!value) continue;
    fields[field] = field === 'weightLbs' ? Number(value.replace(/[^\d.]/g, '')) : value;
  }
  return fields;
}

// storagePath is a path within the `bol-photos` Supabase Storage bucket
// (client already uploaded it there before calling this route).
export async function extractBolFields(storagePath) {
  if (!supabaseAdmin) throw new AppError('Supabase is not configured', 503);
  if (!textractClient) throw new AppError('OCR is not configured', 503);

  const { data: file, error: downloadError } = await supabaseAdmin.storage
    .from('bol-photos')
    .download(storagePath);
  if (downloadError) throw new AppError(`bol-photos download: ${downloadError.message}`, 500);

  const imageBuffer = Buffer.from(await file.arrayBuffer());
  const response = await textractClient.send(
    new AnalyzeDocumentCommand({
      Document: { Bytes: imageBuffer },
      FeatureTypes: ['FORMS'],
    })
  );

  const blocks = response.Blocks ?? [];
  const keyValueMap = buildKeyValueMap(blocks);
  const fields = parseBolFields(keyValueMap);
  const rawText = blocks
    .filter((block) => block.BlockType === 'LINE')
    .map((block) => block.Text)
    .join('\n');

  const verificationStatus = computeVerificationStatus(fields);

  return { fields, verificationStatus, raw: { text: rawText, formFields: keyValueMap } };
}

export function computeVerificationStatus(fields) {
  return REQUIRED_FIELDS.every((key) => fields[key] != null) ? 'ai_verified' : 'pending';
}

const FIELD_TO_COLUMN = {
  trailerNumber: 'bol_trailer_number',
  mfo: 'bol_mfo',
  poNumber: 'bol_po_number',
  weightLbs: 'weight_lbs',
  commodity: 'commodity',
};

// Shared by POST /bol (extracts then applies in one call) and POST
// /bol/attach (applies fields already extracted by an earlier POST
// /bol/preview call, so a "photo first" flow never runs Textract twice for
// what's functionally one BOL photo).
export async function applyBolFields({ loadId, checklistId, storagePath, fields, verificationStatus, raw }) {
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

  return { photo };
}
