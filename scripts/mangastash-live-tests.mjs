import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { load } from 'cheerio';
import { createManaRuntime, installManaHTTP } from './mana-runtime.mjs';
import { authorizeTestImage, fetchTestImage } from './mana-test-images.mjs';

const domain = 'https://mangastash.org', all = { allowedContentRatings: [0, 1, 2, 3] };
const ids = (items) => Array.from(items, (item) => item.id);
const plain = (value) => JSON.parse(JSON.stringify(value));
// Failure-only public-path context. Never log provider HTML, titles or arbitrary URLs.
function coverOwnerDiagnostic(html, surface) {
  const entry = { surface, feed: null, cardIndex: null, selectedField: null, advertisedWidth: null,
    seriesPath: null, coverPath: null, classification: 'diagnostic-unavailable' };
  if (!['catalog', 'home'].includes(surface) || typeof html !== 'string' || html.length > 4_000_000) return undefined;
  const safePath = (value, series = false) => {
    if (typeof value !== 'string' || value.length > 1024 || /[\s\\%?#]/.test(value) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) return null;
    let target;
    try { target = new URL(value, domain); } catch { return null; }
    if (target.origin !== domain || target.username || target.password || target.search || target.hash) return null;
    const valid = series ? /^\/[a-z0-9][a-z0-9-]{0,255}\/$/.test(target.pathname)
      : /^\/content\/(?:covers\/(?:thumbnails\/)?[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}|[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}\/chapter-\d{1,32}(?:\.\d{1,16})?\/[a-zA-Z0-9_-]{1,256})\.(?:jpe?g|png|webp|avif|gif)$/i.test(target.pathname);
    return valid ? target.pathname : null;
  };
  const $ = load(html), groups = surface === 'catalog' ? [[null, $('.series-grid > .series-card')]]
    : [['popular', 'Popular This Month'], ['new', 'New Additions'], ['latest', 'Latest Updates']].map(([id, title]) => {
      const section = $('section.home-section').filter((_, node) => $(node).find('h2.section-title').first().text().replace(/\s+/g, ' ').trim() === title);
      return [id, section.find(id === 'latest' ? '.update-row' : '.series-card')];
    });
  let visited = 0;
  for (const [feed, rows] of groups) for (const [cardIndex, node] of rows.toArray().entries()) {
    if (++visited > 512) return entry;
    const row = $(node), anchor = row.is('a') ? row : row.find('a.update-title').first(), img = row.find('img').first();
    const seriesPath = safePath(anchor.attr('href'), true), candidates = [];
    // Keep the production parser's stable largest-advertised-candidate ordering.
    let fragments = 0;
    for (const field of ['data-srcset', 'srcset']) for (const part of (img.attr(field) ?? '').split(',', 257)) {
      if (++fragments > 256) return entry;
      const match = part.trim().match(/^(\S+)\s+(\d+)w$/);
      if (match) candidates.push({ field, value: match[1], size: Number(match[2]) });
    }
    for (const field of ['data-src', 'src']) if (img.attr(field)) candidates.push({ field, value: img.attr(field), size: 0 });
    candidates.sort((a, b) => b.size - a.size);
    const selected = candidates[0], coverPath = safePath(selected?.value);
    const context = { ...entry, feed, cardIndex, selectedField: selected?.field ?? null,
      advertisedWidth: Number.isSafeInteger(selected?.size) && selected.size <= 1_000_000 ? selected.size : null, seriesPath, coverPath };
    if (!seriesPath || !selected) return { ...context, classification: 'unsafe-or-unsupported-path' };
    const value = selected.value;
    let target;
    try { target = new URL(value, domain); } catch { return { ...context, classification: 'unsafe-or-unsupported-path' }; }
    if (/[\s\\]/.test(value) || /%/.test(value.split('?')[0]) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)
        || target.origin !== domain || target.username || target.password || target.search || target.hash
        || !/\.(?:jpe?g|png|webp|avif|gif)$/i.test(target.pathname)) return { ...context, classification: 'unsafe-or-unsupported-path' };
    // Match ownership independently of the narrower disclosure allowlist.
    const id = seriesPath.slice(1, -1);
    const namedCover = ['/content/covers/kagura-bachi.jpg', '/content/covers/thumbnails/kagura-bachi.jpg'].includes(target.pathname)
      ? id === 'kagurabachi' : new RegExp(`^/content/covers/(?:thumbnails/)?${id}\\.(?:jpe?g|png|webp|avif|gif)$`, 'i').test(target.pathname);
    const ownedPageCover = target.pathname.startsWith(`/content/${id}/`) && new RegExp(`^/content/${id}/chapter-\\d+(?:\\.\\d+)?/[a-zA-Z0-9_-]+\\.(?:jpe?g|png|webp|avif|gif)$`, 'i').test(target.pathname);
    if (!namedCover && !ownedPageCover) return { ...context, classification: !coverPath ? 'unsafe-or-unsupported-path'
      : coverPath.toLowerCase().startsWith('/content/covers/') ? 'named-cover-owner-mismatch' : 'chapter-owner-mismatch' };
  }
  return { ...entry, classification: 'owner-mismatch-not-found' };
}

export async function withMangaStashCoverDiagnostic(read, getHTML, surface, log = console.error) {
  try { return await read(); } catch (error) {
    try {
      if (error?.message === 'MangaStash cover has wrong owner') {
        const diagnostic = coverOwnerDiagnostic(getHTML(), surface);
        if (diagnostic) log(`MangaStash cover-owner diagnostic ${JSON.stringify(diagnostic)}`);
      }
    } catch { /* Diagnostics must never replace the original failure. */ }
    throw error;
  }
}

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
    const http = installManaHTTP(context);
    return { source: http.wrapSource(new context.Target()), store: context.ObjectStore };
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
    assert.equal(source.info.id, 'MangaStash'); assert.equal(source.info.version, '0.0.1-alpha.6');
    assert.match(source.info.description, /chapter dates are unavailable/);
    assert.equal((await findToggle(source)).value, false);
    const form = await source.getSearchForm();
    assert.deepEqual(Array.from(form.sections[0].children, (item) => item.id), ['status', 'genres', 'theme', 'mood', 'format', 'demographic', 'language', 'rating']);
    assert.deepEqual(Array.from(await source.getSortOptions(), (item) => item.id), ['latest', 'popular-month', 'popular-year', 'title']);
    assert.equal(requests.length, 0, 'Initialization must not make provider requests');
  });
  await check('Catalog same-response identities, source cover provenance and unknown fallback', async () => {
    catalog = await withMangaStashCoverDiagnostic(() => source.search({ page: 1, context: all }),
      () => responses.get(`${domain}/browse/`), 'catalog');
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
    // A provider card can use its own chapter page as the exact advertised cover.
    // Exercise the live Mushoku-style case when present, never invent an output URL.
    for (const item of catalog.results.filter((item) => new URL(item.cover).pathname.startsWith(`/content/${item.id}/chapter-`))) {
      assert.equal((await authorizeTestImage(host(replay(), store).source, item.cover, { origin: 'cover' })).url, item.cover);
      for (const bad of [item.cover.replace(`/content/${item.id}/`, '/content/wrong-owner/'), item.cover.replace('/chapter-', '/arbitrary-'), item.cover.replace(`/content/${item.id}/`, `/content/${item.id.toUpperCase()}/`), item.cover + '?x=1', item.cover.replace('/content/', '/content/%2e%2e/')]) {
        const target = host(replay((url, html) => url === `${domain}/browse/` ? html.replace(item.cover, bad) : html)).source;
        await assert.rejects(() => target.search({ context: all }), /owner|URL/);
      }
    }
  });
  await check('Source-proven Kagurabachi alias preserves exact ownership and persisted grants', async () => {
    const id = 'kagurabachi', pageURL = `${domain}/${id}/`, before = requests.length, pair = host();
    const detail = await pair.source.getContent(id, all), html = responses.get(pageURL), $ = load(html);
    assert.equal(requests.length, before + 1, 'One detail response must supply alias provenance without catalog N+1 requests');
    const books = $('script[type="application/ld+json"]').toArray().map((node) => JSON.parse($(node).html())).filter((item) => item['@type'] === 'Book');
    assert.equal($('link[rel="canonical"]').attr('href'), pageURL); assert.equal(books.length, 1);
    assert.equal(books[0]['@id'], pageURL); assert.equal(books[0].url, pageURL);
    assert.equal(books[0].image, `${domain}/content/covers/kagura-bachi.jpg`);
    assert.equal($('meta[property="og:image"]').attr('content'), books[0].image);
    assert.equal(detail.cover, books[0].image);
    const thumbnail = `${domain}/content/covers/thumbnails/kagura-bachi.jpg`;
    assert.equal($('.series-cover img').attr('src'), thumbnail);
    const cold = host(replay(), pair.store).source;
    assert.equal((await authorizeTestImage(cold, detail.cover, { origin: 'cover' })).url, detail.cover);
    // The other known alias is not issued by this isolated detail response.
    await assert.rejects(() => authorizeTestImage(cold, thumbnail, { origin: 'cover' }), /issued/);
    for (const owner of ['other', 'kagura-bachi', 'kagura--bachi']) {
      const changed = host(async () => new Response(html.replaceAll(id, owner), { status: 200, headers: { 'content-type': 'text/html' } })).source;
      await assert.rejects(() => changed.getContent(owner, all), /owner/);
    }
    for (const value of [detail.cover + '?x=1', detail.cover + '#x', detail.cover.replace('.jpg', '.webp'), detail.cover.replace('kagura-bachi', 'kagura--bachi'), detail.cover.replace('mangastash.org', 'other.example')]) {
      const changed = host(async () => new Response(html.replaceAll(detail.cover, value), { status: 200, headers: { 'content-type': 'text/html' } })).source;
      await assert.rejects(() => changed.getContent(id, all), /owner|URL/);
      await assert.rejects(() => authorizeTestImage(cold, value, { origin: 'cover' }), /issued|URL/);
    }
    const response = await fetchTestImage(cold, detail.cover, { origin: 'cover', fetchImpl: referenceFetch });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /^image\/jpe?g(?:;|$)/i);
    const bytes = Buffer.from(await response.arrayBuffer()); assert(bytes.length > 1000 && bytes.length < 16 * 1024 * 1024);
    assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8'); assert.equal(bytes.subarray(-2).toString('hex'), 'ffd9');
    console.log(`MangaStash verified alias complete JPEG ${bytes.length}B ${detail.cover}`);
  });
  await check('Exact source home feeds, same-response whole-feed comparison and overlaps', async () => {
    const sections = await withMangaStashCoverDiagnostic(() => source.getSectionsForPage({ id: 'home', context: all }),
      () => responses.get(`${domain}/`), 'home');
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
    const fields = (await source.getSearchForm()).sections[0].children, genreOwner = fields.find((field) => field.id === 'genres');
    assert(content.tags.every((tag) => tag.isNonInteractive === false && genreOwner.options.some((option) => option.id === tag.id)));
    const beforeTagRoutes = requests.length; let verifiedTagRoutes = 0;
    for (const node of $('.series-tags .tag-group').toArray()) {
      const group = $(node), title = group.find('.tag-category').text().trim().replace(/:$/, '');
      if (title === 'Genres') continue;
      const owner = fields.find((field) => field.title === title);
      if (!owner) continue;
      const section = content.additionalInfo.find((section) => section.id === owner.id);
      assert(section, `Detail tags must use their native owner ${owner.id}`);
      for (const link of group.find('.tag-chip').toArray().slice(0, 10)) {
        const destination = new URL($(link).attr('href'), domain), entries = [...destination.searchParams];
        const option = owner.options.find((option) => option.id && option.id === entries[0]?.[1] && option.title === $(link).text().trim());
        if (destination.origin !== domain || destination.pathname !== '/browse/' || destination.hash || entries.length !== 1 || entries[0][0] !== owner.id || !option) continue;
        const tag = section.items.find((tag) => tag.id === option.id);
        assert(tag && tag.title === option.title && tag.isNonInteractive === false, 'Source browse tags must retain canonical option ID and title');
        // Exercise serialized native detail-to-search routing without another
        // provider request. This verifies the callback contract, not an iOS tap.
        const selected = plain({ filters: { [section.id]: owner.id === 'rating' ? tag : [tag] }, context: all });
        let routed = 0;
        const target = host(async (input) => {
          routed++; const params = new URLSearchParams([[owner.id === 'rating' ? owner.id : `${owner.id}[]`, option.id]]);
          assert.equal(String(input), `${domain}/browse/?${params}`);
          throw new Error('Verified detail-tag search route');
        }).source;
        await assert.rejects(() => target.search(selected), /Verified detail-tag search route/);
        assert.equal(routed, 1); verifiedTagRoutes++;
      }
    }
    assert(verifiedTagRoutes > 0, 'Actual detail must exercise a non-genre native search route');
    assert.equal(requests.length, beforeTagRoutes, 'Detail tag routing must not add provider requests');
    assert.equal(content.contentRating, 0); assert(chapters.length > 0); assert.equal(chapters.length, rows.length);
    assert.deepEqual(Array.from(chapters, (item) => item.chapterId), rows.map((row) => $(row).attr('href').slice(1)));
    assert(chapters.some((item) => item.chapterId === 'ayashimon/chapter-25.6' && item.number === 25.6));
    for (const [index, chapter] of Array.from(chapters).entries()) {
      assert.equal(chapter.index, index); assert.equal(chapter.language, 'en_US');
      const date = $(rows[index]).find('time').attr('datetime') || $(rows[index]).attr('data-date');
      assert.equal(chapter.date.getTime(), date ? new Date(date).getTime() : 0);
    }
    const dateNote = (result) => result.additionalInfo.filter((section) => section.id === 'chapter-date-metadata');
    const missingDates = rows.some((row) => !($(row).find('time[datetime]').attr('datetime') || $(row).attr('data-date')));
    assert.equal(dateNote(content).length, missingDates ? 1 : 0);
    if (missingDates) assert.equal(dateNote(content)[0].items[0].title, 'The site does not provide dates for some chapters. Their displayed upload ages are not reliable.');
    // Small same-response mutations distinguish missing readable dates from
    // complete dates or missing dates belonging only to an omitted locked row.
    for (const variant of ['complete', 'one missing', 'locked missing']) {
      const date = '2020-02-03T04:05:06.000Z';
      const target = host(replay((_url, html) => {
        const $date = load(html), allRows = $date('#chapter-list > .chapter-row');
        allRows.find('time[datetime]').remove(); allRows.attr('data-date', date);
        const selected = allRows.eq(rawRows.indexOf(rows[0]));
        if (variant !== 'complete') selected.removeAttr('data-date');
        if (variant === 'locked missing') selected.attr('data-locked', 'true');
        return $date.html();
      })).source;
      const result = await target.getContent('ayashimon', all);
      assert.equal(dateNote(result).length, variant === 'one missing' ? 1 : 0);
      assert(result.chapters.every((chapter) => chapter.date.getTime() === new Date(date).getTime() || (variant === 'one missing' && chapter.date.getTime() === 0)));
    }
    assert.equal(requests.length, beforeTagRoutes, 'Date-note checks must not add provider requests');
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
    for (const [url, origin] of [[content.cover, 'cover'], [reader.pages[0].url, 'page'], [reader.pages[Math.floor(reader.pages.length / 2)].url, 'page'], [reader.pages.at(-1).url, 'page']]) {
      const request = await authorizeTestImage(cold, url, { origin }); assert.equal(request.url, url);
      const response = await fetchTestImage(cold, url, { origin, fetchImpl: referenceFetch });
      assert.equal(response.status, 200); assert(response.headers.get('content-type')?.startsWith('image/'));
      const bytes = Buffer.from(await response.arrayBuffer()); assert(bytes.length > 100 && bytes.length < 16 * 1024 * 1024);
      // Current source samples advertise JPEG. Full-body marker checks are not a pixel decoder.
      assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8'); assert.equal(bytes.subarray(-2).toString('hex'), 'ffd9');
      console.log(`MangaStash IMAGE complete JPEG ${bytes.length}B ${url}`);
    }
    const pageCover = catalog?.results.find((item) => new URL(item.cover).pathname.startsWith(`/content/${item.id}/chapter-`));
    if (pageCover) {
      const request = await authorizeTestImage(cold, pageCover.cover, { origin: 'cover' });
      assert.equal(request.url, pageCover.cover);
      const response = await fetchTestImage(cold, request.url, { origin: 'cover', fetchImpl: referenceFetch });
      assert.equal(response.status, 200); assert(response.headers.get('content-type')?.startsWith('image/'));
      const bytes = Buffer.from(await response.arrayBuffer()); assert(bytes.length > 100 && bytes.length < 16 * 1024 * 1024);
      const jpeg = bytes.subarray(0, 2).toString('hex') === 'ffd8' && bytes.subarray(-2).toString('hex') === 'ffd9';
      const webp = bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length;
      const png = bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' && bytes.subarray(-8).toString('hex') === '49454e44ae426082';
      assert(jpeg || webp || png, 'Chapter-page cover must contain a complete supported image body');
      console.log(`MangaStash chapter-page cover: one extra read, ${bytes.length}B ${request.url}`);
    } else console.log('MangaStash chapter-page cover: no advertised current sample; extra-body branch unexercised');
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
    for (const id of ['-ayashimon', 'Ayashimon', 'ayashimon%2fother', 'ayashimon/../other', 'ayashimon\\other', 'x'.repeat(257)]) {
      await assert.rejects(() => blocked.getContent(id, all));
      await assert.rejects(() => blocked.getChapterData(id, `${id}/chapter-25.6`));
    }
    assert.equal(await blocked.handleURL('https://foreign.example/ayashimon/'), null);
    assert.equal(attempted, 0);
    // Canonical slug punctuation is literal data, not text to normalize away.
    for (const id of ['ayashimon-', 'ayashimon--side']) {
      const routes = [];
      const changed = host(async (input) => {
        const url = String(input); routes.push(url);
        assert([`${domain}/${id}/`, `${domain}/${id}/chapter-25.6`].includes(url));
        return replay((_url, html) => html.replaceAll('ayashimon', id))(url.replace(id, 'ayashimon'));
      });
      const detail = await changed.source.getContent(id, all);
      assert.equal(detail.webUrl, `${domain}/${id}/`);
      assert(detail.chapters.every((chapter) => chapter.chapterId.startsWith(`${id}/`)));
      assert.equal(detail.cover, content.cover.replace('ayashimon', id));
      const pages = await changed.source.getChapterData(id, `${id}/chapter-25.6`);
      assert.deepEqual(Array.from(pages.pages, ({ url }) => url), Array.from(reader.pages, ({ url }) => url.replace('ayashimon', id)));
      const cold = host(replay(), changed.store).source;
      assert.equal((await authorizeTestImage(cold, detail.cover, { origin: 'cover' })).url, detail.cover);
      await assert.rejects(() => authorizeTestImage(cold, detail.cover.replace(id, 'ayashimon'), { origin: 'cover' }));
      await assert.rejects(() => changed.source.getChapterData(id, 'ayashimon/chapter-25.6'));
      assert.equal((await changed.source.handleURL(`${domain}/${id}/chapter-25.6`)).content.id, id);
      assert.equal(routes.length, 2, 'Literal slug roundtrip must use only the exact detail and reader paths');
    }
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
    await authorizeTestImage(cold, pages.pages[0].url, { origin: 'page' });
    const snapshot = await isolated.store.get('MangaStash.authorization.v1');
    for (const [url, origin, factory, nativeOrigin] of [[detail.cover, 'cover', 'getCoverTransport', 1], [pages.pages[0].url, 'page', 'getPageTransport', 2]]) {
      const client = cold[factory]({ url, origin: nativeOrigin });
      assert(client && typeof client.then !== 'function', 'Image transport factories must be synchronous');
      let outgoing = 0;
      try {
        await assert.rejects(fetchTestImage(cold, url, { origin, fetchImpl: async () => {
          outgoing += 1;
          await isolated.store.set('MangaStash.authorization.v1', { ...snapshot, revision: snapshot.revision + 1, images: [] });
          return new Response('This controlled body must never escape revoked image policy', { status: 200 });
        } }), /policy|issued|changed/);
        assert.equal(outgoing, 1, 'Revocation test must reach exactly one authorized image transport');
      } finally { await isolated.store.set('MangaStash.authorization.v1', snapshot); }
    }
    for (const bad of [pages.pages[0].url + '?x=1', pages.pages[0].url + '#x', pages.pages[0].url.replace('/ayashimon/', '/other/'), pages.pages[0].url.replace('/001.jpg', '/999.jpg'), pages.pages[0].url.replace('/content/', '/x/../content/'), pages.pages[0].url.replace('/content/', '/x/%2e%2e/content/')]) await assert.rejects(() => authorizeTestImage(cold, bad, { origin: 'page' }));
    await (await findToggle(target)).didChange(true);
    await assert.rejects(() => authorizeTestImage(cold, detail.cover, { origin: 'cover' }), /policy|issued|changed/);
    await target.getContent('ayashimon', all); await authorizeTestImage(cold, detail.cover, { origin: 'cover' });
    await assert.rejects(() => target.resolvePageSection({ id: 'home', context: all }, 'popular'), /explicitly Safe/);
    const value = await isolated.store.get('MangaStash.authorization.v1');
    for (const [, grant] of value.images) { grant.at = Date.now() - 86400001; grant.expires = grant.at + 86400000; }
    await isolated.store.set('MangaStash.authorization.v1', value);
    await assert.rejects(() => authorizeTestImage(cold, detail.cover, { origin: 'cover' }), /expired|issued/);
    // Reuse actual reader URLs in transient detail mutations to exercise both
    // issuance orders even if today's catalog has no chapter-page cover.
    for (const order of ['cover-first', 'reader-first']) {
      const page = pages.pages[0].url, chapter = 'ayashimon/chapter-25.6';
      const asCover = replay((url, html) => url === `${domain}/ayashimon/` ? html.replace(`property="og:image" content="${detail.cover}"`, `property="og:image" content="${page}"`) : html);
      const pair = host(order === 'cover-first' ? asCover : replay());
      await pair.source.getContent('ayashimon', { allowedContentRatings: [0] });
      if (order === 'reader-first') await pair.source.getChapterData('ayashimon', chapter);
      let saved = await pair.store.get('MangaStash.authorization.v1');
      const firstRole = saved.images.find(([url]) => url === page)[1];
      firstRole.at = Date.now() - 10000; firstRole.expires = firstRole.at + 86400000;
      const firstBefore = plain(firstRole);
      await pair.store.set('MangaStash.authorization.v1', saved);
      if (order === 'cover-first') await pair.source.getChapterData('ayashimon', chapter);
      else await host(asCover, pair.store).source.getContent('ayashimon', { allowedContentRatings: [0] });
      saved = await pair.store.get('MangaStash.authorization.v1');
      const roles = saved.images.filter(([url]) => url === page);
      assert.deepEqual(roles.map(([, grant]) => grant.chapter).sort(), ['', chapter]);
      assert.deepEqual(plain(roles.find(([, grant]) => grant.chapter === firstBefore.chapter)[1]), firstBefore, 'Issuing another role must not rewrite existing evidence');
      const cold = host(replay(), pair.store).source, baseline = plain(saved);
      await host(asCover, pair.store).source.getContent('ayashimon', all);
      await cold.getChapterData('ayashimon', chapter);
      const reissued = await pair.store.get('MangaStash.authorization.v1');
      assert.deepEqual(plain(reissued.images.filter(([url]) => url === page).sort((a, b) => a[1].chapter.localeCompare(b[1].chapter))), plain(roles.sort((a, b) => a[1].chapter.localeCompare(b[1].chapter))), 'Same-role reissue must retain original policy and expiry too');
      await authorizeTestImage(cold, page, { origin: 'page' });
      for (const expiredRole of ['', chapter]) {
        const state = plain(baseline), grant = state.images.find(([url, grant]) => url === page && grant.chapter === expiredRole)[1];
        grant.at = Date.now() - 86400001; grant.expires = grant.at + 86400000;
        await pair.store.set('MangaStash.authorization.v1', state); await authorizeTestImage(cold, page, { origin: 'page' });
      }
      const bothExpired = plain(baseline);
      for (const [url, grant] of bothExpired.images) if (url === page) { grant.at = Date.now() - 86400001; grant.expires = grant.at + 86400000; }
      await pair.store.set('MangaStash.authorization.v1', bothExpired); await assert.rejects(() => authorizeTestImage(cold, page, { origin: 'page' }), /expired|issued/);
      for (const unavailable of ['locked', 'missing']) {
        const state = plain(baseline), title = state.titles.find(([id]) => id === 'ayashimon')[1];
        if (unavailable === 'locked') title.chapters.find((item) => item.chapterId === chapter).locked = true;
        else title.chapters = title.chapters.filter((item) => item.chapterId !== chapter);
        await pair.store.set('MangaStash.authorization.v1', state); await authorizeTestImage(cold, page, { origin: 'page' }); // Independently advertised public cover remains usable.
        await assert.rejects(() => cold.getChapterData('ayashimon', chapter), /locked|inventory/);
        state.images = state.images.filter(([url, grant]) => url !== page || grant.chapter);
        await pair.store.set('MangaStash.authorization.v1', state); await assert.rejects(() => authorizeTestImage(cold, page, { origin: 'page' }), /policy|evidence/);
      }
      for (const deniedRole of ['', chapter]) {
        const state = plain(baseline);
        state.images.find(([url, grant]) => url === page && grant.chapter === deniedRole)[1].allowed = [2];
        await pair.store.set('MangaStash.authorization.v1', state); await authorizeTestImage(cold, page, { origin: 'page' });
      }
      const currentWarning = plain(baseline);
      for (const [url, grant] of currentWarning.images) if (url === page) grant.allowed = [0];
      currentWarning.titles.find(([id]) => id === 'ayashimon')[1].rating = 2;
      await pair.store.set('MangaStash.authorization.v1', currentWarning); await assert.rejects(() => authorizeTestImage(cold, page, { origin: 'page' }), /policy/);
      await pair.store.set('MangaStash.authorization.v1', baseline);
      for (const bad of [page + '?x=1', page.replace('/ayashimon/', '/other/'), page.replace('/001.jpg', '/unissued.jpg')]) await assert.rejects(() => authorizeTestImage(cold, bad, { origin: 'page' }));
      for (const conflict of ['duplicate-role', 'different-chapter', 'different-owner']) {
        const state = plain(baseline), record = plain(state.images.find(([url, grant]) => url === page && grant.chapter));
        if (conflict === 'different-chapter') record[1].chapter = 'ayashimon/chapter-25';
        if (conflict === 'different-owner') record[1].id = 'other';
        state.images.push(record); await pair.store.set('MangaStash.authorization.v1', state);
        if (conflict === 'different-owner') { // Wrong-owner records cannot authorize their own callback.
          state.images = [record]; await pair.store.set('MangaStash.authorization.v1', state);
        }
        await assert.rejects(() => authorizeTestImage(cold, page, { origin: 'page' }));
      }
      await pair.store.set('MangaStash.authorization.v1', baseline);
      await (await findToggle(cold)).didChange(true); await assert.rejects(() => authorizeTestImage(cold, page, { origin: 'page' }), /policy|issued/);
    }
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
