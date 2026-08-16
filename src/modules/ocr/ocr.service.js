import { AnalyzeDocumentCommand } from '@aws-sdk/client-textract';
import { supabaseAdmin } from '../../config/supabaseAdmin.js';
import { textractClient } from '../../config/textractClient.js';
import { AppError } from '../../middleware/errorHandler.js';

// Fields required for bol_verification_status to auto-flip to 'ai_verified'.
// Deliberately excludes seal # -- confirmed against a real IP BOL that it
// IS sometimes pre-printed (in Shipping Comments, as IP's *expected* seal),
// but not always ("if any"), so requiring it would make 'pending' the
// common case. Deliberately excludes commodity too -- it's the least
// reliably labeled field on a real BOL, same reasoning.
const REQUIRED_FIELDS = ['trailerNumber', 'mfo', 'poNumber'];

// Matched against Textract's extracted form *key* text (case-insensitive,
// substring match) -- BOLs aren't standardized, so these are label variants
// (Trailer #, TRAILER NO, MFO#, M.F.O., P.O. #, PO Number, Weight, WT)
// rather than exact strings. Real-world documents will need this tuned over
// time; that's expected, not a sign something's broken.
const FIELD_KEY_PATTERNS = {
  // International Paper's actual BOL labels this "VEHICLE ID NO.", not
  // "Trailer #" -- confirmed against a real IP BOL photo. Matches both, in
  // case another shipper's paperwork does use "Trailer".
  trailerNumber: /trailer|vehicle\s*id/,
  mfo: /m\.?\s?f\.?\s?o\.?/,
  poNumber: /p\.?\s?o\.?\s*(#|no|number)?/,
  // A real IP BOL has THREE separate "weight" labels in its bottom
  // summary (Subtotal/Pallet/Total Weight) -- confirmed live that a bare
  // /weight/ pattern matches whichever one Textract happened to list
  // first, not necessarily the right one (a scan came back with the
  // pallet weight instead of the shipment's actual weight). Subtotal
  // Weight is the one that means "weight of what's actually shipped".
  weightLbs: /subtotal\s*weight/,
  commodity: /commodity/,
  // Preview-only -- pre-fills destination before a load exists (Scan New
  // Shipment). No shipFrom counterpart: on a real IP BOL the pickup
  // location is always IP's own plant printed in the static letterhead,
  // not a distinct per-shipment field, so origin comes from the driver's
  // GPS location instead (see scan-new-shipment.js).
  shipTo: /ship\s*to|consignee/,
  // Also preview-only -- the driver-facing Coreva "load number" pre-fills
  // from IP's own "Shipment Plan ID" (e.g. "15095 / 5"), confirmed against
  // a real IP BOL, since that's the one field on the paperwork that
  // actually identifies the shipment (Plant Code / Customer's No. are
  // IP-internal, not useful here).
  shipmentPlanId: /shipment\s*plan\s*id/,
  // Raw capture only -- see parseBolFields below, which pulls sealNumber
  // and appointmentAt back out of this and deletes it. Unlike the other
  // fields, IP doesn't give this its own labeled box: a dock appointment
  // date/time and (once assigned) an expected seal number are packed into
  // one free-text "Shipping Comments" block.
  shippingComments: /shipping\s*comments/,
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

function parseBolFields(keyValueMap, rawText) {
  const fields = {};
  for (const [field, pattern] of Object.entries(FIELD_KEY_PATTERNS)) {
    const matchedKey = Object.keys(keyValueMap).find((key) => pattern.test(key));
    const value = matchedKey ? keyValueMap[matchedKey] : null;
    if (!value) continue;
    fields[field] = field === 'weightLbs' ? Number(value.replace(/[^\d.]/g, '')) : value;
  }

  // FORMS' region-based value for this key came back truncated on a live
  // scan ("15272 /", missing the trailing "8") -- label and ID sit on the
  // same physical line, so Textract's plain LINE read (rawText) tends to
  // be more complete than the region it decided was "the value". Prefer
  // it when found.
  if (rawText) {
    const planMatch = rawText.match(/shipment\s*plan\s*id\.?\s*(\d[\d\s/]*\d)/i);
    if (planMatch) fields.shipmentPlanId = planMatch[1].replace(/\s+/g, ' ').trim();
  }

  // The "SHIP TO" box on a real IP BOL also contains a standing legal
  // disclaimer ("* To be filled in only when Shipper desires and
  // governing tariffs provide for delivery there at.") in the same
  // region Textract reads as this field's value -- strip it so only the
  // customer name/address remains. Addresses don't otherwise contain
  // parenthetical asides, so stripping any parenthetical is a safe,
  // OCR-noise-tolerant way to do this (Textract's own read of the
  // disclaimer's exact wording can vary/misread slightly).
  if (fields.shipTo) {
    fields.shipTo = fields.shipTo.replace(/\([^)]*\)?/g, ' ').replace(/\s+/g, ' ').trim();

    // The value also leads with the customer's company name before the
    // actual street address -- confirmed against a real scan (Carlos:
    // "pick up the customer name before the actual delivery address that
    // started with a number"). Keep from the first digit onward, since a
    // street address reliably starts with a number and a company name
    // essentially never does.
    const addressMatch = fields.shipTo.match(/\d.*/s);
    if (addressMatch) fields.shipTo = addressMatch[0].trim();
  }

  // Shipping Comments isn't a clean key: value pair like the rest -- sub-
  // parse the two pieces Carlos actually wants out of it (dock appointment,
  // expected seal #) and drop the raw blob rather than surfacing it as one
  // opaque field.
  if (fields.shippingComments) {
    const sealMatch = fields.shippingComments.match(/seal\s*#?\s*(\d{3,})/i);
    if (sealMatch) fields.sealNumber = sealMatch[1];

    const appointmentMatch = fields.shippingComments.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2})/);
    if (appointmentMatch) fields.appointmentAt = `${appointmentMatch[1]} ${appointmentMatch[2]}`;

    delete fields.shippingComments;
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
  // Temporary diagnostic -- regex tuning against photos of real BOLs has
  // repeatedly not held up on the next live scan (wrong fields matched,
  // garbled values). Rather than guess again, log Textract's own raw
  // key/value read so a failing scan can be diagnosed from what it
  // actually saw, not from a guess about what it probably saw.
  console.warn(`[ocr] ${storagePath} keyValueMap:`, JSON.stringify(keyValueMap, null, 2));
  const rawText = blocks
    .filter((block) => block.BlockType === 'LINE')
    .map((block) => block.Text)
    .join('\n');
  const fields = parseBolFields(keyValueMap, rawText);

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
  // Reference only (Carlos's call) -- this is IP's *expected* seal, shown
  // to the driver alongside the seal number they actually type in at the
  // Seal the Trailer step, never auto-filled into it. `bol_seal_number`
  // already existed in the schema and was already displayed on Load
  // Details -- nothing had ever written to it until now.
  sealNumber: 'bol_seal_number',
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
