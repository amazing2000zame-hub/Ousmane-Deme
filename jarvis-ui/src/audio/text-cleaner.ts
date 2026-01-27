/**
 * Clean LLM text for speech synthesis.
 *
 * Strips markdown formatting, code blocks, special characters, and
 * other artifacts that sound unnatural when read aloud by TTS.
 */
export function cleanTextForSpeech(text: string): string {
  let s = text;

  // Remove code blocks (```lang\n...\n```)
  s = s.replace(/```[\s\S]*?```/g, ' ');

  // Remove inline code backticks but keep the word inside
  s = s.replace(/`([^`]*)`/g, '$1');

  // Remove markdown images ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Remove markdown links [text](url) → keep text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Remove header markers (# ## ### etc.)
  s = s.replace(/^#{1,6}\s+/gm, '');

  // Remove blockquote markers
  s = s.replace(/^>\s*/gm, '');

  // Remove horizontal rules (--- *** ___)
  s = s.replace(/^[\s]*[-*_]{3,}\s*$/gm, ' ');

  // Remove bullet markers (- * + at start of line)
  s = s.replace(/^[\s]*[-*+]\s+/gm, '');

  // Remove numbered list markers (1. 2. etc.)
  s = s.replace(/^[\s]*\d+\.\s+/gm, '');

  // Remove bold/italic markers (*** ** * ___ __ _)
  s = s.replace(/\*{1,3}([^*]*?)\*{1,3}/g, '$1');
  s = s.replace(/_{1,3}([^_]*?)_{1,3}/g, '$1');

  // Remove strikethrough ~~text~~
  s = s.replace(/~~(.*?)~~/g, '$1');

  // Remove remaining asterisks (stray formatting)
  s = s.replace(/\*/g, '');

  // Remove parentheses and their brackets
  // Keep content inside: (something) → something
  s = s.replace(/[()[\]{}]/g, ' ');

  // Remove forward slashes (paths, URLs left over)
  s = s.replace(/\//g, ' ');

  // Remove semicolons
  s = s.replace(/;/g, ' ');

  // Remove colons that aren't part of time (10:30) or natural speech
  // Remove colon at start of line or after single words (like "Note:")
  // Keep colons between digits (timestamps)
  s = s.replace(/(?<!\d):(?!\d)/g, ' ');

  // Remove pipe characters (table formatting)
  s = s.replace(/\|/g, ' ');

  // Remove angle brackets (HTML tags, etc.)
  s = s.replace(/<[^>]*>/g, ' ');

  // Remove backslashes
  s = s.replace(/\\/g, ' ');

  // Remove hash/pound signs not at start of line
  s = s.replace(/#/g, '');

  // Remove equals signs
  s = s.replace(/=/g, ' ');

  // Remove consecutive dashes (but keep single hyphens in words)
  s = s.replace(/-{2,}/g, ' ');

  // Collapse multiple spaces and newlines into single space
  s = s.replace(/\s+/g, ' ');

  return s.trim();
}
