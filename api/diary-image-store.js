import { persistDiaryImageFromDataUrl, toDataUrlFromFlexibleSource } from '../lib/diary-image-asset.js';
import { recordDiaryImageEvent } from '../lib/diary-image-metrics.js';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }

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
