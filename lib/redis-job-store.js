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
    await redis.set(keyForJob(job.id), job, { ex: JOB_TTL_SECONDS });
    return;
  }
  getFallbackMap().set(String(job.id), job);
}

export async function getJob(jobId) {
  const id = String(jobId || '');
  const redis = getRedisClient();
  if (redis) {
    const v = await redis.get(keyForJob(id));
    return v || null;
  }
  return getFallbackMap().get(id) || null;
}
