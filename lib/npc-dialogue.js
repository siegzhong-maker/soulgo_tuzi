/**
 * Post-checkin dialogue between 小粟 and 比卡丘 (invoked via POST /api/chat?soulgoRoute=npc/dialogue or body.soulgoRoute).
 */
import { getSoulShortBlurb } from './load-soul.js';
import { getNpcShortBlurb } from './load-npc.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const UPSTREAM_TIMEOUT_MS = 8000;
const SPEAKER_WHITELIST = ['小粟', '比卡丘'];
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const SYSTEM_PROMPT_BASE = `你是 SoulGo 旅行小屋里的双人对话编剧。场景：主人刚完成一次地图打卡，小粟和比卡丘在房间里用**表情包**讨论这次旅行。

【角色分工】
- 小粟（主角）：美食森林系兔子，爱分享味道；表情偏 🌻😋🤤✨🗺️🧺 等
- 比卡丘（NPC 室友）：活泼电系伙伴，表情偏 ⚡👀❓🎉💪 等

【任务】
根据输入的打卡地点、日记正文、情绪标签，写一段 **4～8 轮** 的交替「表情对话」。
- 必须引用日记里的**具体细节**（味道、场景、感受），用 emoji 组合表达，**不要写文字句子**
- 每句 speaker 只能是「小粟」或「比卡丘」
- 每句 emoji **1～4 个 Unicode 表情符号**，口语感靠 emoji 组合体现
- 比卡丘至少 2 轮；小粟负责分享见闻

【输出格式】
只输出一行合法 JSON，不要 markdown、不要其他文字：
{"dialogue":[{"speaker":"小粟","emoji":"🌻😋"},{"speaker":"比卡丘","emoji":"⚡👀"}]}`;

function getDialogueSystemPrompt() {
  const soulBlurb = getSoulShortBlurb(380);
  const npcBlurb = getNpcShortBlurb('pikachu', 380);
  let prompt = SYSTEM_PROMPT_BASE;
  if (soulBlurb) prompt += `\n\n【小粟设定摘要】\n${soulBlurb}`;
  if (npcBlurb) prompt += `\n\n【比卡丘设定摘要】\n${npcBlurb}`;
  return prompt;
}

function buildUserPrompt(body) {
  const {
    trigger,
    location,
    diaryTitle,
    diaryContent,
    moodTag,
    petPersonality,
    ownerTitle,
    episodicSnippet,
    memoryCount
  } = body || {};

  const parts = [
    `触发场景：${trigger || 'post_checkin'}`,
    `打卡地点：${location || '未知'}`,
    `宠物人格：${petPersonality || '小粟'}`,
    `对主人称呼：${ownerTitle || '伙伴'}`
  ];
  if (diaryTitle) parts.push(`日记标题：${diaryTitle}`);
  if (diaryContent) parts.push(`日记正文：${diaryContent}`);
  if (moodTag) parts.push(`情绪标签：${moodTag}`);
  if (episodicSnippet) parts.push(`相关记忆摘要：${episodicSnippet}`);
  if (typeof memoryCount === 'number' && memoryCount > 0) {
    parts.push(`本次生成参考了 ${memoryCount} 条旅行记忆`);
  }
  parts.push('请生成小粟与比卡丘讨论这次打卡的 emoji 对话 JSON（仅 emoji 字段，不要 text）。');
  return parts.join('\n');
}

function lineToEmoji(item) {
  if (!item || typeof item !== 'object') return '';
  const emoji = String(item.emoji || '').trim();
  if (emoji) return emoji.slice(0, 8);
  const text = String(item.text || '').trim();
  if (text) return '📝';
  const speaker = String(item.speaker || '').trim();
  return speaker === '比卡丘' ? '⚡' : '🌻';
}

function normalizeDialogue(rawDialogue) {
  if (!Array.isArray(rawDialogue)) return null;
  const lines = [];
  for (const item of rawDialogue) {
    if (!item || typeof item !== 'object') continue;
    const speaker = String(item.speaker || '').trim();
    const emoji = lineToEmoji(item);
    if (!SPEAKER_WHITELIST.includes(speaker) || !emoji) continue;
    lines.push({ speaker, emoji });
  }
  if (lines.length < 2) return null;
  return lines.slice(0, 12);
}

function parseDialogueFromContent(content) {
  if (!content || typeof content !== 'string') return null;
  let jsonText = content.trim();
  const firstBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonText = jsonText.slice(firstBrace, lastBrace + 1);
  }
  try {
    const parsed = JSON.parse(jsonText);
    return normalizeDialogue(parsed && parsed.dialogue);
  } catch (_) {
    return null;
  }
}

export function buildFallbackDialogue(body) {
  const location = (body && body.location) || '外面';
  const diaryContent = body && body.diaryContent ? String(body.diaryContent) : '';
  const hasFood = /吃|味|香|甜|辣/.test(diaryContent);
  return [
    { speaker: '小粟', emoji: hasFood ? '🌻😋🤤' : '🌻✨🗺️' },
    { speaker: '比卡丘', emoji: '⚡👀❓' },
    { speaker: '小粟', emoji: hasFood ? '😋☀️' : '💛🌿' },
    { speaker: '比卡丘', emoji: '⚡🎉✨' },
    { speaker: '小粟', emoji: location.length > 4 ? '📍🌻' : '🌻🧺' },
    { speaker: '比卡丘', emoji: '⚡💪🔥' }
  ];
}

/** @returns {Promise<Response>} */
export async function handleNpcDialogue(body) {
  const { location } = body || {};
  if (!location || String(location).trim() === '') {
    return new Response(
      JSON.stringify({ error: 'missing_fields', message: 'location is required.' }),
      { status: 400, headers: JSON_HEADERS }
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ dialogue: buildFallbackDialogue(body), fallback: true }),
      { status: 200, headers: JSON_HEADERS }
    );
  }

  const model = process.env.OPENROUTER_MODEL_ID || 'google/gemini-2.0-flash-001';
  const payload = {
    model,
    messages: [
      { role: 'system', content: getDialogueSystemPrompt() },
      { role: 'user', content: buildUserPrompt(body) }
    ],
    max_tokens: 800,
    temperature: 0.65
  };

  const upstreamController = new AbortController();
  const upstreamTimer = setTimeout(() => upstreamController.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Title': 'SoulGo NPC Dialogue'
      },
      body: JSON.stringify(payload),
      signal: upstreamController.signal
    });
  } catch (e) {
    clearTimeout(upstreamTimer);
    return new Response(
      JSON.stringify({ dialogue: buildFallbackDialogue(body), fallback: true }),
      { status: 200, headers: JSON_HEADERS }
    );
  }
  clearTimeout(upstreamTimer);

  const raw = await upstream.text();
  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ dialogue: buildFallbackDialogue(body), fallback: true }),
      { status: 200, headers: JSON_HEADERS }
    );
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return new Response(
      JSON.stringify({ dialogue: buildFallbackDialogue(body), fallback: true }),
      { status: 200, headers: JSON_HEADERS }
    );
  }

  const content =
    data &&
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;

  const dialogue = parseDialogueFromContent(content);
  if (dialogue) {
    return new Response(
      JSON.stringify({ dialogue }),
      { status: 200, headers: JSON_HEADERS }
    );
  }

  return new Response(
    JSON.stringify({ dialogue: buildFallbackDialogue(body), fallback: true }),
    { status: 200, headers: JSON_HEADERS }
  );
}
