import assert from 'node:assert/strict';
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

// Execute the native bundle against fresh public responses. Observability wrappers
// record the data it actually consumed, never replace it with a parallel source.
export async function testKagane({ source, check, highlights, searchResult, image, requests, freshSource, referenceFetch = globalThis.fetch }) {
  const domain = 'https://kagane.org';
  const api = `${domain}/api/v2`;
  const sample = '019c2084-fa67-791d-8ba5-494744577445';
  const defaultRatings = ['Safe', 'Suggestive'], allRatings = ['Safe', 'Suggestive', 'Erotica', 'Pornographic'];
  const seen = new Map(), details = new Map(), books = new Map(), searches = [];
  const originalSearch = source.api.search.bind(source.api);
  source.api.search = async (...args) => {
    const response = await originalSearch(...args);
    searches.push({ args, response });
    for (const item of response.content) seen.set(item.series_id, item);
    return response;
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
  let catalog, form, chapterList, index, content, blocked, readerData;
  await check('Persistent rating selection defaults to Safe/Suggestive and verifies modern ratings', async () => {
    assert.deepEqual(Array.from((await preference('contentRatings')).value), defaultRatings);
    catalog = await source.search({ page: 1 }); searchResult(catalog);
    for (const item of catalog.results) assert(isSafe(seen.get(item.id)), `Unsafe or unknown listing: ${item.id}`);
    const sent = searches.at(-1).args[0];
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
    const english = (language) => typeof language === 'string' && /^(?:en(?:[-_][a-z0-9]{2,8})*|english)$/i.test(language.trim());
    const expectedTitle = english(metadata.title_language) ? metadata.title : metadata.series_alternate_titles?.find((alias) => english(alias.label) && alias.title.trim())?.title ?? metadata.title;
    assert.equal(content.title, expectedTitle.trim()); assert(content.summary?.trim());
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
    const expected = ['Era', 'Adaptations', 'Spoilers', 'Taboo', 'Content Warnings', 'Sexual Content', 'BL & GL', 'Appearance', 'Personality', 'Character Roles', 'Relationships', 'Health', 'Occupations', 'Creatures', 'Places', 'Activities', 'Objects', 'Worldbuilding', 'Themes', 'Storytelling', 'Format', 'Demographic'];
    const groups = all.filter((field) => field.id?.startsWith('tags:'));
    assert(groups.length >= expected.length);
    assert.deepEqual(Array.from(groups.slice(0, expected.length), (field) => field.title), expected);
    assert(groups.every((field) => field.presentation === 'sheet' && field.options.length));
    const tags = groups.flatMap((group) => group.options);
    assert(tags.length > 1000); assert.equal(new Set(tags.map((tag) => tag.id)).size, tags.length);
    assert(all.find((field) => field.id === 'genres').options.length > 30);
    assert(all.find((field) => field.id === 'source_id').options.length > 10);
    assert.deepEqual(Array.from(await source.getSortOptions(), (sort) => sort.id), ['relevance', 'total_views', 'avg_views', 'avg_views_today', 'avg_views_week', 'avg_views_month', 'updated_at', 'series_name', 'books_count', 'created_at']);
  });
  await check('Every native sort and exact-title mode makes a valid live request', async () => {
    for (const sort of await source.getSortOptions()) {
      validResult(await source.search({ page: 1, sort: { id: sort.id } }));
      assert.equal(searches.at(-1).args[3], sort.id === 'relevance' ? '' : `${sort.id},desc`);
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
  await check('Format, status and uploader filters round-trip through the native request', async () => {
    const raw = seen.get(catalog.results[0].id), all = fields(form);
    const selection = {};
    for (const [id, value] of [['format', raw.format], ['upload_status', raw.upload_status], ['source_id', raw.source_id]]) {
      const option = all.find((field) => field.id === id).options.find((option) => option.id === value); assert(option, `No live ${id}`);
      selection[id] = [option];
    }
    const result = await source.search({ page: 1, filters: selection }); searchResult(result);
    assert(result.results.some((item) => item.id === raw.series_id));
    for (const id of Object.keys(selection)) assert(searches.at(-1).args[0][id].includes(selection[id][0].id));
  });
  await check('Negative search is an empty terminal page and invalid pages are rejected', async () => {
    const result = await source.search({ page: 1, query: 'zzzxqv-kagane-no-such-title-843021' });
    assert.equal(result.results.length, 0); assert.equal(result.isLastPage, true);
    await assert.rejects(source.search({ page: 0 }), /invalid|page/i);
    await assert.rejects(source.search({ page: 1, listId: 'not-a-real-section' }), /unknown|invalid|section|list/i);
  });
  await check('All six website discovery rows preserve order and native continuation', async () => {
    const sections = await source.getSectionsForPage({ id: 'home' });
    assert.deepEqual(Array.from(sections, (section) => section.id), ['popular', 'trending_month', 'trending_week', 'trending_today', 'latest_updates', 'recently_added']);
    for (const section of sections) {
      const result = await source.resolvePageSection({ id: 'home' }, section.id); assert(Array.isArray(result.items));
      const sorts = { popular: 'total_views', trending_month: 'avg_views_month', trending_week: 'avg_views_week', trending_today: 'avg_views_today', latest_updates: 'updated_at', recently_added: 'created_at' };
      const raw = await originalSearch(searches[0].args[0], 1, 50, `${sorts[section.id]},desc`, false);
      const expected = Array.from(raw.content).filter((item) => isSafe(item) && item.cover_image_id?.trim()).map((item) => item.series_id);
      assert.deepEqual(Array.from(result.items, (item) => item.id), expected);
      if (!raw.last) assert.equal(result.viewMoreLink?.request?.listId, section.id);
      for (const item of result.items) assert(isSafe(seen.get(item.id)));
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
}
