"""Test-only anonymous public API transport using FlareSolverr's Chromium sessions.

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
               'is_pornographic', 'is_disturbing', 'content_lang', 'format',
               'upload_status', 'publication_status', 'original_language',
               'translated_language', 'source_id', 'genres', 'tags', 'staff',
               'groups', 'current_books', 'current_volumes', 'start_year', 'end_year'}
HEADERS = {'accept', 'content-type', 'origin', 'referer', 'user-agent', 'x-integrity-token'}
WARM_URLS = {'kagane.org': 'https://kagane.org/',
             'marumaru105.com': 'https://marumaru105.com/manhwa',
             'api.storagewebtoon.store': 'https://api.storagewebtoon.store/'}

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
    def __init__(self, code, reason=None):
        self.code = code
        self.reason = reason


def valid_numeric_range(value, minimum, maximum):
    """Only nonempty plain JSON objects with integer min/max bounds are public filters."""
    return (type(value) is dict and bool(value) and value.keys() <= {'min', 'max'}
            and all(type(bound) is int and minimum <= bound <= maximum for bound in value.values())
            and ('min' not in value or 'max' not in value or value['min'] <= value['max']))


def assert_public_marumaru_request(payload):
    page = r'(?:0|[1-9]\d*)'
    route = (r'(?:works/[1-9]\d*|works\?mediaType=MANHWA&page=' + page
             + r'&size=49|search\?q=(?:[A-Za-z0-9_.!~*\x27()-]|%[0-9A-F]{2})+&page='
             + page + r'&media=MANHWA&sort=LATEST)')
    value = payload.get('url')
    if (payload.get('method') != 'GET' or payload.get('body') is not None
            or not isinstance(value, str) or re.search(r'[\s\\]', value)
            or not (re.fullmatch(r'https://marumaru105\.com/api/' + route, value, re.ASCII)
                    or re.fullmatch(r'https://api\.storagewebtoon\.store/api/v1/reader/A2/(?:works|episodes)/[1-9][0-9]*', value))):
        raise ValueError('Unsupported Marumaru operation')


def assert_public_request(payload):
    """Mirror mana-runtime.mjs's exact read-only allowlist, independently."""
    url = urlparse(payload.get('url', ''))
    if url.hostname in ('marumaru105.com', 'api.storagewebtoon.store'):
        return assert_public_marumaru_request(payload)
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
        # Match the exact raw bulk-read URL, not a normalized path or tracker prefix.
        if re.fullmatch(r'https://kagane\.org/api/v2/trackers/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/series', payload.get('url', '')):
            return
        if not url.query and url.path in ('/', '/api/v2/genres/list', '/api/v2/tags/list'):
            return
        if not url.query and re.fullmatch(r'/api/v2/image/' + ID, url.path):
            return
        if not url.query and re.fullmatch(r'/api/v2/series/' + ID, url.path):
            return
        if re.fullmatch(r'/api/v2/series/' + ID + r'/books/index', url.path) and params == {'fields': 'List'}:
            return
        def listed(key, pattern):
            return key not in params or all(re.fullmatch(pattern, value) for value in params[key].split(','))
        flags = all(params.get(key) in (None, 'true', 'false') for key in ('is_pornographic', 'is_disturbing'))
        common = flags and listed('age_rating', r'Safe|FifteenPlus|EighteenPlus') and listed('lang', r'[A-Za-z0-9-]+')
        if (url.path == '/api/v2/series/trending' and common and params.get('limit') in ('5', '50')
                and params.keys() <= {'limit', 'age_rating', 'lang', 'is_pornographic', 'is_disturbing'}):
            return
        if (re.fullmatch(r'/api/v1/rec/series/' + ID + r'/similar', url.path) and common
                and params.get('kind') == 'similar' and params.get('limit') == '10'
                and listed('source_type', r'Official|Unofficial|Mixed')
                and params.keys() <= {'kind', 'limit', 'age_rating', 'is_pornographic', 'is_disturbing', 'lang', 'source_type'}):
            return
        if (url.path == '/api/v2/groups/search' and params.keys() == {'q', 'limit'}
                and params['q'].strip() and params['limit'] == '8'):
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
        if (url.path == '/api/v2/search/staff' and params == {'size': '8'} and keys == {'name'}
                and isinstance(body['name'], str) and body['name'].strip()):
            return
        if (url.path == '/api/v2/search/series' and body is not None and keys <= SEARCH_KEYS
                and ('current_books' not in body or valid_numeric_range(body['current_books'], 0, 2147483647))
                and ('current_volumes' not in body or valid_numeric_range(body['current_volumes'], 0, 2147483647))
                and ('start_year' not in body or valid_numeric_range(body['start_year'], 1, 9999))
                and ('end_year' not in body or valid_numeric_range(body['end_year'], 1, 9999))
                and params.keys() <= {'page', 'size', 'sort', 'exact_match', 'facets'}
                and params.get('facets') in ('true', None)
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
        raise BrowserGate('security', 'insecure-capability')
    return session.driver


def session_lock(session_id):
    with LOCKS_GUARD:
        return LOCKS.setdefault(session_id, threading.Lock())


def assert_browser_safety(driver, allow_startup=False):
    current = urlparse(driver.current_url)
    title = driver.title.lower()
    # A fresh anonymous Chromium may start on its empty built-in New Tab page.
    # Only the WebView's first, not-yet-committed navigation may recognize it;
    # warning titles/body markers and every other internal URL still fail.
    startup = allow_startup and driver.current_url in ('chrome://newtab/', 'chrome://new-tab-page/')
    if current.scheme == 'chrome-error' or (current.scheme == 'chrome' and not startup):
        raise BrowserGate('security', 'internal-page')
    if ('privacy error' in title or 'your connection is not private' in title
            or 'certificate error' in title or 'net::err_cert_' in driver.page_source.lower()):
        raise BrowserGate('security', 'certificate-marker')
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


def assert_browser_page(driver, site='kagane.org'):
    assert_browser_safety(driver)
    if site not in WARM_URLS or driver.current_url != WARM_URLS[site]:
        raise ValueError('Browser left its public source document')


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
            if set(payload) not in ({'session'}, {'session', 'site'}):
                raise ValueError('Unsupported warm-up')
            site = payload.get('site', 'kagane.org')
            if site not in WARM_URLS:
                raise ValueError('Unsupported warm-up site')
            with session_lock(payload['session']):
                driver = session_driver(payload['session'])
                driver.set_page_load_timeout(60)
                driver.get(WARM_URLS[site])
                deadline = time.monotonic() + 60
                while True:
                    assert_browser_page(driver, site)
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
            return {'error': 'Browser requires user action', 'code': error.code, 'reason': error.reason}
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
            site = urlparse(payload['url']).hostname
            marumaru = site != 'kagane.org'
            catalog = site == 'marumaru105.com'
            headers = payload['headers']
            allowed = (HEADERS - {'x-integrity-token'} | ({'x-site'} if catalog else set())) if marumaru else HEADERS
            if not isinstance(headers, dict) or any(key.lower() not in allowed for key in headers):
                raise ValueError('Unsupported headers')
            if catalog and {key.lower(): value for key, value in headers.items()}.get('x-site') != 'marumaru':
                raise ValueError('Missing Marumaru site header')
            if (any(key.lower() == 'x-integrity-token' for key in headers)
                    and not (payload['method'] == 'POST'
                             and re.fullmatch(r'/api/v2/books/' + ID, urlparse(payload['url']).path))):
                raise ValueError('Integrity token outside public reader bootstrap')
            with session_lock(payload['session']):
                driver = session_driver(payload['session'])
                assert_browser_page(driver, site)
                driver.set_script_timeout(65)
                # Browser supplies its own anonymous cookies, Origin and Referer.
                payload['headers'] = {key: value for key, value in headers.items()
                                      if key.lower() in ('accept', 'content-type', 'x-site' if catalog else 'x-integrity-token')}
                result = driver.execute_async_script(FETCH_SCRIPT, payload)
                assert_browser_page(driver, site)
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
            return {'error': 'Browser requires user action', 'code': error.code, 'reason': error.reason}
        except Exception:
            response.status = 502
            # Never echo webdriver errors, request headers or reader response bodies.
            return {'error': 'Anonymous browser request failed'}
