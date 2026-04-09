const METRICS_KEY = '__soulgo_diary_image_metrics';

function getStore() {
  if (!globalThis[METRICS_KEY]) {
    globalThis[METRICS_KEY] = {
      genSuccess: 0,
      genFail: 0,
      retrySuccess: 0,
      loadError: 0,
      records: []
    };
  }
  return globalThis[METRICS_KEY];
}

export function recordDiaryImageEvent(type, payload = {}) {
  const s = getStore();
  if (type === 'gen_success') s.genSuccess += 1;
  if (type === 'gen_fail') s.genFail += 1;
  if (type === 'retry_success') s.retrySuccess += 1;
  if (type === 'load_error') s.loadError += 1;
  s.records.unshift({
    type,
    at: Date.now(),
    ...payload
  });
  if (s.records.length > 200) s.records.length = 200;
}

export function getDiaryImageMetrics() {
  const s = getStore();
  const total = s.genSuccess + s.genFail;
  return {
    diary_image_gen_success_rate: total ? Number((s.genSuccess / total).toFixed(4)) : 0,
    diary_image_load_error_rate: total ? Number((s.loadError / total).toFixed(4)) : 0,
    diary_image_retry_success_rate: s.genFail ? Number((s.retrySuccess / s.genFail).toFixed(4)) : 0,
    counters: {
      gen_success: s.genSuccess,
      gen_fail: s.genFail,
      retry_success: s.retrySuccess,
      load_error: s.loadError
    },
    recent: s.records
  };
}
