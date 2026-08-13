import { ImageAnnotatorClient } from '@google-cloud/vision';
import { env, isVisionConfigured } from './env.js';

// null if GOOGLE_CLOUD_CREDENTIALS_JSON isn't set -- callers must null-check,
// same convention as supabaseAdmin.js.
export const visionClient = isVisionConfigured
  ? new ImageAnnotatorClient({ credentials: JSON.parse(env.googleCloudCredentialsJson) })
  : null;
