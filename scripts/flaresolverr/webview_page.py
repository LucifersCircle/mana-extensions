"""Anonymous, test-only WebView bridge. No solver, cookie export or API replay."""
import json
import math
import re
import time
from urllib.parse import parse_qsl, urlparse

from bottle import request, response
from browser_request import BrowserGate, assert_browser_safety, session_driver, session_lock

MAX_JSON = 4 * 1024 * 1024
NAVIGATED = set()


def assert_document_url(value):
    if not isinstance(value, str) or re.search(r'[\x00-\x20\x7f]', value) or not re.fullmatch(r'https://marumaru105\.com/[^#\\]*', value):
        raise ValueError('Unsupported WebView document')
    url = urlparse(value)
    if (url.netloc != 'marumaru105.com' or url.params
            or not re.fullmatch(r'/(?:manhwa(?:/[1-9][0-9]*(?:/[1-9][0-9]*)?)?|search)', url.path)):
        raise ValueError('Unsupported WebView document')
    pairs = parse_qsl(url.query, keep_blank_values=True)
    params = dict(pairs)
    if len(pairs) != len(params) or ('page' in params and not re.fullmatch(r'[1-9][0-9]*', params['page'])):
        raise ValueError('Unsupported WebView query')
    if url.path == '/search':
        if (not params.get('q', '').strip() or len(params.get('q', '')) > 300
                or params.get('kind') != 'manhwa' or not params.keys() <= {'q', 'kind', 'page'}):
            raise ValueError('Unsupported WebView search')
    elif params and (url.path != '/manhwa' or set(params) != {'page'}):
        raise ValueError('Unsupported WebView query')


def operation_timeout(value):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= 120:
        raise ValueError('Invalid WebView timeout')
    return value


def assert_document(driver, expected):
    assert_browser_safety(driver)
    if driver.current_url != expected:
        raise ValueError('WebView document identity changed')


def navigate(driver, url, wait_until, timeout, allow_startup=False):
    assert_document_url(url)
    operation_timeout(timeout)
    if wait_until not in ('domcontentloaded', 'load'):
        raise ValueError('Unsupported lifecycle event')
    # CDP navigation does not impose WebDriver's default full-load wait, which
    # would incorrectly implement the SDK's domcontentloaded option.
    previous = driver.current_url
    assert_browser_safety(driver, allow_startup=allow_startup)
    previous_loader = driver.execute_cdp_cmd('Page.getFrameTree', {})['frameTree']['frame'].get('loaderId')
    result = driver.execute_cdp_cmd('Page.navigate', {'url': url})
    if result.get('errorText'):
        if re.search(r'ERR_CERT_|ERR_SSL_', result['errorText']):
            raise BrowserGate('security', 'tls-navigation-error')
        assert_browser_safety(driver)
        raise ValueError('WebView navigation failed')
    deadline = time.monotonic() + timeout
    committed = False
    while True:
        assert_browser_safety(driver, allow_startup=allow_startup and not committed)
        current = driver.current_url
        frame = driver.execute_cdp_cmd('Page.getFrameTree', {})['frameTree']['frame']
        # Once committed, a passive managed check may reload this exact URL
        # under another loader. Do not mistake the successfully cleared page for
        # the previous document or require a superseded loader forever.
        committed = committed or (current == url and (not result.get('loaderId')
                    or frame.get('loaderId') == result['loaderId']
                    or (frame.get('loaderId') and frame.get('loaderId') != previous_loader)))
        if current == url and committed:
            state = driver.execute_script('return document.readyState')
            if state == 'complete' or (wait_until == 'domcontentloaded' and state == 'interactive'):
                html, title = driver.page_source, driver.title.lower()
                challenge = (title in ('just a moment...', 'ddos-guard')
                             or 'id="challenge-running"' in html
                             or 'id="cf-challenge-running"' in html)
                if not challenge:
                    return {'ready': True, 'url': current}
        elif current not in ('about:blank', previous, url):
            # Fail on redirects instead of silently changing origin or identity.
            raise ValueError('WebView document identity changed')
        if time.monotonic() >= deadline:
            raise TimeoutError('WebView navigation timed out')
        time.sleep(0.1)


EVALUATE_SCRIPT = r"""
const payload = arguments[0], done = arguments[arguments.length - 1];
const fail = () => done({error: 'WebView evaluation failed'});
const encode = (value, ancestors = new Set()) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || ancestors.has(value)) throw new Error('Non-JSON result');
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Non-JSON object');
  ancestors.add(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    if (array && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw new Error('Non-index array property');
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !d.enumerable || !('value' in d)) throw new Error('Non-JSON property');
    parts.push((array ? '' : JSON.stringify(key) + ':') + encode(d.value, ancestors));
  }
  if (array && parts.length !== value.length) throw new Error('Sparse array');
  ancestors.delete(value);
  const encoded = array ? '[' + parts.join(',') + ']' : '{' + parts.join(',') + '}';
  if (new TextEncoder().encode(encoded).length > 4 * 1024 * 1024) throw new Error('Result too large');
  return encoded;
};
try {
  if (location.href !== payload.url) throw new Error('Document changed');
  // The callback is the actual compiled source function, not a replacement
  // parser. Evaluate it in this page's JS realm with only JSON bridge arguments.
  const fn = (0, eval)('(' + payload.script + ')');
  if (typeof fn !== 'function') throw new Error('Function required');
  Promise.resolve(fn(...payload.args)).then(value => {
    if (location.href !== payload.url) throw new Error('Document changed');
    const encoded = encode(value);
    if (new TextEncoder().encode(encoded).length > 4 * 1024 * 1024) throw new Error('Result too large');
    done({url: location.href, encoded});
  }).catch(fail);
} catch { fail(); }
"""


def evaluate(driver, payload):
    assert_document_url(payload['url'])
    seconds = operation_timeout(payload['timeout'])
    script, args = payload['script'], payload['args']
    if not isinstance(script, str) or len(script.encode()) > 128 * 1024 or not isinstance(args, list):
        raise ValueError('Unsupported WebView evaluation')
    if len(json.dumps(args, allow_nan=False).encode()) > MAX_JSON:
        raise ValueError('WebView arguments exceed limit')
    assert_document(driver, payload['url'])
    driver.set_script_timeout(seconds)
    try:
        result = driver.execute_async_script(EVALUATE_SCRIPT, payload)
    except Exception:
        # A timeout/context loss can coincide with a newly visible challenge or
        # security interstitial. Preserve the sticky stop instead of hiding it.
        assert_browser_safety(driver)
        raise
    assert_document(driver, payload['url'])
    if (not isinstance(result, dict) or result.get('error') or result.get('url') != payload['url']
            or not isinstance(result.get('encoded'), str) or len(result['encoded'].encode()) > MAX_JSON):
        raise ValueError('WebView evaluation failed')
    return {'url': result['url'], 'value': json.loads(result['encoded'])}


def register(app):
    def handle(keys, action):
        try:
            payload = request.json or {}
            if set(payload) != keys or not re.fullmatch(r'[A-Za-z0-9-]{1,100}', str(payload.get('session', ''))):
                raise ValueError('Unsupported WebView payload')
            with session_lock(payload['session']):
                return action(session_driver(payload['session']), payload)
        except BrowserGate as error:
            response.status = 409
            return {'error': 'Browser requires user action', 'code': error.code, 'reason': error.reason}
        except Exception:
            response.status = 502
            # Never expose exception text, page bodies, arguments or credentials.
            return {'error': 'Anonymous WebView operation failed'}

    @app.hook('before_request')
    def forget_destroyed_session():
        if request.path == '/v1' and (request.json or {}).get('cmd') == 'sessions.destroy':
            NAVIGATED.discard((request.json or {}).get('session'))

    def navigate_once(driver, payload):
        first = payload['session'] not in NAVIGATED
        NAVIGATED.add(payload['session'])
        return navigate(driver, payload['url'], payload['waitUntil'], payload['timeout'], allow_startup=first)

    @app.post('/webview/goto')
    def goto():
        return handle({'session', 'url', 'waitUntil', 'timeout'}, navigate_once)

    @app.post('/webview/evaluate')
    def run_evaluation():
        return handle({'session', 'url', 'script', 'args', 'timeout'}, evaluate)
