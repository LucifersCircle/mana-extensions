import { setTimeout as delay } from 'node:timers/promises'

// A small Node host for live source checks, not a Mana/iOS emulator. The built
// bundle supplies the real @mana-app/types enums and NetworkClientBuilder.
// ObjectStore is process-local for preference callbacks; iOS persistence, WebViews,
// automatic retries and cookie persistence are not emulated.
export function createManaRuntime({ logger = logRequest } = {}) {
    class NetworkError extends Error {
        constructor(name, message, req, res) {
            super(message)
            this.name = name
            this.req = req
            this.res = res
        }
    }

    class CloudflareError extends Error {
        constructor(resolutionURL) {
            super(`Challenge requires the Mana app: ${resolutionURL ?? 'unknown URL'}`)
            this.name = 'CloudflareError'
            this.resolutionURL = resolutionURL
        }
    }

    class NetworkClient {
        constructor(builder = {}) {
            this.builder = builder
            this.nextRequestAt = 0
        }

        get(url, config) {
            return this.request({ ...config, url, method: 'GET' })
        }

        post(url, config) {
            return this.request({ ...config, url, method: 'POST' })
        }

        async request(input) {
            const builder = this.builder
            let request = {
                ...input,
                timeout: input.timeout ?? builder.timeout ?? 30_000,
                maxRetries: input.maxRetries ?? builder.maxRetries ?? 0,
                validateStatus: input.validateStatus ?? builder.statusValidator,
                method: input.method ?? 'GET',
                headers: { ...builder.headers, ...input.headers },
                cookies: [...(builder.cookies ?? []), ...(input.cookies ?? [])],
                transformRequest: [...(builder.requestTransformers ?? []), ...asArray(input.transformRequest)],
                transformResponse: [...(builder.responseTransformers ?? []), ...asArray(input.transformResponse)]
            }
            for (const transform of request.transformRequest) {
                request = await transform(request)
            }
            if (!['GET', 'HEAD'].includes(request.method) || request.body != null) {
                assertReadOnlyMangaSushiPost(request)
            }
            if (request.maxRetries !== 0) {
                throw new Error('Automatic retries are unsupported by the live test host')
            }
            if (!Number.isFinite(request.timeout) || request.timeout <= 0) {
                throw new Error('Live test requests require a positive finite timeout')
            }
            if (request.responseEncoding && !['text', 'base64'].includes(request.responseEncoding)) {
                throw new Error(`Unsupported response encoding: ${request.responseEncoding}`)
            }
            const url = new URL(request.url)
            if (!['http:', 'https:'].includes(url.protocol)) {
                throw new Error(`Unsupported request protocol: ${url.protocol}`)
            }
            for (const [key, value] of Object.entries(request.params ?? {})) {
                if (value == null) continue
                if (!['string', 'number', 'boolean'].includes(typeof value)) {
                    throw new Error(`Unsupported non-scalar query parameter: ${key}`)
                }
                url.searchParams.append(key, String(value))
            }
            const headers = new Headers()
            for (const [key, value] of Object.entries(request.headers ?? {})) {
                headers.set(key, String(value))
            }
            if (request.cookies?.length) {
                const cookies = request.cookies.map(({ name, value }) => `${name}=${value}`).join('; ')
                headers.set('Cookie', [headers.get('Cookie'), cookies].filter(Boolean).join('; '))
            }
            const rate = builder.requestsPerSecond
            if (rate != null && rate !== 0) {
                if (!Number.isFinite(rate) || rate < 0) throw new Error('Invalid request rate limit')
                const startAt = Math.max(Date.now(), this.nextRequestAt)
                this.nextRequestAt = startAt + 1000 / rate
                await delay(Math.max(0, startAt - Date.now()))
            }
            const started = Date.now()
            let status
            try {
                const raw = await fetch(url, {
                    method: request.method,
                    headers,
                    body: request.body,
                    signal: AbortSignal.timeout(request.timeout)
                })
                status = raw.status
                let response = {
                    status,
                    headers: Object.fromEntries(raw.headers),
                    data: request.responseEncoding === 'base64'
                        ? Buffer.from(await raw.arrayBuffer()).toString('base64')
                        : await raw.text(),
                    request: { ...request, url: url.href }
                }
                for (const transform of asArray(request.transformResponse)) {
                    response = await transform(response)
                }
                const validate = request.validateStatus ?? ((value) => value >= 200 && value < 300)
                if (!validate(response.status)) {
                    throw new NetworkError('NetworkError', `HTTP ${response.status}: ${url.href}`, response.request, response)
                }
                logger({ url: url.href, status, durationMs: Date.now() - started })
                return response
            } catch (error) {
                logger({ url: url.href, status, durationMs: Date.now() - started, error: error.message })
                throw error
            }
        }
    }

    const runtime = {
        NetworkClient,
        NetworkError,
        CloudflareError,
        ObjectStore: createObjectStore(),
        SecureStore: unsupported('SecureStore'),
        WebViewPage: unsupported('WebViewPage'),
        console,
        URL,
        URLSearchParams,
        Buffer,
        TextEncoder,
        TextDecoder,
        atob,
        btoa,
        setTimeout,
        clearTimeout
    }
    runtime.global = runtime
    return runtime
}

function asArray(value) {
    return value == null ? [] : Array.isArray(value) ? value : [value]
}

function unsupported(name) {
    return new Proxy({}, {
        get() {
            throw new Error(`${name} is unsupported by the live test host; test this source in Mana`)
        }
    })
}

function logRequest({ url, status, durationMs, error }) {
    console.log(`[http] ${status ?? 'ERROR'} ${url} (${durationMs}ms)${error ? `: ${error}` : ''}`)
}

// These two public AJAX operations retrieve catalog/chapter HTML, not account state.
// All other POST targets and actions remain unsupported and fail closed.
export function assertReadOnlyMangaSushiPost(request) {
    const target = new URL(request.url)
    if (request.method !== 'POST' || target.origin !== 'https://mangasushi.org'
        || typeof request.body !== 'string' || target.search || target.hash) {
        throw new Error('Live test host rejects unsupported non-read-only request')
    }
    if (/^\/manga\/[^/]+\/ajax\/chapters\/$/.test(target.pathname) && request.body === '') return
    const body = new URLSearchParams(request.body)
    const keys = [...body.keys()]
    if (new Set(keys).size !== keys.length
        || keys.some((key) => keys.some((other) => other !== key && other.startsWith(`${key}[`)))) {
        throw new Error('Live test host rejects duplicate or conflicting AJAX parameters')
    }
    if (target.pathname === '/wp-admin/admin-ajax.php'
        && body.get('action') === 'madara_load_more'
        && /^\d+$/.test(body.get('page') ?? '')
        && /^madara-core\/content\/content-(search|archive)$/.test(body.get('template') ?? '')
        && body.get('vars[post_type]') === 'wp-manga'
        && keys.every((key) => ['action', 'page', 'template'].includes(key) || /^vars(?:\[[A-Za-z0-9_]+\])+$/.test(key))) return
    throw new Error('Live test host rejects unsupported MangaSushi AJAX action')
}

function createObjectStore() {
    const values = new Map()
    return {
        async get(key) { return values.get(key) ?? null },
        async set(key, value) { values.set(key, structuredClone(value)) },
        async remove(key) { values.delete(key) },
        async boolean(key) {
            const value = values.get(key) ?? null
            if (value !== null && typeof value !== 'boolean') throw new Error('ObjectStore value is not a boolean')
            return value
        }
    }
}
