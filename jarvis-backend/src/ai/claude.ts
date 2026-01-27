/**
 * Claude API client singleton.
 *
 * Creates a single Anthropic client instance that handles connection pooling
 * internally. The SDK reads ANTHROPIC_API_KEY from the environment automatically.
 *
 * When no API key is configured, Claude is unavailable and the system falls
 * back to the local LLM (Qwen via llama-server).
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

export const claudeAvailable = Boolean(process.env.ANTHROPIC_API_KEY);

export const claudeClient = claudeAvailable ? new Anthropic() : (null as unknown as Anthropic);

export const CLAUDE_MODEL = config.claudeModel;
