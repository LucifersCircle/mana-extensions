import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createManaRuntime, installManaHTTP } from './mana-runtime.mjs';
import { authorizeTestImage, fetchTestImage } from './mana-test-images.mjs';

const empty = { operations: 0, bodies: 0, transfers: 0 };
function fixture(fetchImpl = async () => new Response('actual bytes'), options = {}) {
    const context = vm.createContext(createManaRuntime({ fetchImpl, logger: () => {}, ...options }));
    const host = installManaHTTP(context);
    return { context, host, evaluate: code => vm.runInContext(code, context), run: code => host.runOperation(() => vm.runInContext(code, context)) };
}

test('official runtime is required, exposes new clients only, and rejects HTTP outside operations', async () => {
    const f = fixture();
    assert.equal(f.context.NetworkClient, undefined); assert.equal(f.context.NetworkClientBuilder, undefined);
    await assert.rejects(f.evaluate('new ManaHTTP.HttpClient().get("https://example.invalid/")'), /no source operation/);
    assert.equal(await f.run('new ManaHTTP.HttpClient().get("https://example.invalid/").then(r => r.text())'), 'actual bytes');
    assert.deepEqual(f.host.stats(), empty);
});

test('asynchronous body reads preserve bytes and headers; parsed data survives but native responses expire', async () => {
    const f = fixture(async () => new Response('\ufeff{"answer":42}', { status: 403, headers: { 'X-Test': 'yes' } }));
    const result = await f.run(`new ManaHTTP.HttpClient().get('https://example.invalid/').then(response => {
        globalThis.saved = response;
        return response.json().then(parsed => ({ parsed, status: response.status, header: response.headers.get('x-TEST') }));
    })`);
    assert.equal(result.parsed.answer, 42); assert.equal(result.status, 403); assert.equal(result.header, 'yes');
    await assert.rejects(f.evaluate('saved.text()'), /after the source operation finishes/);
    await assert.rejects(f.evaluate('saved.bytes()'), /after the source operation finishes/);
    assert.deepEqual(f.host.stats(), empty);
});

test('typed JSON and exact form text use unchanged read-only POST allowlists after query merging', async () => {
    const sent = [];
    const f = fixture(async (url, init) => { sent.push({ url, ...init }); return new Response('{}'); });
    await f.run(`new ManaHTTP.HttpClient().post('https://kagane.org/api/v2/search/series', ManaHTTP.Body.json({current_books:{min:0}}), {params:{page:0,size:50}}).then(r=>r.text())`);
    assert.equal(sent[0].body, '{"current_books":{"min":0}}');
    assert.equal(sent[0].headers['content-type'], 'application/json');
    await f.run(`new ManaHTTP.HttpClient().post('https://mangasushi.org/manga/public/ajax/chapters/', ManaHTTP.Body.text('', 'application/x-www-form-urlencoded')).then(r=>r.text())`);
    assert.equal(sent[1].body, ''); assert.equal(sent[1].headers['content-type'], 'application/x-www-form-urlencoded');
    for (const code of [
        `new ManaHTTP.HttpClient().post('https://example.invalid/write', ManaHTTP.Body.json({}))`,
        `new ManaHTTP.HttpClient().delete('https://kagane.org/api/v2/series/public')`,
        `new ManaHTTP.HttpClient().post('https://kagane.org/api/v2/search/series?page=0&size=50', ManaHTTP.Body.json({}), {params:{page:1}})`,
        `new ManaHTTP.HttpClient().post('https://mangasushi.org/manga/public/ajax/chapters/', ManaHTTP.Body.bytes(new Uint8Array([1])))`,
    ]) await assert.rejects(f.run(code));
    assert.equal(sent.length, 2); assert.deepEqual(f.host.stats(), empty);
});

test('official millisecond limiter is effective and included in the request deadline', async () => {
    const starts = [];
    const f = fixture(async () => { starts.push(performance.now()); return new Response('ok'); });
    f.evaluate('globalThis.client = new ManaHTTP.HttpClient().setRateLimit(2, 120)');
    await f.run(`client.get('https://example.invalid/').then(() => client.get('https://example.invalid/')).then(r=>r.text())`);
    assert(starts[1] - starts[0] >= 45, 'Numeric interval must be milliseconds with real admission spacing');
    await assert.rejects(f.run(`client.get('https://example.invalid/', {timeoutMs:10})`), { name: 'TimeoutError' });
    assert.equal(starts.length, 2); assert.deepEqual(f.host.stats(), empty);
});

test('deadlines include asynchronous authorization and prevent late interceptor network I/O', async () => {
    let requests = 0;
    const f = fixture(async () => { requests++; return new Response('ok'); });
    await assert.rejects(f.run(`new ManaHTTP.HttpClient().setTimeoutMs(15)
        .addRequestInterceptor(request => new Promise(resolve => setTimeout(() => resolve(request), 40)))
        .get('https://example.invalid/')`), { name: 'TimeoutError' });
    await new Promise(resolve => setTimeout(resolve, 55));
    assert.equal(requests, 0); assert.deepEqual(f.host.stats(), empty);
});

test('response policy deadlines release native bytes, including late interceptor completion', async () => {
    const f = fixture();
    await assert.rejects(f.run(`new ManaHTTP.HttpClient().setTimeoutMs(15)
        .addResponseInterceptor(response => new Promise(resolve => setTimeout(() => resolve(response), 40)))
        .get('https://example.invalid/')`), { name: 'TimeoutError' });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(f.host.stats(), empty);
});

test('operation cancellation aborts real transport, prevents late body resurrection, and pre-cancels future IDs', async () => {
    let started, lateCancelled = false, signal;
    const began = new Promise(resolve => { started = resolve; });
    const f = fixture(async (_url, init) => {
        signal = init.signal; started();
        await new Promise(resolve => setTimeout(resolve, 30));
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { lateCancelled = true; } }));
    });
    const operation = f.host.runOperation(() => f.evaluate(`new ManaHTTP.HttpClient().get('https://example.invalid/')`), 'cancel-test');
    const rejected = assert.rejects(operation, { name: 'AbortError' });
    await began; f.host.cancelOperation('cancel-test'); await rejected;
    await new Promise(resolve => setTimeout(resolve, 45));
    assert.equal(signal.aborted, true); assert.equal(lateCancelled, true); assert.deepEqual(f.host.stats(), empty);
    f.host.cancelOperation('not-started');
    await assert.rejects(f.host.runOperation(() => { throw new Error('Must not execute'); }, 'not-started'), { name: 'AbortError' });
});

test('oversized, unbounded and stalled native byte streams are cancelled and never retained', async () => {
    let cancelled = 0;
    for (const stream of [
        () => new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1)); }, cancel() { cancelled++; } }),
        () => new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(0)); }, cancel() { cancelled++; } }),
        () => new ReadableStream({ cancel() { cancelled++; } }),
    ]) {
        const f = fixture(async () => new Response(stream()));
        await assert.rejects(f.run(`new ManaHTTP.HttpClient().setTimeoutMs(30).get('https://example.invalid/')`), /byte limit|read limit|timed out|deadline exceeded/);
        assert.deepEqual(f.host.stats(), empty);
    }
    assert.equal(cancelled, 3);
});

test('operation/body ownership rejects foreign handles, duplicate IDs, unsupported bridge messages and invalid readers', async () => {
    const f = fixture(); const send = message => f.context.__manaHTTPBridge.send(message);
    await send({ operation: 7, operationID: 'one' });
    await assert.rejects(send({ operation: 7, operationID: 'one' }), /duplicate/);
    const body = await send({ operation: 4, operationID: 'one', value: Buffer.from([0, 255, 128]).toString('base64') });
    assert.equal((await send({ operation: 1, bodyID: body.bodyID, reader: 1 })).value, 'AP+A');
    await assert.rejects(send({ operation: 1, bodyID: body.bodyID, reader: 7 }), /reader/);
    await send({ operation: 7, operationID: 'two' });
    await assert.rejects(send({ operation: 8, operationID: 'two', keepBodyIDs: [body.bodyID] }), /ownership/);
    for (const operation of [5, 6, 9, -1]) await assert.rejects(send({ operation }), /Unsupported/);
    await send({ operation: 8, operationID: 'one', keepBodyIDs: [] });
    await assert.rejects(send({ operation: 1, bodyID: body.bodyID, reader: 0 }), /unavailable/);
    await send({ operation: 8, operationID: 'two', keepBodyIDs: [] });
    assert.deepEqual(f.host.stats(), empty);
});

test('image authorization can issue nested general metadata requests in the same operation', async () => {
    const requested = [];
    const f = fixture(async (url) => { requested.push(url); return new Response('allowed'); });
    const source = f.host.wrapSource(f.evaluate(`({
        getPageTransport() {
            return new ManaHTTP.HttpClient().addRequestInterceptor(request =>
                new ManaHTTP.HttpClient().get('https://example.invalid/policy').then(r => r.text()).then(policy => {
                    if (policy !== 'allowed') throw new Error('Denied'); request.url = 'https://example.invalid/issued-page'; return request;
                }));
        }
    })`));
    assert.equal((await authorizeTestImage(source, 'https://example.invalid/page', { origin: 'page' })).url, 'https://example.invalid/issued-page');
    assert.deepEqual(requested, ['https://example.invalid/policy']); assert.deepEqual(f.host.stats(), empty);
});

test('parallel source operations isolate byte lifetimes and never promise-wrap synchronous transport factories', async () => {
    const f = fixture(async url => { await new Promise(resolve => setTimeout(resolve, url.endsWith('/slow') ? 20 : 1)); return new Response(url); });
    const source = f.host.wrapSource(f.evaluate(`({
        helper() { return 7; },
        getCoverTransport() { return new ManaHTTP.HttpClient(); },
        getContent(url) { return new ManaHTTP.HttpClient().get(url).then(r => r.text()); }
    })`));
    assert.equal(source.helper(), 7); assert.equal(typeof source.getCoverTransport({}).then, 'undefined');
    const results = await Promise.all([source.getContent('https://example.invalid/slow'), source.getContent('https://example.invalid/fast')]);
    assert.deepEqual(results, ['https://example.invalid/slow', 'https://example.invalid/fast']); assert.deepEqual(f.host.stats(), empty);
});

test('returned preference callbacks receive their own HTTP operation', async () => {
    const f = fixture();
    const source = f.host.wrapSource(f.evaluate(`({getPreferenceMenu(){return [{onChange:()=>new ManaHTTP.HttpClient().get('https://example.invalid/').then(r=>r.text())}];}})`));
    const menu = await source.getPreferenceMenu();
    assert.equal(await menu[0].onChange(), 'actual bytes'); assert.deepEqual(f.host.stats(), empty);
});

test('native errors and logs redact ephemeral query values', async () => {
    const logs = [];
    const f = fixture(async url => { throw new Error('Failed ' + url); }, { logger: entry => logs.push(entry) });
    await assert.rejects(f.run(`new ManaHTTP.HttpClient().get('https://example.invalid/page?token=private-reader&access_token=private-access')`), error => {
        assert(!error.message.includes('private-reader')); assert(!error.message.includes('private-access')); return true;
    });
    assert(!JSON.stringify(logs).includes('private-reader')); assert(!JSON.stringify(logs).includes('private-access'));
    assert.deepEqual(f.host.stats(), empty);
});

test('SDK challenge handling precedes interceptors without turning generic 403 into a challenge', async () => {
    const f = fixture(async () => new Response('cf-chl', { status: 503, headers: { server: 'cloudflare' } }));
    f.context.intercepted = 0;
    await assert.rejects(f.run(`new ManaHTTP.HttpClient().addResponseInterceptor(r => {intercepted++; return r;}).get('https://example.invalid/')`), { name: 'CloudflareError' });
    assert.equal(f.context.intercepted, 0);
    const ordinary = fixture(async () => new Response('Forbidden', { status: 403, headers: { server: 'cloudflare' } }));
    assert.equal(await ordinary.run(`new ManaHTTP.HttpClient().get('https://example.invalid/').then(r=>r.status)`), 403);
    assert.deepEqual(f.host.stats(), empty); assert.deepEqual(ordinary.host.stats(), empty);
});

test('official explicit retries retain real failed-attempt logs and release every body', async () => {
    let attempts = 0;
    const logs = [];
    const f = fixture(async () => new Response(++attempts === 1 ? 'upstream unavailable' : 'recovered',
        { status: attempts === 1 ? 503 : 200, headers: { 'retry-after': '0' } }), { logger: entry => logs.push(entry) });
    assert.equal(await f.run(`new ManaHTTP.HttpClient().setRetry(1).get('https://example.invalid/').then(r=>r.text())`), 'recovered');
    assert.equal(attempts, 2); assert.deepEqual(logs.map(entry => entry.status), [503, 200]); assert.deepEqual(f.host.stats(), empty);
});

test('host close aborts pending operations and permanently rejects new transfer ownership', async () => {
    let start;
    const started = new Promise(resolve => { start = resolve; });
    const f = fixture((_url, init) => new Promise((_, reject) => {
        start(); init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }));
    const pending = assert.rejects(f.run(`new ManaHTTP.HttpClient().get('https://example.invalid/')`), { name: 'AbortError' });
    await started; await f.host.close(); await pending;
    assert.deepEqual(f.host.stats(), empty);
    await assert.rejects(f.run(`new ManaHTTP.HttpClient().get('https://example.invalid/')`), { name: 'AbortError' });
});


test('Marumaru failure diagnostics retain only bounded allowlisted classifications', async () => {
    const { marumaruFailureDiagnostic } = await import('./mana-http-host.mjs');
    const request = { url: 'https://marumaru105.com/api/works/17155?token=SECRET', method: 'GET', headers: { Cookie: 'SECRET', Authorization: 'SECRET' } };
    const bytes = new TextEncoder().encode(JSON.stringify({ status: 406, path: '/seo-gate', error: 'SECRET', token: 'SECRET' }));
    const response = new Response('', { status: 406, headers: { 'content-type': 'application/json', 'set-cookie': 'SECRET' } });
    assert.deepEqual(marumaruFailureDiagnostic(request, response, bytes), {
        method: 'GET', route: 'https://marumaru105.com/api/works/:id', userAgent: 'transport-default', contentType: 'application/json', cloudflareChallenge: false, errorStatus: 406, errorPath: '/seo-gate',
    });
    assert.equal(marumaruFailureDiagnostic(request, new Response(''), bytes), undefined);
    assert.equal(marumaruFailureDiagnostic({ ...request, url: 'https://other.invalid/api/works/1' }, response, bytes), undefined);
    const unexpected = new TextEncoder().encode(JSON.stringify({ status: 'SECRET', path: '/SECRET', error: 'SECRET' }));
    const diagnostic = marumaruFailureDiagnostic({ ...request, headers: { 'user-agent': 'SECRET' } }, response, unexpected);
    assert.equal(diagnostic.userAgent, 'source-supplied');
    assert(!JSON.stringify(diagnostic).includes('SECRET'));
    assert(!('errorStatus' in diagnostic)); assert(!('errorPath' in diagnostic));
    assert(!('errorStatus' in marumaruFailureDiagnostic(request, response, new Uint8Array(4097))));
    const challenge = new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' } });
    assert.equal(marumaruFailureDiagnostic(request, challenge, bytes).cloudflareChallenge, true);
});
