import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function normalizeStyleType(styleType, preferredCategory) {
  const s = String(styleType || '').trim().toLowerCase();
  if (s === 'food' || s === 'sculpture' || s === 'badge') return s;
  const c = String(preferredCategory || '').trim().toLowerCase();
  if (c === 'food') return 'food';
  if (c === 'sculpture') return 'sculpture';
  return 'badge';
}

function extractImageUrl(data) {
  const message = data?.choices?.[0]?.message;
  if (!message) return null;
  if (Array.isArray(message.images) && message.images.length > 0) {
    const first = message.images[0];
    if (typeof first === 'string') return first;
    if (first?.url) return first.url;
    if (first?.imageUrl?.url) return first.imageUrl.url;
    if (first?.image_url?.url) return first.image_url.url;
    if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;
  }
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part?.type === 'image_url' && part?.image_url?.url) return part.image_url.url;
      if (part?.type === 'image' && (part?.image_url?.url || part?.url)) return part?.image_url?.url || part?.url;
    }
  }
  if (typeof message.content === 'string') {
    const txt = message.content.trim();
    const md = txt.match(/!\[.*?\]\((.*?)\)/);
    if (md?.[1]) return md[1];
    if (txt.startsWith('http') || txt.startsWith('data:')) return txt;
  }
  return null;
}

function dataUrlToBuffer(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/\w+;base64,(.+)$/);
  if (!m) return null;
  return Buffer.from(m[1], 'base64');
}

function bufferToDataUrlPng(buf) {
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function alphaFromWhite(r, g, b, a, threshold, feather, maxChromaDiff) {
  if (a === 0) return 0;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min > maxChromaDiff) return a;
  const whiteness = (r + g + b) / 3;
  const start = threshold - feather;
  if (whiteness <= start) return a;
  if (whiteness >= threshold) return 0;
  const keep = (threshold - whiteness) / feather;
  return Math.max(0, Math.min(255, Math.round(a * keep)));
}

async function removeWhiteBg(pngBuf) {
  const img = sharp(pngBuf, { failOn: 'none' }).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  const threshold = 245;
  const feather = 20;
  const maxChromaDiff = 38;
  for (let i = 0; i < out.length; i += 4) {
    out[i + 3] = alphaFromWhite(out[i], out[i + 1], out[i + 2], out[i + 3], threshold, feather, maxChromaDiff);
  }
  return sharp(out, { raw: info }).png().toBuffer();
}

function stylePrompt(styleType, location, memoryTag) {
  const loc = String(location || '某地').trim();
  const tag = String(memoryTag || '').trim();
  if (styleType === 'food') {
    return `Travel collectible sticker, white background, one local signature food from ${loc}, hand-drawn doodle style, no text, no logo, no watermark. Hint tag: ${tag}.`;
  }
  if (styleType === 'sculpture') {
    return `Travel collectible sticker, white background, one iconic landmark/sculpture from ${loc}, hand-drawn doodle style, no text, no logo, no watermark. Hint tag: ${tag}.`;
  }
  return `Travel fridge magnet badge collectible for ${loc}, one concise symbolic composition, hand-drawn doodle style, white background, no text, no logo, no watermark. Hint tag: ${tag}.`;
}

function sceneLabel(styleType, location) {
  const loc = String(location || '未知地点').trim() || '未知地点';
  if (styleType === 'food') return `${loc}·风味美食`;
  if (styleType === 'sculpture') return `${loc}·城市地标`;
  return `${loc}·旅行徽章`;
}

function slug(input) {
  return String(input || '')
    .trim()
    .replace(/[·／/\\:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'item';
}

function buildPersistPaths(styleType, location) {
  const root = process.cwd();
  const poolKey = slug(location || 'misc');
  const styleDir = slug(styleType || 'badge');
  const baseDir = resolve(root, '场景', 'generated', 'aigc-cutouts', styleDir, poolKey);
  const fileName = `${poolKey}-${Date.now()}.png`;
  const absFile = join(baseDir, fileName);
  const relImage = `场景/generated/aigc-cutouts/${styleDir}/${poolKey}/${fileName}`.replace(/\\/g, '/');
  const manifestPath = resolve(root, '场景', 'generated', 'aigc-cutouts', 'manifest.json');
  return { absFile, relImage, manifestPath, baseDir };
}

function persistCollectibleAsset(cutoutPng, styleType, location, scene) {
  try {
    const { absFile, relImage, manifestPath, baseDir } = buildPersistPaths(styleType, location);
    mkdirSync(baseDir, { recursive: true });
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(absFile, cutoutPng);

    let manifest = [];
    if (existsSync(manifestPath)) {
      try {
        const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
        manifest = Array.isArray(raw) ? raw : (Array.isArray(raw.items) ? raw.items : []);
      } catch {
        manifest = [];
      }
    }
    const toSave = {
      image: relImage,
      label: scene.label,
      poolKey: location,
      styleType,
      collectCategory: scene.collectCategory,
      tier: scene.tier,
      memoryTag: scene.memoryTag,
      regionLabel: scene.regionLabel,
      source: scene.source,
      intro: scene.intro,
      facts: scene.facts,
      tags: scene.tags
    };
    manifest.unshift(toSave);
    // 去重：label+image
    const seen = new Set();
    manifest = manifest.filter((it) => {
      const k = `${it.label || ''}::${it.image || ''}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return relImage;
  } catch {
    return null;
  }
}

export async function POST(request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'missing_api_key', message: 'OPENROUTER_API_KEY is not configured.' }, { status: 503 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }
  const location = String(body?.location || '').trim();
  if (!location) return Response.json({ error: 'missing_location' }, { status: 400 });
  const styleType = normalizeStyleType(body?.styleType, body?.preferredCategory);
  const tier = ['S', 'A', 'B', 'C'].includes(String(body?.tier || '').toUpperCase()) ? String(body.tier).toUpperCase() : 'B';
  const memoryTag = String(body?.memoryTag || '').trim();
  const model = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image';

  const payload = {
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: stylePrompt(styleType, location, memoryTag) }] }],
    modalities: ['image', 'text']
  };
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Title': 'SoulGo Dynamic Collectible Gen'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const t = await res.text();
      return Response.json({ error: 'upstream_error', message: t.slice(0, 400) }, { status: res.status });
    }
    const data = await res.json();
    const imageUrl = extractImageUrl(data);
    if (!imageUrl) return Response.json({ error: 'no_image' }, { status: 502 });

    let rawBuf = dataUrlToBuffer(imageUrl);
    if (!rawBuf && /^https?:\/\//i.test(imageUrl)) {
      const ir = await fetch(imageUrl);
      if (ir.ok) rawBuf = Buffer.from(await ir.arrayBuffer());
    }
    if (!rawBuf) return Response.json({ error: 'invalid_image_payload' }, { status: 502 });

    const cutout = await removeWhiteBg(rawBuf);
    const imageDataUrl = bufferToDataUrlPng(cutout);
    const collectCategory = styleType === 'food' ? 'food' : (styleType === 'sculpture' ? 'sculpture' : 'souvenir');
    const scene = {
      image: imageDataUrl,
      label: sceneLabel(styleType, location),
      tier,
      source: 'checkin',
      memoryTag: memoryTag || `dyn_${Date.now()}`,
      collectCategory,
      regionLabel: location,
      assetSource: 'ai_daily',
      collectibleSourceType: 'aigc_cutout_manifest',
      intro: `「${location}」实时生成收集物。`,
      facts: ['Gemini 2.5 Flash 动态生成', '自动扣图'],
      tags: ['AIGC', styleType, '动态掉落']
    };
    const persistedImage = persistCollectibleAsset(cutout, styleType, location, scene);
    if (persistedImage) {
      scene.image = persistedImage;
      scene.tags = Array.isArray(scene.tags) ? [...scene.tags, '已入库'] : ['已入库'];
    }
    return Response.json({ ok: true, scene });
  } catch (err) {
    return Response.json({ error: 'internal_error', message: err?.message || String(err) }, { status: 500 });
  }
}

