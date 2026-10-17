import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { createManaTestWebView } from './mana-test-webview.mjs';

const require = createRequire(import.meta.url);
const url = 'https://marumaru105.com/manhwa/17155';

test('actual new toolchain helpers execute lowered asynchronous WebView functions in the isolated browser realm', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mana-webview-prelude-'));
  try {
    const source = join(root, 'src'), temp = join(root, 'compiled');
    mkdirSync(source);
    // Infrastructure-only callbacks, compiled by the exact installed toolchain.
    // These do not substitute for any live provider test or source parser.
    writeFileSync(join(source, 'index.ts'), `export class Target {
      callbacks() { return [async (n: number) => { await Promise.resolve(); return n + 1 },
        async () => { const out = []; for await (const n of (async function* () { yield 3; yield 4 })()) out.push(n); return out },
        async () => { await Promise.resolve(); throw new Error('SECRET') }]; }
    }`);
    const platform = `@mana-app/dev-${process.platform}-${process.arch}`;
    const executable = join(dirname(require.resolve(`${platform}/package.json`)), `mana-watcher${process.platform === 'win32' ? '.exe' : ''}`);
    const built = spawnSync(executable, ['-source', source, '-temp', temp, '-output', join(root, 'dist'), '-target', 'esnext', '-minify=false'], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(built.status, 0, built.stderr);
    const files = readdirSync(temp).filter(file => file.endsWith('.js'));
    assert.equal(files.length, 1, 'Toolchain failed to emit exactly one fixture');
    const context = {};
    runInNewContext(readFileSync(join(temp, files[0]), 'utf8'), context);
    const prelude = context.__manaSerializedFunctionPrelude;
    assert(typeof prelude === 'string' && prelude.includes('__async'));
    const callbacks = new context.Target().callbacks().map(fn => Function.prototype.toString.call(fn));
    assert(callbacks.every(fn => fn.includes('__async')), 'Callbacks must actually be lowered');
    const extract = spawnSync('python3', ['-c', `import ast,json,pathlib,sys
x=ast.parse(pathlib.Path(sys.argv[1]).read_text())
print(json.dumps(next(n.value.value for n in x.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='EVALUATE_SCRIPT' for t in n.targets))))`, fileURLToPath(new URL('./flaresolverr/webview_page.py', import.meta.url))], { encoding: 'utf8' });
    assert.equal(extract.status, 0, extract.stderr);
    const bridge = JSON.parse(extract.stdout);
    const invoke = (script, helpers = prelude) => new Promise(resolve => {
      const browser = { location: { href: url }, TextEncoder, payload: { url, script, prelude: helpers, args: [4] }, done: result => resolve({ result, browser }) };
      runInNewContext(`(function () { ${bridge} })(payload, done)`, browser);
    });
    assert.equal(JSON.parse((await invoke(callbacks[0])).result.encoded), 5);
    assert.deepEqual(JSON.parse((await invoke(callbacks[1])).result.encoded), [3, 4]);
    const rejected = (await invoke(callbacks[2])).result;
    assert.equal(rejected.reason, 'callback-rejected');
    assert(!JSON.stringify(rejected).includes('SECRET'));
    assert.equal((await invoke(callbacks[0], '')).result.reason, 'callback-reference-error');
    assert.equal((await invoke(callbacks[0])).browser.__async, undefined, 'Helpers must not leak into page globals');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('WebView helper snapshots stay bound to the originating source and remain bounded', async () => {
  const seen = [];
  const host = createManaTestWebView({ solverURL: 'http://127.0.0.1:8191', fetchImpl: async (target, init) => {
    const body = JSON.parse(init.body), path = new URL(target).pathname;
    if (path === '/webview/evaluate') seen.push(body.prelude);
    return Response.json(path === '/v1' ? { status: 'ok' } : path === '/webview/goto' ? { ready: true, url: body.url } : { url: body.url, value: null });
  } });
  const make = prelude => host.wrapSource({ async search() {
    const page = await host.WebViewPage.create();
    await page.goto(url); return page.evaluate(() => null);
  } }, { serializedFunctionPrelude: prelude });
  try {
    await make('var helper = 1;').search(); await make('var helper = 2;').search();
    assert.deepEqual(seen, ['var helper = 1;', 'var helper = 2;']);
    for (const bad of [null, {}, 'x'.repeat(128 * 1024 + 1)]) assert.throws(() => make(bad), /prelude/);
  } finally { await host.close(); }
});

test('the real Python evaluate route accepts the Node prelude payload and rejects expanded or malformed contracts', async () => {
  let payload;
  const host = createManaTestWebView({ solverURL: 'http://127.0.0.1:8191', fetchImpl: async (target, init) => {
    const body = JSON.parse(init.body), path = new URL(target).pathname;
    if (path === '/webview/evaluate') payload = body;
    return Response.json(path === '/v1' ? { status: 'ok' } : path === '/webview/goto' ? { ready: true, url: body.url } : { url: body.url, value: null });
  } });
  try {
    const source = host.wrapSource({ async search() {
      const page = await host.WebViewPage.create(); await page.goto(url); return page.evaluate(() => null);
    } }, { serializedFunctionPrelude: 'var __routeHelper = 1;' });
    await source.search();
  } finally { await host.close(); }
  const program = `import ast,contextlib,json,pathlib,sys,types
tree=ast.parse(pathlib.Path(sys.argv[1]).read_text())
tree.body=[n for n in tree.body if not (isinstance(n,ast.ImportFrom) and n.module in ('bottle','browser_request'))]
class BrowserGate(Exception): pass
request=types.SimpleNamespace(json=None,path='/webview/evaluate')
response=types.SimpleNamespace(status=200)
routes={}
class App:
 def hook(self,name): return lambda fn: fn
 def post(self,path):
  def register(fn): routes[path]=fn; return fn
  return register
class Driver:
 calls=0
 def set_script_timeout(self,seconds): assert 0<seconds<=120
 def execute_async_script(self,script,value):
  assert value['prelude']=='var __routeHelper = 1;'
  assert 'payload.prelude' in script
  self.calls+=1
  return {'url':self.current_url,'encoded':'true'}
driver=Driver()
def session_driver(session): return driver
def session_lock(session): return contextlib.nullcontext()
def assert_browser_safety(driver,**kwargs): pass
exec(compile(tree,sys.argv[1],'exec'))
register(App())
payload=json.load(sys.stdin); driver.current_url=payload['url']
request.json=payload
assert routes['/webview/evaluate']()=={'url':payload['url'],'value':True}
assert driver.calls==1 and response.status==200
missing=dict(payload); del missing['prelude']
for invalid in [missing,dict(payload,unknown='not allowed'),dict(payload,prelude=None),dict(payload,prelude='x'*(128*1024+1)),dict(payload,prelude='é'*(64*1024+1))]:
 request.json=invalid; response.status=200
 result=routes['/webview/evaluate']()
 assert response.status==502 and result['code']=='operation' and result['phase']=='evaluate'
 assert driver.calls==1
print('route contract verified')`;
  const result = spawnSync('python3', ['-c', program, fileURLToPath(new URL('./flaresolverr/webview_page.py', import.meta.url))], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /route contract verified/);
});
