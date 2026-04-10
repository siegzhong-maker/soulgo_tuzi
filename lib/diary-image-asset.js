import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { putPublicObject } from './s3-public-object.js';

const ASSET_DIR = resolve(process.cwd(), 'assets', 'generated', 'diary-images');
const MANIFEST_PATH = resolve(ASSET_DIR, 'manifest.json');

/** Vercel/Lambda/Netlify: cwd is often /var/task and the bundle dir is not writable — never mkdir there. */
function canPersistDiaryImageToProjectDir() {
  if (process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY) {
    return false;
  }
  const cwd = process.cwd();
  if (cwd === '/var/task' || cwd.startsWith('/var/task/')) return false;
  return true;
}

function slug(input) {
  return String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'img';
}

function decodeDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1].toLowerCase(), buffer: Buffer.from(m[2], 'base64') };
}

function extFromMime(mime) {
  const t = String(mime || '').toLowerCase();
  if (t === 'image/jpeg') return '.jpg';
  if (t === 'image/webp') return '.webp';
  if (t === 'image/gif') return '.gif';
  return '.png';
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeManifest(items) {
  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(items, null, 2));
}

export async function persistDiaryImageFromDataUrl(dataUrl, options = {}) {
  const parsed = decodeDataUrl(dataUrl);
  if (!parsed) return null;
  const { mime, buffer } = parsed;
  const ext = extFromMime(mime);
  const diaryId = slug(options.diaryId || 'diary');
  const prefix = slug(options.prefix || 'hero');
  const hash = createHash('sha256').update(buffer).digest('hex');
  const assetId = `${diaryId}-${prefix}-${hash.slice(0, 12)}-${randomUUID().slice(0, 8)}`;
  const fileName = `${assetId}${ext}`;
  const absPath = resolve(ASSET_DIR, fileName);
  const relUrl = `/assets/generated/diary-images/${fileName}`;
  const s3Key = `diary-images/${fileName}`;
  let stableUrl = await putPublicObject(s3Key, buffer, mime);
  let wroteToProjectDir = false;
  if (!stableUrl) {
    if (canPersistDiaryImageToProjectDir()) {
      try {
        mkdirSync(ASSET_DIR, { recursive: true });
        writeFileSync(absPath, buffer);
        stableUrl = relUrl;
        wroteToProjectDir = true;
      } catch {
        stableUrl = dataUrl;
      }
    } else {
      stableUrl = dataUrl;
    }
  }

  if (wroteToProjectDir) {
    try {
      const now = new Date().toISOString();
      const manifest = readManifest();
      manifest.unshift({
        assetId,
        diaryId: String(options.diaryId || ''),
        source: String(options.source || 'aigc'),
        mime,
        bytes: buffer.length,
        hash,
        url: stableUrl,
        createdAt: now
      });
      writeManifest(manifest.slice(0, 5000));
    } catch {
      // Ignore manifest failures (read-only FS, etc.).
    }
  }

  return { assetId, stableUrl, mime, bytes: buffer.length, hash };
}

/**
 * @param {string} imageUrlOrDataUrl
 * @param {{ siteOrigin?: string }} [options] — use deployment origin to fetch same-site paths like /assets/...
 */
export async function toDataUrlFromFlexibleSource(imageUrlOrDataUrl, options = {}) {
  const src = String(imageUrlOrDataUrl || '').trim();
  if (!src) return '';
  if (src.startsWith('data:image/')) return src;

  const siteOrigin = String(options.siteOrigin || '').replace(/\/+$/, '');
  let fetchUrl = '';
  if (/^https?:\/\//i.test(src)) {
    fetchUrl = src;
  } else if (src.startsWith('//')) {
    fetchUrl = `https:${src}`;
  } else if (src.startsWith('/') && siteOrigin) {
    fetchUrl = `${siteOrigin}${src}`;
  } else {
    return '';
  }

  try {
    const r = await fetch(fetchUrl);
    if (!r.ok) return '';
    const ct = (r.headers.get('content-type') || 'image/png').split(';')[0].trim().toLowerCase();
    const b = Buffer.from(await r.arrayBuffer());
    return `data:${ct};base64,${b.toString('base64')}`;
  } catch {
    return '';
  }
}
