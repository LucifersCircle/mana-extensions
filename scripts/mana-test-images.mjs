// Test-only image response interception. Preserve real image bytes and failure
// status; the SDK's response transformer runs before HTTP status validation.
import { assertCoverImageURL, browserImageProof } from './mana-test-webview.mjs';
const MAX_INTERCEPTED_BYTES = 16 * 1024 * 1024;
const resolvedBrowserImages = new WeakMap();
export const resolvedBrowserImageProof = response => resolvedBrowserImages.get(response);

function requestSnapshot(request) {
  const entries = Object.entries(request), headers = Object.entries(request.headers ?? {});
  const transforms = Array.isArray(request.transformResponse) ? [...request.transformResponse] : request.transformResponse;
  return () => {
    const current = Object.entries(request), currentHeaders = Object.entries(request.headers ?? {});
    if (current.length !== entries.length || entries.some(([key, value]) => !Object.hasOwn(request, key) || request[key] !== value)
        || currentHeaders.length !== headers.length || headers.some(([key, value]) => request.headers[key] !== value)
        || (Array.isArray(transforms) && (!Array.isArray(request.transformResponse)
          || request.transformResponse.length !== transforms.length || transforms.some((value, index) => request.transformResponse[index] !== value)))) {
      throw new Error('Image request changed during response interception');
    }
  };
}

export async function interceptImageResponse(response, request) {
  if (request.transformResponse == null) return response;
  const unchanged = requestSnapshot(request);
  const transforms = Array.isArray(request.transformResponse) ? request.transformResponse : [request.transformResponse];
  if (transforms.some(transform => typeof transform !== 'function')) throw new Error('Invalid image response transformer');
  if (request.responseEncoding != null && !['text', 'base64'].includes(request.responseEncoding)) throw new Error('Unsupported image response encoding');
  const parts = [], reader = response.body?.getReader();
  let size = 0, reads = 0, timer;
  if (reader) {
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Image response interception timed out')), 30_000); });
    const expires = performance.now() + 30_000;
    try {
      for (;;) {
        if (++reads > 16384 || performance.now() >= expires) throw new Error('Image response interception exceeded its read limit');
        const { done, value } = await Promise.race([reader.read(), deadline]);
        if (done) break;
        size += value.byteLength;
        if (size > MAX_INTERCEPTED_BYTES) throw new Error('Intercepted image exceeds live-host byte limit');
        parts.push(Buffer.from(value));
      }
    } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  const bytes = Buffer.concat(parts), headers = Object.fromEntries(response.headers);
  const data = bytes.toString(request.responseEncoding === 'base64' ? 'base64' : 'utf8');
  let transformed = { status: response.status, headers: { ...headers }, data, request };
  let transformTimer;
  const transformDeadline = new Promise((_, reject) => { transformTimer = setTimeout(() => reject(new Error('Image response transformer timed out')), 30_000); });
  try { for (const transform of transforms) transformed = await Promise.race([Promise.resolve().then(() => transform(transformed)), transformDeadline]); }
  finally { clearTimeout(transformTimer); unchanged(); }
  // These live checks verify the actual network response, not synthetic image
  // bytes or a transformer that makes a failing status successful.
  if (!transformed || transformed.status !== response.status || transformed.data !== data
      || transformed.request !== request
      || JSON.stringify(Object.entries(transformed.headers ?? {}).sort()) !== JSON.stringify(Object.entries(headers).sort())) {
    throw new Error('Image response rewriting is unsupported by the live test host');
  }
  const result = new Response([204, 205, 304].includes(response.status) ? null : bytes,
    { status: response.status, headers: response.headers });
  Object.defineProperty(result, 'url', { value: response.url });
  return result;
}

function authorizedCoverContract(source, request) {
  if (source.info.id !== 'Marumaru' || Object.keys(request).sort().join(',') !== 'headers,transformResponse,url'
      || typeof request.transformResponse !== 'function' || Object.keys(request.headers ?? {}).join(',') !== 'Referer'
      || request.headers.Referer !== 'https://marumaru105.com/') throw new Error('Unsupported browser-context image resolution contract');
  assertCoverImageURL(request.url);
}

export async function fetchTestImage(source, url, { fetchImpl, captureCoverImage, log = () => {} }) {
  const request = await source.willRequestImage(url);
  if (typeof request.url !== 'string' || !['http:', 'https:'].includes(new URL(request.url).protocol)) throw new Error('Invalid image request URL');
  const originalURL = request.url, unchanged = requestSnapshot(request);
  const raw = await fetchImpl(originalURL, { headers: request.headers, signal: AbortSignal.timeout(30_000) });
  unchanged();
  log('native', raw.status, originalURL);
  const finish = result => { Object.defineProperty(result, 'requestedImageURL', { value: originalURL }); return result; };
  try { return finish(await interceptImageResponse(raw, request)); }
  catch (error) {
    unchanged();
    // A generic403, a guessed error name or a changed URL must never enable this
    // path. Require both the actual source interceptor and positive CF evidence.
    if (error?.name !== 'CloudflareError' || error.resolutionURL !== originalURL || raw.ok
        || raw.url !== originalURL || raw.headers.get('cf-mitigated')?.toLowerCase() !== 'challenge') throw error;
    authorizedCoverContract(source, request);
    if (typeof captureCoverImage !== 'function') throw error;
    const captured = await captureCoverImage(originalURL);
    unchanged();
    if (captured.url !== originalURL) throw new Error('Browser-context image response identity changed');
    // Reauthorize after browser work, including the real source's policy-checking
    // interceptor. A revoked issuing grant may not be revived by cached bytes.
    const refreshed = await source.willRequestImage(url);
    authorizedCoverContract(source, refreshed);
    if (refreshed.url !== originalURL) throw new Error('Source image identity changed during challenge resolution');
    const result = await interceptImageResponse(captured, refreshed);
    const proof = browserImageProof(captured);
    if (proof) resolvedBrowserImages.set(result, proof);
    log('browser-context-after-cloudflare-error', result.status, originalURL);
    return finish(result);
  }
}
