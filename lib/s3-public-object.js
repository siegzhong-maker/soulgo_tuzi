import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

let s3ClientCache = null;

export function getS3Config() {
  const bucket = process.env.AWS_S3_BUCKET || process.env.R2_BUCKET || '';
  const region = process.env.AWS_REGION || 'auto';
  const endpoint = process.env.AWS_S3_ENDPOINT || process.env.R2_ENDPOINT || '';
  const publicBaseUrl = process.env.AWS_S3_PUBLIC_BASE_URL || process.env.R2_PUBLIC_BASE_URL || '';
  if (!bucket) return null;
  return { bucket, region, endpoint, publicBaseUrl };
}

export function getS3Client(conf) {
  if (s3ClientCache) return s3ClientCache;
  s3ClientCache = new S3Client({
    region: conf.region || 'auto',
    endpoint: conf.endpoint || undefined,
    forcePathStyle: !!conf.endpoint
  });
  return s3ClientCache;
}

export function buildS3PublicUrl(conf, key) {
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

/**
 * Upload bytes to configured S3/R2 bucket with public cache headers.
 * @returns {Promise<string|null>} Public HTTPS URL or null if no bucket / error.
 */
export async function putPublicObject(key, body, contentType) {
  const conf = getS3Config();
  if (!conf) return null;
  const client = getS3Client(conf);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: conf.bucket,
        Key: key,
        Body: body,
        ContentType: contentType || 'application/octet-stream',
        CacheControl: 'public, max-age=31536000, immutable'
      })
    );
    return buildS3PublicUrl(conf, key);
  } catch {
    return null;
  }
}
