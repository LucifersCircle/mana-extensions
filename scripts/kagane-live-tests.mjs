import assert from 'node:assert/strict';
import { decode } from 'html-entities';
import { assertPublicKaganeRequest, assertReadOnlyKaganePost, createManaRuntime, redactURL, redactText } from './mana-runtime.mjs';
import { createManaTestTransport } from './mana-test-browser.mjs';

// Host-transport regressions belong to the existing live-contract guard, not a
// separate fixture/parser suite. This can also run without touching the network.
export async function assertKaganeHostGuards({ freshSource } = {}) {
  const domain = 'https://kagane.org', api = `${domain}/api/v2`;
  assertReadOnlyKaganePost({ method: 'POST', url: `${api}/search/series?page=0&size=50`, body: { title: 'test' } });
  for (const request of [
    { method: 'POST', url: `${domain}/api/account`, body: {} },
    { method: 'POST', url: `${api}/sources/list`, body: { source_types: null, delete: true } },
    { method: 'POST', url: `${api}/search/series?page=0&page=1&size=50`, body: {} },
    { method: 'POST', url: `${api}/books/id?is_datasaver=false&purchase=true`, body: {} },
    { method: 'POST', url: `${api}/search/series?page=0&size=50`, body: { password: 'not-a-secret' } },
    { method: 'POST', url: 'https://user:password@kagane.org/api/integrity', body: {} },
    { method: 'GET', url: `${domain}/api/account` },
    { method: 'GET', url: `${api}/image/id?token=not-a-live-token` },
    { method: 'GET', url: `${api}/series/id/books?limit=200&before=one&before=two` },
  ]) assert.throws(() => assertPublicKaganeRequest(request), /unsupported/i);
  for (const path of ['/api/v2/genres/list', '/api/v2/tags/list', '/api/v2/image/cover-id', '/api/v2/series/id', '/api/v2/series/id/books/index', '/api/v2/series/id/books?limit=200&before=cursor']) {
    assertPublicKaganeRequest({ method: 'GET', url: `${domain}${path}` });
  }
  const recorded = [];
  const directFetch = async (url, init) => {
    recorded.push({ url: String(url), ...init });
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  };
  const guarded = new (createManaRuntime({ logger: () => {}, fetchImpl: directFetch }).NetworkClient)();
  await assert.rejects(guarded.request({ method: 'POST', url: `${api}/books/id?is_datasaver=false`, params: { purchase: true }, body: {} }), /unsupported/i);
  await assert.rejects(guarded.request({ method: 'POST', url: `${api}/books/id?is_datasaver=false`, params: { is_datasaver: true }, body: {} }), /unsupported/i);
  assert.equal(recorded.length, 0, 'Rejected finalized URLs reached the network');
  await guarded.request({ method: 'POST', url: `${api}/search/series`, params: { page: 0, size: 50 }, body: { title: 'JSON café' } });
  assert.equal(recorded[0].body, JSON.stringify({ title: 'JSON café' }));
  assert.equal(new URL(recorded[0].url).searchParams.get('size'), '50');
  assert.equal(createManaTestTransport({ solverURL: '', fetchImpl: directFetch }).fetch, directFetch, 'Browser transport must be opt-in');
  let active = 0, peak = 0, creates = 0, warms = 0, destroys = 0;
  const browserPayloads = [], bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x80, 0xfe, 0x00]);
  const browser = createManaTestTransport({ solverURL: 'http://127.0.0.1:8191', fetchImpl: async (url, init) => {
    active += 1; peak = Math.max(peak, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      const payload = JSON.parse(init.body);
      if (String(url).endsWith('/v1')) {
        if (payload.cmd === 'sessions.create') creates += 1;
        else if (payload.cmd === 'sessions.destroy') destroys += 1;
        else assert.fail('Automatic CAPTCHA solver must never be invoked');
        return Response.json({ status: 'ok' });
      }
      if (String(url).endsWith('/browser/warm')) { warms += 1; return Response.json({ ready: true }); }
      browserPayloads.push(payload);
      if (/\/(?:genres\/list|host-cloudflare-probe)$/.test(payload.url)) {
        return Response.json({ status: 403, url: payload.url, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' }, body: Buffer.from('Just a moment').toString('base64'), encoding: 'base64' });
      }
      return Response.json({ status: 200, url: payload.url, headers: { 'content-type': 'image/jpeg' }, body: bytes.toString('base64'), encoding: 'base64' });
    } finally { active -= 1; }
  } });
  try {
    const body = JSON.stringify({ title: 'JSON café' });
    const responses = await Promise.all([
      browser.fetch(`${api}/search/series?page=0&size=50`, { method: 'POST', body }),
      browser.fetch(`${api}/image/cover-id`),
    ]);
    for (const response of responses) assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes, 'Chromium hop corrupted actual image bytes');
    assert.equal(browserPayloads[0].body, body, 'JSON POST became a form request');
    assert.equal(creates, 1); assert.equal(warms, 1); assert.equal(peak, 1, 'Concurrent WebDriver commands raced');
    const remainingChallenge = await browser.fetch(`${api}/genres/list`);
    assert.equal(remainingChallenge.status, 403);
    assert.equal(remainingChallenge.headers.get('cf-mitigated'), 'challenge');
    assert.equal(await remainingChallenge.text(), 'Just a moment');
    if (freshSource) {
      const challenged = freshSource();
      const runtime = createManaRuntime({ logger: () => {}, fetchImpl: browser.fetch });
      challenged.api.client = new runtime.NetworkClient({ statusValidator: () => true });
      await assert.rejects(challenged.api.series('host-cloudflare-probe'), (error) => error.name === 'CloudflareError');
    }
    await assert.rejects(browser.fetch(`${domain}/api/account`), /unsupported/i);
    await assert.rejects(browser.fetch(`${api}/genres/list`, { headers: { authorization: 'not-an-account-token' } }), /credentials/i);
  } finally { await browser.close(); }
  assert.equal(destroys, 1, 'Anonymous browser session was not destroyed');
  for (const code of ['captcha', 'security', 'other']) {
    const failing = createManaTestTransport({ solverURL: 'http://127.0.0.1:8191', fetchImpl: async () => Response.json({ error: 'secret-token-never-log', code }, { status: 409 }) });
    await assert.rejects(failing.fetch(`${api}/genres/list`), (error) => {
      assert(!error.message.includes('secret-token-never-log'));
      assert.match(error.message, code === 'captcha' ? /CAPTCHA.*approval/ : code === 'security' ? /security warning/ : /failed/);
      return true;
    });
    await failing.close();
  }
  if (freshSource) {
    const challenged = freshSource();
    const runtime = createManaRuntime({ logger: () => {}, fetchImpl: async () => new Response('Just a moment', { status: 403, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' } }) });
    challenged.api.client = new runtime.NetworkClient({ statusValidator: () => true });
    await assert.rejects(challenged.api.series('host-cloudflare-probe'), (error) => error.name === 'CloudflareError');
  }
  assert(!redactText(`NetworkError: ${api}/books/page/book/image.jxl?token=not-a-live-token`).includes('not-a-live-token'));
  assert(!redactURL(`${api}/books/page/book/image.jxl?token=not-a-live-token&is_datasaver=false`).includes('not-a-live-token'));
}

// Reuse this run's actual public series/books, changing only language fields.
// Reader/image checks remain separate and use actual provider manifests and bytes.
export async function assertKaganeChapterLanguages({ freshSource, id, detail, books, sources }) {
  assert(detail && books?.length, 'No successful live Kagane sample for language boundaries');
  const target = freshSource();
  assert.equal(detail.translated_language, 'en', 'Need the actual live English sample before language mutation');
  let translated = detail.translated_language;
  const calls = { series: 0, books: 0, sources: 0 };
  target.api.series = async () => { calls.series += 1; return { ...detail, translated_language: translated }; };
  target.api.books = async () => { calls.books += 1; return books; };
  target.api.sources = async () => { calls.sources += 1; return sources; };
  const savedLanguages = (await target.settings()).languages;
  // The real English series must not become Spanish when preferences reorder.
  await target.save('languages', ['es', 'en']);
  try {
    const baseline = await target.getChapters(id);
    assert(baseline.length);
    assert(baseline.every((chapter) => chapter.language === 'en'));
    const cases = [
      [undefined, 'und'], [null, 'und'], ['', 'und'], ['  ', 'und'], ['unk', 'und'], ['und', 'und'], ['UNKNOWN', 'und'], [42, 'und'], [{}, 'und'], [[], 'und'],
      ['en--US', 'und'], ['English', 'und'], ['https://invalid', 'und'], ['en-US-US', 'und'],
      ['es', 'es'], [' es ', 'es'], ['pt-br', 'pt-BR'], ['pt-BR', 'pt-BR'], ['pt', 'pt'], ['es-la', 'es-419'], ['es-419', 'es-419'], ['zh-hk', 'zh-HK'], ['zh-Hans', 'zh-Hans'], ['zh-Hant', 'zh-Hant'], ['en_US', 'en-US'], ['iw', 'he'], ['in', 'id'], ['ji', 'yi'], ['ja-ro', 'ja-Latn'], ['fil', 'fil'], ['pt-la', 'pt-BR'], ['ko-ro', 'ko-Latn'], ['zh-ro', 'zh-Latn'],
    ];
    for (const [value, expected] of cases) {
      translated = value;
      await target.save('languages', ['es', 'en']);
      const before = { ...calls };
      const chapters = await target.getChapters(id);
      assert(chapters.every((chapter) => chapter.language === expected));
      assert.deepEqual(Object.fromEntries(Object.entries(calls).map(([key, value]) => [key, value - before[key]])), { series: 1, books: 1, sources: 1 }, 'Language classification added per-chapter requests');
      assert.deepEqual(Array.from(chapters, ({ language, ...chapter }) => chapter), Array.from(baseline, ({ language, ...chapter }) => chapter));
    }
    assert.equal(target.info.supportedLanguages, undefined, 'Do not claim an unverified English-only catalogue');
  } finally { await target.save('languages', savedLanguages); }
}

// Replay this run's taxonomy and bulk search response at native entrypoints. This
// validates serialization/errors, not whether a server obeys these tag filters.
export async function assertKaganeTagFilters({ freshSource, tags, response, option, groupId }) {
  const tag = tags.find((entry) => entry.id === option.id.split('+')[0]);
  assert(tag && response?.content?.length, 'Need actual Kagane taxonomy/search seeds');
  const target = freshSource(), bodies = [];
  target.api.tags = async () => tags;
  target.api.search = async (body) => { bodies.push(JSON.parse(JSON.stringify(body))); return { ...response, last: true }; };
  const saved = (await target.settings()).excludedTags;
  await target.save('excludedTags', []);
  const search = (filters, listId) => target.search({ query: response.content[0].title, filters, ...(listId ? { listId } : {}) });
  try {
    for (const filters of [
      { tag_query: '__kagane_unknown_filter__' }, { tag_query: '-__kagane_unknown_filter__' },
      { tag_query: `${tag.id}, __kagane_unknown_filter__` }, { tag_query: '-' }, { tag_query: 42 },
      { [groupId]: { included: [{ id: '__stale_tag__' }], excluded: [] } },
      { [groupId]: { included: [], excluded: [{ id: `${tag.id}+__stale_tag__` }] } },
      { [groupId]: { included: [{ id: `${tag.id}+` }] } },
      { [groupId]: [] }, { [groupId]: { included: null } }, { [groupId]: { included: [null] } },
      { [groupId]: { include: [option] } }, { 'tags:__stale_group__': { included: [option] } },
      { match_all_tags: 'true' },
    ]) {
      for (const listId of [undefined, 'popular']) {
        const before = bodies.length;
        await assert.rejects(search(filters, listId), /(?:Unknown|Invalid) Kagane tag/);
        assert.equal(bodies.length, before, 'Invalid tag reached the search API');
      }
    }
    for (const [filters, values, exclude] of [
      [{ tag_query: tag.id }, [tag.id], undefined],
      [{ tag_query: `-${tag.id}` }, [], [tag.id]],
      [{ [groupId]: { included: [option], excluded: [] } }, option.id.split('+'), undefined],
      [{ [groupId]: { included: [], excluded: [option] } }, [], option.id.split('+')],
    ]) {
      await search(filters);
      assert.deepEqual(bodies.at(-1).tags.values, values);
      assert.deepEqual(bodies.at(-1).tags.exclude, exclude);
    }
    for (const filters of [undefined, {}, { tag_query: ' , , ' }, { [groupId]: { included: [], excluded: [] } }]) {
      await search(filters);
      assert.equal(bodies.at(-1).tags, undefined, 'Empty selection added a tag filter');
    }
    for (const filters of [{ tag_query: tag.id }, { [groupId]: { included: [option], excluded: [] } }]) {
      await search(filters, 'popular');
      assert.equal(bodies.at(-1).tags, undefined, 'Discovery changed its pre-existing provider body');
    }
    await target.save('excludedTags', ['__stale_tag__']);
    const before = bodies.length;
    await assert.rejects(search(), /Unknown Kagane tag/);
    assert.equal(bodies.length, before, 'Stale saved exclusion reached the search API');
    await target.save('excludedTags', []);
    const unavailable = new Error('Kagane taxonomy network unavailable');
    target.api.tags = async () => { throw unavailable; };
    await assert.rejects(search({ tag_query: tag.id }), (error) => error === unavailable);
    assert.equal(bodies.length, before, 'Unavailable taxonomy reached the search API');
  } finally { await target.save('excludedTags', saved); }
}

// Validate the field actually consumed by this native request. Equal values are
// valid ties; unrated rows are omitted from rating comparisons, never coerced
// to zero. Counts must be present nonnegative integers.
export function assertKaganeNumericSortOrder({ response, result, field, ascending }) {
  const rows = response.content, values = Array.from(rows, (item) => item[field]);
  assert(values.length > 1, 'Need a numeric sort sample');
  assert(values.every(value => field === 'rating' && value == null || typeof value === 'number' && Number.isFinite(value) && value >= 0 && (field === 'rating' ? value <= 100 : Number.isInteger(value))), `Invalid consumed ${field}`);
  const numeric = values.filter(value => typeof value === 'number');
  assert(numeric.length > 1, 'Insufficient numeric sort observations');
  assert(numeric.every((value, index) => index === 0 || (ascending ? numeric[index - 1] <= value : numeric[index - 1] >= value)), `${field} direction is wrong; tied values are valid`);
  const ids = new Set(Array.from(result.results, item => item.id));
  assert.deepEqual(Array.from(result.results, item => item.id), Array.from(rows).filter(row => ids.has(row.series_id)).map(row => row.series_id), 'Native numeric sort changed consumed row order');
}

// Reuse this run's actual response at the API-method boundary, without probes.
export async function assertKaganeSavedSorts({ freshSource, response }) {
  assert(response?.content?.length > 1, 'Need a successful sort response');
  const target = freshSource(), calls = [];
  target.api.client.request = async () => assert.fail('Saved-sort checks must not request provider data');
  target.api.search = async (...args) => { calls.push(JSON.parse(JSON.stringify(args))); return { ...response, last: true }; };
  const request = { page: 1, query: 'saved sort', filters: { exact_match: true, current_books_min: '0', start_year_max: '9999' } };
  const search = (sort) => target.search({ ...request, ...(sort === undefined ? {} : { sort }) });
  const canonical = await search({ id: 'current_books' });
  const body = calls[0][0];
  assert.equal(calls[0][3], 'current_books,desc');
  assert.equal(calls[0][1], 1); assert.equal(calls[0][2], 50); assert.equal(calls[0][4], true);
  assert.equal(body.title, request.query); assert.deepEqual(body.current_books, { min: 0 }); assert.deepEqual(body.start_year, { max: 9999 });
  for (const sort of [{ id: 'books_count' }, { id: 'books_count', ascending: false }, { id: 'current_books', ascending: false }, { id: 'books_count,desc' }, { id: 'books_count,desc', ascending: true }]) {
    assert.deepEqual(await search(sort), canonical);
    assert.equal(calls.length, 1, 'Equivalent descending count sorts did not share cache');
  }
  const ascending = await search({ id: 'current_books', ascending: true });
  for (const sort of [{ id: 'books_count', ascending: true }, { id: 'books_count,asc' }, { id: 'books_count,asc', ascending: false }]) {
    assert.deepEqual(await search(sort), ascending);
    assert.equal(calls.length, 2, 'Explicit saved suffix must override native direction');
  }
  for (const id of ['updated_at', 'created_at', 'current_books', 'rating']) {
    target.searchPages.clear();
    for (const ascending of [undefined, false, true]) {
      await search({ id, ascending });
      assert.equal(calls.at(-1)[3], `${id},${ascending === true ? 'asc' : 'desc'}`);
      assert.deepEqual(calls.at(-1).slice(0, 3), [body, 1, 50]); assert.equal(calls.at(-1)[4], true);
    }
  }
  await search(); const relevanceCalls = calls.length; assert.equal(calls.at(-1)[3], '');
  await search(null); assert.equal(calls.length, relevanceCalls, 'Whole-null optional sort no longer shares Relevance cache');
  for (const ascending of [undefined, false, true]) {
    await search({ id: 'relevance', ascending }); assert.equal(calls.length, relevanceCalls, 'Relevance changed its empty provider sort');
  }
  for (const id of ['total_views', 'avg_views', 'avg_views_today', 'avg_views_week', 'avg_views_month']) {
    await search({ id, ascending: true }); assert.equal(calls.at(-1)[3], `${id},desc`, 'Nonorderable popularity changed direction');
  }
  for (const [listId, sort] of [['popular', 'total_views'], ['latest_updates', 'updated_at'], ['recently_added', 'created_at']]) {
    await target.search({ ...request, listId, sort: { id: 'rating', ascending: true } });
    assert.equal(calls.at(-1)[0].title, undefined); assert.equal(calls.at(-1)[3], `${sort},desc`, 'Discovery lost its descending route');
  }
  const invalid = ['series_name', 'series_name,asc', 'series_name,desc', 'series_name,invalid', 'current_books,asc', 'books_count,invalid', 'total_views,asc', 'rating,asc', 'rating,ASC', 'created_at,sideways', 'popular_now', '', null, undefined, 42, {}].map(id => ({ id }));
  invalid.push(...[null, 'true', 0, 1, {}, []].map(ascending => ({ id: 'rating', ascending })));
  for (const sort of invalid) {
    const stale = freshSource(); let providerRequests = 0;
    stale.api.client.request = async () => { providerRequests += 1; assert.fail('Unsupported sort reached provider'); };
    stale.api.search = async () => { providerRequests += 1; assert.fail('Unsupported sort reached search'); };
    await assert.rejects(stale.search({ page: 1, sort, filters: { tag_query: 'requires taxonomy' } }), /choose another sort/i);
    assert.equal(providerRequests, 0, 'Malformed sort requested provider data');
  }
  // Every directional page session must own its continuation, including direct
  // page-2 loads. A repeated descending page must survive ascending cache use.
  const paged = freshSource(), pages = [];
  paged.api.client.request = async () => assert.fail('Sort pagination cannot request provider');
  const split = Math.ceil(response.content.length / 2);
  paged.api.search = async (...args) => { pages.push(JSON.parse(JSON.stringify(args))); return { ...response, content: args[1] === 1 ? response.content.slice(0, split) : response.content.slice(split), last: args[1] >= 2 }; };
  for (const id of ['updated_at', 'created_at', 'current_books', 'rating']) {
    for (const ascending of [false, true]) {
      const before = pages.length;
      await paged.search({ ...request, page: 2, sort: { id, ascending } });
      assert.deepEqual(pages.slice(before).map(args => args[1]), [1, 2], 'Direction reused another session continuation');
      for (const args of pages.slice(before)) { assert.deepEqual(args[0], body); assert.equal(args[3], `${id},${ascending ? 'asc' : 'desc'}`); assert.equal(args[4], true); }
    }
    const before = pages.length;
    await paged.search({ ...request, page: 2, sort: { id, ascending: false } });
    assert.equal(pages.length, before, 'Ascending request corrupted descending page cache');
  }
}

// Replay only this run's public bulk rows. These are native serialization/cache
// regressions, not evidence that the provider implements the numeric predicates.
export async function assertKaganeNumericRanges({ freshSource, response, tags, sample }) {
  assert(response?.content?.length && sample && tags?.length, 'Need actual Kagane range replay seeds');
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const makeReplay = (pageResponse = () => ({ ...response, last: true })) => {
    const target = freshSource(), calls = [];
    target.api.client.request = async () => assert.fail('Range replay must not request provider data');
    target.api.tags = async () => tags;
    target.api.search = async (...args) => { calls.push(copy(args)); return pageResponse(args[1]); };
    return { target, calls };
  };
  const tag = tags.find((entry) => sample.tags?.includes(entry.id));
  assert(tag, 'Need a live tag on the range replay sample');
  const context = { allowedContentRatings: [0, 1], origin: 0 };
  const filters = {
    exact_match: true, tag_query: tag.id, match_all_tags: true,
    ...(sample.format ? { format: [{ id: sample.format }] } : {}),
    ...(sample.upload_status ? { upload_status: [{ id: sample.upload_status }] } : {}),
    ...(sample.source_id ? { source_id: [{ id: sample.source_id }] } : {}),
    ...(sample.genres?.length ? { genres: { included: [{ id: sample.genres[0] }], excluded: [] }, match_all_genres: true } : {}),
  };
  const request = { page: 1, query: `  ${sample.title}  `, filters, sort: { id: 'current_books', ascending: true }, context };
  const baseline = makeReplay(), expected = await baseline.target.search(request);
  assert(expected.results.length, 'The actual range sample must survive existing policies');
  assert.equal(baseline.calls.length, 1);
  const expectedBody = baseline.calls[0][0];
  assert.equal(expectedBody.title, sample.title.trim());
  assert.deepEqual(expectedBody.content_rating, ['Safe', 'Suggestive']);
  assert.equal(expectedBody.is_pornographic, false);
  assert(expectedBody.tags.values.includes(tag.id));
  const cases = [
    [{ current_books_min: ' 00100 ' }, { current_books: { min: 100 } }],
    [{ current_books_max: '20' }, { current_books: { max: 20 } }],
    [{ current_books_min: '20', current_books_max: '20' }, { current_books: { min: 20, max: 20 } }],
    [{ current_books_min: '0', current_books_max: '0' }, { current_books: { min: 0, max: 0 } }],
    [{ current_books_min: '2147483647', current_books_max: '2147483647' }, { current_books: { min: 2147483647, max: 2147483647 } }],
    [{ start_year_min: '1' }, { start_year: { min: 1 } }],
    [{ start_year_max: '9999' }, { start_year: { max: 9999 } }],
    [{ start_year_min: ' 2020 ', start_year_max: '2020' }, { start_year: { min: 2020, max: 2020 } }],
    [{ start_year_min: '9999', start_year_max: '9999' }, { start_year: { min: 9999, max: 9999 } }],
    [{ current_books_min: '', current_books_max: ' \t ', start_year_min: '\n', start_year_max: ' ' }, {}],
    [{ current_books_min: '', current_books_max: '20', start_year_min: '2020', start_year_max: '' }, { current_books: { max: 20 }, start_year: { min: 2020 } }],
    [{ current_books_min: '100', current_books_max: '200', start_year_min: '2020', start_year_max: '2022' }, { current_books: { min: 100, max: 200 }, start_year: { min: 2020, max: 2022 } }],
  ];
  for (const [ranges, body] of cases) {
    const replay = makeReplay();
    const result = await replay.target.search({ ...request, filters: { ...filters, ...ranges } });
    assert.equal(replay.calls.length, 1);
    assert.deepEqual(replay.calls[0][0], { ...expectedBody, ...body }, 'Range inputs changed unrelated provider filters');
    assert.deepEqual(replay.calls[0].slice(1), [1, 50, 'current_books,asc', true]);
    assert.deepEqual(Array.from(result.results, (item) => item.id), Array.from(expected.results, (item) => item.id), 'Serialization replay changed canonical bulk-row identity/order');
    for (const item of result.results) assert.deepEqual(item.context, context);
    assert.equal(result.isLastPage, true);
  }

  const invalidValues = [undefined, null, 0, 1, -1, 1.5, NaN, Infinity, -Infinity, true, false, {}, [], ['1'], { id: '1' },
    'bad', '1x', '1.0', '1.5', '-1', '+1', '1e2', '0x10', '1_000', '1,000', '1 0', '1\n2', '１２', '١', 'NaN', 'Infinity', '9007199254740992', '9'.repeat(400)];
  const invalidFilters = Object.keys(cases.at(-1)[0]).flatMap((id) => invalidValues.map((value) => ({ [id]: value })));
  invalidFilters.push({ current_books_min: '2147483648' }, { current_books_max: '2147483648' },
    { start_year_min: '0' }, { start_year_max: '0' }, { start_year_min: '10000' }, { start_year_max: '10000' },
    { current_books_min: '2', current_books_max: '1' }, { start_year_min: '2022', start_year_max: '2020' });
  const invalid = freshSource(), touched = [];
  for (const name of ['tags', 'genres', 'sources', 'search']) invalid.api[name] = async () => { touched.push(name); assert.fail(`Invalid range reached ${name}`); };
  invalid.api.client.request = async () => { touched.push('client'); assert.fail('Invalid range reached client'); };
  for (const input of [...invalidFilters.map((ranges) => ({ ...filters, ...ranges })), null, [], '100', 100]) {
    for (const listId of [undefined, 'popular']) {
      // Even a request which would otherwise stop at the rating gate must reject.
      for (const allowedContentRatings of [[0, 1], []]) {
        await assert.rejects(invalid.search({ page: 1, filters: input, ...(listId ? { listId } : {}), context: { allowedContentRatings } }), /Invalid Kagane numeric range/);
        assert.deepEqual(touched, [], 'Invalid original range requested taxonomy or search before rejection');
      }
    }
  }

  const discovery = makeReplay();
  await discovery.target.search({ ...request, listId: 'popular', filters: { ...filters, ...cases.at(-1)[0] } });
  const ownDiscovery = makeReplay(); await ownDiscovery.target.search({ ...request, listId: 'popular', filters: { exact_match: true } });
  assert.deepEqual(discovery.calls, ownDiscovery.calls, 'Valid injected ranges changed discovery-owned body/sort');
  assert.equal(discovery.calls[0][0].title, undefined);
  assert.equal(discovery.calls[0][0].current_books, undefined); assert.equal(discovery.calls[0][0].start_year, undefined);

  const plain = makeReplay();
  const visible = await plain.target.search({ page: 1, context });
  const rows = Array.from(visible.results, (item) => response.content.find((row) => row.series_id === item.id));
  assert(rows.length >= 2 && rows.every(Boolean), 'Need at least two actual policy-visible rows for native range continuation');
  const split = Math.ceil(rows.length / 2);
  const paged = makeReplay((page) => ({ ...response, content: page === 1 ? rows.slice(0, split) : rows.slice(split), last: page >= 2 }));
  const rangeFilters = { ...cases.at(-1)[0], exact_match: true };
  const pagedRequest = { page: 1, query: sample.title, filters: rangeFilters, sort: { id: 'current_books', ascending: true }, context };
  const first = await paged.target.search(pagedRequest), next = await paged.target.search({ ...pagedRequest, page: 2 });
  assert.equal(first.isLastPage, false); assert.equal(next.isLastPage, true);
  assert.deepEqual([...first.results, ...next.results].map((item) => item.id), rows.map((row) => row.series_id));
  assert.deepEqual(paged.calls.map((args) => args[1]), [1, 2]);
  assert.deepEqual(paged.calls[0][0], paged.calls[1][0], 'Continuation lost its range body');
  assert.deepEqual(paged.calls[1].slice(1), [2, 50, 'current_books,asc', true]);
  const prior = paged.calls.length;
  const cached = await paged.target.search({ ...pagedRequest, page: 2, context: { ...context, origin: 1 } });
  assert.equal(paged.calls.length, prior, 'Identical bounds did not reuse the continuation cache');
  assert(cached.results.every((item) => item.context.origin === 1), 'Cached range result retained stale native context');
  for (const [id, value] of [['current_books_min', '101'], ['current_books_max', '201'], ['start_year_min', '2021'], ['start_year_max', '2023']]) {
    const before = paged.calls.length;
    await paged.target.search({ ...pagedRequest, page: 2, filters: { ...rangeFilters, [id]: value } });
    assert.deepEqual(paged.calls.slice(before).map((args) => args[1]), [1, 2], `Changed ${id} reused another range's cached pages`);
    assert.notDeepEqual(paged.calls.at(-1)[0], paged.calls[0][0]);
  }
  const before = paged.calls.length;
  await paged.target.search({ ...pagedRequest, page: 2 });
  assert.equal(paged.calls.length, before, 'Changing a bound corrupted the original continuation cache');
}

// Scores come only from the exact bulk row that produced this native item.
export function assertKaganeListingScores({ items, rows }) {
  for (const item of items) {
    const raw = rows.find((row) => row.series_id === item.id);
    assert(raw, `Listing score has no consumed series_id row: ${item.id}`);
    const score = raw.rating;
    const expected = typeof score === 'number' && Number.isFinite(score) && score > 0 && score <= 100 ? (score / 10).toFixed(1) : undefined;
    const badge = [raw.format, expected ? `★ ${expected}` : undefined].filter(Boolean).join(' · ');
    assert.deepEqual(item.badge ? { ...item.badge } : undefined, badge ? { text: badge } : undefined, `Native badge differs from its exact bulk row: ${item.id}`);
    const latest = raw.latest_chapters?.[0];
    const subtitle = latest?.chapter_no ? `Ch. ${latest.chapter_no}` : latest?.volume_no ? `Vol. ${latest.volume_no}` : latest?.title?.trim();
    assert.equal(item.subtitle, subtitle || (typeof raw.current_books === 'number' ? `${raw.current_books} Chapters` : undefined), 'Score changed the latest-chapter subtitle');
    assert.deepEqual(Array.from(item.info ?? [], ({ key, value }) => ({ key, value })), [
      ...(raw.publication_status ? [{ key: 'Status', value: raw.publication_status }] : []),
      ...(raw.start_year ? [{ key: 'Year', value: String(raw.start_year) }] : []),
    ], `Native listing info differs from its exact bulk row: ${item.id}`);
  }
}

// Change only rating and the absent-type boundary on this run's actual rows.
// Native search/Discover stay closed; actual reader/image gates stay below.
export async function assertKaganeListingScoreBoundaries({ freshSource, response }) {
  assert(response?.content?.length, 'Need actual bulk rows for listing score boundaries');
  const missing = Symbol('missing');
  const cases = [
    [missing, undefined], [undefined, undefined], [null, undefined], [0, undefined], [-1, undefined],
    [100.01, undefined], [NaN, undefined], [Infinity, undefined], [-Infinity, undefined],
    ['85', undefined], ['', undefined], [true, undefined], [false, undefined], [[], undefined], [{}, undefined],
    [Number.MIN_VALUE, '0.0'], [0.1, '0.0'], [1, '0.1'], [85, '8.5'],
    [84.907, '8.5'], [92.525, '9.3'], [99.99, '10.0'], [100, '10.0'],
    [85, '8.5', missing], [0, undefined, missing], [85, '8.5', null], [85, '8.5', ''],
  ];
  const stripScore = (items) => JSON.parse(JSON.stringify(Array.from(items, ({ badge, ...item }) => item)));
  const baseline = new Map();
  for (const [value, expected, format] of cases) {
    const rows = response.content.map((row) => {
      const result = { ...row, rating: value };
      if (value === missing) delete result.rating;
      if (format === missing) delete result.format;
      else if (format !== undefined) result.format = format;
      return result;
    });
    const target = freshSource(), calls = [];
    target.api.client.request = async () => assert.fail('Listing score boundaries must not request provider data');
    for (const method of ['series', 'books', 'challenge', 'sources', 'genres', 'tags']) target.api[method] = async () => assert.fail(`Listing score requested ${method}`);
    target.api.search = async (...args) => { calls.push(args); return { ...response, content: rows, last: true }; };
    const paths = [
      ['search', async () => (await target.search({ page: 1, query: response.content[0].title })).results],
      ...Array.from(await target.getSectionsForPage({ id: 'home' }), ({ id }) => [id, async () => (await target.resolvePageSection({ id: 'home' }, id)).items]),
    ];
    for (const [id, run] of paths) {
      const items = await run(); assert(items.length, `No visible actual rows in ${id} boundary replay`);
      assertKaganeListingScores({ items, rows });
      for (const item of items) {
        const raw = rows.find((row) => row.series_id === item.id); assert(raw);
        const text = [raw.format, expected ? `★ ${expected}` : undefined].filter(Boolean).join(' · ');
        assert.deepEqual(item.badge ? { ...item.badge } : undefined, text ? { text } : undefined);
      }
      const unchanged = stripScore(items);
      if (value === missing) baseline.set(id, unchanged);
      else assert.deepEqual(unchanged, baseline.get(id), `Rating changed unrelated native ${id} metadata, IDs, order or content policy`);
      const before = calls.length;
      assert.deepEqual(stripScore(await run()), unchanged);
      assert.equal(calls.length, before, 'Repeated listing did not reuse native cache');
    }
    assert.equal(calls.length, paths.length, 'Listing score added bulk or per-card requests');
  }
}

// Check only the response consumed by native details, never another title fetch.
export function assertKaganeDetailMetadata({ content, metadata, sources, id }) {
  assert.equal(metadata.series_id, id, 'Detail response changed canonical series identity');
  const labels = new Map([['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'Hiatus'], ['abandoned', 'Cancelled']]);
  const upload = typeof metadata.upload_status === 'string' ? labels.get(metadata.upload_status.trim().toLowerCase()) : undefined;
  const description = decode((metadata.description ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]*>/g, '')).trim();
  const source = sources.find((entry) => entry.source_id === metadata.source_id)?.title;
  const score = metadata.average_rating;
  const views = metadata.total_views;
  assert.equal(content.summary, [
    typeof score === 'number' && Number.isFinite(score) && score > 0 && score <= 100 ? `★ ${(score / 10).toFixed(1)}` : '',
    typeof views === 'number' && Number.isFinite(views) && views >= 0 ? `Views: ${views}` : '',
    description, source ? `Source: ${source}` : '', metadata.edition_info ? `Edition: ${metadata.edition_info}` : '',
    upload ? `Upload status: ${upload}` : '',
  ].filter(Boolean).join('\n\n'), 'Detail summary must preserve source text and show only its average score and labeled views');
  const trackers = new Map([
    ['anilist.co', ['anilist', 'AniList', /^\/manga\/([1-9][0-9]*)\/?$/]],
    ['myanimelist.net', ['mal', 'MyAnimeList', /^\/manga\/([1-9][0-9]*)(?:\/[A-Za-z0-9_-]+)?\/?$/]],
    ['kitsu.app', ['kitsu', 'Kitsu', /^\/manga\/([1-9][0-9]*)\/?$/]],
    ['www.mangaupdates.com', ['mangaupdates', 'MangaUpdates', /^\/series\/([a-z0-9]{7})(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?\/?$/]],
  ]);
  const expectedLinks = new Map();
  for (const entry of Array.isArray(metadata.series_links) ? metadata.series_links : []) {
    if (entry?.kind !== 'Tracker' || typeof entry.url !== 'string') continue;
    const href = entry.url.trim();
    let url;
    try { url = new URL(href); } catch { continue; }
    const tracker = trackers.get(url.hostname);
    if (!tracker || !href.startsWith(`https://${url.hostname}/`) || url.username || url.password || url.port || url.search || url.hash) continue;
    const match = tracker[2].exec(url.pathname);
    if (!match || href !== `https://${url.hostname}${url.pathname}`) continue;
    const key = `${tracker[0]}:${match[1]}`;
    if (!expectedLinks.has(key)) expectedLinks.set(key, { type: 4, id: key, title: tracker[1], url: href });
  }
  const sections = content.additionalInfo?.filter((section) => section.type === 4) ?? [];
  assert.equal(sections.length, expectedLinks.size ? 1 : 0, 'Empty or duplicate native links section');
  assert.deepEqual(Array.from(sections.flatMap((section) => section.items), (item) => ({ ...item })), [...expectedLinks.values()], 'Native links must be safe, deduplicated and source-published');
}

// Execute the native bundle against fresh public responses. Observability wrappers
// record the data it actually consumed, never replace it with a parallel source.
export async function testKagane({ source, check, highlights, searchResult, image, requests, freshSource, referenceFetch = globalThis.fetch }) {
  const domain = 'https://kagane.org';
  const api = `${domain}/api/v2`;
  const sample = '019c2084-fa67-791d-8ba5-494744577445';
  const defaultRatings = ['Safe', 'Suggestive'], allRatings = ['Safe', 'Suggestive', 'Erotica', 'Pornographic'];
  const seen = new Map(), details = new Map(), books = new Map(), searches = [];
  let uploadSources = [];
  const originalSources = source.api.sources.bind(source.api);
  source.api.sources = async (...args) => { const value = await originalSources(...args); uploadSources = value; return value; };
  const listingRows = new WeakMap();
  const originalSearch = source.api.search.bind(source.api);
  source.api.search = async (...args) => {
    const response = await originalSearch(...args);
    searches.push({ args, response });
    for (const item of response.content) seen.set(item.series_id, item);
    return response;
  };
  // Cached highlights are shallow-cloned, retaining their info-array identity.
  // Keep the exact producing row even when a later response rotates its score.
  const nativeSearch = source.search;
  source.search = async (...args) => {
    const before = searches.length, result = await nativeSearch.apply(source, args);
    const rows = searches.length > before ? searches.at(-1).response.content : [];
    for (const item of result.results) {
      const raw = rows.find((row) => row.series_id === item.id) ?? listingRows.get(item.info);
      assert(raw, `Missing native listing response provenance: ${item.id}`);
      listingRows.set(item.info, raw);
    }
    return result;
  };
  for (const [method, store] of [['series', details], ['books', books]]) {
    const original = source.api[method].bind(source.api);
    source.api[method] = async (id) => { const value = await original(id); store.set(id, value); return value; };
  }
  const fields = (form) => {
    const walk = (items) => items.flatMap((item) => [item, ...walk(item.children ?? [])]);
    return form.sections.flatMap((section) => [...walk(section.children ?? []), ...(section.field ? [section.field] : [])]);
  };
  const preference = async (id, value, target = source) => {
    const field = fields(await target.getPreferenceMenu()).find((item) => item.id === id);
    assert(field, `Missing Kagane preference: ${id}`);
    if (value !== undefined) await field.didChange(value);
    return field;
  };
  const rating = (item) => {
    if (!item || typeof item !== 'object') return undefined;
    const old = typeof item.content_rating === 'string' ? item.content_rating.trim().toLowerCase() : undefined;
    const legacy = ['safe', 'suggestive', 'erotica', 'pornographic'].includes(old) ? old : undefined;
    if (item.is_pornographic === true || legacy === 'pornographic') return 'pornographic';
    if (item.age_rating === undefined && item.is_pornographic === undefined) return legacy;
    if (typeof item.is_pornographic !== 'boolean') return undefined;
    const modern = item.age_rating === 'Safe' && !item.is_pornographic ? 'safe'
      : item.age_rating === 'FifteenPlus' && !item.is_pornographic ? 'suggestive'
      : item.age_rating === 'EighteenPlus' ? item.is_pornographic ? 'pornographic' : 'erotica' : undefined;
    return item.content_rating != null && legacy !== modern ? undefined : modern;
  };
  const isSafe = (item) => ['safe', 'suggestive'].includes(rating(item));
  const validResult = (result) => {
    assert(Array.isArray(result.results)); assert.equal(typeof result.isLastPage, 'boolean');
    if (result.results.length) highlights(result.results);
  };
  const json = async (path) => {
    const response = await referenceFetch(`${api}${path}`, { headers: { origin: domain, referer: `${domain}/` }, signal: AbortSignal.timeout(30_000) });
    assert(response.ok, `Kagane reference HTTP ${response.status}: ${path}`);
    return response.json();
  };
  async function readerImage(url) {
    const request = await source.willRequestImage(url);
    let response;
    try { response = await fetch(request.url, { headers: request.headers, signal: AbortSignal.timeout(30_000) }); }
    catch (error) { throw new Error(`Reader image fetch failed (${error.cause?.code ?? error.name}): ${redactURL(request.url)}`); }
    assert(response.ok, `Reader image HTTP ${response.status}: ${redactURL(request.url)}`);
    assert(response.headers.get('content-type')?.startsWith('image/'), 'Reader response is not an image');
    const reader = response.body.getReader();
    let head;
    try { head = (await reader.read()).value; } finally { await reader.cancel(); }
    assert(head?.length > 12, 'Reader image has no usable bytes');
    const bytes = Buffer.from(head), signature = bytes.subarray(0, 12).toString('hex');
    const known = signature.startsWith('ffd8ff') || signature.startsWith('89504e470d0a1a0a')
      || signature.startsWith('47494638') || signature.startsWith('ff0a')
      || signature === '0000000c4a584c200d0a870a'
      || (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
      || bytes.subarray(4, 8).toString() === 'ftyp';
    assert(known, `Unrecognized reader image bytes: ${signature}`);
    console.log(`READER IMAGE ${response.status} ${response.headers.get('content-type')} ${redactURL(request.url)}`);
  }
  let catalog, form, chapterList, index, content, blocked, readerData, safeBody;
  await check('Never-saved source categories follow native policy and explicit source selection persists', async () => {
    assert.equal(source.info.version, '0.0.1-alpha.11');
    assert.deepEqual(Array.from((await preference('contentRatings')).value), allRatings);
    const start = requests.length, empty = await source.search({ page: 1, context: { allowedContentRatings: [] } });
    assert.equal(empty.results.length, 0); assert.equal(empty.isLastPage, true); assert.equal(requests.length, start);
    const nativeExplicit = await source.search({ page: 1, context: { allowedContentRatings: [3] } }); searchResult(nativeExplicit);
    assert(nativeExplicit.results.every((item) => item.contentRating === 3));
    const nativeSafe = await source.search({ page: 1, context: { allowedContentRatings: [0] } }); searchResult(nativeSafe);
    assert(nativeSafe.results.every((item) => item.contentRating === 0));
    await preference('contentRatings', defaultRatings);
    assert.deepEqual(Array.from((await preference('contentRatings', undefined, freshSource())).value), defaultRatings);
    catalog = await source.search({ page: 1 }); searchResult(catalog);
    for (const item of catalog.results) assert(isSafe(seen.get(item.id)), `Unsafe or unknown listing: ${item.id}`);
    assertKaganeListingScores({ items: catalog.results, rows: catalog.results.map((item) => listingRows.get(item.info)) });
    await assertKaganeListingScoreBoundaries({ freshSource, response: searches.at(-1).response });
    const sent = searches.at(-1).args[0]; safeBody = sent;
    assert.equal(sent.is_pornographic, false); assert(sent.age_rating.includes('Safe'));
  });
  await check('Search pagination follows upstream completion, not the filtered result count', async () => {
    const first = searches.at(-1).response;
    assert.equal(catalog.isLastPage, first.last);
    if (first.last) return;
    const next = await source.search({ page: 2 }); validResult(next);
    assert.equal(next.isLastPage, searches.at(-1).response.last);
    assert(!next.results.some((item) => catalog.results.some((prior) => prior.id === item.id)), 'Search repeats page one');
    for (const item of next.results) assert(isSafe(seen.get(item.id)));
  });
  await check('Full title search, details, cover and series deep link retain identity', async () => {
    const item = catalog.results[0];
    const result = await source.search({ page: 1, query: seen.get(item.id).title }); searchResult(result);
    assert(result.results.some((match) => match.id === item.id));
    content = await source.getContent(item.id);
    const metadata = details.get(item.id); assert(metadata);
    assertKaganeDetailMetadata({ content, metadata, sources: uploadSources, id: item.id });
    const english = (language) => typeof language === 'string' && /^(?:en(?:[-_][a-z0-9]{2,8})*|english)$/i.test(language.trim());
    const expectedTitle = english(metadata.title_language) ? metadata.title : metadata.series_alternate_titles?.find((alias) => english(alias.label) && alias.title.trim())?.title ?? metadata.title;
    assert.equal(content.title, expectedTitle.trim()); assert(content.summary?.trim());
    const labels = [['ongoing', 'Ongoing', 1], ['completed', 'Completed', 2], ['abandoned', 'Cancelled', 3], ['hiatus', 'Hiatus', 4]];
    const expected = (value) => typeof value === 'string' ? labels.find(([name]) => name === value.trim().toLowerCase()) : undefined;
    assert.equal(content.status, expected(metadata.publication_status)?.[2], 'Native status must use publication metadata, never upload progress');
    const upload = expected(metadata.upload_status)?.[1];
    assert.deepEqual(content.summary.split('\n\n').filter((line) => line.startsWith('Upload status: ')), upload ? [`Upload status: ${upload}`] : [], 'Upload progress must remain explicitly labelled');
    assert.equal(new URL(content.webUrl).pathname, `/series/${item.id}`);
    assert(content.tags?.length); assert(content.webUrl.startsWith(`${domain}/series/`));
    await image(source, content.cover);
    assert.equal((await source.handleURL(content.webUrl))?.content?.id, item.id);
    assert.equal(await source.handleURL(`https://example.com/series/${item.id}`), null);
  });
  await check('English titles require explicit metadata and retain the original plus aliases', async () => {
    const id = catalog.results[0].id, raw = details.get(id); assert(raw);
    const tagged = freshSource();
    tagged.api.series = async () => ({ ...raw, title: 'Original metadata title', title_language: 'ja', series_alternate_titles: [{ title: 'Explicit English title', label: 'en' }, { title: 'Another original alias', label: 'unknown' }] });
    const preferred = await tagged.getContent(id);
    assert.equal(preferred.title, 'Explicit English title');
    assert(preferred.additionalTitles.includes('Original metadata title'));
    assert(preferred.additionalTitles.includes('Another original alias'));
    const unknown = freshSource();
    unknown.api.series = async () => ({ ...raw, title: 'Tensei', title_language: 'ja', series_alternate_titles: [{ title: 'Looks English but is unclassified', label: 'unknown' }] });
    assert.equal((await unknown.getContent(id)).title, 'Tensei', 'Unlabelled Latin text must not be assumed English');
    const primary = freshSource();
    primary.api.series = async () => ({ ...raw, title: 'Existing English title', title_language: 'en', series_alternate_titles: [{ title: 'Another English variant', label: 'English' }] });
    assert.equal((await primary.getContent(id)).title, 'Existing English title');
    for (const label of ['en-US', 'en_US', 'en-GB', 'en-Latn', 'English']) {
      const variant = freshSource();
      variant.api.series = async () => ({ ...raw, title: 'Original metadata title', title_language: 'ja', series_alternate_titles: [{ title: 'Explicit English variant', label }] });
      assert.equal((await variant.getContent(id)).title, 'Explicit English variant');
    }
  });
  await check('Native search form preserves live taxonomy and grouped tag sheets', async () => {
    form = await source.getSearchForm(); const all = fields(form);
    for (const id of ['content_rating', 'format', 'upload_status', 'genres', 'match_all_genres', 'match_all_tags', 'tag_query', 'source_id', 'exact_match']) assert(all.some((field) => field.id === id), `Missing ${id}`);
    for (const [id, title] of [['current_books_min', 'Minimum chapters'], ['current_books_max', 'Maximum chapters'], ['start_year_min', 'Earliest start year'], ['start_year_max', 'Latest start year']]) {
      assert.equal(all.filter((field) => field.id === id).length, 1, `Missing or duplicate native range field ${id}`);
      assert.equal(all.find((field) => field.id === id).title, title);
      assert.equal(all.find((field) => field.id === id).type, all.find((field) => field.id === 'tag_query').type, `${id} is not a native text field`);
    }
    const rangeSection = form.sections.find((section) => section.children?.some((field) => field.id === 'current_books_min'));
    assert.match(rangeSection?.footer ?? '', /uploaded Kagane chapter entries, not the highest chapter number/i);
    assert.match(rangeSection.footer, /Leave either bound blank to omit it/i);
    const expected = ['Era', 'Adaptations', 'Spoilers', 'Taboo', 'Content Warnings', 'Sexual Content', 'BL & GL', 'Appearance', 'Personality', 'Character Roles', 'Relationships', 'Health', 'Occupations', 'Creatures', 'Places', 'Activities', 'Objects', 'Worldbuilding', 'Themes', 'Storytelling', 'Format', 'Demographic'];
    const groups = all.filter((field) => field.id?.startsWith('tags:'));
    assert(groups.length >= expected.length);
    assert.deepEqual(Array.from(groups.slice(0, expected.length), (field) => field.title), expected);
    assert(groups.every((field) => field.presentation === 'sheet' && field.options.length));
    const tags = groups.flatMap((group) => group.options);
    assert(tags.length > 1000); assert.equal(new Set(tags.map((tag) => tag.id)).size, tags.length);
    assert(all.find((field) => field.id === 'genres').options.length > 30);
    assert(all.find((field) => field.id === 'source_id').options.length > 10);
    assert.deepEqual(Array.from(await source.getSortOptions(), (sort) => sort.id), ['relevance', 'total_views', 'avg_views', 'avg_views_today', 'avg_views_week', 'avg_views_month', 'updated_at', 'current_books', 'created_at', 'rating']);
    const sorts = await source.getSortOptions();
    assert.deepEqual(Array.from(sorts.filter(option => option.isOrderable), option => [option.id, option.title, option.defaultAscending]), [['updated_at', 'Updated', false], ['current_books', 'Chapter count', false], ['created_at', 'Added', false], ['rating', 'Rating', false]]);
    assert.equal(sorts.filter(option => option.isDefault).length, 1); assert.equal(sorts[0].isDefault, true);
  });
  await check('Every native sort and exact-title mode makes a valid live request', async () => {
    for (const sort of await source.getSortOptions()) {
      for (const ascending of sort.isOrderable ? [false, true] : [false]) {
        const result = await source.search({ page: 1, sort: { id: sort.id, ascending } }); validResult(result);
        assert.equal(searches.at(-1).args[3], sort.id === 'relevance' ? '' : `${sort.id},${ascending ? 'asc' : 'desc'}`);
        const response = searches.at(-1).response;
        if (sort.id === 'current_books' || sort.id === 'rating') assertKaganeNumericSortOrder({ response, result, field: sort.id, ascending });
        if (sort.id === 'current_books' && !ascending) await assertKaganeSavedSorts({ freshSource, response });
      }
    }
    const title = seen.get(catalog.results[0].id).title;
    const result = await source.search({ page: 1, query: title, filters: { exact_match: true } }); searchResult(result);
    assert.equal(searches.at(-1).args[4], true);
    assert(result.results.some((item) => item.id === catalog.results[0].id));
  });
  await check('Include/exclude genres, grouped tags and typed tags use live IDs', async () => {
    const all = fields(form), raw = seen.get(catalog.results[0].id);
    const genreOptions = all.find((field) => field.id === 'genres').options;
    const genre = genreOptions.find((option) => raw.genres.includes(option.id)); assert(genre);
    const include = await source.search({ page: 1, filters: { genres: { included: [genre], excluded: [] }, match_all_genres: true } }); validResult(include);
    assert.equal(searches.at(-1).args[0].genres.match_all, true);
    for (const item of include.results) assert(seen.get(item.id).genres.includes(genre.id));
    const exclude = await source.search({ page: 1, filters: { genres: { included: [], excluded: [genre] } } }); validResult(exclude);
    for (const item of exclude.results) assert(!seen.get(item.id).genres.includes(genre.id));
    const group = all.find((field) => field.id?.startsWith('tags:') && field.options.some((option) => option.id.split('+').some((id) => raw.tags.includes(id)))); assert(group);
    const tag = group.options.find((option) => option.id.includes('+') && option.id.split('+').some((id) => raw.tags.includes(id)))
      ?? group.options.find((option) => option.id.split('+').some((id) => raw.tags.includes(id)));
    for (const match_all_tags of [false, true]) {
      const result = await source.search({ page: 1, query: raw.title, filters: { [group.id]: { included: [tag], excluded: [] }, match_all_tags } }); searchResult(result);
      assert(result.results.some((item) => item.id === raw.series_id), 'Alias matching lost a known tagged title');
      assert(result.results.every((item) => tag.id.split('+').some((id) => seen.get(item.id).tags.includes(id))));
      assert(tag.id.split('+').every((id) => searches.at(-1).args[0].tags.values.includes(id)));
    }
    validResult(await source.search({ page: 1, filters: { tag_query: tag.title } }));
    assert(searches.at(-1).args[0].tags.values.some((id) => tag.id.split('+').includes(id)));
    validResult(await source.search({ page: 1, filters: { tag_query: `-${tag.title}` } }));
    assert(searches.at(-1).args[0].tags.exclude.some((id) => tag.id.split('+').includes(id)));
  });
  await check('Unknown malformed and stale tags fail before search; valid native payloads remain exact', async () => {
    const group = fields(form).find((field) => field.id?.startsWith('tags:') && field.options.some((option) => option.id.includes('+')));
    assert(group, 'Need an actual legacy composite tag option');
    await assertKaganeTagFilters({ freshSource, tags: await source.api.tags(), response: searches[0].response, option: group.options.find((option) => option.id.includes('+')), groupId: group.id });
  });
  await check('Native numeric ranges serialize strictly before taxonomy and preserve policies, discovery and cached continuation', async () => {
    const sample = seen.get(catalog.results[0].id);
    const response = searches.find((entry) => entry.response.content.some((row) => row.series_id === sample.series_id))?.response;
    await assertKaganeNumericRanges({ freshSource, response, tags: await source.api.tags(), sample });
  });
  await check('Live chapter-count and start-year bounds constrain consumed bulk rows without changing native identity or order', async () => {
    const original = source.api.search;
    let rangeCalls = 0;
    source.api.search = async (...args) => {
      assert(rangeCalls < 6, 'Numeric-range checks exceeded their six-search provider budget');
      rangeCalls += 1;
      return original(...args);
    };
    const checkRangePage = async (filters, bounds, page = 1, priorIDs = new Set()) => {
      const before = searches.length;
      const result = await source.search({ page, filters });
      searchResult(result);
      const consumed = searches.slice(before);
      assert(consumed.length, 'Range check did not observe the response consumed by native search');
      const rows = consumed.flatMap((entry) => Array.from(entry.response.content));
      assert(rows.length, 'No actual bulk rows were available to verify range semantics');
      for (const { args } of consumed) {
        const body = JSON.parse(JSON.stringify(args[0]));
        assert.deepEqual(body.current_books, bounds.current_books);
        assert.deepEqual(body.start_year, bounds.start_year);
        assert.deepEqual(Object.fromEntries(Object.entries(body).filter(([key]) => !['current_books', 'start_year'].includes(key))), JSON.parse(JSON.stringify(safeBody)), 'Range query changed the existing policy body');
      }
      for (const row of rows) {
        for (const [field, { min, max }] of Object.entries(bounds)) {
          const value = row[field];
          assert(typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value), `Constrained ${field} is missing, null, nonnumeric or noninteger on ${row.series_id}`);
          assert(min === undefined || value >= min, `${field} below live minimum on ${row.series_id}`);
          assert(max === undefined || value <= max, `${field} above live maximum on ${row.series_id}`);
        }
      }
      const unique = new Set(priorIDs), expected = [];
      for (const row of rows) {
        if (unique.has(row.series_id)) continue;
        unique.add(row.series_id);
        if (isSafe(row) && row.cover_image_id?.trim()) expected.push(row.series_id);
      }
      assert.deepEqual(Array.from(result.results, (item) => item.id), expected, 'Range search changed canonical provider IDs/order or existing visibility policy');
      for (const item of result.results) assert(rows.some((row) => row.series_id === item.id), 'Native range result is not backed by its consumed bulk response');
      assert.equal(result.isLastPage, consumed.at(-1).response.last, 'Range continuation ignored upstream completion');
      return { result, ids: unique, lastRawPage: consumed.at(-1).args[1] };
    };
    try {
      await checkRangePage({ current_books_min: '100' }, { current_books: { min: 100 } });
      await checkRangePage({ current_books_max: '20' }, { current_books: { max: 20 } });
      await checkRangePage({ start_year_min: '2020', start_year_max: '2022' }, { start_year: { min: 2020, max: 2022 } });
      const filters = { current_books_min: '100', start_year_min: '2020', start_year_max: '2022' };
      const bounds = { current_books: { min: 100 }, start_year: { min: 2020, max: 2022 } };
      const first = await checkRangePage(filters, bounds);
      if (!first.result.isLastPage) {
        const before = searches.length;
        await checkRangePage(filters, bounds, 2, first.ids);
        assert.equal(searches[before].args[1], first.lastRawPage + 1, 'Combined range page two restarted its physical cursor');
      }
    } finally { source.api.search = original; }
  });
  await check('Format, status and uploader filters round-trip through the native request', async () => {
    const raw = seen.get(catalog.results[0].id), all = fields(form);
    const statusFilter = all.find((field) => field.id === 'upload_status');
    assert.equal(statusFilter.title, 'Upload Status');
    assert.deepEqual(Array.from(statusFilter.options, ({ id, title }) => [id, title]), [['Ongoing', 'Ongoing'], ['Completed', 'Completed'], ['Hiatus', 'Hiatus'], ['Abandoned', 'Cancelled']]);
    const selection = {};
    for (const [id, value] of [['format', raw.format], ['upload_status', raw.upload_status], ['source_id', raw.source_id]]) {
      const option = all.find((field) => field.id === id).options.find((option) => option.id === value); assert(option, `No live ${id}`);
      selection[id] = [option];
    }
    const result = await source.search({ page: 1, filters: selection }); searchResult(result);
    assert(result.results.some((item) => item.id === raw.series_id));
    for (const id of Object.keys(selection)) assert(searches.at(-1).args[0][id].includes(selection[id][0].id));
    assert.equal(searches.at(-1).args[0].publication_status, undefined, 'Do not substitute a publication filter for saved upload semantics');
  });
  await check('Negative search is an empty terminal page and invalid pages are rejected', async () => {
    const result = await source.search({ page: 1, query: 'zzzxqv-kagane-no-such-title-843021' });
    assert.equal(result.results.length, 0); assert.equal(result.isLastPage, true);
    await assert.rejects(source.search({ page: 0 }), /invalid|page/i);
    await assert.rejects(source.search({ page: 1, listId: 'not-a-real-section' }), /unknown|invalid|section|list/i);
  });
  await check('All six native discovery sorts preserve live API order and continuation', async () => {
    const sections = await source.getSectionsForPage({ id: 'home' });
    assert.deepEqual(Array.from(sections, ({ id, title }) => [id, title]), [
      ['popular', 'Popular'], ['trending_month', 'Popular This Month'], ['trending_week', 'Popular This Week'],
      ['trending_today', 'Popular Today'], ['latest_updates', 'Latest Updates'], ['recently_added', 'Recently Added'],
    ]);
    for (const section of sections) {
      const result = await source.resolvePageSection({ id: 'home' }, section.id); assert(Array.isArray(result.items));
      const sorts = { popular: 'total_views', trending_month: 'avg_views_month', trending_week: 'avg_views_week', trending_today: 'avg_views_today', latest_updates: 'updated_at', recently_added: 'created_at' };
      const raw = await originalSearch(safeBody, 1, 50, `${sorts[section.id]},desc`, false);
      const expected = Array.from(raw.content).filter((item) => isSafe(item) && item.cover_image_id?.trim()).map((item) => item.series_id);
      assert.deepEqual(Array.from(result.items, (item) => item.id), expected);
      if (!raw.last) assert.equal(result.viewMoreLink?.request?.listId, section.id);
      for (const item of result.items) assert(isSafe(seen.get(item.id)));
      assertKaganeListingScores({ items: result.items, rows: result.items.map((item) => listingRows.get(item.info)) });
    }
  });
  await check('A real 200-plus chapter list matches every live index ID exactly', async () => {
    index = await json(`/series/${sample}/books/index`);
    assert(index.count > 200, 'Need a real multi-page live chapter sample');
    await preference('chapterTitle', 'original');
    const start = requests.length;
    chapterList = await source.getChapters(sample);
    const idColumn = index.fields.indexOf('book_id'); assert(idColumn >= 0);
    const expected = index.books.map((row) => row[idColumn]);
    assert.equal(chapterList.length, index.count);
    assert.equal(new Set(chapterList.map((chapter) => chapter.chapterId)).size, index.count);
    assert.deepEqual(Array.from(chapterList, (chapter) => chapter.chapterId).sort(), expected.sort());
    assert(requests.slice(start).some((request) => new URL(request.url).searchParams.has('before')), 'No real before-cursor page was fetched');
    const raw = books.get(sample); assert.equal(raw.length, index.count);
    for (const [i, chapter] of chapterList.entries()) {
      assert.equal(chapter.index, chapterList.length - 1 - i); assert.equal(typeof chapter.number, 'number');
      assert(Number.isFinite(chapter.date.getTime())); assert(chapter.title?.trim()); assert(chapter.language);
      const upstream = raw.find((book) => book.book_id === chapter.chapterId); assert(upstream);
      assert.equal(chapter.title, upstream.title.trim(), 'Original chapter title lost');
    }
  });
  await check('Current live series translation and unknown language preserve native chapter identity', async () => {
    await assertKaganeChapterLanguages({ freshSource, id: sample, detail: details.get(sample), books: books.get(sample), sources: await source.api.sources() });
  });
  await check('Repeated chapter/detail calls reuse bulk data instead of N-plus-one requests', async () => {
    await source.getContent(sample);
    const start = requests.length;
    const [first, second] = await Promise.all([source.getChapters(sample), source.getChapters(sample)]);
    assert.equal(first.length, chapterList.length); assert.equal(second.length, chapterList.length);
    await source.getContent(sample);
    assert.equal(requests.length, start, 'Cached details and full chapter list should not refetch');
  });
  await check('First and last actual chapter readers load image bytes with source headers', async () => {
    for (const chapter of [chapterList[0], chapterList.at(-1)]) {
      const data = await source.getChapterData(sample, chapter.chapterId, chapter);
      assert(data.pages.length > 0); assert.equal(new Set(data.pages.map((page) => page.url)).size, data.pages.length);
      const raw = books.get(sample).find((book) => book.book_id === chapter.chapterId);
      if (raw.page_count) assert.equal(data.pages.length, raw.page_count);
      for (const page of data.pages) {
        const target = new URL(page.url); assert(target.pathname.includes(`/books/page/${chapter.chapterId}/`));
        assert(target.searchParams.get('token')); assert.equal(target.searchParams.get('is_datasaver'), 'false');
        const request = await source.willRequestImage(page.url);
        assert.equal(request.headers.referer ?? request.headers.Referer, `${domain}/`);
      }
      await readerImage(data.pages[0].url); await readerImage(data.pages.at(-1).url);
      readerData = data;
    }
  });
  await check('Expired reader sessions refresh once per chapter and retain the actual page identity', async () => {
    const chapter = chapterList.at(-1);
    const data = await source.getChapterData(sample, chapter.chapterId, chapter);
    const session = source.readerSessions.get(`${sample}:${chapter.chapterId}`); assert(session);
    const tokenParts = session.challenge.access_token.split('.');
    const payload = tokenParts.length === 3 ? JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString()) : null;
    console.log(`Reader token: ${payload ? 'JWT' : 'opaque'}, remaining lifetime ${payload?.exp ? Math.round(payload.exp - Date.now() / 1000) : 'not published'} seconds`);
    session.expiry = Date.now() - 1;
    const before = requests.filter((request) => new URL(request.url).pathname === `/api/v2/books/${chapter.chapterId}`).length;
    const [first, last] = await Promise.all([source.willRequestImage(data.pages[0].url), source.willRequestImage(data.pages.at(-1).url)]);
    const after = requests.filter((request) => new URL(request.url).pathname === `/api/v2/books/${chapter.chapterId}`).length;
    assert.equal(after - before, 1, 'Expired chapter should share one manifest refresh');
    assert.equal(new URL(first.url).pathname, new URL(data.pages[0].url).pathname);
    assert.equal(new URL(last.url).pathname, new URL(data.pages.at(-1).url).pathname);
    await readerImage(first.url); await readerImage(last.url);
  });
  await check('Data saver uses the supported query and still loads actual reader images', async () => {
    await preference('dataSaver', true);
    const data = await source.getChapterData(sample, chapterList[0].chapterId, chapterList[0]);
    assert(data.pages.length); assert(data.pages.every((page) => new URL(page.url).searchParams.get('is_datasaver') === 'true'));
    await readerImage(data.pages[0].url); await readerImage(data.pages.at(-1).url);
    await preference('dataSaver', false);
  });
  await check('Reader rejects a book from another series before requesting access', async () => {
    const other = catalog.results.find((item) => item.id !== sample); assert(other);
    const start = requests.length;
    await assert.rejects(source.getChapterData(other.id, chapterList[0].chapterId), /chapter|series|belong/i);
    assert(!requests.slice(start).some((request) => /^\/api\/v2\/books\/[A-Za-z0-9-]+$/.test(new URL(request.url).pathname)), 'Mismatched reader attempted access');
  });
  await check('Every rating category selects its exact modern class and an empty selection shows none', async () => {
    for (const selected of allRatings) {
      await preference('contentRatings', [selected]);
      assert.deepEqual(Array.from((await preference('contentRatings', undefined, freshSource())).value), [selected]);
      const result = await source.search({ page: 1 }); searchResult(result);
      assert(result.results.every((item) => rating(seen.get(item.id)) === selected.toLowerCase()), `Wrong class under ${selected}`);
      await source.getContent(result.results[0].id);
    }
    await preference('contentRatings', []);
    assert.equal((await preference('contentRatings', undefined, freshSource())).value.length, 0);
    const result = await source.search({ page: 1 });
    assert.equal(result.results.length, 0); assert.equal(result.isLastPage, true);
    await assert.rejects(source.getContent(sample), /excluded|classification|rating|NSFW|selected/i);
    await preference('contentRatings', defaultRatings);
  });
  await check('Mixed rating selections and per-search or host limits cannot widen global choices', async () => {
    await preference('contentRatings', ['Safe', 'Pornographic']);
    const mixed = await source.search({ page: 1 }); searchResult(mixed);
    assert(mixed.results.every((item) => ['safe', 'pornographic'].includes(rating(seen.get(item.id)))));
    const narrowed = await source.search({ page: 1, filters: { content_rating: [{ id: 'Erotica' }] } });
    assert.equal(narrowed.results.length, 0); assert.equal(narrowed.isLastPage, true);
    // SAFE is 0 in pinned @mana-app/types 0.0.27; do not rely on a newer host policy.
    const host = await source.search({ page: 1, context: { allowedContentRatings: [0] } }); searchResult(host);
    assert(host.results.every((item) => rating(seen.get(item.id)) === 'safe'));
    const none = await source.search({ page: 1, context: { allowedContentRatings: [] } });
    assert.equal(none.results.length, 0); assert.equal(none.isLastPage, true);
    await preference('contentRatings', defaultRatings);
  });
  await check('Previously issued reader URLs cannot evade changed rating settings', async () => {
    assert(readerData?.pages?.length, 'No live reader data was established');
    await preference('contentRatings', ['Safe']);
    await assert.rejects(source.willRequestImage(readerData.pages[0].url), /reopen|settings|authoriz/i);
    await preference('contentRatings', defaultRatings);
  });
  await check('Setting persistence and explicit content exclusion apply even to title search', async () => {
    await preference('contentRatings', allRatings);
    assert.deepEqual(Array.from((await preference('contentRatings', undefined, freshSource())).value), allRatings);
    const result = await source.search({ page: 1, filters: { content_rating: [{ id: 'Pornographic', title: 'Pornographic' }] } }); searchResult(result);
    blocked = result.results.find((item) => rating(seen.get(item.id)) === 'pornographic'); assert(blocked, 'No live explicit sample to verify policy');
    await source.getContent(blocked.id);
    await preference('contentRatings', defaultRatings);
    const search = await source.search({ page: 1, query: seen.get(blocked.id).title }); validResult(search);
    assert(!search.results.some((item) => item.id === blocked.id));
    for (const fn of [() => source.getContent(blocked.id), () => source.getChapters(blocked.id), () => source.getChapterData(blocked.id, chapterList[0].chapterId)]) await assert.rejects(fn(), /excluded|classification|rating|NSFW/i);
    const link = source.handleURL(blocked.webUrl ?? `${domain}/series/${blocked.id}`);
    try { assert.equal(await link, null); } catch (error) { assert.match(error.message, /excluded|classification|rating|NSFW/i); }
  });
  await check('Unknown and conflicting ratings fail closed for details, chapters and reading', async () => {
    const raw = details.get(sample); assert(raw);
    for (const overrides of [{ age_rating: undefined, is_pornographic: undefined, content_rating: undefined }, { age_rating: 'Safe', is_pornographic: true }, { age_rating: 'Safe', is_pornographic: false, content_rating: 'Pornographic' }]) {
      const target = freshSource(); target.api.series = async () => ({ ...raw, ...overrides });
      for (const fn of [() => target.getContent(sample), () => target.getChapters(sample), () => target.getChapterData(sample, chapterList[0].chapterId)]) await assert.rejects(fn(), /excluded|classification|rating|NSFW/i);
    }
  });
  await check('Incomplete rating metadata uses native Mature fallback without overriding known explicit evidence', async () => {
    const raw = details.get(sample); assert(raw); await preference('contentRatings', allRatings);
    try {
      const target = freshSource(); target.api.series = async () => ({ ...raw, age_rating: undefined, is_pornographic: undefined, content_rating: undefined });
      const result = await target.getContent(sample, { allowedContentRatings: [2] }); assert.equal(result.contentRating, 2);
      assert(result.additionalInfo.some((section) => section.id === 'content-rating-metadata' && /Incomplete/.test(section.items[0].title)));
      await assert.rejects(target.getContent(sample, { allowedContentRatings: [0, 1, 3] }), /excluded/);
      assert.equal((await target.getContent(sample)).contentRating, 2, 'Omitted native policy is not Safe-only');
      for (const [age, pornographic, expected] of [['Safe', false, 0], ['FifteenPlus', false, 1], ['EighteenPlus', false, 2], ['EighteenPlus', true, 3]]) {
        const rated = freshSource(); rated.api.series = async () => ({ ...raw, content_rating: undefined, age_rating: age, is_pornographic: pornographic });
        assert.equal((await rated.getContent(sample, { allowedContentRatings: [expected] })).contentRating, expected);
        await assert.rejects(rated.getContent(sample, { allowedContentRatings: [0, 1, 2, 3].filter((value) => value !== expected) }), /excluded/);
      }
      for (const overrides of [{ age_rating: 'Safe', is_pornographic: true }, { age_rating: 'Safe', is_pornographic: false, content_rating: 'Pornographic' }]) {
        const explicit = freshSource(); explicit.api.series = async () => ({ ...raw, ...overrides });
        assert.equal((await explicit.getContent(sample, { allowedContentRatings: [3] })).contentRating, 3);
        await assert.rejects(explicit.getContent(sample, { allowedContentRatings: [0, 1, 2] }), /excluded/);
      }
    } finally { await preference('contentRatings', defaultRatings); }
  });
  await check('Native rating policy and accumulated IDs survive partial overlap and duplicate-only physical pages', async () => {
    const pool = [...seen.values()].filter((item) => item.series_id && item.title && item.cover_image_id).slice(0, 5); assert.equal(pool.length, 5);
    await preference('contentRatings', allRatings);
    try {
      const target = freshSource(), calls = [];
      target.api.search = async (_body, page) => { calls.push(page); return { content: (page === 1 ? pool.slice(0, 3) : page === 2 ? pool.slice(0, 3) : pool.slice(2)).map((item) => ({ ...item, age_rating: 'Safe', is_pornographic: false, content_rating: 'Safe' })), last: page >= 3 }; };
      const first = await target.search({ page: 1, context: { allowedContentRatings: [0] } }), next = await target.search({ page: 2, context: { allowedContentRatings: [0] } });
      assert.deepEqual([...first.results, ...next.results].map((item) => item.id), pool.map((item) => item.series_id)); assert.deepEqual(calls, [1, 2, 3]);
      assert.equal(new Set([...first.results, ...next.results].map((item) => item.id)).size, 5); assert.equal(next.isLastPage, true);
      const before = calls.length; assert.deepEqual(Array.from((await target.search({ page: 2, context: { allowedContentRatings: [0] } })).results, (item) => item.id), next.results.map((item) => item.id)); assert.equal(calls.length, before);
      const migrated = await target.search({ page: 2, context: { allowedContentRatings: [0], origin: 0 } });
      assert(migrated.results.every((item) => item.context.origin === 0)); assert.equal(calls.length, before, 'Migration context reuses cached policy metadata');
      const ordinary = await target.search({ page: 2, context: { allowedContentRatings: [0] } });
      assert(ordinary.results.every((item) => item.context.origin === undefined), 'Cached highlights do not retain a previous request origin');
      const blocked = await target.search({ page: 1, context: { allowedContentRatings: [3] } }); assert.equal(blocked.results.length, 0); assert.equal(blocked.isLastPage, true);
      const link = await target.resolvePageSection({ id: 'home', context: { allowedContentRatings: [0] } }, 'latest_updates');
      if (link.viewMoreLink) assert.deepEqual(Array.from(link.viewMoreLink.request.context.allowedContentRatings), [0]);
    } finally { await preference('contentRatings', defaultRatings); }
  });
  await check('Changing safety preference invalidates an in-flight unfiltered response', async () => {
    await preference('contentRatings', allRatings);
    const original = source.api.search; let arrive, release;
    const arrived = new Promise((resolve) => { arrive = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    try {
      source.api.search = async (...args) => { const value = await original(...args); arrive(); await gate; return value; };
      const pending = source.search({ page: 1, query: 'Beginning After the End' });
      await Promise.race([arrived, pending.then(() => assert.fail('Search completed before the gate'))]);
      const rejected = assert.rejects(pending, /settings changed/i);
      await preference('contentRatings', defaultRatings); release(); await rejected;
    } finally { release(); source.api.search = original; }
  });
  await check('Malformed pagination and reader manifests are errors, not empty successes', async () => {
    const raw = searches.find((entry) => entry.response.content.length)?.response; assert(raw);
    const target = freshSource();
    const original = target.api.response;
    target.api.response = async () => ({ status: 200, headers: {}, data: JSON.stringify({ ...raw, last: undefined }) });
    try { await assert.rejects(target.search({ page: 1, query: 'malformed-search-probe' }), /pagination|invalid|missing/i); }
    finally { target.api.response = original; }
    const reader = freshSource(); reader.api.series = async () => details.get(sample); reader.api.books = async () => books.get(sample);
    reader.api.challenge = async () => ({ access_token: 'test-only-not-a-live-token', cache_url: domain, manifest: { pages: [] } });
    await assert.rejects(reader.getChapterData(sample, chapterList[0].chapterId), /page|manifest|empty/i);
    assert(readerData?.pages?.length, 'No successful live reader ran before the corruption check');
  });
  await check('Test host permits only exact public Kagane operations and redacts reader tokens', async () => {
    await assertKaganeHostGuards({ freshSource });
    for (const path of ['/genres/list', '/tags/list', '/sources/list']) assert.equal(requests.filter((request) => new URL(request.url).pathname === `/api/v2${path}`).length, 1, `Public taxonomy was redundantly fetched: ${path}`);
    assert(!requests.some((request) => request.url.includes('token=') && !request.url.includes('redacted')));
  });
  source.search = nativeSearch;
}
