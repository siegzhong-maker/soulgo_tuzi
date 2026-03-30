/**
 * Load repo-root soul.md for serverless prompts (character bible).
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export function getSoulText() {
  try {
    const p = join(process.cwd(), 'soul.md');
    if (!existsSync(p)) return '';
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

/** Truncate for token budget; keeps start (基础信息 + 核心信念 usually at top). */
export function getSoulTextForPrompt(maxLen = 6000) {
  const t = getSoulText();
  if (!t) return '';
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + '\n…（设定已截断）';
}

/** Short pin for lightweight APIs (pet decide, image comment context). */
export function getSoulShortBlurb(maxLen = 500) {
  const t = getSoulText();
  if (!t) return '';
  const withoutFence = t.replace(/```json[\s\S]*?```\s*$/m, '').trim();
  const s = withoutFence.slice(0, maxLen);
  return s.length < withoutFence.length ? s + '…' : s;
}
