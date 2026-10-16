import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { assertPublicKaganeRequest, assertReadOnlyKaganePost, createManaRuntime } from './mana-runtime.mjs'
import { assertKaganeTaxonomyCache } from './kagane-live-tests.mjs'

const origin = 'https://kagane.org'
const searchURL = `${origin}/api/v2/search/series?page=0&size=50`
const search = (body, url = searchURL) => ({ method: 'POST', url, body })
const fixtures = []
const accept = (name, request) => fixtures.push({ name, request, allowed: true })
const reject = (name, request) => fixtures.push({ name, request, allowed: false })

accept('existing empty search', search({}))
accept('both bounded filters with existing search options', search({
    title: 'test', content_lang: ['en'], current_books: { min: 0, max: 2147483647 }, start_year: { min: 1, max: 9999 }
}))
accept('serialized numeric ranges', search(JSON.stringify({ current_books: { min: 100 }, start_year: { max: 2026 } })))
for (const [field, minimum, maximum] of [['current_books', 0, 2147483647], ['start_year', 1, 9999]]) {
    for (const range of [{ min: minimum }, { max: maximum }, { min: maximum, max: maximum }]) {
        accept(`${field} accepts ${JSON.stringify(range)}`, search({ [field]: range }))
    }
    for (const range of [null, [], true, false, 1, '1', {}, { min: null }, { max: null },
        { min: true }, { max: false }, { min: '1' }, { max: '2' }, { min: 1.5 },
        { min: minimum - 1 }, { max: maximum + 1 }, { min: maximum, max: minimum },
        { min: minimum, unknown: 1 }, { min: minimum, constructor: 1 }, { min: minimum, toString: 1 },
        JSON.parse(`{"min":${minimum},"__proto__":{"max":1}}`)]) {
        reject(`${field} rejects ${JSON.stringify(range)}`, search({ [field]: range }))
    }
    reject(`${field} rejects malformed serialized bound`, search(`{"${field}":{"min":NaN}}`))
}
for (const key of ['password', 'delete', 'purchase', 'current_books_min', 'start_year_max', 'range']) {
    reject(`unrecognized top-level ${key}`, search({ [key]: 1, current_books: { min: 0 } }))
}
for (const path of ['/api/account', '/api/v2/account', '/api/v2/collections', '/api/v2/upload',
    '/api/v2/books/id/purchase', '/api/v2/books/id', '/api/integrity', '/api/v2/sources/list']) {
    reject(`ranges cannot authorize ${path}`, search({ current_books: { min: 0 } }, `${origin}${path}`))
}
for (const url of [
    searchURL.replace('https:', 'http:'), searchURL.replace('kagane.org', 'other.kagane.org'),
    searchURL.replace('kagane.org', 'kagane.org:8443'), searchURL.replace('kagane.org', 'user:password@kagane.org'),
    `${searchURL}#fragment`, `${searchURL}&purchase=true`, `${searchURL}&page=1`, `${searchURL}&size=20`,
    `${origin}/api/v2/search/series/?page=0&size=50`, `${origin}/api/v2/search/series?page=-1&size=50`,
    `${origin}/api/v2/search/series?page=0&size=0`, `${searchURL}&exact_match=1`,
]) reject(`unsupported target/query ${url}`, search({ current_books: { min: 0 } }, url))
for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
    reject(`range body cannot authorize ${method}`, { ...search({ start_year: { min: 1 } }), method })
}
accept('existing integrity bootstrap', search({}, `${origin}/api/integrity`))
accept('existing public reader manifest', search({}, `${origin}/api/v2/books/id?is_datasaver=false`))
accept('existing uploader taxonomy', search({ source_types: null }, `${origin}/api/v2/sources/list`))
accept('existing public GET', { method: 'GET', url: `${origin}/api/v2/series/id/books?limit=200&before=cursor` })

// The sole new read-only route must pass both independent transport guards.
const tracker = '2a849c5f-2cc7-5d67-8be0-4a883e63565c'
const editions = `${origin}/api/v2/trackers/${tracker}/series`
accept('exact bulk edition GET', { method: 'GET', url: editions })
accept('valid uppercase UUID bulk read', { method: 'GET', url: editions.replace(tracker, tracker.toUpperCase()) })
for (const url of [
    editions + '/', editions + '?', editions + '?x=1', editions + '?id=1&id=2', editions + '#', editions + '#x',
    editions.replace('/series', '/relationships'), editions + '/account', editions + '/purchase', editions + '/delete',
    editions.replace(tracker, 'bad'), editions.replace(tracker, tracker.replaceAll('-', '')),
    editions.replace(tracker, '00000000-0000-0000-0000-000000000000'), editions.replace(tracker, tracker.replace('-5d67-', '-9d67-')),
    editions.replace(tracker, tracker.replace('-8be0-', '-7be0-')), editions.replace(tracker, `%32${tracker.slice(1)}`),
    editions.replace('/trackers/', '/trackers/../trackers/'), editions.replace('/trackers/', '/trackers%2F'),
    editions.replace('/series', '/%73eries'), editions.replace('https:', 'http:'),
    editions.replace('kagane.org', 'kagane.org:443'), editions.replace('kagane.org', 'kagane.org:8443'),
    editions.replace('kagane.org', 'user:password@kagane.org'), editions.replace('kagane.org', 'evil.kagane.org'),
    editions.replace('kagane.org', 'kagane.org.evil.test'), editions.replace('kagane.org', 'kagane.org.'),
    editions.replace('kagane.org', 'kagane.org\\@evil.test'), '\n' + editions, editions + '\n',
]) reject(`bulk edition route rejects ${JSON.stringify(url)}`, { method: 'GET', url })
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) reject(`bulk edition rejects ${method}`, { method, url: editions })
for (const body of ['', {}, 'null']) reject('bulk edition rejects body', { method: 'GET', url: editions, body })

test('Mana guard accepts only the exact range schemas on existing read-only routes', () => {
    for (const { name, request, allowed } of fixtures) {
        if (allowed) assert.doesNotThrow(() => assertPublicKaganeRequest(request), name)
        else assert.throws(() => assertPublicKaganeRequest(request), undefined, name)
        if (request.method === 'POST') {
            if (allowed) assert.doesNotThrow(() => assertReadOnlyKaganePost(request), name)
            else assert.throws(() => assertReadOnlyKaganePost(request), undefined, name)
        }
    }
})

test('Mana numeric ranges reject nonfinite, inherited, accessor and non-JSON object tricks', () => {
    for (const field of ['current_books', 'start_year']) {
        for (const range of [
            { min: NaN }, { min: Infinity }, { max: -Infinity }, { min: undefined },
            { min: 1n }, new Date(), new Number(1), Object.create(null),
            Object.assign(Object.create(null), { min: 1 }), Object.create({ min: 1 }),
            Object.assign(Object.create({ max: 2 }), { min: 1 }),
            Object.defineProperty({}, 'min', { value: 1 }),
            Object.defineProperty({}, 'min', { enumerable: true, get: () => 1 }),
            Object.defineProperty({ min: 1 }, 'toJSON', { value: () => ({ min: -1 }) }),
            { min: 1, [Symbol('unknown')]: 1 },
        ]) assert.throws(() => assertReadOnlyKaganePost(search({ [field]: range })))
        assert.throws(() => assertReadOnlyKaganePost(search(Object.defineProperty({}, field, {
            enumerable: true, get: () => ({ min: 1 })
        }))))
    }
    assert.doesNotThrow(() => assertReadOnlyKaganePost(search(runInNewContext(
        '({ current_books: { min: 0, max: 2147483647 }, start_year: { min: 1, max: 9999 } })'
    ))))
})

test('Python browser guard matches the JSON fixtures without importing transport services', () => {
    // Compile only the pure guard and its constants/helpers from the real module.
    // Importing browser_request itself would initialize Bottle/FlareSolverr state.
    const program = `
import ast, json, pathlib, re, sys
from urllib.parse import parse_qsl, urlparse
tree = ast.parse(pathlib.Path(sys.argv[1]).read_text())
names = {'ID', 'SEARCH_KEYS'}
nodes = [node for node in tree.body if (
    isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in names for target in node.targets)
) or (isinstance(node, ast.FunctionDef) and node.name in {'valid_numeric_range', 'assert_public_request'})]
exec(compile(ast.Module(body=nodes, type_ignores=[]), sys.argv[1], 'exec'))
results = []
for fixture in json.load(sys.stdin):
    try:
        assert_public_request(fixture['request'])
        allowed = True
    except (ValueError, TypeError):
        allowed = False
    results.append(allowed)
# Python-specific object/nonfinite checks exercise the same exact JSON schema.
class DerivedRange(dict):
    pass
for value in [DerivedRange(min=1), {'min': float('nan')}, {'min': float('inf')}, {'min': True}]:
    assert not valid_numeric_range(value, 0, 2147483647)
for body in ['{"current_books":{"min":1,"min":2}}', '{"start_year":{"max":2026,"max":2027}}']:
    try:
        assert_public_request({'method': 'POST', 'url': '${searchURL}', 'body': body})
    except ValueError:
        pass
    else:
        raise AssertionError('duplicate JSON range bounds accepted')
print(json.dumps(results))
`
    const result = spawnSync('python3', ['-c', program,
        fileURLToPath(new URL('./flaresolverr/browser_request.py', import.meta.url))], {
        input: JSON.stringify(fixtures), encoding: 'utf8'
    })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    const actual = JSON.parse(result.stdout)
    assert.equal(actual.length, fixtures.length)
    fixtures.forEach((fixture, index) => assert.equal(actual[index], fixture.allowed, fixture.name))
})

test('finalized range requests fail closed before transport and accepted bodies serialize unchanged', async () => {
    const sent = []
    const client = new (createManaRuntime({ logger: () => {}, fetchImpl: async (url, init) => {
        sent.push({ url: String(url), ...init })
        return new Response('{}', { headers: { 'content-type': 'application/json' } })
    } }).NetworkClient)()
    for (const { request, allowed } of fixtures) {
        if (!allowed && request.method === 'POST') await assert.rejects(client.request(request))
    }
    await assert.rejects(client.request({ ...search({ current_books: { min: 0 } }), params: { purchase: true } }))
    await assert.rejects(client.request({ ...search({ current_books: { min: 0 } }), params: { page: 1 } }))
    assert.equal(sent.length, 0)
    const body = { current_books: { min: 0, max: 2147483647 }, start_year: { min: 1, max: 9999 } }
    await client.request(search(body))
    assert.equal(sent.length, 1)
    assert.equal(sent[0].body, JSON.stringify(body))
    assert.equal(sent[0].url, searchURL)
})

test('taxonomy cache oracle distinguishes one evidenced recovery from redundant or failed loads', async () => {
    const run = async (tags, mutate) => {
        const requests = ['genres', 'sources'].map(method => ({ url: `${origin}/api/v2/${method}/list`, status: 200 }))
        requests.push(...tags.map(attempt => ({ url: `${origin}/api/v2/tags/list`, ...attempt })))
        const evidence = [], reads = []
        const source = { api: Object.fromEntries(['genres', 'tags', 'sources'].map(method => [method, async () => {
            reads.push(method)
            return mutate?.(method, requests) ?? [{ id: method }]
        }])) }
        await assertKaganeTaxonomyCache({ source, requests, logger: line => evidence.push(line) })
        assert.deepEqual(reads, ['genres', 'tags', 'sources'])
        return evidence
    }
    assert.deepEqual(await run([{ status: 200 }]), [])
    assert.match((await run([{ status: 500 }, { status: 200 }]))[0], /RECOVERED.*tags\/list: 500/)
    assert.match((await run([{ error: 'Network unavailable' }, { status: 200 }]))[0], /RECOVERED.*ERROR/)
    for (const attempts of [
        [], [{ status: 500 }], [{ status: 500 }, { status: 500 }],
        [{ status: 200 }, { status: 200 }], [{ status: 200 }, { status: 500 }],
        [{ status: 500 }, { status: 500 }, { status: 200 }], [{}, { status: 200 }],
        [{ status: 0 }, { status: 200 }], [{ status: 200, error: ' ' }, { status: 200 }],
    ]) await assert.rejects(run(attempts), /taxonomy/i)
    await assert.rejects(run([{ status: 200 }], method => method === 'tags' ? [] : undefined), /No validated cached/)
    await assert.rejects(run([{ status: 200 }], (method, requests) => {
        if (method === 'tags') requests.push({ url: `${origin}/api/v2/tags/list`, status: 200 })
    }), /cache read fetched again/)
})
