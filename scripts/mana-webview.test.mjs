import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { assertWebViewURL, createManaTestWebView, jsonBridge } from './mana-test-webview.mjs';

const url = 'https://marumaru105.com/manhwa/17155';
const valid = [url, `${url}/21331`, 'https://marumaru105.com/manhwa', 'https://marumaru105.com/manhwa?page=2',
  'https://marumaru105.com/search?q=%EB%9D%BC%EB%A9%98&kind=manhwa', 'https://marumaru105.com/search?q=test&kind=manhwa&page=2'];
const invalid = [url.replace('https:', 'http:'), url.replace('marumaru105.com', 'evil.test'),
  url.replace('marumaru105.com', 'marumaru105.com:443'), url.replace('marumaru105.com', 'user:pass@marumaru105.com'),
  url + '#', url + '?account=1', url + '/buy', url + '/0', url.replace('/manhwa/', '/a/../manhwa/'),
  url.replace('/manhwa/', '/%6danhwa/'), url + '?page=2', url + '\\', '\n' + url, url + '\n',
  'file:///etc/passwd', 'javascript:alert(1)', 'https://marumaru105.com/api/accounts',
  'https://marumaru105.com/manhwa?page=0', 'https://marumaru105.com/manhwa?page=2&page=3',
  'https://marumaru105.com/search?q=one&q=two&kind=manhwa', 'https://marumaru105.com/search?q=x&kind=novel',
  'https://marumaru105.com/search?q=&kind=manhwa', 'https://marumaru105.com/search?q=x&kind=manhwa&buy=1'];

test('Node and Python independently allow only public supported document routes', () => {
  valid.forEach(value => assert.doesNotThrow(() => assertWebViewURL(value), value));
  invalid.forEach(value => assert.throws(() => assertWebViewURL(value), undefined, value));
  const program = `import ast, json, pathlib, re, sys
from urllib.parse import parse_qsl, urlparse
tree = ast.parse(pathlib.Path(sys.argv[1]).read_text())
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'assert_document_url']
exec(compile(ast.Module(body=nodes, type_ignores=[]), sys.argv[1], 'exec'))
result = []
for value in json.load(sys.stdin):
 try:
  assert_document_url(value)
  result.append(True)
 except (ValueError, TypeError): result.append(False)
print(json.dumps(result))`;
  const result = spawnSync('python3', ['-c', program, fileURLToPath(new URL('./flaresolverr/webview_page.py', import.meta.url))], {
    input: JSON.stringify([...valid, ...invalid]), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [...valid.map(() => true), ...invalid.map(() => false)]);
});

test('JSON bridge preserves cross-realm values and rejects non-JSON or side-effectful values', () => {
  const value = runInNewContext('({ text: "Korean 한글", array: [1, true, null, {nested: "yes"}] })');
  assert.deepEqual(jsonBridge(value), { text: 'Korean 한글', array: [1, true, null, { nested: 'yes' }] });
  const cycle = {}; cycle.self = cycle;
  for (const bad of [undefined, NaN, Infinity, () => {}, 1n, new Date(), new Map(), cycle,
    [undefined], Array(2), { value: undefined }, { get value() { throw new Error('Getter ran'); } },
    { toJSON() { throw new Error('toJSON ran'); } }, { [Symbol('secret')]: 1 }, 'x'.repeat(4 * 1024 * 1024)]) {
    assert.throws(() => jsonBridge(bad), /WebView bridge/);
  }
  let called = 0;
  const array = Object.setPrototypeOf([1, 2], { toJSON() { called++; return 'wrong'; } });
  assert.deepEqual(jsonBridge(array), [1, 2]);
  const prototype = Object.assign(Object.create(null), { constructor: Object, toJSON() { called++; return 'wrong'; } });
  assert.deepEqual(jsonBridge(Object.assign(Object.create(prototype), { actual: true })), { actual: true });
  assert.equal(called, 0, 'Inherited serializers must never execute');
  assert.throws(() => jsonBridge({ get [Symbol.toStringTag]() { called++; return 'Object'; } }), /WebView bridge/);
  assert.equal(called, 0);
});

function harness(override, options = {}) {
  const calls = [];
  const host = createManaTestWebView({ ...options, solverURL: 'http://127.0.0.1:8191', fetchImpl: async (target, init) => {
    const path = new URL(target).pathname, body = JSON.parse(init.body);
    calls.push({ path, body });
    const response = await override?.(path, body);
    if (response) return response;
    return Response.json(path === '/v1' ? { status: 'ok' } : path === '/webview/goto'
      ? { ready: true, url: body.url } : { url: body.url, value: { text: 'real response placeholder for bridge-only infrastructure test' } });
  } });
  return { host, calls };
}

test('detail observation preserves exact consumed HTML with no extra browser command', async () => {
  const observed = [], html = '<section>generic infrastructure string</section>';
  const { host, calls } = harness((path, body) => path === '/webview/evaluate'
    ? Response.json({ url: body.url, value: html }) : undefined,
  { onDocument: value => { observed.push(value); assert(Object.isFrozen(value)); return 'never a substitute'; } });
  const source = host.wrapSource({ async getContent(target) {
    const page = await host.WebViewPage.create(); await page.goto(target);
    return page.evaluate(() => 'actual source callback');
  } });
  assert.equal(await source.getContent(url), html);
  assert.deepEqual(observed, [{ url, html }]);
  assert.deepEqual(calls.map(call => call.path), ['/v1', '/webview/goto', '/webview/evaluate', '/v1']);
  for (const target of [url + '/21331', 'https://marumaru105.com/manhwa', 'https://marumaru105.com/search?q=x&kind=manhwa']) {
    assert.equal(await source.getContent(target), html);
  }
  assert.equal(observed.length, 1, 'Only canonical detail HTML is observed');
  await host.close();
});

test('detail observation never receives invalid identity or non-string results', async () => {
  let observed = 0, wrongURL = false;
  const { host } = harness((path, body) => path === '/webview/evaluate'
    ? Response.json({ url: wrongURL ? url + '/21331' : body.url, value: wrongURL ? 'not trusted' : { text: 'not HTML' } }) : undefined,
  { onDocument: () => { observed++; } });
  const source = host.wrapSource({ async getContent() {
    const page = await host.WebViewPage.create(); await page.goto(url); return page.evaluate(() => null);
  } });
  assert.deepEqual(await source.getContent(), { text: 'not HTML' });
  wrongURL = true; await assert.rejects(source.getContent(), /identity/);
  assert.equal(observed, 0); await host.close();
  assert.throws(() => createManaTestWebView({ onDocument: true }), /observer/);
});

test('SDK bridge uses seconds, serializes actual function/JSON arguments, and cleans up', async () => {
  const { host, calls } = harness();
  let saved;
  const source = host.wrapSource({ async search() {
    saved = await host.WebViewPage.create({ timeout: 25 });
    await saved.goto(url, { waitUntil: 'domcontentloaded', timeout: 20 });
    const fn = runInNewContext('(async (expected, options) => ({ url: location.href, expected, options }))');
    return saved.evaluate(fn, url, { n: 1 });
  } });
  await source.search();
  assert.deepEqual(calls.map(call => call.path), ['/v1', '/webview/goto', '/webview/evaluate', '/v1']);
  assert.equal(calls[0].body.cmd, 'sessions.create');
  assert.equal(calls[1].body.timeout, 20);
  assert.equal(calls[1].body.waitUntil, 'domcontentloaded');
  assert.equal(calls[2].body.timeout, 25);
  assert.match(calls[2].body.script, /location.href/);
  assert.deepEqual(calls[2].body.args, [url, { n: 1 }]);
  assert.equal(calls[3].body.cmd, 'sessions.destroy');
  assert.equal(calls[0].body.session, calls[3].body.session);
  await saved.close();
  assert.equal(calls.length, 4, 'Close must be idempotent');
  await assert.rejects(saved.evaluate(() => 1), /closed/);
  await host.close();
});

test('page creation is method-scoped, single-page, and closes when a source throws', async () => {
  const { host, calls } = harness();
  await assert.rejects(host.WebViewPage.create(), /inside a source method/);
  const source = host.wrapSource({ async search() {
    const page = await host.WebViewPage.create();
    await assert.rejects(host.WebViewPage.create(), /Only one/);
    await assert.rejects(page.evaluate(() => true), /navigate before/);
    assert.throws(() => page.goto('https://example.com'), /unsupported document/);
    assert.throws(() => page.goto(url, { waitUntil: 'networkidle' }), /lifecycle/);
    assert.throws(() => page.goto(url, { timeout: 0 }), /timeout/);
    assert.throws(() => page.evaluateScript('1'), /not implemented/);
    throw new Error('Source failed');
  } });
  await assert.rejects(source.search(), /Source failed/);
  assert.deepEqual(calls.map(call => call.body.cmd), ['sessions.create', 'sessions.destroy']);
});

test('missing browser remains an explicit failure, never a source skip or mock result', async () => {
  const host = createManaTestWebView({ solverURL: '' });
  const source = host.wrapSource({ async search() { return host.WebViewPage.create(); } });
  await assert.rejects(source.search(), /requires the real test-only Chromium helper/);
  for (const value of ['https://127.0.0.1:8191', 'http://example.com', 'http://localhost:8191', 'http://127.0.0.1:8191/?token=x']) {
    assert.throws(() => createManaTestWebView({ solverURL: value }), /loopback/);
  }
});

for (const code of ['captcha', 'security']) test(`${code} stops later operations without logging upstream secrets`, async () => {
  const { host, calls } = harness(path => path === '/webview/goto'
    ? Response.json({ error: 'SECRET-cookie-and-token', code, reason: 'SECRET-reason' }, { status: 409 }) : undefined);
  const source = host.wrapSource({ async search() {
    const page = await host.WebViewPage.create();
    await page.goto(url);
  } });
  await assert.rejects(source.search(), error => !error.message.includes('SECRET') && /stopped/.test(error.message));
  assert.equal(calls.at(-1).body.cmd, 'sessions.destroy');
  const count = calls.length;
  await assert.rejects(source.search(), /stopped/);
  assert.equal(calls.length, count);
});

test('failed WebView operations expose only fixed phase/reason enums and never retry', async () => {
  for (const payload of [
    { code: 'operation', phase: 'goto', reason: 'driver-frame-changed' },
    { code: 'operation', phase: 'evaluate', reason: 'evaluation-error' },
    { code: 'operation', phase: 'evaluate', reason: 'render-readiness-timeout' },
    { code: 'operation', phase: 'SECRET-url', reason: 'SECRET-token' },
    { code: 'SECRET-code', phase: 'goto', reason: 'navigation-error' },
  ]) {
    const { host, calls } = harness(path => path === '/webview/goto'
      ? Response.json({ ...payload, error: 'SECRET-body' }, { status: 502 }) : undefined);
    const source = host.wrapSource({ async search() {
      const page = await host.WebViewPage.create();
      await page.goto(url);
    } });
    await assert.rejects(source.search(), error => {
      assert(!error.message.includes('SECRET'));
      if (payload.reason === 'driver-frame-changed') assert.match(error.message, /goto: driver-frame-changed/);
      if (payload.reason === 'evaluation-error') assert.match(error.message, /evaluate: evaluation-error/);
      if (payload.reason === 'render-readiness-timeout') assert.match(error.message, /evaluate: render-readiness-timeout/);
      if (payload.reason === 'SECRET-token') assert.match(error.message, /unknown: unknown/);
      return true;
    });
    assert.equal(calls.filter(call => call.path === '/webview/goto').length, 1);
    assert.equal(calls.at(-1).body.cmd, 'sessions.destroy');
    await host.close();
  }
});

test('Python operation diagnostics classify known failures without exposing raw exceptions', () => {
  const program = `import ast, pathlib, sys
tree = ast.parse(pathlib.Path(sys.argv[1]).read_text())
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'operation_failure_reason']
exec(compile(ast.Module(body=nodes, type_ignores=[]), sys.argv[1], 'exec'))
assert operation_failure_reason(TimeoutError('WebView navigation timed out')) == 'navigation-timeout'
assert operation_failure_reason(TimeoutError('SECRET')) == 'operation-timeout'
for message, expected in [('WebView document identity changed', 'document-identity-changed'),
 ('WebView navigation failed', 'navigation-error'), ('WebView evaluation failed', 'evaluation-error'),
 ('WebView callback rejected', 'callback-rejected'), ('WebView callback invalid', 'callback-invalid'),
 ('WebView render readiness timeout', 'render-readiness-timeout'), ('WebView serialization failed', 'serialization-error'),
 ('SECRET body url token', 'invalid-operation')]:
 assert operation_failure_reason(ValueError(message)) == expected
for name, expected in [('TimeoutException', 'driver-timeout'),
 ('StaleElementReferenceException', 'driver-element-changed'), ('NoSuchFrameException', 'driver-frame-changed'),
 ('NoSuchWindowException', 'driver-window-closed'), ('InvalidSessionIdException', 'driver-session-lost'),
 ('JavascriptException', 'driver-script-error'), ('WebDriverException', 'driver-error'),
 ('SECRET exception class', 'unexpected-error')]:
 error = type(name, (Exception,), {})('SECRET body url token')
 assert operation_failure_reason(error) == expected
assert operation_failure_reason(RuntimeError('SECRET')) == 'unexpected-error'
print('Fixed failure diagnostics passed')`;
  const result = spawnSync('python3', ['-c', program, fileURLToPath(new URL('./flaresolverr/webview_page.py', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('wrong identity, malformed results and uncertain creation fail closed and destroy sessions', async () => {
  for (const failAt of ['/v1', '/webview/goto', '/webview/evaluate']) {
    const { host, calls } = harness((path, body) => {
      if (path !== failAt || body.cmd === 'sessions.destroy') return;
      if (failAt === '/v1') throw new Error('SECRET: response lost');
      return Response.json({ ready: true, url: 'https://other.test', value: 'incorrect' });
    });
    const source = host.wrapSource({ async search() {
      const page = await host.WebViewPage.create();
      await page.goto(url);
      return page.evaluate(() => document.title);
    } });
    await assert.rejects(source.search(), error => !error.message.includes('SECRET'));
    assert.equal(calls.at(-1).body.cmd, 'sessions.destroy');
    assert.equal(calls.filter(call => call.body.cmd === 'sessions.create').length, 1);
  }
});

test('late creation after method completion or host close is destroyed exactly once', async () => {
  for (const finish of ['method', 'host']) {
    let release, creation;
    const gate = new Promise(resolve => { release = resolve; });
    const { host, calls } = harness(async (path, body) => {
      if (body.cmd === 'sessions.create') await gate;
    });
    const source = host.wrapSource({ async search() {
      creation = host.WebViewPage.create();
      creation.catch(() => {});
      if (finish === 'host') await creation;
    } });
    const method = source.search();
    method.catch(() => {});
    await new Promise(resolve => setImmediate(resolve));
    const shutdown = finish === 'host' ? host.close() : undefined;
    release();
    await assert.rejects(creation, /already finished/);
    if (finish === 'host') await assert.rejects(method, /already finished/);
    else await method;
    await shutdown;
    await host.close();
    assert.deepEqual(calls.map(call => call.body.cmd), ['sessions.create', 'sessions.destroy']);
  }
});

test('overlapping methods cannot create two pages on the same source', async () => {
  const { host, calls } = harness();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const source = host.wrapSource({ async search(wait) {
    await host.WebViewPage.create();
    if (wait) await gate;
  } });
  const first = source.search(true);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(source.search(false), /Only one WebView/);
  assert.equal(calls.filter(call => call.body.cmd === 'sessions.create').length, 1);
  release(); await first;
});

test('wrapping SDK entrypoints preserves synchronous internal helper types and identity', async () => {
  const { host, calls } = harness();
  const raw = { label: 'native', searchURL() { return url; }, allowed() { return false; },
    highlight() { return { title: this.label }; }, async search() { return this.searchURL(); } };
  const source = host.wrapSource(raw);
  assert.equal(source.searchURL, raw.searchURL);
  assert.equal(source.searchURL(), url);
  assert.equal(source.allowed(), false);
  assert.deepEqual(source.highlight(), { title: 'native' });
  assert.equal(await source.search(), url);
  assert.equal(calls.length, 0);
});

test('actual browser bridge awaits promises, preserves JSON and rejects lossy values without invoking serializers', async () => {
  const extract = spawnSync('python3', ['-c', `import ast, json, pathlib, sys
tree = ast.parse(pathlib.Path(sys.argv[1]).read_text())
print(json.dumps(next(n.value.value for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'EVALUATE_SCRIPT' for t in n.targets))))`,
  fileURLToPath(new URL('./flaresolverr/webview_page.py', import.meta.url))], { encoding: 'utf8' });
  assert.equal(extract.status, 0, extract.stderr);
  const script = JSON.parse(extract.stdout);
  async function run(fn, args = []) {
    return new Promise(resolve => {
      const context = { location: { href: url }, TextEncoder, payload: { script: fn, url, args }, done: resolve };
      runInNewContext(`(function () { ${script} })(payload, done)`, context);
    });
  }
  assert.deepEqual(JSON.parse((await run('async (...args) => ({ args, browser: typeof location })', [1, null])).encoded),
    { args: [1, null], browser: 'object' });
  for (const fn of ['() => undefined', '() => NaN', '() => new Date()', '() => [undefined]',
    '() => { const x = {}; x.x = x; return x; }', '() => { throw new Error("SECRET"); }']) {
    assert.equal((await run(fn)).error, 'WebView evaluation failed');
  }
  for (const [fn, expected] of [
    ['() => undefined', 'serialization-error'],
    ['() => { throw new Error("SECRET"); }', 'callback-rejected'],
    ['async () => { throw new Error("SECRET"); }', 'callback-rejected'],
    ['async () => { throw new Error("Marumaru rendered content did not become ready"); }', 'render-readiness-timeout'],
    ['() => { throw { get message() { throw new Error("getter must not execute"); } }; }', 'callback-rejected'],
    ['() => { throw new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("SECRET-trap"); } }); }', 'callback-rejected'],
    ['() => { location.href = "SECRET-url"; return 1; }', 'document-identity-changed'],
    ['not valid syntax', 'callback-invalid'],
  ]) {
    const result = await run(fn);
    assert.equal(result.reason, expected);
    assert(!JSON.stringify(result).includes('SECRET'));
  }
  assert.equal((await run('() => Object.setPrototypeOf([1, 2], {toJSON() {throw new Error("must not run")}})')).encoded, '[1,2]');
});

test('Python navigation honors lifecycle, repeat navigation, passive reloads and sticky security gates', () => {
  const program = `import ast, math, pathlib, re, sys
from urllib.parse import parse_qsl, urlparse
from types import SimpleNamespace
tree = ast.parse(pathlib.Path(sys.argv[1]).read_text())
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in {'assert_document_url', 'operation_timeout', 'navigate'}]
exec(compile(ast.Module(body=nodes, type_ignores=[]), sys.argv[1], 'exec'))
class BrowserGate(Exception): pass
def assert_browser_safety(driver, allow_startup=False):
 if driver.state.get('gate'): raise BrowserGate(driver.state['gate'])
 if driver.current_url.startswith('chrome:') and not (allow_startup and driver.current_url in ('chrome://newtab/', 'chrome://new-tab-page/')): raise BrowserGate('security')
class Driver:
 def __init__(self, states, error=None):
  self.states, self.index, self.error, self.started = states, 0, error, False
 @property
 def state(self): return self.states[self.index]
 @property
 def current_url(self): return self.state['url']
 @property
 def title(self): return self.state.get('title', 'Test document')
 @property
 def page_source(self): return '<html></html>'
 def execute_cdp_cmd(self, cmd, args):
  if cmd == 'Page.navigate':
   self.started = True
   return {'errorText': self.error} if self.error else {'loaderId': 'requested'}
  return {'frameTree': {'frame': {'loaderId': self.state['loader']}}}
 def execute_script(self, script): return self.state.get('ready', 'complete')
 def sleep(self, delay):
  self.index = min(self.index + 1, len(self.states) - 1)
  self.clock += delay
def run(states, wait='load', error=None, initial=False):
 global time
 d = Driver(states, error); d.clock = 0
 time = SimpleNamespace(monotonic=lambda: d.clock, sleep=d.sleep)
 return navigate(d, '${url}', wait, 0.5, allow_startup=initial)
old = {'url': 'https://marumaru105.com/manhwa', 'loader': 'old'}
new = {'url': '${url}', 'loader': 'requested'}
assert run([old, new])['ready']
startup = {'url': 'chrome://newtab/', 'loader': 'blank'}
assert run([startup, new], initial=True)['ready']
try: run([startup, {**new, 'title': 'Just a moment...'}, startup], initial=True)
except BrowserGate: pass
else: raise AssertionError('Startup allowance survived document commit')
assert run([{'url': '${url}', 'loader': 'old'}, new])['ready']
assert run([old, {**new, 'title': 'Just a moment...'}, {**new, 'loader': 'after-challenge'}])['ready']
# A fast passive reload can finish between polls, so observe a different committed
# loader at the exact URL rather than requiring an already-superseded loader.
assert run([old, {**new, 'loader': 'already-cleared'}])['ready']
assert run([old, {**new, 'ready': 'interactive'}], 'domcontentloaded')['ready']
assert run([old, {**new, 'ready': 'interactive'}, new], 'load')['ready']
for states in [[old, {**new, 'url': 'https://other.test'}], [old]]:
 try: run(states)
 except (ValueError, TimeoutError): pass
 else: raise AssertionError('Wrong/unchanged navigation passed')
for gate in ['captcha', 'security']:
 try: run([old, {**new, 'gate': gate}])
 except BrowserGate: pass
 else: raise AssertionError('Browser gate was not preserved')
try: run([old], error='net::ERR_CERT_AUTHORITY_INVALID')
except BrowserGate: pass
else: raise AssertionError('Certificate failure did not stop the browser')
print('Navigation state assertions passed')`;
  const result = spawnSync('python3', ['-c', program, fileURLToPath(new URL('./flaresolverr/webview_page.py', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('only exact benign startup tabs may pass the initial check; real security/CAPTCHA markers still stop', () => {
  const program = `import ast, pathlib, sys
from urllib.parse import urlparse
tree = ast.parse(pathlib.Path(sys.argv[1]).read_text())
nodes = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name == 'assert_browser_safety') or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in {'CAPTCHA_SCRIPT', 'CHALLENGE_FRAMES'} for t in n.targets))]
exec(compile(ast.Module(body=nodes, type_ignores=[]), sys.argv[1], 'exec'))
class BrowserGate(Exception): pass
class Driver:
 def __init__(self, url, title='New Tab', body='', captcha=False):
  self.current_url, self.title, self.page_source, self.captcha = url, title, body, captcha
 def execute_script(self, script): return self.captcha
 def find_elements(self, *args): return []
for url in ['chrome://newtab/', 'chrome://new-tab-page/']:
 assert_browser_safety(Driver(url), allow_startup=True)
 try: assert_browser_safety(Driver(url))
 except BrowserGate: pass
 else: raise AssertionError('Startup allowance leaked beyond initial navigation')
 for d in [Driver(url, title='Privacy error'), Driver(url, body='net::ERR_CERT_AUTHORITY_INVALID'), Driver(url, captcha=True)]:
  try: assert_browser_safety(d, allow_startup=True)
  except BrowserGate: pass
  else: raise AssertionError('Startup allowance bypassed actual warning')
for url in ['chrome://newtab/?x=1', 'chrome://newtab/#x', 'chrome://newtab/unsafe', 'chrome://newtab.evil/', 'chrome://interstitials/', 'chrome-error://chromewebdata/']:
 try: assert_browser_safety(Driver(url), allow_startup=True)
 except BrowserGate: pass
 else: raise AssertionError('Unsafe internal page accepted')
assert_browser_safety(Driver('about:blank'))
print('Startup and negative safety assertions passed')`;
  const result = spawnSync('python3', ['-c', program, fileURLToPath(new URL('./flaresolverr/browser_request.py', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
