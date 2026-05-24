/**
 * Load repo-root npc/*.md for serverless NPC prompts.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const NPC_FILES = {
  pikachu: 'npc/pikachu.md'
};

export function getNpcText(npcId = 'pikachu') {
  try {
    const rel = NPC_FILES[npcId];
    if (!rel) return '';
    const p = join(process.cwd(), rel);
    if (!existsSync(p)) return '';
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

/** Truncate for token budget. */
export function getNpcTextForPrompt(npcId = 'pikachu', maxLen = 3500) {
  const t = getNpcText(npcId);
  if (!t) return '';
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + '\n…（设定已截断）';
}

/** Short blurb for lightweight APIs. */
export function getNpcShortBlurb(npcId = 'pikachu', maxLen = 480) {
  const t = getNpcText(npcId);
  if (!t) return '';
  const withoutFence = t.replace(/```json[\s\S]*?```\s*$/m, '').trim();
  const s = withoutFence.slice(0, maxLen);
  return s.length < withoutFence.length ? s + '…' : s;
}
