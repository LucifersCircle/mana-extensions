import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { load } from 'cheerio';
import { createManaRuntime } from './mana-runtime.mjs';

const domain = 'https://mangastash.org', all = { allowedContentRatings: [0, 1, 2, 3] };
const ids = (items) => Array.from(items, (item) => item.id);
const plain = (value) => JSON.parse(JSON.stringify(value));
export async function testMangaStash({ check, referenceFetch = globalThis.fetch }) {
  const code = readFileSync('dist/sources/MangaStash.mana', 'utf8'), responses = new Map(), requests = [];
  const fetchImpl = async (input, init) => {
    const response = await referenceFetch(input, init);
    const url = String(input);
    requests.push(url);
    if (response.headers.get('content-type')?.includes('text/html')) responses.set(url, await response.clone().text());
    return response;
  };
  function host(transport = fetchImpl, store) {
    const runtime = createManaRuntime({ fetchImpl: transport, logger: () => {} });
    if (store) runtime.ObjectStore = store;
    const context = vm.createContext(runtime);
    vm.runInContext(code, context, { timeout: 10000 });
    return { source: new context.Target(), store: context.ObjectStore };
  }
  const { source, store } = host();
  const replay = (mutate = (_url, html) => html) => async (input) => {
    const url = String(input), body = responses.get(url);
    assert(body, `No retained same-response body for ${url}`);
    return new Response(mutate(url, body), { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const findToggle = async (target) => (await target.getPreferenceMenu()).sections[0].children.find((item) => item.id === 'onlySafe');
  let catalog, content, chapters, reader, home;
  await check('MangaStash native initialization and exact browse controls', async () => {
    assert.equal(source.info.id, 'MangaStash'); assert.equal(source.info.version, '0.0.1-alpha.1');
    assert.match(source.info.description, /technical unknown/);
    assert.equal((await findToggle(source)).value, false);
    const form = await source.getSearchForm();
    assert.deepEqual(Array.from(form.sections[0].children, (item) => item.id), ['status', 'genres', 'theme', 'mood', 'format', 'demographic', 'language', 'rating']);
    assert.deepEqual(Array.from(await source.getSortOptions(), (item) => item.id), ['latest', 'popular-month', 'popular-year', 'title']);
    assert.equal(requests.length, 0, 'Initialization must not make provider requests');
  });
  await check('Catalog same-response identities, source cover provenance and unknown fallback', async () => {
    catalog = await source.search({ page: 1, context: all });
    const $ = load(responses.get(`${domain}/browse/`));
    const rows = $('.series-grid > .series-card').toArray();
    for (const field of (await source.getSearchForm()).sections[0].children) {
      const sourceName = field.id === 'genres' ? 'genre[]' : field.id === 'rating' ? 'rating' : `${field.id}[]`;
      assert.deepEqual(Array.from(field.options, (option) => option.id), $(`#browse-form input[name="${sourceName}"]`).toArray().map((node) => $(node).attr('value')), 'Native options differ from declared source controls');
    }
    assert.deepEqual(Array.from(await source.getSortOptions(), (option) => option.id), $('select[name="sort"] option').toArray().map((node) => new URL($(node).attr('value'), domain).searchParams.get('sort')));
    assert(rows.length > 0); assert.equal(catalog.results.length, rows.length);
    assert.deepEqual(ids(catalog.results), rows.map((node) => $(node).attr('href').slice(1, -1)));
    for (const [index, item] of Array.from(catalog.results).entries()) {
      const row = $(rows[index]);
      assert.equal(item.title, row.find('h3').text().replace(/\s+/g, ' ').trim());
      assert.equal(item.cover, new URL(row.find('img').attr('data-src') || row.find('img').attr('src'), domain).href);
      const labels = row.find('.badge').toArray().map((node) => $(node).text().trim());
      if (!labels.some((label) => ['Safe', 'Suggestive', 'Mature', 'Explicit'].includes(label))) assert.equal(item.contentRating, 1);
    }
    assert(catalog.results.every((item) => item.context === all), 'Native highlights must retain exact request context reference');
    assert.equal(requests.length, 1, 'Catalog must not enrich cards with N+1 requests');
  });
  await check('Exact source home feeds, same-response whole-feed comparison and overlaps', async () => {
    const sections = await source.getSectionsForPage({ id: 'home', context: all });
    home = responses.get(`${domain}/`); const $ = load(home), expected = [];
    const signatures = new Set();
    for (const [id, title] of [['popular', 'Popular This Month'], ['new', 'New Additions'], ['latest', 'Latest Updates']]) {
      const section = $('section.home-section').filter((_, node) => $(node).find('h2').first().text().trim() === title);
      const selector = id === 'latest' ? '.update-title' : '.series-card';
      const expectedIds = section.find(selector).toArray().map((node) => $(node).attr('href').slice(1, -1));
      assert(expectedIds.length);
      const signature = JSON.stringify(expectedIds);
      if (!signatures.has(signature)) expected.push({ id, title });
      signatures.add(signature);
      const result = await source.resolvePageSection({ id: 'home', context: all }, id);
      assert(result.items.every((item) => item.context === all));
      assert.deepEqual(ids(result.items), expectedIds, 'Curated feed membership/order changed');
      assert.equal(result.viewMoreLink, undefined, 'Finite source homepage row must not invent pagination');
    }
    assert.deepEqual(Array.from(sections, ({ id, title }) => ({ id, title })), expected);
    assert.equal(requests.filter((url) => url === `${domain}/`).length, 1);
  });
  await check('Source-declared compound filters preserve exact page-two scope and ordering', async () => {
    const request = { filters: { genres: [{ id: 'action' }], language: [{ id: 'EN' }], rating: { id: 'safe' } }, sort: { id: 'title' }, context: all };
    const first = await source.search({ ...request, page: 1 });
    const firstURL = requests.at(-1), $ = load(responses.get(firstURL)), next = new URL($('nav.pagination a.page-next').attr('href'), domain).href;
    assert(next); assert.equal(first.isLastPage, false);
    const second = await source.search({ ...request, page: 2 });
    assert.equal(requests.at(-1), next);
    const pageTwo = load(responses.get(next));
    assert.deepEqual(ids(second.results), pageTwo('.series-grid > .series-card').toArray().map((node) => pageTwo(node).attr('href').slice(1, -1)));
    assert(second.results.length); assert(second.results.every((item) => !ids(first.results).includes(item.id)));
    assert(second.results.every((item) => item.contentRating === 1), 'Safe scope must not invent per-card Safe classification');
  });
  await check('Text search uses q only and authoritative source rating', async () => {
    const result = await source.search({ query: 'Ayashimon', page: 1, context: all });
    assert.equal(requests.at(-1), `${domain}/search?q=Ayashimon`);
    assert(result.results.some((item) => item.id === 'ayashimon' && item.contentRating === 0));
  });
  await check('Complete detail chapters reuse one response, preserve decimal routes and unknown dates', async () => {
    content = await source.getContent('ayashimon', all); chapters = content.chapters;
    const $ = load(responses.get(`${domain}/ayashimon/`)), rawRows = $('#chapter-list > .chapter-row').toArray();
    const declaredCount = $('.cl-toolbar h2').text().trim().match(/^Chapters \((\d+)\)$/);
    assert(declaredCount); assert.equal(Number(declaredCount[1]), rawRows.length, 'Raw declared inventory must remain complete');
    assert.equal(new Set(rawRows.map((row) => $(row).attr('href'))).size, rawRows.length);
    const rows = rawRows.filter((node) => {
      const row = $(node);
      return !row.is('.locked,.chapter-locked,[data-locked="true"],[aria-disabled="true"]')
        && !row.find('.locked,.chapter-locked,.chapter-lock').length
        && !/locked|premium|log ?in|sign ?in|unlock|members only|subscription/i.test(row.find('.chapter-meta').text().replace(/\s+/g, ' ').trim());
    });
    assert.equal(content.title, $('.series-meta h1').text().trim());
    assert.equal(content.cover, $('meta[property="og:image"]').attr('content'));
    assert.deepEqual(Array.from(content.tags, ({ id }) => id), ['action', 'comedy']);
    const genreOwner = (await source.getSearchForm()).sections[0].children.find((field) => field.id === 'genres');
    assert(content.tags.every((tag) => tag.isNonInteractive === false && genreOwner.options.some((option) => option.id === tag.id)));
    assert.equal(content.contentRating, 0); assert(chapters.length > 0); assert.equal(chapters.length, rows.length);
    assert.deepEqual(Array.from(chapters, (item) => item.chapterId), rows.map((row) => $(row).attr('href').slice(1)));
    assert(chapters.some((item) => item.chapterId === 'ayashimon/chapter-25.6' && item.number === 25.6));
    for (const [index, chapter] of Array.from(chapters).entries()) {
      assert.equal(chapter.index, index); assert.equal(chapter.language, 'en_US');
      const date = $(rows[index]).find('time').attr('datetime') || $(rows[index]).attr('data-date');
      assert.equal(chapter.date.getTime(), date ? new Date(date).getTime() : 0);
    }
    assert.match(JSON.stringify(content.additionalInfo), /not an actual publication date/);
    const count = requests.length;
    assert.deepEqual(plain(await source.getChapters('ayashimon')), plain(chapters));
    assert.equal(requests.length, count, 'Complete cached chapter inventory must avoid extra requests');
    const link = await source.handleURL(`${domain}/ayashimon/chapter-25.6`);
    assert.equal(link.content.id, 'ayashimon');
    assert.equal(await source.handleURL(`${domain}/other/../ayashimon/`), null);
  });
  await check('Canonical persisted decimal reader preserves every advertised page and credit page', async () => {
    const cold = host(fetchImpl, store).source;
    const before = requests.length; reader = await cold.getChapterData('ayashimon', 'ayashimon/chapter-25.6');
    assert.equal(requests.length, before + 1, 'Persisted title evidence must avoid detail N+1');
    const $ = load(responses.get(`${domain}/ayashimon/chapter-25.6`));
    const expected = $('#reader-pages > .reader-page').toArray().map((node, index) => {
      assert.equal($(node).attr('data-page'), String(index + 1));
      const img = $(node).find('.reader-page-inner > img'); return new URL(img.attr('data-src') || img.attr('src'), domain).href;
    });
    assert.deepEqual(Array.from(reader.pages, (item) => item.url), expected); const declaredPages = [...responses.get(`${domain}/ayashimon/chapter-25.6`).matchAll(/^\s*totalPages:\s*(\d+),?\s*$/gm)];
    assert.equal(declaredPages.length, 1); assert.equal(expected.length, Number(declaredPages[0][1])); assert(expected.length > 0);
    assert.equal(new Set(expected).size, expected.length);
  });
  await check('First, middle, last reader and original cover images deliver complete image bytes', async () => {
    const cold = host(replay(), store).source;
    for (const url of [content.cover, reader.pages[0].url, reader.pages[Math.floor(reader.pages.length / 2)].url, reader.pages.at(-1).url]) {
      const request = await cold.willRequestImage(url); assert.equal(request.url, url);
      const response = await referenceFetch(url, { headers: request.headers, signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200); assert(response.headers.get('content-type')?.startsWith('image/'));
      const bytes = Buffer.from(await response.arrayBuffer()); assert(bytes.length > 100 && bytes.length < 16 * 1024 * 1024);
      // Current source samples advertise JPEG. Full-body marker checks are not a pixel decoder.
      assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8'); assert.equal(bytes.subarray(-2).toString('hex'), 'ffd9');
      console.log(`MangaStash IMAGE complete JPEG ${bytes.length}B ${url}`);
    }
  });
  await check('Malformed request shapes, unsupported combinations and IDs fail before HTTP', async () => {
    let attempted = 0;
    const blocked = host(async () => { attempted++; throw new Error('Unexpected provider request'); }).source;
    for (const request of [{ page: 0 }, { page: 1.5 }, { page: '2' }, { filters: null }, { filters: [] }, { filters: { genres: {} } }, { filters: { genres: ['action'] } }, { filters: { genres: [{ id: 'missing' }] } }, { filters: { rating: [] } }, { filters: { invented: [] } }, { query: {} }, { query: 'x', sort: { id: 'latest' } }, { query: 'x', filters: { rating: { id: 'safe' } } }, { sort: 'title' }, { sort: { id: 'unknown' } }, { listId: 'missing' }]) await assert.rejects(() => blocked.search(request));
    for (const allowedContentRatings of [null, '1', 1, {}, [1, '3'], [1, 99], [NaN]]) {
      const context = { allowedContentRatings };
      for (const action of [() => blocked.search({ context }), () => blocked.getContent('ayashimon', context), () => blocked.getSectionsForPage({ id: 'home', context }), () => blocked.resolvePageSection({ id: 'home', context }, 'latest')]) await assert.rejects(action, /Invalid Mana content-rating policy/);
    }
    await assert.rejects(() => blocked.getChapterData('ayashimon', 'other/chapter-25.6'));
    assert.equal(attempted, 0);
  });
  await check('Deny-all, Safe-only, omitted and concurrent native contexts stay request-scoped', async () => {
    const target = host(replay()).source;
    const broad = await target.search({ context: all }); assert(broad.results.length);
    const empty = { allowedContentRatings: [] };
    assert.equal((await target.search({ context: empty })).results.length, 0);
    assert.equal((await target.getSectionsForPage({ id: 'home', context: empty })).length, 0);
    assert.equal((await target.resolvePageSection({ id: 'home', context: empty }, 'latest')).items.length, 0);
    await assert.rejects(() => target.getContent('ayashimon', empty), /excluded/);
    assert.equal((await target.search({})).results.length, broad.results.length);
    const [safe, broadAgain] = await Promise.allSettled([target.search({ context: { allowedContentRatings: [0] } }), target.search({ context: all })]);
    assert.equal(safe.status, 'rejected'); assert.match(safe.reason.message, /content-rating policy/);
    assert.equal(broadAgain.status, 'fulfilled'); assert.equal(broadAgain.value.results.length, broad.results.length);
    assert.equal((await target.getContent('ayashimon', { allowedContentRatings: [0] })).contentRating, 0);
    await assert.rejects(() => target.getContent('ayashimon', { allowedContentRatings: [1] }), /excluded/);
  });
  await check('Persisted image grants reject forged URLs, expired evidence and source-setting revocation', async () => {
    const isolated = host(replay()), target = isolated.source;
    const detail = await target.getContent('ayashimon', all), pages = await target.getChapterData('ayashimon', 'ayashimon/chapter-25.6');
    const cold = host(replay(), isolated.store).source;
    await cold.willRequestImage(pages.pages[0].url);
    for (const bad of [pages.pages[0].url + '?x=1', pages.pages[0].url + '#x', pages.pages[0].url.replace('/ayashimon/', '/other/'), pages.pages[0].url.replace('/001.jpg', '/999.jpg'), pages.pages[0].url.replace('/content/', '/x/../content/'), pages.pages[0].url.replace('/content/', '/x/%2e%2e/content/')]) await assert.rejects(() => cold.willRequestImage(bad));
    await (await findToggle(target)).didChange(true);
    await assert.rejects(() => cold.willRequestImage(detail.cover), /policy|issued|changed/);
    await target.getContent('ayashimon', all); await cold.willRequestImage(detail.cover);
    await assert.rejects(() => target.resolvePageSection({ id: 'home', context: all }, 'popular'), /explicitly Safe/);
    const value = await isolated.store.get('MangaStash.authorization.v1');
    for (const [, grant] of value.images) { grant.at = Date.now() - 86400001; grant.expires = grant.at + 86400000; }
    await isolated.store.set('MangaStash.authorization.v1', value);
    await assert.rejects(() => cold.willRequestImage(detail.cover), /expired|issued/);
    const maxState = { revision: Number.MAX_SAFE_INTEGER, onlySafe: false, titles: [], images: [] };
    await isolated.store.set('MangaStash.authorization.v1', maxState);
    await assert.rejects(() => (async () => (await findToggle(cold)).didChange(true))(), /revision is exhausted/);
    assert.deepEqual(plain(await isolated.store.get('MangaStash.authorization.v1')), maxState);
  });
  await check('Reader ownership, route, configuration, page count and ordering mutations fail closed', async () => {
    const mutations = [
      (s) => s.replace('rel="canonical" href="https://mangastash.org/ayashimon/chapter-25.6"', 'rel="canonical" href="https://mangastash.org/ayashimon/chapter-25"'),
      (s) => s.replace("seriesSlug: 'ayashimon'", "seriesSlug: 'other'"),
      (s) => s.replace('chapterNum: 25.6', 'chapterNum: 25'),
      (s) => s.replace('nextChapter: null,', 'nextChapter: null, chapterNum: 26,'),
      (s) => s.replace('chapterNum: 25.6,', "chapterNum: 25.6,\n    'chapterNum': 26,"),
      (s) => s.replace('chapterNum: 25.6,', 'chapterNum: 25.6,\n    chapterNum: 26,'),
      (s) => s.replace("seriesSlug: 'ayashimon',", "seriesSlug: 'ayashimon',\n    seriesSlug: 'other',"),
      (s) => s.replace('chapterNum: 25.6,', 'chapterNum: 25.6,\n    chapterNum: unsupported(),'),
      (s) => s.replace("seriesSlug: 'ayashimon',", "seriesSlug: 'ayashimon',\n    ['seriesSlug']: 'other',"),
      (s) => s.replace(/chapterId:\s*\d+/, 'chapterId: 0'),
      (s) => s.replace(/totalPages:\s*(\d+)/, (_, count) => `totalPages: ${Number(count) + 1}`),
      (s) => s.replace('data-page="3"', 'data-page="2"'),
      (s) => s.replaceAll('/chapter-0025.6/', '/chapter-0026/'),
      (s) => s.replace('class="reader-chapter-title">Ayashimon Ch. 25.6', 'class="reader-chapter-title">Ayashimon Ch. 25'),
      (s) => s.replace('class="reader"', 'class="reader chapter-locked"'),
      (s) => s.replace('data-src="/content/ayashimon/chapter-0025.6/003.jpg"', 'data-src="/content/ayashimon/chapter-0025.6/002.jpg"'),
    ];
    for (const mutation of mutations) {
      const target = host(replay((url, html) => url.endsWith('/chapter-25.6') ? mutation(html) : html)).source;
      await target.getContent('ayashimon', all);
      await assert.rejects(() => target.getChapterData('ayashimon', 'ayashimon/chapter-25.6'));
    }
  });
  await check('Positive source labels, malformed warnings and pagination mutations do not become fallback permission', async () => {
    for (const [label, rating] of [['Suggestive', 1], ['Mature', 2]]) {
      const target = host(replay((url, html) => url === `${domain}/ayashimon/` ? html.replace('>Safe</span>', `>${label}</span>`) : html)).source;
      assert.equal((await target.getContent('ayashimon', all)).contentRating, rating);
      await assert.rejects(() => target.getContent('ayashimon', { allowedContentRatings: [0] }), /excluded/);
    }
    for (const injected of ['<span class="content-rating">Unrecognized class</span>', '<div class="content-warning">Unrecognized source warning</div>']) {
      const target = host(replay((url, html) => url === `${domain}/ayashimon/` ? html.replace('<div class="series-meta">', `<div class="series-meta">${injected}`) : html)).source;
      await assert.rejects(() => target.getContent('ayashimon', all), /unrecognized/);
    }
    for (const mutate of [
      (html) => html.replace(/(name="rating" value="safe"\s*)checked/, '$1'),
      (html) => html.replace('class="page-num active">1', 'class="page-num active">2'),
      (html) => html.replace(/(value="[^"]*sort=title"\s*)selected/, '$1'),
    ]) {
      const target = host(replay((url, html) => url.includes('rating=safe') ? mutate(html) : html)).source;
      await assert.rejects(() => target.search({ filters: { genres: [{ id: 'action' }], language: [{ id: 'EN' }], rating: { id: 'safe' } }, sort: { id: 'title' }, context: all }), /scope|page|sort/);
    }
    const wrongQuery = host(replay((url, html) => url.includes('/search?') ? html.replace('value="Ayashimon" placeholder="Search series, authors, artists...', 'value="Other" placeholder="Search series, authors, artists...') : html)).source;
    await assert.rejects(() => wrongQuery.search({ query: 'Ayashimon', context: all }), /query echo/);
    const wrongScope = host(replay((url, html) => url.includes('/browse/') ? html.replace(/(<a href=")([^"]+)(" class="page-next")/, '$1/browse/?rating=mature&page=2$3') : html)).source;
    await assert.rejects(() => wrongScope.search({ context: all }), /scope/);
  });
  await check('Locked inventory chapters are not exposed or requested through persisted reader callbacks', async () => {
    let readerRequests = 0;
    const target = host(async (url) => {
      if (String(url).endsWith('/chapter-25.6')) readerRequests++;
      return replay((value, html) => value === `${domain}/ayashimon/` ? html.replace('href="/ayashimon/chapter-25.6" class="chapter-row"', 'href="/ayashimon/chapter-25.6" class="chapter-row locked"').replace('href="/ayashimon/chapter-1" class="chapter-row"', 'href="/ayashimon/chapter-1" class="chapter-row locked"') : html)(url);
    }).source;
    const detail = await target.getContent('ayashimon', all);
    assert(!detail.chapters.some((chapter) => ['ayashimon/chapter-1', 'ayashimon/chapter-25.6'].includes(chapter.chapterId)));
    assert(detail.chapters.every((chapter, index) => chapter.index === index), 'Readable native chapter indexes must remain consecutive after locks are omitted');
    await assert.rejects(() => target.getChapterData('ayashimon', 'ayashimon/chapter-25.6'), /locked/);
    assert.equal(readerRequests, 0);
  });
  await check('Source-setting changes revoke in-flight results without native-context interference', async () => {
    let release, began;
    const started = new Promise((resolve) => { began = resolve; });
    const target = host(async (url) => { began(); await new Promise((resolve) => { release = resolve; }); return replay()(url); }).source;
    const pending = target.getContent('ayashimon', all);
    await started; await (await findToggle(target)).didChange(true); release();
    await assert.rejects(() => pending, /changed/);
  });
  return { requests: requests.length };
}
