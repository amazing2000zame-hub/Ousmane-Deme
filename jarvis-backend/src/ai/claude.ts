/**
 * Claude API client singleton.
 *
 * Creates a single Anthropic client instance that handles connection pooling
 * internally. The SDK reads ANTHROPIC_API_KEY from the environment automatically.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

export const claudeClient = new Anthropic();

export const CLAUDE_MODEL = config.claudeModel;
