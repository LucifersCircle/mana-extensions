// Infrastructure-only fake-driver checks. These do not count as source/live image proof.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const helper = fileURLToPath(new URL('./flaresolverr/image_response.py', import.meta.url));
const setup = String.raw`
import base64, importlib.util, json, math, pathlib, re, sys, types
from contextlib import nullcontext
sys.dont_write_bytecode = True
bottle = types.ModuleType('bottle')
bottle.request = types.SimpleNamespace(json=None)
bottle.response = types.SimpleNamespace(status=200)
sys.modules['bottle'] = bottle
browser = types.ModuleType('browser_request')
class BrowserGate(Exception):
 def __init__(self, code, reason=None): self.code, self.reason = code, reason
browser.BrowserGate = BrowserGate
safety_calls = []
def safety(driver, allow_startup=False):
 safety_calls.append(allow_startup)
 if driver.gate: raise BrowserGate(driver.gate)
 if driver.current_url.startswith('chrome:') and not allow_startup: raise BrowserGate('security')
browser.assert_browser_safety = safety
browser.session_driver = lambda session: active_driver
browser.session_lock = lambda session: nullcontext()
sys.modules['browser_request'] = browser
webview = types.ModuleType('webview_page')
webview.NAVIGATED = set()
def assert_document(driver, expected):
 safety(driver)
 if driver.current_url != expected: raise ValueError('WebView document identity changed')
webview.assert_document = assert_document
def navigate(driver, url, wait, timeout, allow_startup=False):
 safety(driver, allow_startup)
 assert wait == 'domcontentloaded' and 0 < timeout <= 120
 driver.navigations.append(url)
 driver.current_url = url
 if driver.navigate_hook: driver.navigate_hook(driver)
webview.navigate = navigate
def operation_timeout(value):
 if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= 120: raise ValueError('timeout')
 return value
webview.operation_timeout = operation_timeout
# Use the real shared fixed-enum classifier without importing Selenium/Bottle.
import ast
webview_path = pathlib.Path(sys.argv[1]).with_name('webview_page.py')
tree = ast.parse(webview_path.read_text())
classifier = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'operation_failure_reason')
exec(compile(ast.Module(body=[classifier], type_ignores=[]), str(webview_path), 'exec'), webview.__dict__)
sys.modules['webview_page'] = webview
spec = importlib.util.spec_from_file_location('image_capture', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
url = 'https://peer.storagewebtoon.store/manhwa/17155/cover.webp'
page = 'https://marumaru105.com/manhwa/17155'
body = base64.b64encode(b'RIFF\x12\x00\x00\x00WEBPVP8 actual-test-bytes').decode()
def event(method, **params):
 return {'message': json.dumps({'message': {'method': method, 'params': params}})}
def events(target=url, rid='image-1', status=200, mime='image/webp', headers=None):
 return [event('Network.requestWillBeSent', requestId=rid, documentURL=page, type='Image', request={'url': target, 'method': 'GET'}),
  event('Network.responseReceived', requestId=rid, type='Image', response={
   'url': target, 'status': status, 'mimeType': mime, 'headers': headers or {'Content-Type': mime}}),
  event('Network.loadingFinished', requestId=rid, encodedDataLength=100)]
def fail(fn, cls=ValueError):
 try: fn()
 except cls: return
 raise AssertionError('expected ' + cls.__name__)
class Driver:
 def __init__(self, batches=None):
  self.current_url, self.title, self.page_source = 'chrome://newtab/', 'Title', '<html></html>'
  self.gate, self.navigate_hook, self.body_hook = None, None, None
  self.navigations, self.commands = [], []
  self.batches = [[], events()] if batches is None else batches
  self.hero = {'url': url, 'complete': True, 'width': 200, 'height': 300}
  self.body = {'body': body, 'base64Encoded': True}
 def execute_script(self, script):
  assert script == module.HERO_SCRIPT
  return self.hero
 def get_log(self, kind):
  assert kind == 'performance'
  return self.batches.pop(0) if self.batches else []
 def execute_cdp_cmd(self, method, args):
  self.commands.append((method, args))
  if method == 'Network.enable': return {}
  assert method == 'Network.getResponseBody'
  assert args == {'requestId': 'image-1'}
  if self.body_hook: self.body_hook(self)
  if isinstance(self.body, Exception): raise self.body
  return self.body
class Clock:
 def __init__(self): self.now = 0
 def monotonic(self): return self.now
 def sleep(self, seconds): self.now += seconds
module.time = Clock()
def capture(driver, session='test-session', timeout=1):
 return module.capture_image(driver, {'session': session, 'url': url, 'timeout': timeout})
`;

function python(program) {
  const result = spawnSync('python3', ['-c', setup + '\n' + program, helper], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('Python cover routes reject aliases, nonpositive IDs, dot segments and non-cover endpoints', () => {
  python(String.raw`
for prefix in ['manhwa', 'webtoon']:
 assert module.title_page(url.replace('/manhwa/', '/' + prefix + '/')) == page
for bad in [None, 123, '', url + '?x=1', url + '#', url + '\n', '\n' + url,
 url.replace('https:', 'http:'), url.replace('peer.', 'user:pass@peer.'),
 url.replace('.store/', '.store:443/'), url.replace('peer.', 'PEER.'),
 url.replace('/manhwa/', '/a/../manhwa/'), url.replace('/manhwa/', '/%6danhwa/'),
 url.replace('/17155/', '/0/'), url.replace('/17155/', '/01/'),
 url.replace('/17155/', '/-1/'), url.replace('/17155/', '/1.0/'),
 url.replace('cover.webp', '.'), url.replace('cover.webp', '..'),
 url.replace('cover.webp', '%2e%2e'), url.replace('cover.webp', 'a/b.webp'),
 url.replace('/manhwa/', '/api/media/episode/'), url.replace('cover.webp', 'x\\y.webp')]:
 fail(lambda: module.title_page(bad))
`);
});

test('Python capture proves exact title-page hero network body without image navigation or replay', () => {
  python(String.raw`
driver = Driver([[], events(headers={'Content-Type': 'image/webp', 'Set-Cookie': 'SECRET', 'X-Secret': 'NEVER EXPORT'})])
result = capture(driver)
assert result == {'url': url, 'status': 200, 'contentType': 'image/webp', 'body': body, 'encoding': 'base64'}
assert driver.navigations == [page]
assert [command for command, _ in driver.commands] == ['Network.enable', 'Network.getResponseBody']
assert driver.commands[0][1]['maxResourceBufferSize'] == 16 * 1024 * 1024
assert safety_calls[0] is True
assert safety_calls[-1] is False
assert 'test-session' in webview.NAVIGATED
# A previously used session cannot reallow Chromium startup, even after failure.
driver = Driver()
fail(lambda: capture(driver), BrowserGate)
assert driver.navigations == []
`);
});

test('Python evidence rejects redirects, wrong identity/status/MIME, missing completion and TLS failures', () => {
  python(String.raw`
for index, change in [
 (0, lambda p: p['request'].update(method='POST')),
 (0, lambda p: p['request'].pop('method')),
 (0, lambda p: p['request'].update(urlFragment='#other')),
 (0, lambda p: p.update(type='Fetch')),
 (0, lambda p: p.pop('type')),
 (0, lambda p: p.update(documentURL=page + '?other=1')),
 (0, lambda p: p.pop('documentURL')),
 (1, lambda p: p['response'].update(status=403)),
 (1, lambda p: p['response'].update(status=True)),
 (1, lambda p: p['response'].update(mimeType='text/html')),
 (1, lambda p: p['response'].update(mimeType='image/svg+xml')),
 (1, lambda p: p['response'].update(headers={'cf-mitigated': 'challenge'})),
 (1, lambda p: p['response'].update(headers={'Content-Type': 'text/html'})),
 (1, lambda p: p['response'].update(headers={})),
 (1, lambda p: p['response'].update(headers={'Content-Type': 'image/webp', 'content-type': 'image/webp'})),
 (1, lambda p: p['response'].update(headers={'Content-Type': 'image/webp; foo=1\nimage/webp'})),
 (1, lambda p: p['response'].update(url=url + '?new=1')),
 (1, lambda p: p['response'].update(fromServiceWorker=True)),
 (1, lambda p: p.update(type='Fetch')),
 (1, lambda p: p.update(requestId='another')),
 (2, lambda p: p.update(encodedDataLength=module.MAX_BYTES + 1)),
 (2, lambda p: p.update(encodedDataLength=float('inf'))),
]:
 entries = events()
 message = json.loads(entries[index]['message'])
 change(message['message']['params'])
 entries[index]['message'] = json.dumps(message)
 fail(lambda: module.ImageEvidence(url).observe(entries))
for redirect in [
 event('Network.requestWillBeSent', requestId='image-1', request={'url': url + '?new=1'}, redirectResponse={'url': url, 'status': 302}),
 event('Network.requestWillBeSent', requestId='image-1', request={'url': url}, redirectResponse={'url': 'https://other.test', 'status': 302}),
]:
 fail(lambda: module.ImageEvidence(url).observe(events()[:1] + [redirect]))
fail(lambda: module.ImageEvidence(url).observe(events()[:1] * 2))
fail(lambda: module.ImageEvidence(url).observe(events() + events(rid='another')))
fail(lambda: module.ImageEvidence(url).observe(events()[1:]))
fail(lambda: module.ImageEvidence(url).observe(events()[:1] + [events()[2]]))
fail(lambda: module.ImageEvidence(url).observe(events()[:1] + [event('Network.loadingFailed', requestId='image-1', errorText='net::ERR_FAILED')]))
fail(lambda: module.ImageEvidence(url).observe(events()[:1] + [event('Network.loadingFailed', requestId='image-1', errorText='net::ERR_CERT_AUTHORITY_INVALID')]), BrowserGate)
entries = events()
message = json.loads(entries[1]['message'])
message['message']['params']['response']['securityState'] = 'broken'
entries[1]['message'] = json.dumps(message)
fail(lambda: module.ImageEvidence(url).observe(entries), BrowserGate)
module.MAX_LOG_BYTES = 10
fail(lambda: module.ImageEvidence(url).observe(events()))
module.MAX_LOG_BYTES = 16 * 1024 * 1024
evidence = module.ImageEvidence(url)
evidence.observe(events()[:2])
assert not evidence.finished
`);
});

test('Python body decoding is canonical, nonempty and byte bounded', () => {
  python(String.raw`
assert module.canonical_body({'body': body, 'base64Encoded': True}) == body
for value in [{}, {'body': body, 'base64Encoded': False}, {'body': '', 'base64Encoded': True},
 {'body': 'YQ==\n', 'base64Encoded': True}, {'body': 'YR==', 'base64Encoded': True},
 {'body': 'not base64', 'base64Encoded': True}, {'body': 123, 'base64Encoded': True}]:
 fail(lambda: module.canonical_body(value))
module.MAX_BYTES = 3
assert module.canonical_body({'body': 'YWJj', 'base64Encoded': True}) == 'YWJj'
fail(lambda: module.canonical_body({'body': 'YWJjZA==', 'base64Encoded': True}))
module.MAX_BYTES = 2
fail(lambda: module.canonical_body({'body': 'YWJj', 'base64Encoded': True}))
`);
});

test('Python capture fails closed on missing decoded hero/body, changed page and safety stops without retry', () => {
  python(String.raw`
for index, change, expected in [
 (0, lambda d: setattr(d, 'hero', None), TimeoutError),
 (1, lambda d: d.hero.update(complete=False), TimeoutError),
 (2, lambda d: d.hero.update(width=0), TimeoutError),
 (3, lambda d: d.hero.update(height=True), TimeoutError),
 (4, lambda d: d.hero.update(url=url + '?new=1'), ValueError),
 (5, lambda d: setattr(d, 'body', RuntimeError('SECRET unavailable cache body')), RuntimeError),
 (6, lambda d: setattr(d, 'body', {'body': '', 'base64Encoded': True}), ValueError),
 (7, lambda d: setattr(d, 'navigate_hook', lambda d: setattr(d, 'current_url', page + '?changed=1')), ValueError),
 (8, lambda d: setattr(d, 'body_hook', lambda d: setattr(d, 'gate', 'captcha')), BrowserGate),
 (9, lambda d: setattr(d, 'body_hook', lambda d: setattr(d, 'gate', 'security')), BrowserGate),
 (10, lambda d: setattr(d, 'body_hook', lambda d: d.hero.update(url=url + '?new=1')), ValueError),
 (11, lambda d: setattr(d, 'navigate_hook', lambda d: setattr(d, 'title', 'Just a moment...')), ValueError),
 (12, lambda d: setattr(d, 'navigate_hook', lambda d: setattr(d, 'gate', 'captcha')), BrowserGate),
 (13, lambda d: setattr(d, 'navigate_hook', lambda d: setattr(d, 'gate', 'security')), BrowserGate),
]:
 driver = Driver()
 change(driver)
 fail(lambda: capture(driver, session='test-' + str(index)), expected)
 assert driver.navigations == [page]
 assert len([cmd for cmd, _ in driver.commands if cmd == 'Network.getResponseBody']) <= 1
for index, entries in enumerate([[], events()[:2], events(target=url.replace('/17155/', '/99999/'))]):
 driver = Driver([[], entries])
 fail(lambda: capture(driver, session='missing-' + str(index)), TimeoutError)
 assert driver.navigations == [page]
 assert [cmd for cmd, _ in driver.commands] == ['Network.enable']
`);
});

test('Python endpoint accepts exactly three fields and never leaks raw failures or network metadata', () => {
  python(String.raw`
class App:
 def __init__(self): self.routes = {}
 def post(self, path):
  def register(fn): self.routes[path] = fn; return fn
  return register
app = App()
module.register(app)
endpoint = app.routes['/webview/image-response']
active_driver = Driver()
for payload in [None, [], {}, {'session': 'test', 'url': url},
 {'session': 'test', 'url': url, 'timeout': 1, 'headers': {}},
 {'session': True, 'url': url, 'timeout': 1}, {'session': 'x/y', 'url': url, 'timeout': 1},
 {'session': 'test', 'url': url, 'timeout': True}, {'session': 'test', 'url': url, 'timeout': 121}]:
 bottle.request.json = payload
 result = endpoint()
 assert result['error'] == 'Anonymous browser image capture failed'
 assert result['code'] == 'operation' and result['phase'] == 'image-capture' and result['stage'] == 'validation'
 assert result['reason'] in ('image-invalid-request', 'invalid-operation')
 assert set(result) == {'error', 'code', 'phase', 'stage', 'reason'}
 assert bottle.response.status == 502
assert active_driver.commands == []
active_driver = Driver()
active_driver.body = RuntimeError('SECRET headers cookies upstream-url')
bottle.request.json = {'session': 'valid', 'url': url, 'timeout': 1}
assert endpoint() == {'error': 'Anonymous browser image capture failed', 'code': 'operation', 'phase': 'image-capture', 'stage': 'body-read', 'reason': 'unexpected-error', 'cdpMimeCategory': 'webp', 'contentTypeCategory': 'webp'}
assert bottle.response.status == 502
active_driver = Driver()
active_driver.gate = 'captcha'
bottle.request.json = {'session': 'another', 'url': url, 'timeout': 1}
assert endpoint() == {'error': 'Browser requires user action', 'code': 'captcha'}
assert bottle.response.status == 409
`);
});

test('Python diagnostics identify each capture stage with fixed enums and never expose driver values', () => {
  python(String.raw`
class WebDriverException(Exception): pass
class App:
 def __init__(self): self.routes = {}
 def post(self, path):
  def register(fn): self.routes[path] = fn; return fn
  return register
app = App()
module.register(app)
endpoint = app.routes['/webview/image-response']
def broken(*args, **kwargs): raise WebDriverException('SECRET URL headers cookies raw performance logs')
original_driver, original_safety = module.session_driver, module.assert_browser_safety
original_page = module.assert_capture_page
for index, (stage, expected_reason) in enumerate([
 ('session-acquisition', 'driver-error'), ('initial-safety', 'driver-error'),
 ('network-enable', 'driver-error'), ('initial-log', 'driver-error'), ('navigation', 'driver-error'),
 ('page-safety', 'driver-error'), ('observation', 'driver-error'), ('hero', 'driver-error'),
 ('body-read', 'driver-error'), ('final-verification', 'document-identity-changed'),
 ('body-validation', 'image-body-unavailable'),
]):
 module.session_driver, module.assert_browser_safety = original_driver, original_safety
 module.assert_capture_page = original_page
 active_driver = Driver()
 if stage == 'session-acquisition': module.session_driver = broken
 elif stage == 'initial-safety': module.assert_browser_safety = broken
 elif stage == 'network-enable': active_driver.execute_cdp_cmd = broken
 elif stage == 'initial-log': active_driver.get_log = broken
 elif stage == 'navigation': active_driver.navigate_hook = broken
 elif stage == 'page-safety': module.assert_capture_page = broken
 elif stage == 'observation':
  calls = []
  def log(kind):
   calls.append(kind)
   return [] if len(calls) == 1 else broken()
  active_driver.get_log = log
 elif stage == 'hero': active_driver.execute_script = broken
 elif stage == 'body-read': active_driver.body = WebDriverException('SECRET body error')
 elif stage == 'final-verification': active_driver.body_hook = lambda driver: setattr(driver, 'current_url', page + '?SECRET')
 elif stage == 'body-validation': active_driver.body = {'body': '', 'base64Encoded': True}
 bottle.request.json = {'session': 'stage-' + str(index), 'url': url, 'timeout': 1}
 result = endpoint()
 expected = {'error': 'Anonymous browser image capture failed', 'code': 'operation',
  'phase': 'image-capture', 'stage': stage, 'reason': expected_reason}
 if stage in ('hero', 'body-read', 'final-verification', 'body-validation'):
  expected.update(cdpMimeCategory='webp', contentTypeCategory='webp')
 assert result == expected, result
 assert bottle.response.status == 502
 assert 'SECRET' not in json.dumps(result)
 assert len(active_driver.navigations) <= 1
 assert len([cmd for cmd, _ in active_driver.commands if cmd == 'Network.getResponseBody']) <= 1
module.session_driver, module.assert_browser_safety = original_driver, original_safety
module.assert_capture_page = original_page
active_driver = Driver([[], []])
bottle.request.json = {'session': 'timeout', 'url': url, 'timeout': 1}
result = endpoint()
assert result['reason'] == 'image-capture-timeout' and result['stage'] in module.CAPTURE_STAGES
# An explicit safety stop takes priority over the original CDP diagnostic.
active_driver = Driver()
active_driver.body = WebDriverException('SECRET body failure')
active_driver.body_hook = lambda driver: setattr(driver, 'gate', 'captcha')
bottle.request.json = {'session': 'gate-after-body', 'url': url, 'timeout': 1}
assert endpoint() == {'error': 'Browser requires user action', 'code': 'captcha'}
assert bottle.response.status == 409
`);
});

test('Python image reason mapping distinguishes response guards and defaults unknown text to safe enums', () => {
  python(String.raw`
for text, reason in module.IMAGE_FAILURE_REASONS.items():
 assert module.image_failure_reason(ValueError(text)) == reason
assert module.image_failure_reason(ValueError('SECRET arbitrary header status or URL')) == 'invalid-operation'
assert module.image_failure_reason(RuntimeError('SECRET body or raw logs')) == 'unexpected-error'
assert module.image_failure_reason(TimeoutError('Browser image capture timed out')) == 'image-capture-timeout'
assert module.image_failure_reason(json.JSONDecodeError('SECRET rawlog', 'SECRET', 0)) == 'image-network-evidence-invalid'
for name, reason in [('WebDriverException', 'driver-error'), ('JavascriptException', 'driver-script-error'),
 ('InvalidSessionIdException', 'driver-session-lost'), ('NoSuchWindowException', 'driver-window-closed'),
 ('TimeoutException', 'driver-timeout')]:
 assert module.image_failure_reason(type(name, (Exception,), {})('SECRET driver text')) == reason
for change, reason in [
 (lambda p: p['response'].update(status=403), 'image-response-forbidden'),
 (lambda p: p['response'].update(status=403, headers={'Cf-Mitigated': '  CHALLENGE  '}), 'image-response-challenge'),
 (lambda p: p['response'].update(status=503), 'image-response-http-status'),
 (lambda p: p['response'].update(fromServiceWorker=True), 'image-response-service-worker'),
 (lambda p: p.update(type='Fetch'), 'image-response-resource-type'),
 (lambda p: p['response'].update(url=url + '?SECRET'), 'image-response-identity'),
 (lambda p: p['response'].update(headers={}), 'image-content-type-missing'),
 (lambda p: p['response'].update(headers={'Content-Type': 'image/png'}), 'image-content-type-mismatch'),
 (lambda p: p['response'].update(headers={'Content-Type': 'image/webp', 'content-type': 'image/webp'}), 'image-content-type-duplicate'),
]:
 entries = events()
 message = json.loads(entries[1]['message'])
 change(message['message']['params'])
 entries[1]['message'] = json.dumps(message)
 try: module.ImageEvidence(url).observe(entries)
 except ValueError as error: assert module.image_failure_reason(error) == reason
 else: raise AssertionError('must retain failure')
for change, reason in [
 (lambda p: p['request'].update(method='POST'), 'image-request-method'),
 (lambda p: p['request'].update(urlFragment='#SECRET'), 'image-request-fragment'),
 (lambda p: p.update(type='Fetch'), 'image-request-resource-type'),
 (lambda p: p.update(documentURL=page + '?SECRET'), 'image-request-document'),
]:
 entries = events()
 message = json.loads(entries[0]['message'])
 change(message['message']['params'])
 entries[0]['message'] = json.dumps(message)
 try: module.ImageEvidence(url).observe(entries)
 except ValueError as error: assert module.image_failure_reason(error) == reason
 else: raise AssertionError('must retain failure')
`);
});

test('Python MIME diagnostics use only closed categories and preserve MIME rejection without reading a body', () => {
  python(String.raw`
for value, expected in [
 ('image/jpeg', 'jpeg'), ('image/jpg', 'jpg'), ('image/png', 'png'), ('image/gif', 'gif'),
 ('image/webp', 'webp'), ('image/avif', 'avif'), ('image/bmp', 'bmp'), ('image/x-icon', 'icon'),
 ('image/vnd.microsoft.icon', 'icon'), ('application/octet-stream', 'octet-stream'),
 ('binary/octet-stream', 'binary-octet-stream'), ('chemical/x-xyz', 'chemical-xyz'),
 ('image/xyz', 'image-xyz'), ('application/xyz', 'application-xyz'), ('application/x-xyz', 'application-x-xyz'),
 ('text/plain', 'text'), ('text/html', 'html'), ('application/json', 'json'),
 ('application/problem+json', 'json'), ('application/SECRET', 'other'),
 (None, 'missing'), ({'SECRET': 'not a MIME'}, 'invalid'), ('SECRET\r\nvalue', 'invalid'),
 ('', 'invalid'), ('image/png,image/jpeg', 'invalid'), ('  IMAGE/JPEG; SECRET=value  ', 'jpeg'),
]:
 assert module.mime_category(value) == expected
 assert module.mime_category(value) in module.MIME_CATEGORIES
assert module.content_type_category({}) == 'missing'
assert module.content_type_category({'Content-Type': 'image/jpeg', 'content-type': 'image/jpeg'}) == 'duplicate'
assert module.content_type_category({'Content-Type': None}) == 'invalid'
assert module.content_type_category({'CoNtEnT-TyPe': 'image/png; SECRET=value', 'Set-Cookie': 'SECRET'}) == 'png'
class App:
 def __init__(self): self.routes = {}
 def post(self, path):
  def register(fn): self.routes[path] = fn; return fn
  return register
app = App()
module.register(app)
endpoint = app.routes['/webview/image-response']
for index, (cdp, headers, expected_cdp, expected_header, expected_reason) in enumerate([
 ('chemical/x-xyz', {'Content-Type': 'chemical/x-xyz'}, 'chemical-xyz', 'chemical-xyz', 'image-response-mime'),
 ('application/octet-stream', {'Content-Type': 'image/jpeg'}, 'octet-stream', 'jpeg', 'image-response-mime'),
 ('image/jpg', {'Content-Type': 'image/jpg'}, 'jpg', 'jpg', 'image-response-mime'),
 ('image/webp', {}, 'webp', 'missing', 'image-content-type-missing'),
 ('image/webp', {'Content-Type': 'image/png'}, 'webp', 'png', 'image-content-type-mismatch'),
 ('image/webp', {'Content-Type': 'image/webp', 'content-type': 'image/webp'}, 'webp', 'duplicate', 'image-content-type-duplicate'),
 ('image/webp', {'Content-Type': 'SECRET\nvalue'}, 'webp', 'invalid', 'image-content-type-invalid'),
 ('application/SECRET', {'Content-Type': 'text/plain; secret=SECRET'}, 'other', 'text', 'image-response-mime'),
]):
 entries = events()
 message = json.loads(entries[1]['message'])
 message['message']['params']['response'].update(mimeType=cdp, headers=headers)
 entries[1]['message'] = json.dumps(message)
 active_driver = Driver([[], entries])
 bottle.request.json = {'session': 'mime-category-' + str(index), 'url': url, 'timeout': 1}
 result = endpoint()
 assert result == {'error': 'Anonymous browser image capture failed', 'code': 'operation',
  'phase': 'image-capture', 'stage': 'observation', 'reason': expected_reason,
  'cdpMimeCategory': expected_cdp, 'contentTypeCategory': expected_header}, result
 assert bottle.response.status == 502
 assert active_driver.navigations == [page]
 assert [cmd for cmd, _ in active_driver.commands] == ['Network.enable']
 assert 'SECRET' not in json.dumps(result)
`);
});
