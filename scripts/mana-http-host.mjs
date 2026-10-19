// Test-only native HTTP bridge for the official Mana SDK. No source imports this
// adapter. Bodies remain opaque, bounded byte capabilities owned by an operation.
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { decryptGCMMessage } from './mana-test-crypto.mjs';

const require = createRequire(import.meta.url);
const runtimes = new WeakMap(), sources = new WeakMap();
const MAX_BYTES = 16 * 1024 * 1024, MAX_READS = 16384, MAX_TIMEOUT = 30_000;
const SOURCE_METHODS = new Set(['search', 'getContent', 'getChapters', 'getChapterData',
    'getSectionsForPage', 'resolvePageSection', 'getSearchForm', 'getSortOptions',
    'handleURL', 'getPreferenceMenu', 'onEnvironmentLoaded', 'willResolveSectionsForPage',
    'getAdditionalInfoSectionItems', 'getLibraryPageLinks', 'validateSearchForm']);
const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const probeReached = new Error('Image authorization probe reached transport');
const imageDispatch = Symbol.for('mana.http.image.v1');

// Bounded diagnostics only: no new requests, retained bodies, cookies or header values.
export function marumaruFailureDiagnostic(request, raw, bytes) {
    const url = new URL(request.url);
    if (raw.status === 200 || url.origin !== 'https://marumaru105.com'
        || !/^\/api\/(?:search|works(?:\/[1-9]\d*)?)$/.test(url.pathname)) return undefined;
    const mime = (raw.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const result = {
        method: request.method === 'GET' ? 'GET' : 'other',
        route: url.origin + url.pathname.replace(/\/\d+$/, '/:id'),
        userAgent: new Headers(request.headers).has('user-agent') ? 'source-supplied' : 'transport-default',
        contentType: ['application/json', 'text/html'].includes(mime) ? mime : 'other',
        cloudflareChallenge: raw.headers.get('cf-mitigated')?.toLowerCase() === 'challenge',
    };
    if (mime === 'application/json' && bytes.byteLength <= 4096) {
        try {
            const value = JSON.parse(new TextDecoder().decode(bytes));
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                if (Number.isInteger(value.status) && value.status >= 400 && value.status <= 599) result.errorStatus = value.status;
                // Never retain arbitrary provider messages or paths; these can contain secrets.
                if (value.path === '/seo-gate') result.errorPath = '/seo-gate';
            }
        } catch { /* Invalid JSON remains an ordinary failed response. */ }
    }
    return result;
}

function abortError() { const error = new Error('HTTP operation ended or was cancelled'); error.name = 'AbortError'; return error; }
function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
function responseHeaders(headers) { return Object.fromEntries(new Headers(headers)); }
function equalHeaders(a, b) { return JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort()); }
function assertURL(value) {
    if (typeof value !== 'string') throw new Error('Invalid HTTP request URL');
    const target = new URL(value);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Invalid HTTP request URL');
    return target;
}
function snapshotRequest(request) {
    const keys = Object.keys(request), values = keys.map(key => request[key]);
    const headers = request.headers.toJSON(), body = JSON.stringify(request.body);
    return () => {
        if (Object.keys(request).length !== keys.length || keys.some((key, index) => !own(request, key) || request[key] !== values[index])
            || !equalHeaders(headers, request.headers.toJSON()) || JSON.stringify(request.body) !== body) {
            throw new Error('Image request changed during response interception');
        }
    };
}

export function createHTTPBridge({ fetchImpl, logger, assertRequest, redactURL, redactText }) {
    const sessionID = randomUUID(), operations = new Map(), bodies = new Map(), transfers = new Map();
    const modes = new Map(), transportScope = new AsyncLocalStorage();
    const controller = new AbortController();
    let nextBody = 0, nextOperation = 0, context, api, closed = false;
    const active = id => {
        const operation = operations.get(id);
        if (closed || !operation) throw abortError();
        return operation;
    };
    const bodyFor = id => {
        const body = bodies.get(id);
        if (!body || (!body.exported && !operations.has(body.operationID))) throw new Error('Native response body is unavailable');
        return body;
    };
    const dropBody = id => {
        const body = bodies.get(id);
        operations.get(body?.operationID)?.bodies.delete(id);
        bodies.delete(id);
    };
    const saveBody = (operationID, bytes, metadata, request) => {
        const operation = active(operationID);
        const bodyID = `${sessionID}:${++nextBody}`;
        bodies.set(bodyID, { bytes, metadata, request, operationID, exported: false });
        operation.bodies.add(bodyID);
        return { ...metadata, bodyID, sessionID };
    };
    async function fetchMessage(message) {
        const operation = active(message.operationID);
        if (typeof message.requestID !== 'string' || !message.requestID || transfers.has(message.requestID)) throw new Error('Invalid or duplicate HTTP request ID');
        if (!Number.isFinite(message.timeoutMs) || message.timeoutMs <= 0) throw new Error('Invalid HTTP timeout');
        if (!Number.isInteger(message.origin) || message.origin < 0 || message.origin > 2) throw new Error('Invalid HTTP request origin');
        const target = assertURL(message.url), method = methods[message.method];
        if (!Number.isInteger(message.method) || !method) throw new Error('Invalid HTTP method');
        if (message.bodyKind !== undefined && ![0, 1, 2, 3].includes(message.bodyKind)) throw new Error('Unsupported HTTP body kind');
        if ((message.bodyKind === undefined) !== (message.body === undefined)
            || message.body !== undefined && typeof message.body !== 'string') throw new Error('Invalid serialized HTTP body');
        if (message.bodyKind === 3) throw new Error('Binary request bodies are unsupported by the read-only live host');
        const headers = responseHeaders(message.headers);
        const request = { url: target.href, method, headers, body: message.body, origin: message.origin };
        assertRequest(request);
        const mode = modes.get(message.operationID);
        if (message.origin !== 0 && mode) {
            if (mode.request) throw new Error('Duplicate image transfer within one dispatch');
            mode.request = request;
            if (mode.probe) throw probeReached;
            if (mode.replay && (request.url !== mode.replay.url || method !== 'GET' || request.body !== undefined)) {
                throw new Error('Source image identity changed during challenge resolution');
            }
        }
        const transfer = new AbortController();
        transfers.set(message.requestID, { controller: transfer, operationID: message.operationID });
        operation.transfers.add(message.requestID);
        const started = performance.now();
        let status, timer, raw;
        const stopped = new Promise((_, reject) => {
            transfer.signal.addEventListener('abort', () => reject(transfer.signal.reason ?? abortError()), { once: true });
            timer = setTimeout(() => { const error = new Error('HTTP transport timed out'); error.name = 'TimeoutError'; transfer.abort(error); }, Math.min(MAX_TIMEOUT, message.timeoutMs));
        });
        const race = value => Promise.race([value, stopped]);
        try {
            const pending = Promise.resolve().then(() => mode?.replay && message.origin !== 0 ? mode.replay : (transportScope.getStore() ?? fetchImpl)(target.href, {
                method, headers, body: message.body, signal: transfer.signal,
            }));
            // A transport that ignores cancellation must not leave its late body live.
            void pending.then(value => { if (transfer.signal.aborted) void value.body?.cancel().catch(() => {}); }, () => {});
            raw = await race(pending);
            active(message.operationID);
            status = raw.status;
            if (!Number.isInteger(status) || status < 200 || status > 599 || !raw.headers) throw new Error('Invalid native HTTP response');
            const responseURL = raw.url || target.href;
            assertURL(responseURL);
            const metadata = { status, url: responseURL, headers: responseHeaders(raw.headers) };
            if (mode && message.origin !== 0) {
                mode.native = { ...metadata, requestedURL: target.href };
                mode.log?.(mode.replay ? 'browser-context-after-cloudflare-error' : 'native', status, target.href);
            }
            const bytes = await readBytes(raw, race);
            transfer.signal.throwIfAborted();
            const native = saveBody(message.operationID, bytes, metadata, request);
            if (mode && message.origin !== 0) mode.native.bodyID = native.bodyID;
            const diagnostic = marumaruFailureDiagnostic(request, raw, bytes);
            logger({ url: redactURL(target.href), status, durationMs: Math.round(performance.now() - started), ...(diagnostic ? { diagnostic } : {}) });
            return native;
        } catch (error) {
            logger({ url: redactURL(target.href), status, durationMs: Math.round(performance.now() - started), error: redactText(error?.message ?? error) });
            if (error === probeReached) throw error;
            const clean = new Error(redactText(error?.message ?? error));
            clean.name = ['AbortError', 'TimeoutError'].includes(error?.name) ? error.name : 'Error';
            throw clean;
        } finally {
            clearTimeout(timer);
            if (raw?.body && !raw.body.locked) void raw.body.cancel().catch(() => {});
            transfers.delete(message.requestID);
            operation.transfers.delete(message.requestID);
        }
    }
    async function readBytes(raw, race) {
        const reader = raw.body?.getReader();
        if (!reader) return Buffer.alloc(0);
        const parts = []; let size = 0, reads = 0;
        try {
            for (;;) {
                if (++reads > MAX_READS) throw new Error('Native HTTP response exceeded its read limit');
                const { done, value } = await race(reader.read());
                if (done) break;
                size += value.byteLength;
                if (size > MAX_BYTES) throw new Error('Native HTTP response exceeds live-host byte limit');
                parts.push(Buffer.from(value));
            }
            return Buffer.concat(parts, size);
        } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    const bridge = {
        requiresOperation: true,
        crypto: [2], // SDK CryptoAlgorithm.AesGcm; no other native ciphers advertised.
        signal: controller.signal,
        now: () => performance.now(),
        async send(message) {
            if (!message || typeof message !== 'object') throw new Error('Invalid HTTP bridge message');
            switch (message.operation) {
                case 0: return fetchMessage(message);
                case 9:
                    if (closed) throw abortError();
                    return decryptGCMMessage(message);
                case 1: {
                    const body = bodyFor(message.bodyID);
                    if (![0, 1].includes(message.reader)) throw new Error('Unsupported native body reader');
                    return { value: body.bytes.toString(message.reader === 0 ? 'utf8' : 'base64') };
                }
                case 2: dropBody(message.bodyID); return {};
                case 3: {
                    const transfer = transfers.get(message.requestID);
                    if (transfer && transfer.operationID !== message.operationID) throw new Error('HTTP cancellation operation mismatch');
                    transfer?.controller.abort(abortError()); return {};
                }
                case 4: {
                    active(message.operationID);
                    if (typeof message.value !== 'string' || message.value.length > Math.ceil(MAX_BYTES / 3) * 4
                        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(message.value)) throw new Error('Invalid native body bytes');
                    const bytes = Buffer.from(message.value, 'base64');
                    if (bytes.length > MAX_BYTES || bytes.toString('base64') !== message.value) throw new Error('Invalid native body bytes');
                    const native = saveBody(message.operationID, bytes);
                    return { bodyID: native.bodyID, sessionID };
                }
                case 7: {
                    if (closed || typeof message.operationID !== 'string' || !message.operationID || operations.has(message.operationID)) throw new Error('Invalid or duplicate HTTP operation');
                    operations.set(message.operationID, { bodies: new Set(), transfers: new Set() }); return {};
                }
                case 8: {
                    const operation = active(message.operationID);
                    const keep = message.keepBodyIDs;
                    if (!Array.isArray(keep) || new Set(keep).size !== keep.length || keep.some(id => !operation.bodies.has(id))) throw new Error('Invalid exported HTTP body ownership');
                    for (const id of operation.transfers) transfers.get(id)?.controller.abort(abortError());
                    for (const id of [...operation.bodies]) {
                        if (keep.includes(id)) bodyFor(id).exported = true;
                        else dropBody(id);
                    }
                    operations.delete(message.operationID); return {};
                }
                // The pinned SDK does not dispatch these operations. Do not claim
                // retention or session invalidation semantics that were not tested.
                default: throw new Error('Unsupported HTTP bridge operation');
            }
        },
    };
    const host = {
        bridge,
        install(value) {
            if (context && context !== value) throw new Error('HTTP host is already bound to another VM');
            if (context === value && api) return host;
            context = value;
            const sdkPath = require.resolve('@mana-app/types/dist/runtime/http.generated.js');
            if (!context.ManaHTTP?.HttpClient) vm.runInContext(readFileSync(sdkPath, 'utf8'), context, { filename: sdkPath });
            const sdk = context.ManaHTTP;
            const hostPath = require.resolve('@mana-app/types/dist/runtime/http-host.generated.js');
            vm.runInContext(readFileSync(hostPath, 'utf8'), context, { filename: hostPath });
            api = context.ManaHTTP;
            context.ManaHTTP = { ...sdk, ...api };
            return host;
        },
        runOperation(callback, id) {
            if (!api) throw new Error('Install the official Mana HTTP host before invoking the source');
            return api.runHttpOperation(callback, id);
        },
        wrapSource(source) {
            const wrapped = new Proxy(source, {
                get(target, key, receiver) {
                    const value = Reflect.get(target, key, receiver);
                    if (typeof value !== 'function' || !SOURCE_METHODS.has(key)) return value;
                    return (...args) => host.runOperation(() => Reflect.apply(value, target, args)).then(result =>
                        key === 'getPreferenceMenu' ? host.wrapCallbacks(result) : result);
                },
            });
            sources.set(source, host); sources.set(wrapped, host);
            return wrapped;
        },
        wrapCallbacks(value, seen = new WeakMap()) {
            if (!value || typeof value !== 'object') return value;
            if (seen.has(value)) return seen.get(value);
            const wrapped = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
            seen.set(value, wrapped);
            for (const key of Reflect.ownKeys(value)) {
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (typeof descriptor.value === 'function') {
                    const callback = descriptor.value;
                    descriptor.value = (...args) => host.runOperation(() => Reflect.apply(callback, value, args));
                } else if ('value' in descriptor) descriptor.value = host.wrapCallbacks(descriptor.value, seen);
                Object.defineProperty(wrapped, key, descriptor);
            }
            return wrapped;
        },
        withTransport(fetchOverride, callback) {
            if (typeof fetchOverride !== 'function') throw new Error('Invalid HTTP fixture transport');
            return transportScope.run(fetchOverride, callback);
        },
        createResponse({ status = 200, url = 'https://fixture.invalid/', headers = {}, body = '' } = {}) {
            const sdk = context.ManaHTTP;
            const bytes = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body);
            return new sdk.HttpResponse({ url, method: 0, headers: new sdk.HttpHeaders() },
                { status, url, headers, bodyID: '', sessionID: '' }, new Uint8Array(bytes));
        },
        async dispatchImage(source, url, { origin, probe = false, replay, log } = {}) {
            assertURL(url);
            const originValue = origin === 'cover' ? 1 : origin === 'page' ? 2 : undefined;
            if (originValue === undefined) throw new Error('Image dispatch requires an explicit cover or page origin');
            const method = originValue === 1 ? 'getCoverTransport' : 'getPageTransport';
            const id = `live-image-${sessionID}-${++nextOperation}`;
            const mode = { probe, replay, log }; modes.set(id, mode);
            let unchanged, client, observer, responseObserver;
            const dispatchSource = {
                [method](request) {
                    client = source[method]?.(request);
                    if (!client || typeof client[imageDispatch] !== 'function') return client;
                    observer = value => { unchanged = snapshotRequest(value); return value; };
                    client.addRequestInterceptor(observer);
                    // SDK 0.1.1 clones the prepared request after request interceptors.
                    // Verify the effective response request against the actual transport,
                    // not solely the earlier interceptor object snapshot.
                    responseObserver = response => {
                        const actual = mode.request, request = response.request;
                        if (!actual || request.url !== actual.url || methods[request.method] !== actual.method
                            || !equalHeaders(request.headers.toJSON(), actual.headers)
                            || request.body !== undefined) throw new Error('Image request changed during response interception');
                        return response;
                    };
                    client.addResponseInterceptor(responseObserver);
                    return client;
                },
            };
            try {
                const result = await host.runOperation(() => api.loadImage(dispatchSource, { url, origin: originValue }), id);
                unchanged?.();
                if (probe) throw new Error('Image authorization probe unexpectedly produced a response');
                const body = bodyFor(result.bodyID);
                if (result.sessionID !== sessionID || result.bodyID !== mode.native?.bodyID
                    || result.status !== mode.native.status || result.url !== mode.native.url
                    || !equalHeaders(result.headers, mode.native.headers)) throw new Error('Image response rewriting is unsupported by the live test host');
                const response = new Response([204, 205, 304].includes(result.status) ? null : body.bytes,
                    { status: result.status, headers: result.headers });
                Object.defineProperties(response, { url: { value: result.url }, requestedImageURL: { value: mode.request.url } });
                return { response, mode };
            } catch (error) {
                unchanged?.();
                if (probe && mode.request && (error === probeReached || error?.cause === probeReached)) return { request: mode.request, mode };
                // Evidence is returned only internally, never on error objects sent
                // to source code or in logs, where reader tokens could escape.
                throw { imageDispatchFailure: true, error, mode };
            } finally {
                client?.removeRequestInterceptor?.(observer);
                client?.removeResponseInterceptor?.(responseObserver);
                modes.delete(id);
                for (const [bodyID, body] of bodies) if (body.operationID === id) dropBody(bodyID);
            }
        },
        cancelOperation(id) { api.cancelHttpOperation(id); },
        stats: () => ({ operations: operations.size, bodies: bodies.size, transfers: transfers.size }),
        async close() {
            api?.cancelAllHttpOperations();
            controller.abort(abortError());
            for (const transfer of transfers.values()) transfer.controller.abort(abortError());
            for (const bodyID of bodies.keys()) dropBody(bodyID);
            operations.clear(); closed = true;
        },
    };
    return host;
}
export function registerHTTPRuntime(runtime, host) { runtimes.set(runtime, host); }
export function installManaHTTP(context) {
    const host = runtimes.get(context) ?? runtimes.get(context.__manaHTTPBridge);
    if (!host) throw new Error('VM does not use createManaRuntime');
    return host.install(context);
}
export function httpHostFor(source) {
    const host = sources.get(source);
    if (!host) throw new Error('Source must be registered with the official Mana HTTP host');
    return host;
}
