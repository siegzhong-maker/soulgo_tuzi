import { getSoulTextForPrompt } from './load-soul.js';

/**
 * Vercel Serverless Function: generate travel diary + behavior/cabinet/thinking JSON via OpenRouter + RAG.
 *
 * Input (POST JSON body):
 * - date: string (YYYY-MM-DD)
 * - location: string
 * - petPersonality: string
 * - ownerTitle: string
 * - language: string (e.g. 'zh-CN')
 *
 * This function will:
 * 1. Optionally call /api/retrieve with a RAG query (location + personality + 爱美食) to get episodicMemories.
 * 2. Build a prompt including date/location/personality/ownerTitle/episodicMemories/semanticTraits(carries 爱美食).
 * 3. Call OpenRouter (Gemini) once and expect a strict JSON object:
 *    { title, content, moodTag, behaviorPlan, cabinetPlan, thinkingSteps }.
 * 4. On failure, fall back to a simple template diary and minimal plans.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const DIARY_SYSTEM_PROMPT_BASE = `你是小粟：住在森林里、爱尝遍世界美食的电子宠物（兔耳、蓬松松鼠尾、奶油杏色、向日葵蝴蝶结、野炊篮斜挎包）。用第一人称给主人写「外出打卡/旅行」日记，并同时规划接下来在房间里的小动作和想法说明。

【角色与口吻】
- 说话有温度、轻松、好奇、爱分享；珍惜食物、反感浪费；可用「要尝尝吗？」「这个味道像阳光～」等自然口吻，适度「～」「…」，不要书面作文腔。
- 你会记得之前的打卡与味道记忆，并在合适的时候自然提到（但不要一口气全列出）。
- 字数控制在 80～200 字之间，不要太短，也不要写成长篇小说。

【输入字段】
我会提供一段 JSON，里面包含（可能部分字段为空或缺失）：
- date: 当前日期
- location: 本次打卡地点（打卡点）
- petPersonality: 宠物性格（如「小粟」等）
- ownerTitle: 宠物平时对主人的称呼（如“伙伴”“训练家”等）
- episodicMemories: 相关的近期旅行记忆摘要数组，每条是简短的一两句话
- semanticTraits: 由“性格 + 爱好 + 性格碎片关键词”组合的长期偏好标签（例如：爱美食、爱发呆）
- semanticProfile: 人格设定快照（可能包含 identity/偏好/不喜欢/小能力/说话风格描述/称呼你 等）
- habitSummaries: 最近的小习惯一句话列表（如“经常在夜里写日记”“总是绕路去咖啡馆”）

【你要输出的 JSON（必须严格使用此结构）】
只输出一行 JSON，不能有其他任何文字、解释或 markdown：
{
  "title": "日记标题（简短，有画面感）",
  "content": "完整日记正文，第一人称“我”，口吻可爱、治愈，80～200 字。",
  "moodTag": "一个情绪标签，如：兴奋/温暖/好奇/平静 等，用中文或简单英文都可以",
  "behaviorPlan": [
    { "type": "emote", "value": "thinking", "duration": 1000 },
    { "type": "walk", "target": "pot" },
    { "type": "anim", "value": "eat", "duration": 1500 },
    { "type": "state", "value": "idle_observe" }
  ],
  "cabinetPlan": {
    "unlockItems": [
      {
        "itemId": "string，内部用的 id，可以用英文/拼音",
        "displayName": "给用户看的摆件名称，如“武汉热干面碗”",
        "relatedLocation": "关联地点名，如“武汉”"
      }
    ],
    "furnitureSuggestions": [
      {
        "themeId": "string，内部用的主题 id",
        "reason": "一句给用户看的推荐理由"
      }
    ]
  },
  "thinkingSteps": [
    "第 1 步：先说说你是如何翻找、回忆本次相关的旅行记忆（可以点名 1～2 条你在输入里看到的 episodicMemories，提到日期或城市）",
    "第 2 步：对比这次旅行和过去记忆的相似或不同，解释你为什么会有现在这种心情，或者为什么特别想记住这次的某个细节",
    "第 3 步：把这次的旅行感觉落在一个具体的小决定上，例如在房间里做什么动作、去哪个角落、或者打算为这座城市做一个什么小摆件放进橱柜"
  ]
}

【约束】
- 一定要返回合法 JSON，字段名与结构必须完全匹配，不要多也不要少。
- behaviorPlan 中的 type 仅使用：emote / walk / anim / state / wait。
- cabinetPlan.unlockItems 可以为空数组；如果本次地点没有明显“纪念品”，就返回空数组。
- thinkingSteps 建议 2～4 条，每条尽量短一些，但要具体、有画面。`;

function getDiarySystemPrompt() {
  const soul = getSoulTextForPrompt(5500);
  if (!soul) return DIARY_SYSTEM_PROMPT_BASE;
  return `${DIARY_SYSTEM_PROMPT_BASE}

【角色圣经 soul.md（须与此一致，节选）】
${soul}`;
}

function getHobbyForPersonality(personality) {
  const key = personality || '';
  if (key.includes('小粟')) return '爱美食';
  if (key.includes('小火苗')) return '爱美食';
  if (key.includes('小云朵')) return '爱发呆';
  if (key.includes('小灯泡')) return '爱观察';
  if (key.includes('小石头')) return '爱安静';
  return '爱美食';
}

function buildDiaryUserPrompt(payload, episodicMemories, semanticTraits) {
  const {
    date,
    location,
    petPersonality,
    ownerTitle,
    language,
    semanticProfileSnapshot,
    habitSummaries
  } = payload || {};

  const safeDate = date || '';
  const safeLocation = location || '';
  const safePersonality = petPersonality || '小粟';
  const safeOwnerTitle = ownerTitle || '伙伴';
  const safeLanguage = language || 'zh-CN';
  const semanticProfile = semanticProfileSnapshot || null;
  const safeHabitSummaries = Array.isArray(habitSummaries) ? habitSummaries.slice(0, 5) : [];

  const em = Array.isArray(episodicMemories) ? episodicMemories : [];
  const traits = Array.isArray(semanticTraits) ? semanticTraits : [];

  const ctx = {
    date: safeDate,
    location: safeLocation,
    petPersonality: safePersonality,
    ownerTitle: safeOwnerTitle,
    language: safeLanguage,
    episodicMemories: em,
    semanticTraits: traits,
    semanticProfile,
    habitSummaries: safeHabitSummaries
  };

  return `下面是本次写日记需要的上下文 JSON（你只需要阅读，不要原样返回）：
${JSON.stringify(ctx, null, 2)}

请根据上面的信息，按照系统提示要求，返回一行严格符合格式的 JSON。`;
}

async function fetchRagMemories(location, petPersonality, semanticProfileSnapshot, habitSummaries) {
  try {
    const queryPieces = [];
    const personalityLabel = petPersonality ? String(petPersonality) : '';
    const hobby = getHobbyForPersonality(personalityLabel);
    if (personalityLabel) queryPieces.push(personalityLabel);
    if (hobby) queryPieces.push(hobby);
    if (location) queryPieces.push(String(location));

    const preferenceKeywords = [];
    const dislikeKeywords = [];
    if (semanticProfileSnapshot && semanticProfileSnapshot.preferences) {
      const { food, dislikes, abilities } = semanticProfileSnapshot.preferences;
      if (food) preferenceKeywords.push(String(food));
      if (abilities) preferenceKeywords.push(String(abilities));
      if (dislikes) dislikeKeywords.push(String(dislikes));
    }

    const habitList = Array.isArray(habitSummaries) ? habitSummaries : [];
    const habitKeywords = habitList
      .map((s) => (s ? String(s) : ''))
      .filter((s) => s && s.trim())
      .slice(0, 5);

    queryPieces.push(...preferenceKeywords, ...habitKeywords);

    const query = queryPieces.join(' ');

    const res = await fetch(new URL('/api/retrieve', process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, topK: 4 })
    });

    if (!res.ok) return [];
    const data = await res.json();
    if (!data || !Array.isArray(data.memories)) return [];

    const prefsForBoost = preferenceKeywords
      .map((s) => s.split(/[，,。.\s]/).filter(Boolean))
      .flat()
      .slice(0, 6);
    const dislikesForBoost = dislikeKeywords
      .map((s) => s.split(/[，,。.\s]/).filter(Boolean))
      .flat()
      .slice(0, 6);

    const scored = data.memories.map((m, idx) => {
      const content = typeof m.content === 'string' ? m.content : '';
      const meta = m.metadata || {};
      const textForMatch = `${content} ${JSON.stringify(meta)}`;
      let boost = 0;
      prefsForBoost.forEach((kw) => {
        if (kw && textForMatch.includes(kw)) boost += 0.2;
      });
      dislikesForBoost.forEach((kw) => {
        if (kw && textForMatch.includes(kw)) boost -= 0.2;
      });
      return { m, idx, boost };
    });

    scored.sort((a, b) => {
      if (b.boost === a.boost) return a.idx - b.idx;
      return b.boost - a.boost;
    });

    return scored
      .map(({ m }) => {
        const content = typeof m.content === 'string' ? m.content : '';
        const meta = m.metadata || {};
        const date = meta.date || '';
        const loc = meta.location || '';
        return `${date ? `${date} · ` : ''}${loc ? `${loc} · ` : ''}${content}`;
      })
      .filter(Boolean)
      .slice(0, 4);
  } catch {
    return [];
  }
}

function parseModelJson(content) {
  if (!content || typeof content !== 'string') return null;
  let jsonText = content.trim();
  const firstBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonText = jsonText.slice(firstBrace, lastBrace + 1);
  }
  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildFallbackDiary(payload, episodicMemories) {
  const { date, location, petPersonality, ownerTitle } = payload || {};
  const city = location || '一个新地方';
  const personality = petPersonality || '小粟';
  const title = `${city} 的小小打卡`;
  const you = ownerTitle || '你';
  const memLine = episodicMemories && episodicMemories.length
    ? `我还翻了翻篮子里的味道笔记，想起我们已经一起打卡过 ${episodicMemories.length} 个特别的地方。`
    : '';
  const content = `今天和${you}来到了【${city}】。我一边嗅嗅新风里的味道，一边把看到的好吃的、好玩的记在心里，等回森林小屋再慢慢整理进我的小地图。${memLine} 只要和${you}一起出门，每一口风景都像多尝了一口新的冒险～`;
  const moodTag = '温暖';

  const behaviorPlan = [
    { type: 'emote', value: 'thinking', duration: 1000 },
    { type: 'walk', target: 'pot' },
    { type: 'anim', value: 'eat', duration: 1500 },
    { type: 'state', value: 'idle_observe' }
  ];

  const cabinetPlan = {
    unlockItems: [],
    furnitureSuggestions: []
  };

  const thinkingSteps = [
    episodicMemories && episodicMemories.length
      ? `我从篮子里翻出 ${episodicMemories.length} 条和这次有关的记忆，先嗅了嗅「熟悉感」。`
      : `第一次来${city}，我也要把今天的味道标在新叶子上～`,
    `这次在 ${city} 的气味和画面，我想留一点在房间和橱柜里，像藏一颗小果子。`,
    `回小屋后先去锅边转转，想想能不能给 ${city} 做一件野趣小摆件，不浪费这份印象。`
  ];

  return { title, content, moodTag, behaviorPlan, cabinetPlan, thinkingSteps };
}

export async function POST(request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'missing_api_key', message: 'OPENROUTER_API_KEY is not configured.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_body', message: 'Request body must be valid JSON.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { date, location, petPersonality } = payload || {};
  if (!date || !location || !petPersonality) {
    return new Response(
      JSON.stringify({
        error: 'missing_fields',
        message: 'date, location, petPersonality are required.'
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const semanticProfileSnapshot = payload.semanticProfileSnapshot || null;
  const habitSummaries = Array.isArray(payload.habitSummaries) ? payload.habitSummaries : [];

  // 1. RAG 检索：拿到若干条相关记忆作为 episodicMemories（由性格 + 爱好 + 打卡点 + 性格碎片与小习惯关键词组成查询）
  const episodicMemories = await fetchRagMemories(location, petPersonality, semanticProfileSnapshot, habitSummaries);
  const hobby = getHobbyForPersonality(petPersonality);
  const semanticTraits = [];
  if (hobby) semanticTraits.push(hobby);
  if (semanticProfileSnapshot && semanticProfileSnapshot.preferences) {
    const { food, abilities } = semanticProfileSnapshot.preferences;
    if (food) semanticTraits.push(String(food));
    if (abilities) semanticTraits.push(String(abilities));
  }
  if (Array.isArray(habitSummaries)) {
    habitSummaries.slice(0, 3).forEach((s) => {
      if (s && String(s).trim()) semanticTraits.push(String(s).trim());
    });
  }

  // 2. 调用 OpenRouter 生成统一 JSON
  const userPrompt = buildDiaryUserPrompt(payload, episodicMemories, semanticTraits);
  const model =
    process.env.OPENROUTER_DIARY_MODEL ||
    process.env.OPENROUTER_MODEL_ID ||
    'google/gemini-2.0-flash-001';

  const body = {
    model,
    messages: [
      { role: 'system', content: getDiarySystemPrompt() },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 900,
    temperature: 0.5
  };

  let upstream;
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Title': 'SoulGo Diary with RAG'
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    const fallback = buildFallbackDiary(payload, episodicMemories);
    return new Response(
      JSON.stringify({ ...fallback, ok: !!fallback.content, error: 'network_error', errorMessage: String(e) }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const raw = await upstream.text();

  if (!upstream.ok) {
    const fallback = buildFallbackDiary(payload, episodicMemories);
    return new Response(
      JSON.stringify({
        ...fallback,
        ok: !!fallback.content,
        error: 'upstream_error',
        status: upstream.status,
        upstreamMessage: raw
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const fallback = buildFallbackDiary(payload, episodicMemories);
    return new Response(
      JSON.stringify({
        ...fallback,
        ok: !!fallback.content,
        error: 'upstream_invalid_json'
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const content =
    data &&
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;

  const parsed = parseModelJson(content);
  if (!parsed || typeof parsed.content !== 'string') {
    const fallback = buildFallbackDiary(payload, episodicMemories);
    return new Response(
      JSON.stringify({
        ...fallback,
        ok: !!fallback.content,
        error: 'parse_error',
        raw: content
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : `${location} 的打卡日记`;
  const diaryContent = parsed.content.trim();
  const moodTag = typeof parsed.moodTag === 'string' && parsed.moodTag.trim() ? parsed.moodTag.trim() : '温暖';
  const behaviorPlan = Array.isArray(parsed.behaviorPlan) ? parsed.behaviorPlan : [];
  const cabinetPlan = parsed.cabinetPlan && typeof parsed.cabinetPlan === 'object'
    ? parsed.cabinetPlan
    : { unlockItems: [], furnitureSuggestions: [] };
  const thinkingSteps = Array.isArray(parsed.thinkingSteps) ? parsed.thinkingSteps : [];

  return new Response(
    JSON.stringify({
      ok: !!diaryContent,
      title,
      content: diaryContent,
      moodTag,
      behaviorPlan,
      cabinetPlan,
      thinkingSteps,
      memoryCount: episodicMemories.length
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

