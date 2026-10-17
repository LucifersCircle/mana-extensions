// Test-only diagnostics. Never return response text, arbitrary headers or redirect URLs.
// Failed responses stay failed; this helper does not retry or change the request.
const MAX_BYTES = 16 * 1024;
const DEADLINE_MS = 1500;
const MAX_READS = 256;

export async function imageFailureDiagnostic(response, expectedURL) {
  const rawType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const contentType = ['text/html', 'text/plain', 'application/json', 'application/xml', 'text/xml'].includes(rawType)
    ? rawType : rawType?.startsWith('image/') ? 'image' : rawType ? 'other' : 'missing';
  const challengeHeader = response.headers.get('cf-mitigated') === 'challenge';
  const result = { contentType, sameURL: response.url === expectedURL, challengeHeader,
    marker: 'unclassified', scan: 'no-body' };
  if (response.ok || !response.body) return result;
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = '', bytes = 0, reads = 0, timer;
  const expires = performance.now() + DEADLINE_MS;
  const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(null), DEADLINE_MS); });
  try {
    for (;;) {
      if (reads++ >= MAX_READS) { result.scan = 'read-limit'; break; }
      if (performance.now() >= expires) { result.scan = 'time-limit'; break; }
      const next = await Promise.race([reader.read(), deadline]);
      if (next === null) { result.scan = 'time-limit'; break; }
      if (next.done) { result.scan = 'complete'; break; }
      const part = next.value.subarray(0, MAX_BYTES - bytes);
      text += decoder.decode(part, { stream: true }); bytes += part.byteLength;
      if (bytes >= MAX_BYTES) { result.scan = 'byte-limit'; break; }
    }
    text += decoder.decode();
  } catch { result.scan = 'read-error'; }
  finally {
    clearTimeout(timer);
    // Cancellation can depend on an upstream stream; never extend this diagnostic's deadline.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (/access[\s_-]*denied|\bforbidden\b|permission denied|you have been blocked|error\s*(?:code\s*:?\s*)?1020|not authorized|unauthorized/i.test(text)) result.marker = 'access-denial-marker';
  else if (challengeHeader || /\/cdn-cgi\/challenge-platform|cf-chl-|just a moment/i.test(text)) result.marker = 'managed-challenge-marker';
  else if (/captcha|recaptcha|hcaptcha|turnstile/i.test(text)) result.marker = 'captcha-marker';
  return result;
}
