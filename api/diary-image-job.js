import { createDiaryImageJob, getDiaryImageJob, updateDiaryImageJob } from '../lib/diary-image-jobs.js';
import { persistDiaryImageFromDataUrl, toDataUrlFromFlexibleSource } from '../lib/diary-image-asset.js';
import { getDiaryImageMetrics, recordDiaryImageEvent } from '../lib/diary-image-metrics.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function extractImageUrl(data) {
  const message = data?.choices?.[0]?.message;
  if (!message) return '';
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
  return '';
}

async function runJob(job) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    await updateDiaryImageJob(job.id, { status: 'failed', errorCode: 'missing_api_key', errorMessage: 'OPENROUTER_API_KEY missing' });
    return;
  }
  const model = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image';
  await updateDiaryImageJob(job.id, { status: 'generating' });

  for (let i = 1; i <= job.maxAttempts; i++) {
    await updateDiaryImageJob(job.id, { attempts: i });
    try {
      const userContent = [{ type: 'text', text: String(job.prompt || '') }];
      if (job.reference_image_data_url) {
        userContent.push({ type: 'image_url', image_url: { url: String(job.reference_image_data_url) } });
      } else if (job.reference_image_url) {
        userContent.push({ type: 'image_url', image_url: { url: String(job.reference_image_url) } });
      }
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Title': 'SoulGo Diary Image Job'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: userContent }],
          modalities: ['image', 'text']
        })
      });
      if (!res.ok) throw new Error(`upstream_${res.status}`);
      const data = await res.json();
      const imageSrc = extractImageUrl(data);
      if (!imageSrc) throw new Error('no_image_generated');

      const dataUrl = await toDataUrlFromFlexibleSource(imageSrc);
      if (!dataUrl) throw new Error('image_fetch_failed');

      const persisted = await persistDiaryImageFromDataUrl(dataUrl, { diaryId: job.diaryId, source: 'aigc', prefix: 'hero' });
      if (!persisted) throw new Error('persist_failed');

      const isRetry = i > 1;
      recordDiaryImageEvent(isRetry ? 'retry_success' : 'gen_success', { diaryId: String(job.diaryId || '') });
      await updateDiaryImageJob(job.id, {
        status: 'ready',
        result: {
          ...persisted,
          image_url: persisted.stableUrl,
          source: 'stable_asset'
        }
      });
      return;
    } catch (err) {
      const msg = String(err?.message || err || 'unknown_error');
      const isLast = i === job.maxAttempts;
      if (isLast) {
        recordDiaryImageEvent('gen_fail', { diaryId: String(job.diaryId || ''), reason: msg });
        await updateDiaryImageJob(job.id, { status: 'failed', errorCode: msg, errorMessage: msg });
        return;
      }
      await new Promise((r) => setTimeout(r, i * 300));
    }
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { searchParams } = new URL(request.url);
  const action = String(searchParams.get('action') || '').trim().toLowerCase();
  if (action === 'store') {
    const diaryId = String(body?.diaryId || '').trim();
    const source = String(body?.source || 'aigc').trim();
    const input = String(body?.imageDataUrl || body?.imageUrl || '').trim();
    if (!diaryId || !input) {
      return Response.json({ error: 'missing_input', message: 'diaryId and image source are required.' }, { status: 400 });
    }
    const dataUrl = await toDataUrlFromFlexibleSource(input);
    if (!dataUrl) {
      recordDiaryImageEvent('load_error', { reason: 'store_input_unreachable', diaryId });
      return Response.json({ error: 'input_unreachable' }, { status: 422 });
    }
    const persisted = await persistDiaryImageFromDataUrl(dataUrl, { diaryId, source, prefix: 'hero' });
    if (!persisted) {
      recordDiaryImageEvent('load_error', { reason: 'store_decode_failed', diaryId });
      return Response.json({ error: 'persist_failed' }, { status: 500 });
    }
    return Response.json({ ok: true, ...persisted });
  }

  const prompt = String(body?.prompt || '').trim();
  const diaryId = String(body?.diaryId || '').trim();
  if (!prompt || !diaryId) return Response.json({ error: 'missing_prompt_or_diary_id' }, { status: 400 });
  const referenceImageDataUrl = String(body?.reference_image_data_url || '').trim();
  const referenceImageUrl = String(body?.reference_image_url || '').trim();

  const job = await createDiaryImageJob({
    prompt,
    diaryId,
    reference_image_data_url: referenceImageDataUrl,
    reference_image_url: referenceImageUrl
  });
  // Serverless runtimes are not reliable for fire-and-forget background work.
  // Run inline and return terminal status to avoid client-side poll timeouts.
  try {
    await runJob(job);
    const latest = await getDiaryImageJob(job.id);
    return Response.json({
      ok: true,
      jobId: job.id,
      status: latest?.status || 'queued',
      attempts: latest?.attempts || 0,
      errorCode: latest?.errorCode || '',
      errorMessage: latest?.errorMessage || '',
      result: latest?.result || null
    });
  } catch (e) {
    const msg = String(e?.message || e || 'job_crashed');
    await updateDiaryImageJob(job.id, { status: 'failed', errorCode: 'job_crashed', errorMessage: msg });
    return Response.json({
      ok: true,
      jobId: job.id,
      status: 'failed',
      errorCode: 'job_crashed',
      errorMessage: msg
    });
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = String(searchParams.get('action') || '').trim().toLowerCase();
  if (action === 'metrics') {
    return Response.json({ ok: true, metrics: getDiaryImageMetrics() });
  }
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
