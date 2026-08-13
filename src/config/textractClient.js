import { TextractClient } from '@aws-sdk/client-textract';
import { env, isTextractConfigured } from './env.js';

// null if AWS_REGION/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY aren't all set
// -- callers must null-check, same convention as supabaseAdmin.js. Explicit
// credentials rather than the SDK's default provider chain, so this stays
// consistent with the rest of the app's "configured or null" pattern.
export const textractClient = isTextractConfigured
  ? new TextractClient({
      region: env.awsRegion,
      credentials: {
        accessKeyId: env.awsAccessKeyId,
        secretAccessKey: env.awsSecretAccessKey,
      },
    })
  : null;
