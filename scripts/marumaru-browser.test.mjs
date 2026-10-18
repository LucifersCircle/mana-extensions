import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertPublicMarumaruRequest } from './mana-runtime.mjs';
import { createManaTestTransport } from './mana-test-browser.mjs';

const origin = 'https://marumaru105.com';
const detail = `${origin}/api/works/17155`;
const headers = { accept: 'application/json', 'x-site': 'marumaru', referer: `${origin}/` };
const catalog = `${origin}/api/works?mediaType=MANHWA&page=0&size=49`;
const search = `${origin}/api/search?q=${encodeURIComponent('라멘 아카네코')}&page=0&media=MANHWA&sort=LATEST`;
const reader = 'https://api.storagewebtoon.store/api/v1/reader/A2/works/17155';
const valid = [detail, catalog, search, search.replace('page=0', 'page=1'), reader,
  reader.replace('works/17155', 'episodes/21333')].map(url => ({ url, method: 'GET' }));
const invalid = [
  detail.replace('https:', 'http:'), detail.replace('marumaru105.com', 'other.invalid'),
  detail.replace('marumaru105.com', 'marumaru105.com:443'), detail.replace('https://', 'https://user:password@'),
  `${detail}?token=secret`, `${detail}#`, `${detail}#fragment`, `${detail}/`, `${detail}\n`, `\n${detail}`,
  detail.replace('/api/', '/a/../api/'), detail.replace('/api/', '/%61pi/'), detail.replace('17155', '0'),
  detail.replace('17155', '017155'), detail.replace('17155', '1١'), `${origin}/api/account`, `${origin}/api/works/17155/purchase`,
  `${origin}/manhwa/17155`, `${origin}/api/works?mediaType=WEBTOON&page=0&size=49`,
  `${catalog}&page=1`, `${catalog}&account=1`, search.replace('q=', 'q=one&q='),
  search.replace('page=0', 'page=-1'), search.replace('sort=LATEST', 'sort=UNKNOWN'),
  reader.replace('/A2/', '/OTHER/'), `${reader}?token=secret`, reader.replace('/works/', '/account/'),
  reader.replace('https:', 'http:'), reader.replace('17155', '0'), reader.replace('https://', 'https://user:password@'),
  'https://peer.storagewebtoon.store/api/media/episode/123/1.webp',
].map(url => ({ url, method: 'GET' }));
invalid.push(...['POST', 'PUT', 'DELETE', 'HEAD'].map(method => ({ url: detail, method })),
  { url: detail, method: 'GET', body: 'unexpected' });

test('Node and Python browser boundaries accept only the public Marumaru catalog/reader GET routes', () => {
  valid.forEach(request => assert.doesNotThrow(() => assertPublicMarumaruRequest(request)));
  invalid.forEach(request => assert.throws(() => assertPublicMarumaruRequest(request), undefined, request.url));
  const program = `import ast, json, pathlib, re, sys
from urllib.parse import urlparse
tree = ast.parse(pathlib.Path(sys.argv[1]).read_text())
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in {'assert_public_request', 'assert_public_marumaru_request'}]
exec(compile(ast.Module(body=nodes, type_ignores=[]), sys.argv[1], 'exec'))
result = []
for request in json.load(sys.stdin):
 try:
  assert_public_marumaru_request(request)
  assert_public_request(request)
  result.append(True)
 except (ValueError, TypeError): result.append(False)
print(json.dumps(result))`;
  const result = spawnSync('python3', ['-c', program, fileURLToPath(new URL('./flaresolverr/browser_request.py', import.meta.url))], {
    input: JSON.stringify([...valid, ...invalid]), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [...valid.map(() => true), ...invalid.map(() => false)]);
});

function fixture(reply = payload => ({ status: 200, body: 'public test JSON', url: payload.url })) {
  const calls = [], direct = [];
  const transport = createManaTestTransport({ solverURL: 'http://127.0.0.1:8191', fetchImpl: async (input, init) => {
    const url = new URL(input);
    if (url.hostname !== '127.0.0.1') { direct.push({ input, init }); return new Response('direct image bytes'); }
    const payload = JSON.parse(init.body);
    calls.push({ path: url.pathname, ...payload });
    if (url.pathname === '/v1') return Response.json({ status: 'ok' });
    if (url.pathname === '/browser/warm') return Response.json({ ready: true });
    const result = reply(payload);
    return Response.json(result.error ? result : {
      ...result, encoding: 'base64', body: Buffer.from(result.body).toString('base64'),
      headers: { 'content-type': 'application/json', 'x-test-evidence': 'preserved' },
    });
  } });
  return { calls, direct, transport };
}

test('separate anonymous host sessions reuse their warm-up and leave images direct', async () => {
  const f = fixture();
  try {
    await Promise.all([f.transport.fetch(detail, { headers }), f.transport.fetch(catalog, { headers })]);
    await f.transport.fetch('https://kagane.org/api/v2/genres/list');
    const creates = f.calls.filter(call => call.cmd === 'sessions.create');
    assert.equal(creates.length, 2);
    assert.notEqual(creates[0].session, creates[1].session);
    assert.deepEqual(f.calls.filter(call => call.path === '/browser/warm').map(call => call.site), ['marumaru105.com', 'kagane.org']);
    const marumaru = f.calls.filter(call => call.url?.startsWith(origin));
    assert.equal(marumaru.length, 2);
    assert(marumaru.every(call => call.session === creates[0].session && call.method === 'GET' && call.body === null));
    assert(marumaru.every(call => call.headers['x-site'] === 'marumaru'));
    await f.transport.fetch(reader, { headers: { accept: 'application/json', referer: `${origin}/` } });
    const readerCall = f.calls.find(call => call.url === reader);
    assert(readerCall && !creates.some(call => call.session === readerCall.session));
    assert.equal(readerCall.headers['x-site'], undefined);
    for (const url of ['https://peer.storagewebtoon.store/manhwa/17155/cover.dat',
      'https://peer.storagewebtoon.store/api/media/episode/123/1.webp']) {
      await f.transport.fetch(url, { headers: { referer: `${origin}/` } });
    }
    assert.equal(f.direct.length, 2);
  } finally { await f.transport.close(); }
  assert.equal(f.calls.filter(call => call.cmd === 'sessions.destroy').length, 3);
  await assert.rejects(f.transport.fetch(detail, { headers }), /closed/);
});

test('HTTP failures and Cloudflare responses retain the exact status, headers and bytes', async () => {
  for (const status of [200, 403, 406, 503]) {
    const body = status === 200 ? '{"work":{"id":17155}}' : 'test-only real-status placeholder';
    const f = fixture(payload => ({ status, body, url: payload.url }));
    try {
      const result = await f.transport.fetch(detail, { headers });
      assert.equal(result.status, status);
      assert.equal(result.url, detail);
      assert.equal(result.headers.get('x-test-evidence'), 'preserved');
      assert.equal(await result.text(), body);
    } finally { await f.transport.close(); }
  }
});

test('unsupported routes, credentials and cross-site headers fail before helper I/O', async () => {
  const f = fixture();
  for (const request of invalid.filter(request => new URL(request.url).hostname === 'marumaru105.com')) {
    await assert.rejects(f.transport.fetch(request.url, { ...request, headers }));
  }
  for (const extra of [{ authorization: 'secret' }, { cookie: 'secret' }, { 'x-integrity-token': 'secret' }, { 'x-site': 'other' }]) {
    await assert.rejects(f.transport.fetch(detail, { headers: { ...headers, ...extra } }));
  }
  await assert.rejects(f.transport.fetch(reader, { headers }));
  await assert.rejects(f.transport.fetch(detail));
  assert.equal(f.calls.length, 0);
  await f.transport.close();
});

test('CAPTCHA and security stops remain sticky and still destroy the anonymous session', async () => {
  for (const code of ['captcha', 'security']) {
    const f = fixture(() => ({ error: 'Do not log provider details', code }));
    await assert.rejects(f.transport.fetch(detail, { headers }), /CAPTCHA|security/);
    const count = f.calls.length;
    await assert.rejects(f.transport.fetch(catalog, { headers }), /CAPTCHA|security/);
    assert.equal(f.calls.length, count);
    await f.transport.close();
    assert.equal(f.calls.filter(call => call.cmd === 'sessions.destroy').length, 1);
  }
});

test('without explicit FlareSolverr opt-in the native transport is used unchanged', async () => {
  const response = new Response('native failure', { status: 406 });
  const transport = createManaTestTransport({ solverURL: '', fetchImpl: async () => response });
  assert.equal(await transport.fetch(detail, { headers }), response);
  await transport.close();
});
