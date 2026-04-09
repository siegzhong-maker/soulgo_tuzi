import { getJob, setJob } from './redis-job-store.js';
const JOBS_KEY = '__soulgo_diary_image_jobs';

function getJobsMap() {
  if (!globalThis[JOBS_KEY]) globalThis[JOBS_KEY] = new Map();
  return globalThis[JOBS_KEY];
}

export async function createDiaryImageJob(initial) {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id,
    status: 'queued',
    attempts: 0,
    maxAttempts: 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    errorCode: '',
    errorMessage: '',
    result: null,
    ...initial
  };
  getJobsMap().set(id, job);
  await setJob(job);
  return job;
}

export async function updateDiaryImageJob(id, patch) {
  const jobs = getJobsMap();
  let prev = jobs.get(id);
  if (!prev) {
    prev = await getJob(id);
  }
  if (!prev) return null;
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  jobs.set(id, next);
  await setJob(next);
  return next;
}

export async function getDiaryImageJob(id) {
  const jobs = getJobsMap();
  const key = String(id || '');
  const inMem = jobs.get(key);
  if (inMem) return inMem;
  const persisted = await getJob(key);
  if (persisted) jobs.set(key, persisted);
  return persisted || null;
}
