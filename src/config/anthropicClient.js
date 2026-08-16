import Anthropic from '@anthropic-ai/sdk';
import { env, isAnthropicConfigured } from './env.js';

// null if ANTHROPIC_API_KEY isn't set -- callers must null-check, same
// convention as textractClient.js/supabaseAdmin.js.
export const anthropicClient = isAnthropicConfigured ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
