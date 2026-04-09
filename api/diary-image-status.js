import { getDiaryImageJob } from '../lib/diary-image-jobs.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  const job = await getDiaryImageJob(jobId);
  if (!job) return Response.json({ error: 'job_not_found' }, { status: 404 });
  return Response.json({
    ok: true,
    jobId: job.id,
    status: job.status,
    attempts: job.attempts,
    errorCode: job.errorCode || '',
    errorMessage: job.errorMessage || '',
    result: job.result || null
  });
}
