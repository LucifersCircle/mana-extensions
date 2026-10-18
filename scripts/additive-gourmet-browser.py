"""Additive-PR-only anonymous Gourmet documents. No shared routes are changed."""
import base64
import re
import time
from urllib.parse import urlparse, parse_qsl
from bottle import request, response
from browser_request import session_driver, session_lock, assert_browser_safety, BrowserGate, FETCH_SCRIPT

STATE = {}
DENIAL = ('request forbidden by administrative rules', 'your ip has been blocked', 'access from your ip address has been denied')

def assert_target(value):
    if not isinstance(value, str) or not re.fullmatch(r'https://gourmetsupremacy\.com/[^#\\\s]*', value):
        raise ValueError('Unsupported target')
    url = urlparse(value)
    if url.netloc != 'gourmetsupremacy.com' or url.params:
        raise ValueError('Unsupported authority')
    if re.fullmatch(r'/project/[a-z0-9-]+/(?:[a-z0-9-]+/)?', url.path) and not url.query:
        return
    if not re.fullmatch(r'/(?:page/(?:[1-9][0-9]?|100)/)?', url.path):
        raise ValueError('Unsupported route')
    pairs = parse_qsl(url.query, keep_blank_values=True)
    params = dict(pairs)
    if (len(pairs) != len(params) or not {'s', 'post_type', 'm_orderby'} <= params.keys()
            or not params.keys() <= {'s', 'post_type', 'm_orderby', 'genre[]'}
            or len(params['s']) > 500 or params['post_type'] != 'wp-manga'
            or params['m_orderby'] not in ('latest', 'new-manga', 'alphabet', 'views')
            or ('genre[]' in params and not 0 < len(params['genre[]']) <= 200)):
        raise ValueError('Unsupported query')

def safety(driver, expected, startup=False):
    assert_browser_safety(driver, allow_startup=startup)
    if any(marker in driver.page_source.lower() for marker in DENIAL):
        raise BrowserGate('denial')
    if driver.current_url != expected and not (startup and driver.current_url in ('about:blank', 'chrome://newtab/', 'chrome://new-tab-page/')):
        raise BrowserGate('identity')

def register(app):
    @app.post('/additive/gourmet')
    def gourmet():
        payload = request.json or {}
        state = None
        stage, reason = 'validation', 'operation-error'
        try:
            if set(payload) != {'session', 'url', 'method', 'headers', 'body', 'deadline', 'operation'} or payload['method'] != 'GET' or payload['body'] is not None:
                raise ValueError('Unsupported payload')
            if payload['operation'] not in ('warm', 'fetch'):
                raise ValueError('Unsupported operation')
            assert_target(payload['url'])
            if type(payload['deadline']) not in (int, float) or not 0 < payload['deadline'] / 1000 - time.time() <= 20:
                raise ValueError('Invalid or expired deadline')
            headers = payload['headers']
            if (not isinstance(headers, dict) or any(key not in ('accept', 'referer', 'user-agent') for key in headers)
                    or ('referer' in headers and headers['referer'] != 'https://gourmetsupremacy.com/')):
                raise ValueError('Unsupported headers')
            with session_lock(payload['session']):
                stage = 'session'
                driver = session_driver(payload['session'])
                state = STATE.setdefault(payload['session'], {'warmups': 0, 'assistedRequests': 0, 'stopped': False})
                if state['stopped'] or state['assistedRequests'] >= 12:
                    raise ValueError('Stopped or exhausted session')
                if payload['operation'] == 'warm':
                    if state['warmups']:
                        raise ValueError('Warm-up already attempted')
                    stage = 'warm-safety'
                    assert_browser_safety(driver, allow_startup=True)
                    state['warmups'] += 1
                    state['document'] = payload['url']
                    stage = 'warm-navigation'
                    result = driver.execute_cdp_cmd('Page.navigate', {'url': payload['url']})
                    if result.get('errorText'):
                        raise BrowserGate('security')
                    deadline = min(time.monotonic() + 10, time.monotonic() + payload['deadline'] / 1000 - time.time())
                    while True:
                        stage = 'warm-poll'
                        safety(driver, state['document'], startup=True)
                        title, html = driver.title.lower(), driver.page_source.lower()
                        challenge = (title in ('just a moment...', 'ddos-guard') or 'cf-chl' in html or 'id="challenge-running"' in html)
                        if driver.current_url == state['document'] and not challenge and driver.execute_script('return document.readyState') in ('interactive', 'complete'):
                            break
                        if time.monotonic() >= deadline:
                            reason = 'challenge-timeout' if challenge else 'readiness-timeout'
                            raise ValueError('Managed challenge timeout')
                        time.sleep(0.1)
                    return {'ready': True, 'traffic': {'warmups': state['warmups'], 'assistedRequests': state['assistedRequests'], 'subresourcesUncounted': True}}
                if not state['warmups']:
                    raise ValueError('Warm-up required')
                stage = 'fetch-safety'
                safety(driver, state['document'])
                remaining = int(payload['deadline'] - time.time() * 1000)
                if remaining <= 0:
                    reason = 'deadline-expired'
                    raise ValueError('Assist deadline expired before fetch')
                state['assistedRequests'] += 1
                driver.set_script_timeout(remaining / 1000 + 1)
                stage = 'fetch'
                data = driver.execute_async_script(FETCH_SCRIPT.replace('AbortSignal.timeout(60000)', f'AbortSignal.timeout({remaining})'), {**payload, 'headers': {key: value for key, value in headers.items() if key == 'accept'}})
                stage = 'response-inspection'
                safety(driver, state['document'])
                if data.get('error') or data.get('url') != payload['url']:
                    raise ValueError('Browser response identity failed')
                body = base64.b64decode(data.get('body', ''), validate=True)
                if len(body) > 5_000_000:
                    raise ValueError('Oversized response')
                text = body.decode('utf-8', errors='replace').lower()
                denied = any(marker in text for marker in DENIAL)
                challenged = (data.get('headers', {}).get('cf-mitigated') == 'challenge'
                              or any(marker in text for marker in ('cf-chl', 'cf-turnstile', 'cdn-cgi/challenge-platform', 'challenges.cloudflare.com')))
                captcha = challenged and bool(re.search(r'<input\b[^>]*\btype\s*=\s*["\']?checkbox\b', text))
                data['stopCode'] = 'denial' if denied else 'captcha' if captcha else 'challenge' if challenged else 'http-error' if data.get('status') != 200 else None
                if data['stopCode']:
                    state['stopped'] = True
                data['traffic'] = {key: state[key] for key in ('warmups', 'assistedRequests')}
                data['traffic']['subresourcesUncounted'] = True
                return data
        except BrowserGate as error:
            if state is not None:
                state['stopped'] = True
            response.status = 409
            return {'error': 'Browser stopped', 'code': error.code, 'stage': stage, 'reason': 'safety-stop'}
        except Exception as error:
            if state is not None:
                state['stopped'] = True
            response.status = 502
            category = {'ValueError': 'validation', 'TypeError': 'python-type', 'AttributeError': 'python-type', 'NameError': 'python-name', 'TimeoutException': 'webdriver-timeout', 'JavascriptException': 'webdriver-script', 'WebDriverException': 'webdriver'}.get(type(error).__name__, 'other')
            return {'error': 'Anonymous Gourmet browser request failed', 'stage': stage, 'reason': reason, 'category': category}
