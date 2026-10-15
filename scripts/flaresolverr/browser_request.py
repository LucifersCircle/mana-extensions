"""Test-only anonymous Kagane transport, using FlareSolverr's Chromium sessions.

Never invoke its request.get/post solver: that flow can click CAPTCHA controls.
"""

import base64
import json
import re
import threading
import time
from urllib.parse import parse_qsl, urlparse

from bottle import request, response
from flaresolverr_service import SESSIONS_STORAGE

LOCKS = {}
LOCKS_GUARD = threading.Lock()
ID = r'[A-Za-z0-9-]+'
SEARCH_KEYS = {'source_type', 'title', 'content_rating', 'age_rating',
               'is_pornographic', 'content_lang', 'format', 'upload_status',
               'source_id', 'genres', 'tags'}
HEADERS = {'accept', 'content-type', 'origin', 'referer', 'user-agent', 'x-integrity-token'}

FETCH_SCRIPT = """
const payload = arguments[0], done = arguments[arguments.length - 1];
fetch(payload.url, {
    method: payload.method, headers: payload.headers, body: payload.body,
    credentials: 'include', cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(60000)
}).then(async result => {
    const bytes = new Uint8Array(await result.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    done({url: result.url, status: result.status,
        headers: Object.fromEntries(result.headers.entries()),
        body: btoa(binary), encoding: 'base64'});
}).catch(() => done({error: 'Browser fetch failed'}));
"""

# Inspect actual visible interactive controls, including inside challenge frames.
# A visible iframe alone may be a noninteractive managed spinner, not a CAPTCHA.
# We never click, type, solve, or use the upstream click_verify flow.
CAPTCHA_SCRIPT = """
const selector = arguments[0]
  ? 'input[type="checkbox"], [role="checkbox"], input[type="button"], button'
  : '#challenge-form input[type="checkbox"], #challenge-form [role="checkbox"], '
    + '.cf-turnstile [role="checkbox"], #challenge-form input[type="button"], #challenge-form button';
return [...document.querySelectorAll(selector)].some(element => {
  const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
  const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden'
    && style.display !== 'none' && style.opacity !== '0';
  const checkbox = element.matches('input[type="checkbox"], [role="checkbox"]');
  return visible && (checkbox || /verify|human|robot|captcha/i.test(
    `${element.textContent} ${element.value ?? ''} ${element.getAttribute('aria-label') ?? ''}`));
});
"""
CHALLENGE_FRAMES = ('iframe[src*="challenges.cloudflare.com"], '
                    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]')


class BrowserGate(Exception):
    def __init__(self, code):
        self.code = code


def assert_public_request(payload):
    """Mirror mana-runtime.mjs's exact read-only allowlist, independently."""
    url = urlparse(payload.get('url', ''))
    if (url.scheme != 'https' or url.hostname != 'kagane.org'
            or url.port not in (None, 443) or url.username or url.password
            or url.fragment or url.params):
        raise ValueError('Unsupported Kagane target')
    pairs = parse_qsl(url.query, keep_blank_values=True)
    params = dict(pairs)
    if len(params) != len(pairs):
        raise ValueError('Duplicate query keys')
    method, body = payload.get('method'), payload.get('body')
    if method == 'GET' and body is None:
        if not url.query and url.path in ('/', '/api/v2/genres/list', '/api/v2/tags/list'):
            return
        if not url.query and re.fullmatch(r'/api/v2/image/' + ID, url.path):
            return
        if not url.query and re.fullmatch(r'/api/v2/series/' + ID + r'(/books/index)?', url.path):
            return
        if (re.fullmatch(r'/api/v2/series/' + ID + r'/books', url.path)
                and params.keys() <= {'limit', 'before'} and params.get('limit') == '200'
                and ('before' not in params or params['before'].strip())):
            return
    if method == 'POST':
        if isinstance(body, str):
            # Detect duplicate JSON keys as well as duplicate query parameters.
            def unique_object(pairs):
                result = dict(pairs)
                if len(result) != len(pairs):
                    raise ValueError('Duplicate JSON keys')
                return result
            body = json.loads(body, object_pairs_hook=unique_object)
        if body is not None and not isinstance(body, dict):
            raise ValueError('JSON object required')
        keys = set(body or {})
        if url.path == '/api/integrity' and not url.query and not keys:
            return
        if (re.fullmatch(r'/api/v2/books/' + ID, url.path) and not keys
                and params.keys() <= {'is_datasaver'}
                and params.get('is_datasaver') in ('true', 'false', None)):
            return
        if (url.path == '/api/v2/sources/list' and not url.query and keys == {'source_types'}
                and (body['source_types'] is None or (isinstance(body['source_types'], list)
                     and all(item in ('Official', 'Unofficial', 'Mixed') for item in body['source_types'])))):
            return
        if (url.path == '/api/v2/search/series' and body is not None and keys <= SEARCH_KEYS
                and params.keys() <= {'page', 'size', 'sort', 'exact_match'}
                and re.fullmatch(r'[0-9]+', params.get('page', ''))
                and re.fullmatch(r'[1-9][0-9]*', params.get('size', ''))
                and params.get('exact_match') in ('true', 'false', None)):
            return
    raise ValueError('Unsupported Kagane operation')


def session_driver(session_id):
    if session_id not in SESSIONS_STORAGE.session_ids():
        raise ValueError('Create an anonymous Chromium session first')
    session, _ = SESSIONS_STORAGE.get(session_id)
    if session.driver.capabilities.get('acceptInsecureCerts') is not False:
        raise BrowserGate('security')
    return session.driver


def session_lock(session_id):
    with LOCKS_GUARD:
        return LOCKS.setdefault(session_id, threading.Lock())


def assert_browser_page(driver):
    current = urlparse(driver.current_url)
    title = driver.title.lower()
    if (current.scheme in ('chrome-error', 'chrome') or 'privacy error' in title
            or 'your connection is not private' in title or 'certificate error' in title
            or 'net::err_cert_' in driver.page_source.lower()):
        raise BrowserGate('security')
    if (current.scheme != 'https' or current.hostname != 'kagane.org'
            or current.path not in ('', '/') or current.query or current.fragment):
        raise ValueError('Browser left the public Kagane root')
    if driver.execute_script(CAPTCHA_SCRIPT):
        raise BrowserGate('captcha')
    for frame in driver.find_elements('css selector', CHALLENGE_FRAMES):
        if not frame.is_displayed():
            continue
        try:
            driver.switch_to.frame(frame)
            if driver.execute_script(CAPTCHA_SCRIPT, True):
                raise BrowserGate('captcha')
        finally:
            driver.switch_to.default_content()


def register(app):
    @app.hook('before_request')
    def restrict_solver_commands():
        # The standard solver's request.get/post can auto-click explicit CAPTCHA.
        # This localhost test service only needs anonymous session lifecycle.
        if request.path == '/v1':
            payload = request.json or {}
            if (payload.get('cmd') not in ('sessions.create', 'sessions.destroy')
                    or set(payload) != {'cmd', 'session'}
                    or not re.fullmatch(r'[A-Za-z0-9-]{1,100}', str(payload.get('session', '')))):
                from bottle import abort
                abort(400, 'Only anonymous test session lifecycle is supported')

    @app.post('/browser/warm')
    def warm_browser():
        payload = request.json or {}
        try:
            if set(payload) != {'session'}:
                raise ValueError('Unsupported warm-up')
            with session_lock(payload['session']):
                driver = session_driver(payload['session'])
                driver.set_page_load_timeout(60)
                driver.get('https://kagane.org/')
                deadline = time.monotonic() + 60
                while True:
                    assert_browser_page(driver)
                    html, title = driver.page_source, driver.title.lower()
                    challenge = (title in ('just a moment...', 'ddos-guard')
                                 or 'id="challenge-running"' in html
                                 or 'id="cf-challenge-running"' in html)
                    if not challenge:
                        return {'ready': True}
                    if time.monotonic() >= deadline:
                        raise ValueError('Managed challenge did not finish')
                    time.sleep(0.5)
        except BrowserGate as error:
            response.status = 409
            return {'error': 'Browser requires user action', 'code': error.code}
        except Exception:
            response.status = 502
            return {'error': 'Anonymous browser warm-up failed'}

    @app.post('/browser/request')
    def browser_request():
        payload = request.json or {}
        try:
            if set(payload) != {'session', 'url', 'method', 'headers', 'body'}:
                raise ValueError('Unsupported payload')
            assert_public_request(payload)
            headers = payload['headers']
            if not isinstance(headers, dict) or any(key.lower() not in HEADERS for key in headers):
                raise ValueError('Unsupported headers')
            if (any(key.lower() == 'x-integrity-token' for key in headers)
                    and not (payload['method'] == 'POST'
                             and re.fullmatch(r'/api/v2/books/' + ID, urlparse(payload['url']).path))):
                raise ValueError('Integrity token outside public reader bootstrap')
            with session_lock(payload['session']):
                driver = session_driver(payload['session'])
                assert_browser_page(driver)
                driver.set_script_timeout(65)
                # Browser supplies its own anonymous cookies, Origin and Referer.
                payload['headers'] = {key: value for key, value in headers.items()
                                      if key.lower() in ('accept', 'content-type', 'x-integrity-token')}
                result = driver.execute_async_script(FETCH_SCRIPT, payload)
                if result.get('error'):
                    raise ValueError('Browser fetch failed')
                # A challenged API response with an explicit checkbox is a stop.
                # Bare Turnstile/iframe markers can be noninteractive, so they are
                # returned unchanged for native CloudflareError detection instead.
                headers = result.get('headers', {})
                challenged = (result.get('status') in (403, 503)
                              or headers.get('cf-mitigated') == 'challenge')
                if (challenged and 'text/html' in headers.get('content-type', '')
                        and re.search(r'<input\b[^>]*\btype\s*=\s*["\']?checkbox\b', base64.b64decode(result.get('body', '')).decode('utf-8', errors='replace'), re.I)):
                    raise BrowserGate('captcha')
                return result
        except BrowserGate as error:
            response.status = 409
            return {'error': 'Browser requires user action', 'code': error.code}
        except Exception:
            response.status = 502
            # Never echo webdriver errors, request headers or reader response bodies.
            return {'error': 'Anonymous browser request failed'}
