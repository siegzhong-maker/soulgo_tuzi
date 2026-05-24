import { Redis } from '@upstash/redis';

const FALLBACK_JOBS_KEY = '__soulgo_diary_image_jobs_fallback';
const JOB_TTL_SECONDS = 24 * 60 * 60;

function getFallbackMap() {
  if (!globalThis[FALLBACK_JOBS_KEY]) globalThis[FALLBACK_JOBS_KEY] = new Map();
  return globalThis[FALLBACK_JOBS_KEY];
}

function getRedisClient() {
  try {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      return Redis.fromEnv();
    }
  } catch {
    // fallback to memory map
  }
  return null;
}

function keyForJob(jobId) {
  return `soulgo:diary-image-job:${String(jobId || '')}`;
}

export async function setJob(job) {
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set(keyForJob(job.id), job, { ex: JOB_TTL_SECONDS });
      return;
    } catch (err) {
      console.warn('[diary-image-job] Redis set failed, using in-memory store:', err?.message || err);
    }
  }
  getFallbackMap().set(String(job.id), job);
}

export async function getJob(jobId) {
  const id = String(jobId || '');
  const redis = getRedisClient();
  if (redis) {
    try {
      const v = await redis.get(keyForJob(id));
      return v || null;
    } catch (err) {
      console.warn('[diary-image-job] Redis get failed, using in-memory store:', err?.message || err);
    }
  }
  return getFallbackMap().get(id) || null;
}
