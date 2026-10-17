// Test-only official Mana image dispatch. Authorization probes stop at the image
// bridge boundary; successful live images always retain the native response bytes.
import { httpHostFor } from './mana-http-host.mjs';
import { assertCoverImageURL, browserImageProof } from './mana-test-webview.mjs';

const resolvedBrowserImages = new WeakMap();
export const resolvedBrowserImageProof = response => resolvedBrowserImages.get(response);

// Initiate the SDK call synchronously here, or use its VM Promise chain. Node
// async/await continuations do not inherit the official VM operation context.
export function runTestOperation(source, callback) { return httpHostFor(source).runOperation(callback); }
export function createHttpResponse(source, options) { return httpHostFor(source).createResponse(options); }
export function withSourceTransport(source, fetchImpl, callback) { return httpHostFor(source).withTransport(fetchImpl, callback); }

export async function authorizeTestImage(source, url, { origin } = {}) {
    try { return (await httpHostFor(source).dispatchImage(source, url, { origin, probe: true })).request; }
    catch (failure) { throw failure.imageDispatchFailure ? failure.error : failure; }
}

function authorizedCoverContract(source, mode) {
    const request = mode.request;
    if (source.info.id !== 'Marumaru' || request?.origin !== 1 || request.method !== 'GET' || request.body !== undefined
        || Object.keys(request.headers).join(',') !== 'referer' || request.headers.referer !== 'https://marumaru105.com/') {
        throw new Error('Unsupported browser-context image resolution contract');
    }
    assertCoverImageURL(request.url);
}

export async function fetchTestImage(source, url, { origin, captureCoverImage, log = () => {}, fetchImpl } = {}) {
    const host = httpHostFor(source);
    if (fetchImpl !== undefined) return host.withTransport(fetchImpl, () => fetchTestImage(source, url, { origin, captureCoverImage, log }));
    try { return (await host.dispatchImage(source, url, { origin, log })).response; }
    catch (failure) {
        if (!failure.imageDispatchFailure) throw failure;
        const { error, mode } = failure, native = mode.native;
        // The official SDK throws before response interceptors. Positive native
        // evidence, exact URL and failed native status are all required, not a
        // guessed error name, generic 403 or challenge HTML alone.
        if (source.info.id !== 'Marumaru' || origin !== 'cover'
            || error?.name !== 'CloudflareError' || error.resolutionURL !== mode.request?.url
            || !native || native.status >= 200 && native.status < 300 || native.url !== mode.request.url
            || native.headers['cf-mitigated']?.toLowerCase() !== 'challenge') throw error;
        authorizedCoverContract(source, mode);
        if (typeof captureCoverImage !== 'function') throw error;
        const captured = await captureCoverImage(mode.request.url);
        if (captured.url !== mode.request.url) throw new Error('Browser-context image response identity changed');
        // A second full official dispatch reruns all async authorization before
        // the captured bytes are supplied to its response-policy interceptors.
        let refreshed;
        try {
            refreshed = await host.dispatchImage(source, url, { origin, replay: captured, log });
        } catch (retry) { throw retry.imageDispatchFailure ? retry.error : retry; }
        authorizedCoverContract(source, refreshed.mode);
        if (refreshed.mode.request.url !== mode.request.url) throw new Error('Source image identity changed during challenge resolution');
        const proof = browserImageProof(captured);
        if (proof) resolvedBrowserImages.set(refreshed.response, proof);
        return refreshed.response;
    }
}
