import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const ASSET_DIR = resolve(process.cwd(), 'assets', 'generated', 'diary-images');
const MANIFEST_PATH = resolve(ASSET_DIR, 'manifest.json');

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

function getS3Config() {
  const bucket = process.env.AWS_S3_BUCKET || process.env.R2_BUCKET || '';
  const region = process.env.AWS_REGION || 'auto';
  const endpoint = process.env.AWS_S3_ENDPOINT || process.env.R2_ENDPOINT || '';
  const publicBaseUrl = process.env.AWS_S3_PUBLIC_BASE_URL || process.env.R2_PUBLIC_BASE_URL || '';
  if (!bucket) return null;
  return { bucket, region, endpoint, publicBaseUrl };
}

let s3ClientCache = null;
function getS3Client(conf) {
  if (s3ClientCache) return s3ClientCache;
  s3ClientCache = new S3Client({
    region: conf.region || 'auto',
    endpoint: conf.endpoint || undefined,
    forcePathStyle: !!conf.endpoint
  });
  return s3ClientCache;
}

function buildS3PublicUrl(conf, key) {
  if (conf.publicBaseUrl) {
    const base = conf.publicBaseUrl.replace(/\/+$/, '');
    return `${base}/${key}`;
  }
  if (conf.endpoint) {
    const ep = conf.endpoint.replace(/\/+$/, '');
    return `${ep}/${conf.bucket}/${key}`;
  }
  return `https://${conf.bucket}.s3.${conf.region}.amazonaws.com/${key}`;
}

async function persistToS3(buffer, mime, fileName) {
  const conf = getS3Config();
  if (!conf) return null;
  const key = `diary-images/${fileName}`;
  const client = getS3Client(conf);
  await client.send(new PutObjectCommand({
    Bucket: conf.bucket,
    Key: key,
    Body: buffer,
    ContentType: mime,
    CacheControl: 'public, max-age=31536000, immutable'
  }));
  return buildS3PublicUrl(conf, key);
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
  let stableUrl = null;
  try {
    stableUrl = await persistToS3(buffer, mime, fileName);
  } catch {
    stableUrl = null;
  }
  if (!stableUrl) {
    const relUrl = `/assets/generated/diary-images/${fileName}`;
    mkdirSync(ASSET_DIR, { recursive: true });
    writeFileSync(absPath, buffer);
    stableUrl = relUrl;
  }

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

  return { assetId, stableUrl, mime, bytes: buffer.length, hash };
}

export async function toDataUrlFromFlexibleSource(imageUrlOrDataUrl) {
  const src = String(imageUrlOrDataUrl || '').trim();
  if (!src) return '';
  if (src.startsWith('data:image/')) return src;
  if (!/^https?:\/\//i.test(src)) return '';
  try {
    const r = await fetch(src);
    if (!r.ok) return '';
    const ct = (r.headers.get('content-type') || 'image/png').split(';')[0].trim().toLowerCase();
    const b = Buffer.from(await r.arrayBuffer());
    return `data:${ct};base64,${b.toString('base64')}`;
  } catch {
    return '';
  }
}
