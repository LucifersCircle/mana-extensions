"""Test-only cover proof from a normal anonymous title-page image load.

No direct image navigation, fetch replay, header/cookie export or solver is used.
The caller owns the anonymous session lifecycle and the source authorization.
"""
import base64
import binascii
import json
import math
import re
import time

from bottle import request, response
from browser_request import BrowserGate, assert_browser_safety, session_driver, session_lock
from webview_page import NAVIGATED, assert_document, navigate, operation_failure_reason, operation_timeout

MAX_BYTES = 16 * 1024 * 1024
MAX_LOG_BYTES = 16 * 1024 * 1024
# The provider's issued covers use application/octet-stream. It is retained as
# the actual type, not rewritten: the same hero must decode and the Node caller
# additionally validates complete JPEG/PNG/WebP bytes for this exact exception.
IMAGE_MIMES = frozenset({'image/jpeg', 'image/png', 'image/gif', 'image/webp',
                         'image/avif', 'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon',
                         'application/octet-stream'})
HERO_SCRIPT = """
const images = document.querySelectorAll('.hero-v2-thumb img');
if (images.length !== 1) return null;
const image = images[0];
return {url: image.currentSrc, complete: image.complete,
        width: image.naturalWidth, height: image.naturalHeight};
"""


# Decode only the same existing title-page hero. Never create an Image, assign
# src, fetch bytes, navigate, or retry. Both sides of the await retain identity.
DECODE_SCRIPT = """
const payload = arguments[0], done = arguments[arguments.length - 1];
let finished = false, timer;
const finish = result => {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  done(result);
};
const fail = reason => finish({decoded: false, reason});
const check = image => {
  if (location.href !== payload.document) return 'image-decode-identity';
  const images = document.querySelectorAll('.hero-v2-thumb img');
  if (!image || images.length !== 1 || images[0] !== image || image.currentSrc !== payload.url)
    return 'image-decode-identity';
  if (!image.complete || !(image.naturalWidth > 0) || !(image.naturalHeight > 0))
    return 'image-decode-not-ready';
};
try {
  const images = document.querySelectorAll('.hero-v2-thumb img');
  const image = images.length === 1 ? images[0] : null;
  const before = check(image);
  if (before) return fail(before);
  timer = setTimeout(() => fail('image-decode-timeout'), payload.timeoutMs);
  Promise.resolve(image.decode()).then(() => {
    if (finished) return;
    const after = check(image);
    if (after) return fail(after);
    finish({decoded: true});
  }, () => fail('image-decode-failed')).catch(() => fail('image-decode-failed'));
} catch { fail('image-decode-failed'); }
"""


def title_page(value):
    """Do not URL-normalize aliases into the independently approved cover path."""
    if not isinstance(value, str):
        raise ValueError('Unsupported cover target')
    match = re.fullmatch(r'https://peer\.storagewebtoon\.store/(?:manhwa|webtoon)/([1-9][0-9]*)/([A-Za-z0-9._-]+)', value)
    if not match or match[2] in ('.', '..'):
        raise ValueError('Unsupported cover target')
    return 'https://marumaru105.com/manhwa/' + match[1]


def canonical_body(result):
    if (type(result) is not dict or result.get('base64Encoded') is not True
            or not isinstance(result.get('body'), str)
            or len(result['body']) > 4 * ((MAX_BYTES + 2) // 3)):
        raise ValueError('Browser image bytes unavailable')
    try:
        raw = base64.b64decode(result['body'], validate=True)
    except (ValueError, binascii.Error):
        raise ValueError('Browser image bytes unavailable') from None
    if not raw or len(raw) > MAX_BYTES or base64.b64encode(raw).decode('ascii') != result['body']:
        raise ValueError('Browser image bytes unavailable')
    return result['body']


MIME_CATEGORIES = frozenset({'jpeg', 'jpg', 'png', 'gif', 'webp', 'avif', 'bmp', 'icon',
                            'octet-stream', 'binary-octet-stream', 'chemical-xyz', 'image-xyz', 'application-xyz',
                            'application-x-xyz', 'text', 'html',
                            'json', 'other', 'missing', 'duplicate', 'invalid'})


def mime_category(value):
    """Diagnostic classification only; never use this to accept an image."""
    if value is None:
        return 'missing'
    if not isinstance(value, str) or re.search(r'[\x00-\x1f\x7f]', value):
        return 'invalid'
    mime = value.split(';', 1)[0].strip().lower()
    if not re.fullmatch(r'[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+', mime):
        return 'invalid'
    known = {'image/jpeg': 'jpeg', 'image/jpg': 'jpg', 'image/png': 'png',
             'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp',
             'image/x-icon': 'icon', 'image/vnd.microsoft.icon': 'icon',
             'application/octet-stream': 'octet-stream', 'binary/octet-stream': 'binary-octet-stream',
             'chemical/x-xyz': 'chemical-xyz', 'image/xyz': 'image-xyz', 'application/xyz': 'application-xyz',
             'application/x-xyz': 'application-x-xyz', 'text/html': 'html', 'application/xhtml+xml': 'html',
             'application/json': 'json', 'text/json': 'json'}
    if mime in known:
        return known[mime]
    if mime.endswith('+json'):
        return 'json'
    return 'text' if mime.startswith('text/') else 'other'


def content_type_category(headers):
    if type(headers) is not dict or any(not isinstance(name, str) for name in headers):
        return 'invalid'
    values = [value for name, value in headers.items() if name.lower() == 'content-type']
    if not values:
        return 'missing'
    if len(values) != 1:
        return 'duplicate'
    return mime_category(values[0]) if isinstance(values[0], str) else 'invalid'


class ImageEvidence:
    """Bind the exact observed Image request, response and completed load."""
    def __init__(self, target, diagnostic=None):
        self.diagnostic = diagnostic if diagnostic is not None else {}
        self.target = target
        self.document = title_page(target)
        self.request_id = None
        self.mime = None
        self.finished = False
        self.log_bytes = 0

    def observe(self, entries):
        for entry in entries:
            raw = entry.get('message')
            if not isinstance(raw, str):
                raise ValueError('Browser network evidence unavailable')
            self.log_bytes += len(raw.encode('utf-8'))
            if self.log_bytes > MAX_LOG_BYTES:
                raise ValueError('Browser network evidence exceeds limit')
            message = json.loads(raw)['message']
            method, params = message.get('method'), message.get('params', {})
            request_id = params.get('requestId')
            if method == 'Network.requestWillBeSent':
                network_request = params.get('request', {})
                url = network_request.get('url')
                redirect = params.get('redirectResponse')
                if (url != self.target and request_id != self.request_id
                        and (not redirect or redirect.get('url') != self.target)):
                    continue
                if redirect:
                    raise ValueError('Browser image redirected')
                if url != self.target or not isinstance(request_id, str) or not request_id:
                    raise ValueError('Browser image request identity changed')
                if self.request_id is not None or self.mime is not None or self.finished:
                    raise ValueError('Browser image request duplicated')
                # CDP documents method/documentURL; the optional resource
                # type must also be present as Image or evidence fails closed.
                if network_request.get('method') != 'GET':
                    raise ValueError('Browser image request method changed')
                if network_request.get('urlFragment'):
                    raise ValueError('Browser image request fragment present')
                if params.get('type') != 'Image':
                    raise ValueError('Browser image request resource type changed')
                if params.get('documentURL') != self.document:
                    raise ValueError('Browser image request document changed')
                self.request_id = request_id
            elif method == 'Network.responseReceived':
                result = params.get('response', {})
                if result.get('url') != self.target and request_id != self.request_id:
                    continue
                if not self.request_id or request_id != self.request_id or result.get('url') != self.target:
                    raise ValueError('Browser image response identity changed')
                if params.get('type') != 'Image':
                    raise ValueError('Browser image response resource type changed')
                if self.mime is not None:
                    raise ValueError('Browser image response duplicated')
                if type(result.get('status')) not in (int, float) or result['status'] != 200:
                    if type(result.get('status')) in (int, float) and result['status'] == 403:
                        rejected_headers = result.get('headers', {})
                        if type(rejected_headers) is dict and any(
                                isinstance(name, str) and name.lower() == 'cf-mitigated'
                                and isinstance(value, str) and value.strip().lower() == 'challenge'
                                for name, value in rejected_headers.items()):
                            raise ValueError('Browser image response is challenged')
                        raise ValueError('Browser image response is forbidden')
                    raise ValueError('Browser image response status not successful')
                if result.get('fromServiceWorker') is True:
                    raise ValueError('Browser image response from service worker')
                if result.get('securityState') in ('insecure', 'broken'):
                    raise BrowserGate('security', 'image-transport-error')
                mime = result.get('mimeType')
                # Record only closed categories from metadata already observed;
                # neither classification changes acceptance or reads the body.
                self.diagnostic['cdpMimeCategory'] = mime_category(mime)
                self.diagnostic['contentTypeCategory'] = content_type_category(result.get('headers', {}))
                if mime not in IMAGE_MIMES:
                    raise ValueError('Browser response is not a supported image')
                headers = result.get('headers', {})
                if type(headers) is not dict:
                    raise ValueError('Browser image metadata unavailable')
                content_types = []
                for name, value in headers.items():
                    if not isinstance(name, str) or not isinstance(value, str):
                        raise ValueError('Browser image metadata unavailable')
                    if name.lower() == 'cf-mitigated' and value.strip().lower() == 'challenge':
                        raise ValueError('Browser image response is challenged')
                    if name.lower() == 'content-type':
                        if re.search(r'[\x00-\x1f\x7f]', value):
                            raise ValueError('Browser image media type invalid')
                        content_types.append(value.split(';', 1)[0].strip().lower())
                if not content_types:
                    raise ValueError('Browser image media type missing')
                if len(content_types) != 1:
                    raise ValueError('Browser image media type duplicated')
                if content_types[0] != mime:
                    raise ValueError('Browser image media type changed')
                # Return only the verified server media type, never a MIME
                # synthesized from browser sniffing or arbitrary header data.
                self.mime = content_types[0]
            elif method == 'Network.loadingFailed' and self.request_id and request_id == self.request_id:
                if re.search(r'ERR_CERT_|ERR_SSL_', str(params.get('errorText', ''))):
                    raise BrowserGate('security', 'image-transport-error')
                raise ValueError('Browser image load failed')
            elif method == 'Network.loadingFinished' and self.request_id and request_id == self.request_id:
                size = params.get('encodedDataLength')
                if (self.mime is None or self.finished or type(size) not in (int, float)
                        or not math.isfinite(size) or not 0 <= size <= MAX_BYTES):
                    raise ValueError('Browser image completion unavailable')
                self.finished = True


def assert_capture_page(driver, document):
    assert_document(driver, document)
    html, title = driver.page_source, driver.title.lower()
    if (title in ('just a moment...', 'ddos-guard') or 'id="challenge-running"' in html
            or 'id="cf-challenge-running"' in html):
        raise ValueError('Browser title page is challenged')


def hero_loaded(driver, target):
    hero = driver.execute_script(HERO_SCRIPT)
    if hero is None:
        return False
    if type(hero) is not dict or not isinstance(hero.get('url'), str):
        raise ValueError('Browser hero image evidence unavailable')
    if hero['url'] and hero['url'] != target:
        raise ValueError('Browser hero image identity changed')
    return (hero['url'] == target and hero.get('complete') is True
            and all(type(hero.get(key)) in (int, float) and math.isfinite(hero[key]) and hero[key] > 0
                    for key in ('width', 'height')))


def decode_hero(driver, document, target, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('Browser image capture timed out')
    driver.set_script_timeout(remaining)
    result = driver.execute_async_script(DECODE_SCRIPT, {
        'document': document, 'url': target, 'timeoutMs': max(1, math.floor(remaining * 1000)),
    })
    if time.monotonic() >= deadline:
        raise TimeoutError('Browser image capture timed out')
    if type(result) is not dict:
        raise ValueError('Browser image decode evidence unavailable')
    if set(result) == {'decoded'} and result.get('decoded') is True:
        return
    message = {
        'image-decode-failed': 'Browser hero image decode failed',
        'image-decode-timeout': 'Browser hero image decode timed out',
        'image-decode-identity': 'Browser hero image decode identity changed',
        'image-decode-not-ready': 'Browser hero image decode not ready',
    }.get(result.get('reason'))
    if result.get('decoded') is False and message:
        raise ValueError(message)
    raise ValueError('Browser image decode evidence unavailable')


def capture_image(driver, payload, diagnostic=None):
    diagnostic = diagnostic if diagnostic is not None else {}
    diagnostic['stage'] = 'setup'
    target = payload['url']
    document = title_page(target)
    seconds = operation_timeout(payload['timeout'])
    deadline = time.monotonic() + seconds
    first = payload['session'] not in NAVIGATED
    NAVIGATED.add(payload['session'])
    diagnostic['stage'] = 'initial-safety'
    assert_browser_safety(driver, allow_startup=first)
    navigation_started = False
    try:
        # Keep only bounded response bodies; do not disable cache/security or
        # intercept/modify requests. Discard earlier session log entries first.
        diagnostic['stage'] = 'network-enable'
        driver.execute_cdp_cmd('Network.enable', {'maxTotalBufferSize': 2 * MAX_BYTES,
                                                'maxResourceBufferSize': MAX_BYTES,
                                                'maxPostDataSize': 0})
        diagnostic['stage'] = 'initial-log'
        driver.get_log('performance')
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Browser image capture timed out')
        navigation_started = True
        diagnostic['stage'] = 'navigation'
        navigate(driver, document, 'domcontentloaded', remaining, allow_startup=first)
        evidence = ImageEvidence(target, diagnostic)
        while True:
            diagnostic['stage'] = 'page-safety'
            if time.monotonic() >= deadline:
                raise TimeoutError('Browser image capture timed out')
            assert_capture_page(driver, document)
            diagnostic['stage'] = 'observation'
            evidence.observe(driver.get_log('performance'))
            loaded = False
            if evidence.finished:
                diagnostic['stage'] = 'hero'
                loaded = hero_loaded(driver, target)
            if loaded:
                diagnostic['stage'] = 'decode'
                decode_hero(driver, document, target, deadline)
                assert_capture_page(driver, document)
                if not hero_loaded(driver, target):
                    raise ValueError('Browser hero image changed during capture')
                # This is a single read of the browser's actual completed body,
                # not a fallback fetch. Evicted/cache-only bodies fail closed.
                diagnostic['stage'] = 'body-read'
                result = driver.execute_cdp_cmd('Network.getResponseBody', {'requestId': evidence.request_id})
                diagnostic['stage'] = 'final-verification'
                assert_capture_page(driver, document)
                evidence.observe(driver.get_log('performance'))
                if not hero_loaded(driver, target):
                    raise ValueError('Browser hero image changed during capture')
                if time.monotonic() > deadline:
                    raise TimeoutError('Browser image capture timed out')
                diagnostic['stage'] = 'body-validation'
                return {'url': target, 'status': 200, 'contentType': evidence.mime,
                        'body': canonical_body(result), 'encoding': 'base64', 'decoded': True}
            if time.monotonic() >= deadline:
                raise TimeoutError('Browser image capture timed out')
            time.sleep(min(0.1, max(0, deadline - time.monotonic())))
    except Exception:
        # Preserve newly visible CAPTCHA/TLS stops even after a CDP failure.
        assert_browser_safety(driver, allow_startup=first and not navigation_started)
        raise


CAPTURE_STAGES = frozenset({'setup', 'validation', 'session-acquisition', 'initial-safety', 'network-enable', 'initial-log', 'navigation',
                            'page-safety', 'observation', 'hero', 'decode', 'body-read',
                            'final-verification', 'body-validation'})
IMAGE_FAILURE_REASONS = {
    'Unsupported browser image payload': 'image-invalid-request',
    'Unsupported cover target': 'image-invalid-request',
    'Browser network evidence unavailable': 'image-network-evidence-invalid',
    'Browser network evidence exceeds limit': 'image-network-evidence-limit',
    'Browser image redirected': 'image-redirect',
    'Browser image request identity changed': 'image-request-identity',
    'Browser image request duplicated': 'image-request-duplicate',
    'Browser image request method changed': 'image-request-method',
    'Browser image request fragment present': 'image-request-fragment',
    'Browser image request resource type changed': 'image-request-resource-type',
    'Browser image request document changed': 'image-request-document',
    'Browser image response identity changed': 'image-response-identity',
    'Browser image response resource type changed': 'image-response-resource-type',
    'Browser image response duplicated': 'image-response-duplicate',
    'Browser image response status not successful': 'image-response-http-status',
    'Browser image response is forbidden': 'image-response-forbidden',
    'Browser image response from service worker': 'image-response-service-worker',
    'Browser response is not a supported image': 'image-response-mime',
    'Browser image metadata unavailable': 'image-response-metadata',
    'Browser image response is challenged': 'image-response-challenge',
    'Browser image media type invalid': 'image-content-type-invalid',
    'Browser image media type missing': 'image-content-type-missing',
    'Browser image media type duplicated': 'image-content-type-duplicate',
    'Browser image media type changed': 'image-content-type-mismatch',
    'Browser image load failed': 'image-load-failed',
    'Browser image completion unavailable': 'image-load-completion',
    'Browser title page is challenged': 'image-page-challenge',
    'Browser hero image evidence unavailable': 'image-hero-evidence',
    'Browser hero image identity changed': 'image-hero-identity',
    'Browser hero image changed during capture': 'image-hero-changed',
    'Browser image bytes unavailable': 'image-body-unavailable',
    'Browser hero image decode failed': 'image-decode-failed',
    'Browser hero image decode timed out': 'image-decode-timeout',
    'Browser hero image decode identity changed': 'image-decode-identity',
    'Browser hero image decode not ready': 'image-decode-not-ready',
    'Browser image decode evidence unavailable': 'image-decode-evidence',
}


def image_failure_reason(error):
    """Closed diagnostics only, never return driver/error/header/body values."""
    if type(error) is TimeoutError and str(error) == 'Browser image capture timed out':
        return 'image-capture-timeout'
    if isinstance(error, json.JSONDecodeError):
        return 'image-network-evidence-invalid'
    if type(error) is ValueError and str(error) in IMAGE_FAILURE_REASONS:
        return IMAGE_FAILURE_REASONS[str(error)]
    return operation_failure_reason(error)


def register(app):
    @app.post('/webview/image-response')
    def image_response():
        diagnostic = {'stage': 'setup'}
        try:
            diagnostic['stage'] = 'validation'
            payload = request.json
            if (type(payload) is not dict or set(payload) != {'session', 'url', 'timeout'}
                    or not isinstance(payload.get('session'), str)
                    or not re.fullmatch(r'[A-Za-z0-9-]{1,100}', payload['session'])):
                raise ValueError('Unsupported browser image payload')
            title_page(payload['url'])
            operation_timeout(payload['timeout'])
            diagnostic['stage'] = 'session-acquisition'
            with session_lock(payload['session']):
                return capture_image(session_driver(payload['session']), payload, diagnostic)
        except BrowserGate as error:
            response.status = 409
            return {'error': 'Browser requires user action', 'code': error.code}
        except Exception as error:
            response.status = 502
            # Never return network headers, cookies, logs or exception text.
            result = {'error': 'Anonymous browser image capture failed', 'code': 'operation',
                      'phase': 'image-capture',
                      'stage': diagnostic['stage'] if diagnostic['stage'] in CAPTURE_STAGES else 'setup',
                      'reason': image_failure_reason(error)}
            for key in ('cdpMimeCategory', 'contentTypeCategory'):
                if key in diagnostic:
                    value = diagnostic[key]
                    result[key] = value if isinstance(value, str) and value in MIME_CATEGORIES else 'invalid'
            return result
