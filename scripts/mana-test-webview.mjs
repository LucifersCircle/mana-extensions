// Test-only implementation of the @mana-app/types 0.0.27 WebView bridge.
// Uses anonymous Chromium, not a WKWebView/iOS emulator. No source imports this.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const MAX_JSON = 4 * 1024 * 1024;
const MAX_IMAGE = 16 * 1024 * 1024;
async function boundedHelperText(response, maxBytes, milliseconds) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing helper response');
  const parts = []; let size = 0, reads = 0, timer;
  const expires = performance.now() + milliseconds;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Helper response timeout')), milliseconds); });
  try {
    for (;;) {
      if (++reads > 65536 || performance.now() >= expires) throw new Error('Helper response read limit');
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Oversized helper response');
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts).toString('utf8');
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function assertCoverImageURL(value) {
  if (typeof value !== 'string' || !/^https:\/\/peer\.storagewebtoon\.store\/(?:manhwa|webtoon)\/[1-9]\d*\/[A-Za-z0-9._-]+$/.test(value)
      || /\/(?:\.|\.\.)$/.test(value)) throw new Error('Live-test browser rejects unsupported cover image');
}
// Only SDK entrypoints own a WebView lifetime. Test probes also call internal
// synchronous helpers (URL builders, classifiers, parsers); never promise-wrap
// those helpers or change their return types/identity.
const SOURCE_METHODS = new Set(['search', 'getContent', 'getChapters', 'getChapterData',
  'getSectionsForPage', 'resolvePageSection', 'getSearchForm', 'getSortOptions',
  'handleURL', 'willRequestImage', 'getPreferenceMenu', 'onEnvironmentLoaded',
  'willResolveSectionsForPage', 'getAdditionalInfoSectionItems', 'getLibraryPageLinks', 'validateSearchForm']);
export function assertWebViewURL(value) {
  const reject = () => { throw new Error('Live-test WebView rejects unsupported document navigation'); };
  if (typeof value !== 'string' || /[\x00-\x20\x7f]/.test(value) || !/^https:\/\/marumaru105\.com\/[^#\\]*$/.test(value)) return reject();
  const url = new URL(value);
  // Reject normalization, encoded route aliases, duplicate keys, account/API routes.
  if (url.origin !== 'https://marumaru105.com' || url.username || url.password || url.hash
      || !/^\/(?:manhwa(?:\/[1-9]\d*(?:\/[1-9]\d*)?)?|search)$/.test(url.pathname)
      || value.split('?')[0] !== url.origin + url.pathname) return reject();
  const pairs = [...url.searchParams], keys = pairs.map(([key]) => key);
  if (new Set(keys).size !== keys.length || (url.searchParams.has('page') && !/^[1-9]\d*$/.test(url.searchParams.get('page')))) return reject();
  if (url.pathname === '/search') {
    const query = url.searchParams.get('q');
    if (!query?.trim() || query.length > 300 || url.searchParams.get('kind') !== 'manhwa'
        || keys.some(key => !['q', 'kind', 'page'].includes(key))) return reject();
  } else if (keys.length && (url.pathname !== '/manhwa' || keys.length !== 1 || keys[0] !== 'page')) return reject();
}

function timeout(value = 30) {
  if (!Number.isFinite(value) || value <= 0 || value > 120) throw new Error('Live-test WebView timeout must be between 0 and 120 seconds');
  return value;
}

// Do not silently drop undefined/functions, convert NaN to null, or invoke toJSON.
export function jsonBridge(value) {
  const ancestors = new Set();
  const encode = (entry) => {
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return JSON.stringify(entry);
    if (typeof entry === 'number' && Number.isFinite(entry)) return JSON.stringify(entry);
    if (typeof entry !== 'object' || ancestors.has(entry)) throw new Error('WebView bridge requires finite, acyclic JSON values');
    const array = Array.isArray(entry);
    if (!array) {
      const prototype = Object.getPrototypeOf(entry);
      const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
      if (prototype !== null && (Object.getPrototypeOf(prototype) !== null || typeof constructor !== 'function'
          || Function.prototype.toString.call(constructor) !== Function.prototype.toString.call(Object))) throw new Error('WebView bridge requires plain JSON objects');
    }
    ancestors.add(entry);
    const parts = [];
    for (const key of Reflect.ownKeys(entry)) {
      if (array && key === 'length') continue;
      if (array && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= entry.length)) throw new Error('WebView bridge rejects non-index array properties');
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor)) throw new Error('WebView bridge rejects getters and hidden values');
      parts.push((array ? '' : JSON.stringify(key) + ':') + encode(descriptor.value));
    }
    if (array && parts.length !== entry.length) throw new Error('WebView bridge rejects sparse arrays');
    ancestors.delete(entry);
    const encoded = array ? '[' + parts.join(',') + ']' : '{' + parts.join(',') + '}';
    if (Buffer.byteLength(encoded) > MAX_JSON) throw new Error('WebView bridge payload exceeds its size limit');
    return encoded;
  };
  const serialized = encode(value);
  if (Buffer.byteLength(serialized) > MAX_JSON) throw new Error('WebView bridge payload exceeds its size limit');
  return JSON.parse(serialized);
}

export function safeWebViewDiagnostic(result) {
  const phase = ['goto', 'evaluate', 'image-capture'].includes(result?.phase) ? result.phase : 'unknown';
  const reason = ['navigation-timeout', 'operation-timeout', 'document-identity-changed', 'navigation-error', 'evaluation-error',
    'callback-rejected', 'callback-invalid', 'render-readiness-timeout', 'serialization-error',
    'invalid-operation', 'driver-timeout', 'driver-element-changed', 'driver-frame-changed', 'driver-window-closed',
    'driver-session-lost', 'driver-script-error', 'driver-error', 'unexpected-error',
    'image-invalid-request', 'image-network-evidence-invalid', 'image-network-evidence-limit', 'image-redirect',
    'image-request-identity', 'image-request-duplicate', 'image-request-provenance', 'image-response-identity',
    'image-request-method', 'image-request-document', 'image-request-resource-type', 'image-request-fragment',
    'image-response-resource-type', 'image-response-duplicate', 'image-response-http-status',
    'image-response-service-worker', 'image-response-mime', 'image-response-metadata', 'image-response-challenge', 'image-response-forbidden',
    'image-content-type-invalid', 'image-content-type-missing', 'image-content-type-duplicate', 'image-content-type-mismatch',
    'image-load-failed', 'image-load-completion', 'image-page-challenge', 'image-hero-evidence',
    'image-hero-identity', 'image-hero-changed', 'image-body-unavailable', 'image-capture-timeout'].includes(result?.reason) ? result.reason : 'unknown';
  const stage = ['setup', 'validation', 'session-acquisition', 'initial-safety', 'network-enable', 'initial-log',
    'navigation', 'page-safety', 'observation', 'hero', 'body-read', 'final-verification', 'body-validation'].includes(result?.stage) ? result.stage : 'unknown';
  const media = ['jpeg', 'jpg', 'png', 'gif', 'webp', 'avif', 'bmp', 'icon', 'octet-stream', 'binary-octet-stream',
    'chemical-xyz', 'image-xyz', 'application-xyz', 'application-x-xyz', 'text', 'html', 'json', 'other', 'missing', 'duplicate', 'invalid'];
  const cdpMimeCategory = media.includes(result?.cdpMimeCategory) ? result.cdpMimeCategory : 'unknown';
  const contentTypeCategory = media.includes(result?.contentTypeCategory) ? result.contentTypeCategory : 'unknown';
  return { phase, reason, stage, cdpMimeCategory, contentTypeCategory };
}

export function createManaTestWebView({ solverURL = process.env.FLARESOLVERR_URL, fetchImpl = globalThis.fetch } = {}) {
  let solver;
  if (solverURL) {
    solver = new URL(solverURL);
    if (solver.protocol !== 'http:' || solver.hostname !== '127.0.0.1' || solver.username || solver.password
        || solver.pathname !== '/' || solver.search || solver.hash) throw new Error('Live-test WebView requires a loopback HTTP browser helper');
  }
  const scope = new AsyncLocalStorage(), pages = new Set(), imageOperations = new Set();
  let stopped, closed = false;
  async function command(path, payload, seconds = 30, maxBytes = MAX_JSON + 1024) {
    let response, result;
    try {
      response = await fetchImpl(solver.origin + path, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(Math.ceil((seconds + 5) * 1000)) });
      const text = await boundedHelperText(response, maxBytes, Math.ceil((seconds + 5) * 1000));
      result = JSON.parse(text);
    } catch {
      throw new Error('Live-test WebView helper failed; upstream bodies and credentials are not logged');
    }
    if (!response.ok || !result || typeof result !== 'object' || result.error || (path === '/v1' && result.status !== 'ok')) {
      if (result?.code === 'captcha') stopped = new Error('Explicit CAPTCHA requires user approval; WebView live checks stopped');
      if (result?.code === 'security') {
        const reason = ['insecure-capability', 'internal-page', 'certificate-marker', 'tls-navigation-error'].includes(result.reason) ? ` (${result.reason})` : '';
        stopped = new Error(`Browser security warning${reason}; WebView live checks stopped`);
      }
      const safe = safeWebViewDiagnostic(result), { phase, reason, stage, cdpMimeCategory, contentTypeCategory } = safe;
      const diagnostic = result?.code === 'operation' ? ` (${phase}: ${reason}${phase === 'image-capture' ? `; stage: ${stage}; mime: ${cdpMimeCategory}; content-type: ${contentTypeCategory}` : ''})` : '';
      if (stopped) throw stopped;
      const failure = new Error(`Live-test WebView operation failed${diagnostic}; no upstream details are logged`);
      if (result?.code === 'operation') Object.defineProperty(failure, 'liveTestDiagnostic', { value: safe });
      throw failure;
    }
    return result;
  }
  const WebViewPage = {
    async create(options = {}) {
      if (!solver) throw new Error('WebViewPage requires the real test-only Chromium helper; start docker compose and set FLARESOLVERR_URL');
      const current = scope.getStore();
      if (!current || current.finished) throw new Error('WebViewPage.create must run inside a source method');
      if (current.owner.page) throw new Error('Only one WebView may be active for a source');
      if (closed || stopped) throw stopped ?? new Error('Live-test WebView host is closed');
      if (Object.keys(options).some(key => key !== 'timeout')) throw new Error('Unsupported WebView creation option');
      const seconds = timeout(options.timeout), session = randomUUID();
      let creation, closing, pageClosed = false, documentURL, queue = Promise.resolve();
      const serial = operation => {
        const result = queue.then(operation);
        queue = result.catch(() => {});
        return result;
      };
      const open = () => {
        if (pageClosed || current.finished || closed) throw new Error('WebView page is closed');
        if (stopped) throw stopped;
      };
      const page = {
        goto(url, config = {}) {
          assertWebViewURL(url);
          if (Object.keys(config).some(key => !['waitUntil', 'timeout'].includes(key))) throw new Error('Unsupported WebView navigation option');
          const waitUntil = config.waitUntil ?? 'load', navigationTimeout = timeout(config.timeout ?? seconds);
          if (!['domcontentloaded', 'load'].includes(waitUntil)) throw new Error('Unsupported WebView lifecycle event');
          return serial(async () => {
            open(); documentURL = undefined;
            const result = await command('/webview/goto', { session, url, waitUntil, timeout: navigationTimeout }, navigationTimeout);
            if (result.url !== url || result.ready !== true) throw new Error('WebView navigation did not preserve document identity');
            documentURL = url;
          });
        },
        evaluate(fn, ...args) {
          if (typeof fn !== 'function') throw new Error('WebView.evaluate requires a function');
          const script = Function.prototype.toString.call(fn), values = jsonBridge(args);
          if (Buffer.byteLength(script) > 128 * 1024 || script.includes('[native code]')) throw new Error('Unsupported WebView function');
          return serial(async () => {
            open();
            if (!documentURL) throw new Error('WebView must navigate before evaluating');
            const result = await command('/webview/evaluate', { session, url: documentURL, script, args: values, timeout: seconds }, seconds);
            if (result.url !== documentURL || !Object.hasOwn(result, 'value')) throw new Error('WebView evaluation did not preserve document identity');
            return jsonBridge(result.value);
          });
        },
        evaluateScript() { throw new Error('evaluateScript is not implemented by the minimal test WebView host'); },
        async close() {
          if (closing) return closing;
          pageClosed = true;
          closing = serial(async () => {
            try {
              if (creation) { await creation.catch(() => {}); await command('/v1', { cmd: 'sessions.destroy', session }); }
            } finally { pages.delete(page); if (current.page === page) current.page = undefined; if (current.owner.page === page) current.owner.page = undefined; }
          });
          return closing;
        },
      };
      current.page = page; current.owner.page = page; pages.add(page);
      try {
        creation = command('/v1', { cmd: 'sessions.create', session });
        await creation;
        if (current.finished || closed) { await page.close(); throw new Error('WebView source method already finished'); }
        return page;
      } catch (error) {
        // Creation may have succeeded before its response was lost. Destroy this
        // unique anonymous session without creating another or retrying evaluation.
        await page.close().catch(() => {});
        throw error;
      }
    },
  };
  return {
    WebViewPage,
    async captureCoverImage(url) {
      assertCoverImageURL(url);
      if (!solver) throw new Error('Browser-context image resolution requires the real Chromium helper');
      if (closed || stopped) throw stopped ?? new Error('Live-test WebView host is closed');
      const session = randomUUID();
      const operation = (async () => {
        try {
          await command('/v1', { cmd: 'sessions.create', session });
          if (closed || stopped) throw stopped ?? new Error('Live-test WebView host is closed');
          const result = await command('/webview/image-response', { session, url, timeout: 30 }, 30, Math.ceil(MAX_IMAGE * 4 / 3) + 2048);
          if (closed || stopped) throw stopped ?? new Error('Live-test WebView host is closed');
          if (Object.keys(result).sort().join(',') !== 'body,contentType,encoding,status,url'
              || result.url !== url || result.status !== 200 || result.encoding !== 'base64'
              || typeof result.contentType !== 'string' || !/^image\/[a-z0-9][a-z0-9.+-]*$/i.test(result.contentType)
              || typeof result.body !== 'string' || result.body.length > 4 * Math.ceil(MAX_IMAGE / 3)) {
            throw new Error('Browser-context cover response lacks exact identity, status or image bytes');
          }
          const bytes = Buffer.from(result.body, 'base64');
          if (!bytes.length || bytes.length > MAX_IMAGE || bytes.toString('base64') !== result.body) throw new Error('Browser-context cover bytes are invalid');
          const response = new Response(bytes, { status: result.status, headers: { 'content-type': result.contentType } });
          Object.defineProperty(response, 'url', { value: url });
          return response;
        } finally {
          // Destroy even if creation's reply was lost, and never retry a capture.
          await command('/v1', { cmd: 'sessions.destroy', session });
        }
      })();
      imageOperations.add(operation);
      try { return await operation; }
      finally { imageOperations.delete(operation); }
    },
    wrapSource(source) {
      const owner = { page: undefined };
      return new Proxy(source, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver);
          if (typeof value !== 'function' || !SOURCE_METHODS.has(key)) return value;
          return (...args) => scope.run({ page: undefined, finished: false, owner }, async () => {
            const current = scope.getStore();
            try { return await Reflect.apply(value, target, args); }
            finally { current.finished = true; if (current.page) await current.page.close(); }
          });
        },
      });
    },
    async close() {
      closed = true;
      const results = await Promise.allSettled([...pages].map(page => page.close()).concat([...imageOperations]));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    },
  };
}
