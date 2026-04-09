import { getDiaryImageMetrics } from '../lib/diary-image-metrics.js';

export async function GET() {
  return Response.json({ ok: true, metrics: getDiaryImageMetrics() });
}
