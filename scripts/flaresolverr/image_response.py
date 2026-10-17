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
from webview_page import NAVIGATED, assert_document, navigate, operation_timeout

MAX_BYTES = 16 * 1024 * 1024
MAX_LOG_BYTES = 16 * 1024 * 1024
IMAGE_MIMES = frozenset({'image/jpeg', 'image/png', 'image/gif', 'image/webp',
                         'image/avif', 'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon'})
HERO_SCRIPT = """
const images = document.querySelectorAll('.hero-v2-thumb img');
if (images.length !== 1) return null;
const image = images[0];
return {url: image.currentSrc, complete: image.complete,
        width: image.naturalWidth, height: image.naturalHeight};
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


class ImageEvidence:
    """Bind the exact observed Image request, response and completed load."""
    def __init__(self, target):
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
                if (redirect or url != self.target or not isinstance(request_id, str) or not request_id
                        or self.request_id is not None
                        or self.mime is not None or self.finished):
                    raise ValueError('Browser image redirected or identity changed')
                # CDP documents method/documentURL; the optional resource
                # type must also be present as Image or evidence fails closed.
                if (network_request.get('method') != 'GET' or network_request.get('urlFragment')
                        or params.get('type') != 'Image' or params.get('documentURL') != self.document):
                    raise ValueError('Browser request is not the title-page image embed')
                self.request_id = request_id
            elif method == 'Network.responseReceived':
                result = params.get('response', {})
                if result.get('url') != self.target and request_id != self.request_id:
                    continue
                if (not self.request_id or request_id != self.request_id or result.get('url') != self.target
                        or params.get('type') != 'Image' or self.mime is not None
                        or type(result.get('status')) not in (int, float) or result['status'] != 200
                        or result.get('fromServiceWorker') is True):
                    raise ValueError('Browser image response did not succeed')
                if result.get('securityState') in ('insecure', 'broken'):
                    raise BrowserGate('security', 'image-transport-error')
                mime = result.get('mimeType')
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
                            raise ValueError('Browser image media type changed')
                        content_types.append(value.split(';', 1)[0].strip().lower())
                if len(content_types) != 1 or content_types[0] != mime:
                    raise ValueError('Browser image media type missing or changed')
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


def capture_image(driver, payload):
    target = payload['url']
    document = title_page(target)
    seconds = operation_timeout(payload['timeout'])
    deadline = time.monotonic() + seconds
    first = payload['session'] not in NAVIGATED
    NAVIGATED.add(payload['session'])
    assert_browser_safety(driver, allow_startup=first)
    navigation_started = False
    try:
        # Keep only bounded response bodies; do not disable cache/security or
        # intercept/modify requests. Discard earlier session log entries first.
        driver.execute_cdp_cmd('Network.enable', {'maxTotalBufferSize': 2 * MAX_BYTES,
                                                'maxResourceBufferSize': MAX_BYTES,
                                                'maxPostDataSize': 0})
        driver.get_log('performance')
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Browser image capture timed out')
        navigation_started = True
        navigate(driver, document, 'domcontentloaded', remaining, allow_startup=first)
        evidence = ImageEvidence(target)
        while True:
            if time.monotonic() >= deadline:
                raise TimeoutError('Browser image capture timed out')
            assert_capture_page(driver, document)
            evidence.observe(driver.get_log('performance'))
            if evidence.finished and hero_loaded(driver, target):
                # This is a single read of the browser's actual completed body,
                # not a fallback fetch. Evicted/cache-only bodies fail closed.
                result = driver.execute_cdp_cmd('Network.getResponseBody', {'requestId': evidence.request_id})
                assert_capture_page(driver, document)
                evidence.observe(driver.get_log('performance'))
                if not hero_loaded(driver, target):
                    raise ValueError('Browser hero image changed during capture')
                if time.monotonic() > deadline:
                    raise TimeoutError('Browser image capture timed out')
                return {'url': target, 'status': 200, 'contentType': evidence.mime,
                        'body': canonical_body(result), 'encoding': 'base64'}
            if time.monotonic() >= deadline:
                raise TimeoutError('Browser image capture timed out')
            time.sleep(min(0.1, max(0, deadline - time.monotonic())))
    except Exception:
        # Preserve newly visible CAPTCHA/TLS stops even after a CDP failure.
        assert_browser_safety(driver, allow_startup=first and not navigation_started)
        raise


def register(app):
    @app.post('/webview/image-response')
    def image_response():
        try:
            payload = request.json
            if (type(payload) is not dict or set(payload) != {'session', 'url', 'timeout'}
                    or not isinstance(payload.get('session'), str)
                    or not re.fullmatch(r'[A-Za-z0-9-]{1,100}', payload['session'])):
                raise ValueError('Unsupported browser image payload')
            title_page(payload['url'])
            operation_timeout(payload['timeout'])
            with session_lock(payload['session']):
                return capture_image(session_driver(payload['session']), payload)
        except BrowserGate as error:
            response.status = 409
            return {'error': 'Browser requires user action', 'code': error.code}
        except Exception:
            response.status = 502
            # Never return network headers, cookies, logs or exception text.
            return {'error': 'Anonymous browser image capture failed'}
