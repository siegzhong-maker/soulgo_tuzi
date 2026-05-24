/**
 * Vercel Serverless Function: post-checkin dialogue between 小粟 and 比卡丘 via OpenRouter.
 * POST { trigger, location, diaryTitle?, diaryContent?, moodTag?, petPersonality?, ownerTitle?, episodicSnippet?, memoryCount? }
 * Returns { dialogue: [{ speaker, text }], fallback?: boolean }
 */
import { getSoulShortBlurb } from '../load-soul.js';
import { getNpcShortBlurb } from '../load-npc.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const UPSTREAM_TIMEOUT_MS = 8000;
const SPEAKER_WHITELIST = ['小粟', '比卡丘'];

const SYSTEM_PROMPT_BASE = `你是 SoulGo 旅行小屋里的双人对话编剧。场景：主人刚完成一次地图打卡，小粟和比卡丘在房间里讨论这次旅行。

【角色分工】
- 小粟（主角）：美食森林系兔子，爱分享味道、珍惜食物，第一人称口语，可带「～」
- 比卡丘（NPC 室友）：活泼电系伙伴，爱追问细节，适度「皮卡～」，不抢小粟风头

【任务】
根据输入的打卡地点、日记正文、情绪标签，写一段 **4～8 轮** 的交替对话。
- 必须引用日记里的**具体细节**（味道、场景、人物感受）
- 每句 speaker 只能是「小粟」或「比卡丘」
- 每句 text **≤ 60 字**，口语治愈风
- 比卡丘至少问 1～2 个追问；小粟负责分享见闻

【输出格式】
只输出一行合法 JSON，不要 markdown、不要其他文字：
{"dialogue":[{"speaker":"小粟","text":"..."},{"speaker":"比卡丘","text":"..."}]}`;

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
  parts.push('请生成小粟与比卡丘讨论这次打卡的对话 JSON。');
  return parts.join('\n');
}

function normalizeDialogue(rawDialogue) {
  if (!Array.isArray(rawDialogue)) return null;
  const lines = [];
  for (const item of rawDialogue) {
    if (!item || typeof item !== 'object') continue;
    const speaker = String(item.speaker || '').trim();
    const text = String(item.text || '').trim();
    if (!SPEAKER_WHITELIST.includes(speaker) || !text) continue;
    lines.push({ speaker, text: text.length > 80 ? text.slice(0, 77) + '…' : text });
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
  const snippet = (body && body.diaryContent)
    ? String(body.diaryContent).slice(0, 40)
    : '好多新鲜事';
  return [
    { speaker: '小粟', text: `刚从【${location}】回来～${snippet}…` },
    { speaker: '比卡丘', text: '皮卡～然后呢？最好吃的是什么？' },
    { speaker: '小粟', text: '味道像阳光一样～要尝尝吗？' },
    { speaker: '比卡丘', text: '听起来超——级——棒！下次我也要去！' }
  ];
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'invalid_body', message: 'Request body must be valid JSON.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { location } = body || {};
  if (!location || String(location).trim() === '') {
    return new Response(
      JSON.stringify({ error: 'missing_fields', message: 'location is required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ dialogue: buildFallbackDialogue(body), fallback: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
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
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
  clearTimeout(upstreamTimer);

  const raw = await upstream.text();
  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ dialogue: buildFallbackDialogue(body), fallback: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return new Response(
      JSON.stringify({ dialogue: buildFallbackDialogue(body), fallback: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
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
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ dialogue: buildFallbackDialogue(body), fallback: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
