import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { assertReadOnlyManhwaNexPost, createManaRuntime } from './mana-runtime.mjs';

const domain = 'https://manhwanex.com';
const blocked = new Set(['adult', 'mature', 'smut', 'hentai', 'erotica', 'ecchi']);
const canonicalID = (url) => new URL(url).pathname.split('/')[2];
const ids = (items) => Array.from(items, (item) => item.id);
async function html(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
  assert(response.ok, `Reference HTTP ${response.status}`);
  return load(await response.text());
}
async function imageBytes(source, url) {
  const request = await source.willRequestImage(url);
  const response = await fetch(request.url, { headers: request.headers, signal: AbortSignal.timeout(30_000) });
  assert(response.ok, `Image HTTP ${response.status}`);
  assert(response.headers.get('content-type')?.startsWith('image/'));
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(bytes.length > 100 && bytes.length < 20 * 1024 * 1024, 'Image bytes missing or outside the bounded live probe');
  const signature = bytes.subarray(0, 12).toString('hex');
  assert(signature.startsWith('ffd8ff') || signature.startsWith('89504e470d0a1a0a')
    || signature.startsWith('47494638')
    || (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'), 'Unrecognized actual image signature');
  console.log(`IMAGE ${bytes.length}B ${url}`);
  return bytes;
}
function imageDimensions(bytes) {
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    assert(bytes.length >= 45, 'Truncated PNG');
    assert.equal(bytes.readUInt32BE(8), 13, 'Invalid PNG IHDR length');
    assert.equal(bytes.subarray(12, 16).toString(), 'IHDR', 'PNG has no initial IHDR');
    const dimensions = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    assert(dimensions.every((value) => value > 0 && value <= 0x7fffffff), 'Invalid PNG dimensions');
    let imageData = false;
    for (let offset = 8; offset < bytes.length;) {
      assert(offset + 12 <= bytes.length, 'Truncated PNG chunk');
      const size = bytes.readUInt32BE(offset), kind = bytes.subarray(offset + 4, offset + 8).toString();
      assert(size <= bytes.length - offset - 12, 'Truncated PNG chunk data');
      assert(offset === 8 || kind !== 'IHDR', 'Duplicate PNG IHDR');
      if (kind === 'IDAT') imageData = true;
      offset += size + 12;
      if (kind === 'IEND') {
        assert(size === 0 && imageData && offset === bytes.length, 'PNG has no image data or is incomplete');
        return dimensions;
      }
    }
    assert.fail('PNG has no IEND');
  }
  assert(bytes.length >= 26, 'Truncated WebP');
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, 'WebP is incomplete');
  for (let offset = 12; offset < bytes.length;) {
    assert(offset + 8 <= bytes.length, 'Truncated WebP chunk');
    const size = bytes.readUInt32LE(offset + 4);
    assert(size + (size % 2) <= bytes.length - offset - 8, 'Truncated WebP chunk data');
    offset += 8 + size + (size % 2);
  }
  assert(bytes.readUInt32LE(16) >= (bytes.subarray(12, 16).toString() === 'VP8L' ? 5 : 10), 'Truncated WebP dimensions');
  const kind = bytes.subarray(12, 16).toString();
  if (kind === 'VP8X') return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  if (kind === 'VP8L') { const n = bytes.readUInt32LE(21); return [(n & 0x3fff) + 1, ((n >>> 14) & 0x3fff) + 1]; }
  assert.equal(kind, 'VP8 '); assert.equal(bytes.subarray(23, 26).toString('hex'), '9d012a');
  return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
}

export async function testManhwaNexNativeRatings({ source, check, requests, freshSource, nativeStore }) {
  const setting = async (target, value) => {
    const field = (await target.getPreferenceMenu()).sections[0].children[0];
    if (value !== undefined) await field.didChange(value);
    return field;
  };
  const context = (ratings) => ({ allowedContentRatings: ratings });
  const fields = '.mg_genres .summary-content a, .tab-summary .genres-content a';
  const warning = '.adult-content, .manga-adult, .adult-warning, [data-adult="1"], [data-adult="true"]';
  let baseline;
  await check('Native rating authority defaults to no extra source cap and replays raw cached pages under changed contexts', async () => {
    if (nativeStore) assert.equal(await nativeStore.get('ManhwaNex.excludeNSFW'), null);
    assert.equal((await setting(source)).value, false, 'Never-saved preference silently imposed an adult cap');
    const start = requests.length;
    baseline = await source.search({ page: 1 });
    assert(baseline.results.length);
    assert(requests.slice(start).every((request) => new URL(request.url).searchParams.get('adult') !== '0'));
    assert(baseline.results.every((item) => [2, 3].includes(item.contentRating)));
    if (nativeStore) assert.equal(await nativeStore.get('ManhwaNex.excludeNSFW'), null, 'Reading an unset preference must not save a default');
    const warm = requests.length;
    const all = await source.search({ page: 1, context: context([0, 1, 2, 3]) });
    assert.deepEqual(ids(all.results), ids(baseline.results));
    const mature = await source.search({ page: 1, context: context([2]) });
    assert(mature.results.every((item) => item.contentRating === 2));
    for (const ratings of [[], [0], [1]]) {
      const none = await source.search({ page: 1, context: context(ratings) });
      assert.equal(none.results.length, 0); assert.equal(none.isLastPage, true);
    }
    assert.deepEqual(ids((await source.search({ page: 1 })).results), ids(baseline.results));
    const narrowContext = context([2]), broadContext = context([0, 1, 2, 3]);
    const concurrent = await Promise.all([source.search({ page: 1, context: narrowContext }), source.search({ page: 1, context: broadContext })]);
    assert(concurrent[0].results.every((item) => item.contentRating === 2 && item.context === narrowContext));
    assert(concurrent[1].results.every((item) => item.context === broadContext));
    assert.deepEqual(ids(concurrent[1].results), ids(baseline.results));
    assert.equal(requests.length, warm, 'Context changes discarded reusable raw native pages');
    const changed = context([2]);
    const row = await source.resolvePageSection({ id: 'home', context: changed }, 'latest');
    assert(row.items.every((item) => item.contentRating === 2 && item.context === changed));
    assert.strictEqual(row.viewMoreLink.request.context, changed, 'viewMore lost its exact native context');
    await setting(source, false);
    if (nativeStore) assert.equal(await nativeStore.get('ManhwaNex.excludeNSFW'), false);
    assert.equal((await setting(freshSource())).value, false, 'Saved false did not survive source restart');
    await setting(source, true);
    assert.equal((await setting(freshSource())).value, true, 'Saved true did not survive source restart');
    await setting(source, false);
  });
  await check('Native details use supported Mature fallback only for incomplete metadata and retain positive adult warnings', async () => {
    const id = baseline.results.find((item) => item.contentRating === 2).id;
    for (const adult of [false, true]) {
      const cold = freshSource(), original = cold.api.text.bind(cold.api);
      cold.api.text = async (...args) => {
        const $ = load(await original(...args)); $(fields).remove(); $(warning).remove();
        if (adult) $('.tab-summary').first().append('<span class="adult-warning"></span>');
        return $.html();
      };
      const details = await cold.getContent(id, context([adult ? 3 : 2]));
      assert.equal(details.contentRating, adult ? 3 : 2);
      const markers = details.additionalInfo.filter((section) => section.id === 'content-rating-metadata');
      assert.equal(markers.length, adult ? 0 : 1);
      if (!adult) assert(markers[0].items.some((item) => /Incomplete metadata.*Mature compatibility fallback/.test(item.title)));
      assert.equal(details.webUrl, `${domain}/manga/${id}/`);
      await assert.rejects(() => cold.getContent(id, context([adult ? 2 : 0])), /Mana.*content-rating policy/);
      await assert.rejects(() => cold.getContent(id, context([])), /Mana.*content-rating policy/);
    }
    const allowed = freshSource(), details = await allowed.getContent(id, context([2]));
    await assert.rejects(() => allowed.getContent(id, context([3])), /Mana.*content-rating policy/);
    // Reader callbacks have no native SourceContext. A preceding restricted call
    // must not poison authorized source-only chapter or image access.
    const chapters = await allowed.getChapters(id);
    assert(chapters.length);
    const reader = await allowed.getChapterData(id, chapters.at(-1).chapterId);
    await imageBytes(allowed, reader.pages[0].url);
    await imageBytes(allowed, details.cover);
  });
  await check('Native singleton policy skips excluded-only physical pages and never caches a reader policy', async () => {
    const cold = freshSource(), original = cold.api.text.bind(cold.api);
    let second, third;
    cold.api.text = async (...args) => {
      const value = await original(...args);
      if (args[1] === 'POST') return value;
      const $ = load(value);
      if (args[0] === `${domain}/?s=&post_type=wp-manga`) second = $('.wp-pagenavi a.nextpostslink').attr('href');
      else if (args[0] === second) { $('.c-tabs-item__content').append('<span class="adult-warning"></span>'); third = $('.wp-pagenavi a.nextpostslink').attr('href'); }
      else if (args[0] === third) $('.wp-pagenavi a.nextpostslink').remove();
      return $.html();
    };
    const first = await cold.search({ page: 1, context: context([2]) });
    const next = await cold.search({ page: 2, context: context([2]) });
    assert(first.results.length && next.results.length && next.isLastPage);
    assert(first.results.every((item) => item.contentRating === 2) && next.results.every((item) => item.contentRating === 2));
    assert.equal(new Set([...ids(first.results), ...ids(next.results)]).size, first.results.length + next.results.length);
    const explicit = await cold.search({ page: 1, context: context([3]) });
    assert(explicit.results.length && explicit.results.every((item) => item.contentRating === 3));
    assert.deepEqual(ids((await cold.search({ page: 2, context: context([2]) })).results), ids(next.results));
  });
  // Existing safety/authorization tests below explicitly exercise saved true.
  await setting(source, true);
}

export async function testManhwaNex({ source, check, requests, freshSource, nativeStore }) {
  await testManhwaNexNativeRatings({ source, check, requests, freshSource, nativeStore });
  const preference = async (value) => {
    const field = (await source.getPreferenceMenu()).sections.flatMap((section) => section.children ?? []).find((item) => item.id === 'excludeNSFW');
    assert(field, 'Missing persistent NSFW setting');
    if (value !== undefined) await field.didChange(value);
    return field;
  };
  let sections, home, catalog, content, chapters, form;
  const detailResponses = new Map();
  const sample = 'logging-10000-years-into-the-future';
  await check('Explicitly saved source exclusion uses two cold requests and zero warm requests', async () => {
    assert.equal((await preference()).value, true);
    const before = requests.length;
    sections = await source.getSectionsForPage({ id: 'home' });
    assert.deepEqual(Array.from(sections, (section) => section.title), ['Popular Series', 'Latest Updates', 'Action', 'Romance', 'Fantasy', 'Martial Arts', 'Adventure', 'Ghost', 'Cultivation', 'System']);
    assert.equal(requests.length - before, 1, 'Section descriptors eagerly fetched category cards or metadata');
    home = {};
    for (const section of sections.slice(0, 2)) home[section.id] = await source.resolvePageSection({ id: 'home' }, section.id);
    assert.equal(requests.length - before, 2, 'Cold discovery reintroduced metadata N+1');
    assert(home.popular.items.length && home.latest.items.length);
    for (const section of sections.slice(0, 2)) await source.resolvePageSection({ id: 'home' }, section.id);
    assert.equal(requests.length - before, 2, 'Warm discovery made network requests');
  });
  await check('Native home names, memberships, exact order and pagination are preserved', async () => {
    const $ = await html(`${domain}/`);
    for (const [id, selector] of [['popular', '.widget-manga-popular-slider .slider__item'], ['latest', '.page-item-detail']]) {
      const expected = $(selector).toArray().map((node) => canonicalID($(node).find('.post-title a').attr('href')));
      assert.deepEqual(ids(home[id].items), expected);
    }
    assert.equal(home.popular.viewMoreLink, undefined);
    assert(home.latest.viewMoreLink);
    const next = await source.search({ page: 2, listId: 'latest' });
    const reference = await html($('.wp-pagenavi a.nextpostslink').attr('href'));
    assert.deepEqual(ids(next.results), reference('.page-item-detail').toArray().map((node) => canonicalID(reference(node).find('.post-title a').attr('href'))).filter((id) => !ids(home.latest.items).includes(id)));
    assert(!next.results.some((item) => home.latest.items.some((prior) => prior.id === item.id)));
  });
  await check('Largest source-advertised covers have real intrinsic image dimensions', async () => {
    const popular = home.popular.items[0], latest = home.latest.items.find((item) => item.id === popular.id);
    assert(latest);
    assert.deepEqual(imageDimensions(await imageBytes(source, popular.cover)), [193, 278]);
    assert.deepEqual(imageDimensions(await imageBytes(source, latest.cover)), [350, 476]);
  });
  await check('Native safe search returns exact source page and next-page identities', async () => {
    catalog = await source.search({ page: 1 });
    assert(catalog.results.length && !catalog.isLastPage);
    const $ = await html(`${domain}/?s=&post_type=wp-manga&adult=0`);
    assert.deepEqual(ids(catalog.results), $('.c-tabs-item__content').toArray().map((node) => canonicalID($(node).find('.post-title a').attr('href'))));
    const next = await source.search({ page: 2 });
    const reference = await html($('.wp-pagenavi a.nextpostslink').attr('href'));
    assert.deepEqual(ids(next.results), reference('.c-tabs-item__content').toArray().map((node) => canonicalID(reference(node).find('.post-title a').attr('href'))).filter((id) => !ids(catalog.results).includes(id)));
    assert(requests.some((request) => new URL(request.url).searchParams.get('adult') === '0'));
  });
  await check('Search form exposes only verified native taxonomy and Relevance sort', async () => {
    form = (await source.getSearchForm()).sections.flatMap((section) => section.children ?? []);
    assert.equal(form.find((field) => field.id === 'genres').options.length, 8);
    assert.equal(form.find((field) => field.id === 'status').options.length, 5);
    assert.deepEqual(Array.from(await source.getSortOptions(), (sort) => sort.id), ['relevance']);
    for (const id of ['condition', 'author', 'artist', 'release', 'adult']) assert(form.some((field) => field.id === id));
    assert.equal(form.find((field) => field.id === 'adult').options.length, 1);
  });
  for (const section of sections.slice(2)) await check(`Native ${section.title} archive stays lazy, ordered and complete in both safety modes`, async () => {
    try {
      for (const exclude of [true, false]) {
        const cold = freshSource(), original = cold.api.text.bind(cold.api), captured = new Map(), calls = [];
        await (await cold.getPreferenceMenu()).sections[0].children[0].didChange(exclude);
        cold.api.text = async (...args) => {
          calls.push({ url: args[0], method: args[1] ?? 'GET', body: args[2] });
          const value = await original(...args);
          if (args[1] !== 'POST') captured.set(args[0], value);
          return value;
        };
        const before = requests.length, descriptors = await cold.getSectionsForPage({ id: 'home' });
        assert.equal(requests.length - before, 1, 'Descriptors fetched archive cards or safety metadata');
        const nativeHome = load(captured.get(`${domain}/`)), menu = [];
        nativeHome('li.menu-item-object-wp-manga-genre > a').each((_, node) => {
          const href = nativeHome(node).attr('href');
          if (!menu.some((item) => item.url === href)) menu.push({ id: `genre:${new URL(href).pathname.split('/')[2]}`, title: nativeHome(node).text().trim(), url: href });
        });
        assert.deepEqual(Array.from(descriptors.slice(2), ({ id, title }) => ({ id, title })), menu.map(({ id, title }) => ({ id, title })));
        const native = menu.find((item) => item.id === section.id), combined = [], seen = new Set();
        assert(native, 'A section was not backed by the native menu');
        let nextURL = native.url, page = 1;
        while (nextURL) {
          assert(page <= 100, 'Archive did not finish within the verified page bound');
          const start = calls.length;
          const result = await cold.search({ page, listId: section.id });
          const actualRequests = calls.slice(start);
          assert.equal(actualRequests.filter((request) => request.method === 'GET').length, 1, 'A page fetched more than its advertised archive');
          assert(actualRequests.every((request) => request.url === nextURL || request.url === `${domain}/wp-admin/admin-ajax.php`), 'Archive resolution fetched details or an unrelated route');
          const batches = actualRequests.filter((request) => request.method === 'POST');
          assert(batches.length <= 1, 'Archive safety classification reintroduced metadata N+1');
          for (const batch of batches) {
            const body = new URLSearchParams(batch.body);
            assert(Number(body.get('vars[posts_per_page]')) <= 16);
            assert.equal(body.has('vars[meta_query][0][key]'), exclude);
          }
          const $ = load(captured.get(nextURL)), rows = $('.page-item-detail.manga').toArray();
          const raw = rows.map((node) => ({ id: canonicalID($(node).find('.post-title a').attr('href')), title: $(node).find('.post-title a').attr('title') || $(node).find('.post-title a').text().replace(/\s+/g, ' ').trim() }));
          assert(raw.length && raw.length <= 16);
          const expected = raw.filter((item) => !seen.has(item.id) && (!exclude || cold.allowed(cold.metadata.get(`true:${item.id}`)?.value)));
          assert.deepEqual(ids(result.results), expected.map((item) => item.id));
          assert.deepEqual(Array.from(result.results, (item) => item.title), expected.map((item) => item.title));
          for (const item of result.results) assert(cold.metadata.get(`${exclude}:${item.id}`)?.value.genres.some((genre) => genre.id === section.id.slice('genre:'.length)), 'Archive metadata lost its native genre membership');
          for (const item of raw) seen.add(item.id);
          combined.push(...ids(result.results));
          nextURL = $('.wp-pagenavi a.nextpostslink').attr('href');
          assert.equal(result.isLastPage, !nextURL);
          const warm = requests.length;
          assert.deepEqual(ids((await cold.search({ page, listId: section.id })).results), ids(result.results));
          assert.equal(requests.length, warm, 'Warm archive page made network requests');
          if (page === 1) {
            const resolved = await cold.resolvePageSection({ id: 'home' }, section.id);
            assert.deepEqual(ids(resolved.items), ids(result.results));
            assert.equal(Boolean(resolved.viewMoreLink), !result.isLastPage);
            if (resolved.viewMoreLink) assert.equal(resolved.viewMoreLink.request.listId, section.id);
          }
          page += 1;
        }
        assert.equal(new Set(combined).size, combined.length, 'Combined native pages contain repeated canonical IDs');
        const end = requests.length, beyond = await cold.search({ page, listId: section.id });
        assert.equal(beyond.results.length, 0); assert.equal(beyond.isLastPage, true);
        assert.equal(requests.length, end, 'Terminal archive tried an unadvertised continuation');
      }
    } finally { await preference(true); }
  });
  await check('Concurrent lazy archive requests coalesce the native page and bounded metadata batch', async () => {
    const cold = freshSource();
    await cold.getSectionsForPage({ id: 'home' });
    const before = requests.length;
    const result = await Promise.all([cold.resolvePageSection({ id: 'home' }, 'genre:romance'), cold.resolvePageSection({ id: 'home' }, 'genre:romance')]);
    assert.deepEqual(ids(result[0].items), ids(result[1].items));
    assert.equal(requests.length - before, 2, 'Concurrent archive requests duplicated native reads');
  });
  await check('Distinct native canonical aliases retain separate details and chapter inventories', async () => {
    const aliases = ['catastrophic-necromancer', 'disastrous-necromancer'];
    const inventories = [];
    for (const id of aliases) {
      const cold = freshSource(), detail = await cold.getContent(id), list = await cold.getChapters(id);
      assert.equal(detail.webUrl, `${domain}/manga/${id}/`);
      assert(detail.additionalTitles.some((title) => /Catastrophic Necromancer|Disastrous Necromancer/.test(title)));
      inventories.push(Array.from(list, (chapter) => chapter.chapterId));
    }
    assert(inventories.every((list) => list.length));
    assert.notDeepEqual(inventories[0], inventories[1], 'Distinct source records were collapsed into one chapter inventory');
  });
  await check('Sequential native pages deduplicate real canonical overlap without losing later titles or terminal state', async () => {
    for (const route of [
      { listId: 'latest', first: `${domain}/`, selector: '.page-item-detail' },
      { listId: 'genre:action', first: `${domain}/manga-genre/action/`, selector: '.page-item-detail.manga' },
      { first: `${domain}/?s=&post_type=wp-manga&adult=0`, selector: '.c-tabs-item__content' }
    ]) for (const mode of ['partial', 'duplicate-only', 'excluded-only']) {
      const cold = freshSource(), original = cold.api.text.bind(cold.api), captured = new Map();
      let firstRows, reordered = false, secondURL, thirdURL;
      cold.api.text = async (...args) => {
        const value = await original(...args);
        if (args[1] === 'POST') return value;
        const $ = load(value), rows = $(route.selector);
        if (args[0] === route.first) {
          firstRows = rows.toArray().map((node) => $.html(node));
          assert(firstRows.length >= 2);
          if (reordered) rows.each((index, node) => $(node).replaceWith(firstRows[firstRows.length - 1 - index]));
          firstRows = $(route.selector).toArray().map((node) => $.html(node));
          secondURL = $('.wp-pagenavi a.nextpostslink').attr('href');
          assert(secondURL, 'The live overlap probe needs a native second page');
        } else if (args[0] === secondURL) {
          assert(firstRows.length >= rows.length);
          if (mode === 'excluded-only') rows.append('<span class="adult-warning"></span>');
          else rows.each((index, node) => { if (mode === 'duplicate-only' || index === 0) $(node).replaceWith(firstRows[index]); });
          thirdURL = $('.wp-pagenavi a.nextpostslink').attr('href');
          assert(thirdURL, 'The live overlap probe needs a native third page');
        } else if (args[0] === thirdURL) {
          // Bound this live-derived controlled chain at a real later page.
          // Only the continuation link is removed, never any later source card.
          $('.wp-pagenavi a.nextpostslink').remove();
        } else return value;
        const result = $.html(); captured.set(args[0], result); return result;
      };
      const results = [];
      for (let page = 1; page <= 3; page += 1) results.push(await cold.search({ page, ...(route.listId ? { listId: route.listId } : {}) }));
      const visiblePages = [], combined = [], seen = new Set();
      for (const url of [route.first, secondURL, thirdURL]) {
        const $ = load(captured.get(url)), raw = $(route.selector).toArray().map((node) => canonicalID($(node).find('.post-title a').attr('href')));
        const expected = raw.filter((id) => !seen.has(id) && cold.allowed(cold.metadata.get(`true:${id}`)?.value));
        for (const id of raw) seen.add(id);
        if (expected.length) visiblePages.push(expected);
      }
      assert.equal(visiblePages.length, mode === 'partial' ? 3 : 2, 'Controlled source chain did not contain the expected empty intermediate page');
      for (const [index, result] of results.entries()) {
        assert.deepEqual(ids(result.results), visiblePages[index] ?? [], `${route.listId ?? 'search'} ${mode} logical page ${index + 1} lost or repeated a canonical ID`);
        assert.equal(result.isLastPage, index >= visiblePages.length - 1);
        if (index < visiblePages.length) assert(result.results.length, 'An empty visible page would stop native Mana pagination prematurely');
      }
      // Model the pinned SDK: the app stops on isLastPage OR zero results.
      for (const result of results) {
        combined.push(...ids(result.results));
        if (result.isLastPage || !result.results.length) break;
      }
      assert.deepEqual(combined, visiblePages.flat(), 'App-style sequential pagination lost later fresh entries');
      assert.equal(new Set(combined).size, combined.length);
      const terminal = requests.length;
      const beyond = await cold.search({ page: 100, ...(route.listId ? { listId: route.listId } : {}) });
      assert.equal(beyond.results.length, 0); assert.equal(beyond.isLastPage, true);
      await assert.rejects(() => cold.search({ page: 101, ...(route.listId ? { listId: route.listId } : {}) }), /Invalid ManhwaNex page/);
      assert.equal(requests.length, terminal, 'Completed or out-of-bounds traversal made an outgoing request');
      reordered = true;
      if (cold.homeCache) cold.homeCache.at = 0;
      for (const entry of cold.listings.values()) entry.at = 0;
      const refreshed = await cold.search({ page: 1, ...(route.listId ? { listId: route.listId } : {}) });
      const $ = load(captured.get(route.first));
      assert.deepEqual(ids(refreshed.results), $(route.selector).toArray().map((node) => canonicalID($(node).find('.post-title a').attr('href'))).filter((id) => cold.allowed(cold.metadata.get(`true:${id}`)?.value)), 'Refresh retained old seen IDs or source order');
      assert(refreshed.results.length >= 2);
    }
  });
  await check('Pagination identity stays scoped to native query, category and current settings', async () => {
    const cold = freshSource(), original = cold.api.text.bind(cold.api), captured = new Map();
    cold.api.text = async (...args) => { const value = await original(...args); if (args[1] !== 'POST') captured.set(args[0], value); return value; };
    const first = await cold.search({ page: 1 }); await cold.search({ page: 2 });
    const query = await cold.search({ page: 1, query: 'Logging' });
    const reference = load(captured.get(`${domain}/?s=Logging&post_type=wp-manga&adult=0`));
    assert(query.results.length);
    assert.deepEqual(ids(query.results), reference('.c-tabs-item__content').toArray().map((node) => canonicalID(reference(node).find('.post-title a').attr('href'))));
    assert.deepEqual(ids((await cold.search({ page: 1 })).results), ids(first.results), 'Another query changed the first page seen set');
    await cold.search({ page: 2, listId: 'genre:action' });
    const fantasy = await cold.search({ page: 1, listId: 'genre:fantasy' }), native = load(captured.get(`${domain}/manga-genre/fantasy/`));
    assert.deepEqual(ids(fantasy.results), native('.page-item-detail.manga').toArray().map((node) => canonicalID(native(node).find('.post-title a').attr('href'))));
    try {
      await (await cold.getPreferenceMenu()).sections[0].children[0].didChange(false);
      const unrestricted = await cold.search({ page: 1, listId: 'genre:action' });
      assert(unrestricted.results.length);
      await (await cold.getPreferenceMenu()).sections[0].children[0].didChange(true);
      const reset = await cold.search({ page: 1, listId: 'genre:action' });
      assert.deepEqual(ids(reset.results), ids(unrestricted.results).filter((id) => cold.allowed(cold.metadata.get(`true:${id}`)?.value)), 'Setting change retained a previous pagination seen set');
    } finally { await preference(true); }
  });
  await check('Category continuation rejects foreign, switched, nonadvancing and wrong-context archives before following them', async () => {
    const root = `${domain}/manga-genre/action/`;
    for (const mutation of ['foreign', 'switch', 'repeat', 'skip', 'query', 'canonical', 'body', 'page-number']) {
      const cold = freshSource(), original = cold.api.text.bind(cold.api), visited = [];
      cold.api.text = async (...args) => {
        visited.push(args[0]); const value = await original(...args);
        if (args[0] !== root) return value;
        const $ = load(value), next = $('.wp-pagenavi a.nextpostslink');
        assert(next.length);
        if (mutation === 'foreign') next.attr('href', 'https://example.com/manga-genre/action/page/2/');
        if (mutation === 'switch') next.attr('href', `${domain}/manga-genre/fantasy/page/2/`);
        if (mutation === 'repeat') next.attr('href', root);
        if (mutation === 'skip') next.attr('href', `${root}page/3/`);
        if (mutation === 'query') next.attr('href', `${root}page/2/?adult=1`);
        if (mutation === 'canonical') $('link[rel="canonical"]').attr('href', `${domain}/manga-genre/fantasy/`);
        if (mutation === 'body') $('body').attr('class', 'tax-wp-manga-genre term-fantasy');
        if (mutation === 'page-number') $('.wp-pagenavi .current').text('2');
        return $.html();
      };
      await assert.rejects(() => cold.search({ page: 2, listId: 'genre:action' }), /category archive|continuation|different catalog page/);
      assert.deepEqual(visited, [`${domain}/`, root], 'An invalid continuation made an outgoing request');
    }
    for (const href of ['https://example.com/manga-genre/action/', `${domain}/manga-genre/action%2fadult/`, `${domain}/manga-genre/unknown/`]) {
      const cold = freshSource(), original = cold.api.text.bind(cold.api);
      cold.api.text = async (...args) => { const $ = load(await original(...args)); $('li.menu-item-object-wp-manga-genre > a').first().attr('href', href); return $.html(); };
      await assert.rejects(() => cold.getSectionsForPage({ id: 'home' }), /taxonomy|home category/);
    }
  });
  await check('Raw archive adult evidence cannot be overwritten by complete safe batch metadata', async () => {
    for (const probe of [
      { listId: 'genre:action', page: 1, marker: 'adult-marker' },
      { listId: 'genre:action', page: 1, marker: 'blocked-genre' },
      { listId: 'genre:action', page: 1, marker: 'adult-marker', cold: true },
      { listId: 'popular', page: 1, marker: 'adult-marker' },
      { listId: 'genre:action', page: 2, marker: 'adult-marker', overlap: true, failedBatch: true }
    ]) {
      const cold = freshSource(), original = cold.api.text.bind(cold.api), originalBatch = cold.api.metadata.bind(cold.api);
      const baseline = await cold.search({ page: 1, listId: probe.listId === 'popular' ? 'popular' : 'latest' });
      let baselineID = baseline.results[0].id, sourceTitle = baseline.results[0].title, overlapCard, firstArchiveIDs;
      if (probe.listId === 'genre:action') {
        const $ = load(await original(`${domain}/manga-genre/action/`)), homeIDs = new Set(ids(baseline.results)), laterIDs = new Set();
        firstArchiveIDs = new Set($('.page-item-detail.manga').toArray().map((node) => canonicalID($(node).find('.post-title a').attr('href'))));
        if (probe.overlap) {
          const next = load(await original(`${domain}/manga-genre/action/page/2/`));
          for (const node of next('.page-item-detail.manga').toArray()) laterIDs.add(canonicalID(next(node).find('.post-title a').attr('href')));
        }
        const node = $('.page-item-detail.manga').toArray().find((node) => {
          const id = canonicalID($(node).find('.post-title a').attr('href'));
          return homeIDs.has(id) && !laterIDs.has(id);
        });
        assert(node, 'Live Action/home rows do not supply a shared canonical probe absent from the overlap page');
        const anchor = $(node).find('.post-title a');
        baselineID = canonicalID(anchor.attr('href'));
        sourceTitle = (anchor.attr('title') || anchor.text()).replace(/\s+/g, ' ').trim();
        if (probe.overlap) { overlapCard = $.html(node); await cold.search({ page: 1, listId: 'genre:action' }); }
      }
      const words = [...new Set(sourceTitle.match(/[\p{L}\p{N}]+/gu) ?? [])].filter((word) => word.length >= 4).sort((a, b) => b.length - a.length);
      const candidates = [...new Set([sourceTitle, ...words])].slice(0, 4);
      let verifiedQuery, verifiedQueryURL, postWarningSearch;
      for (const candidate of candidates) {
        const url = `${domain}/?${new URLSearchParams({ s: candidate, post_type: 'wp-manga', adult: '0' })}`;
        const $ = load(await original(url));
        if ($('.c-tabs-item__content').toArray().some((node) => canonicalID($(node).find('.post-title a').attr('href')) === baselineID)) {
          verifiedQuery = candidate; verifiedQueryURL = url; break;
        }
      }
      assert(verifiedQuery, 'Bounded source-title queries did not yield the exact selected native canonical ID');
      const cachedDetail = await cold.getContent(baselineID);
      const cachedChapters = await cold.getChapters(baselineID);
      const cachedReader = await cold.getChapterData(baselineID, cachedChapters.at(-1).chapterId);
      const originalMetadata = JSON.parse(JSON.stringify(cold.metadata.get(`true:${baselineID}`).value));
      assert.equal(originalMetadata.explicit, false, 'Conflict setup did not warm real nonadult metadata');
      let target, missingID, targetBatchMetadata, releaseReader, readerReached, releaseBatch, batchReached, holdReader = true, holdBatch = true;
      const readerGate = new Promise((resolve) => { releaseReader = resolve; });
      const readerReady = new Promise((resolve) => { readerReached = resolve; });
      const batchGate = new Promise((resolve) => { releaseBatch = resolve; });
      const batchReady = new Promise((resolve) => { batchReached = resolve; });
      const readerURL = `${domain}/manga/${baselineID}/${cachedChapters.at(-1).chapterId}/`;
      const warningURL = probe.listId === 'popular' ? `${domain}/` : `${domain}/manga-genre/action/${probe.overlap ? 'page/2/' : ''}`;
      cold.api.text = async (...args) => {
        const value = await original(...args);
        if (args[0] === verifiedQueryURL) postWarningSearch = value;
        if (args[0] === readerURL && holdReader) { readerReached(); await readerGate; return value; }
        if (args[0] !== warningURL) return value;
        const $ = load(value), selector = probe.listId === 'popular' ? '.widget-manga-popular-slider .slider__item' : '.page-item-detail.manga';
        if (probe.overlap) {
          assert(!$(selector).toArray().some((node) => canonicalID($(node).find('.post-title a').attr('href')) === baselineID), 'Selected overlap probe is no longer absent from the actual native second page');
          $(selector).first().replaceWith(overlapCard);
        }
        const cards = $(selector), card = cards.filter((_, node) => canonicalID($(node).find('.post-title a').attr('href')) === baselineID);
        assert.equal(card.length, 1, 'Exact selected native card is not uniquely present in the requested section');
        target = canonicalID(card.find('.post-title a').attr('href'));
        const other = cards.toArray().find((node) => {
          const id = canonicalID($(node).find('.post-title a').attr('href'));
          return id !== target && (!probe.overlap || !firstArchiveIDs.has(id));
        });
        assert(other, 'Native page has no separate fresh metadata ID to hold');
        missingID = canonicalID($(other).find('.post-title a').attr('href'));
        assert.notEqual(missingID, target);
        cold.metadata.delete(`true:${missingID}`);
        if (probe.marker === 'adult-marker') card.attr('data-adult', '1');
        else card.append(`<div class="mg_genres"><div class="summary-content"><a href="${domain}/manga-genre/mature/">Mature</a></div></div>`);
        return $.html();
      };
      cold.api.metadata = async (...args) => {
        const values = await originalBatch(...args);
        if (holdBatch) {
          assert(args[0].includes(missingID), 'Conflict setup did not request its genuinely missing native ID');
          assert.equal(args[0].includes(baselineID), Boolean(probe.cold), 'Conflict target cache state did not match the held native batch');
          if (probe.cold) {
            targetBatchMetadata = JSON.parse(JSON.stringify(values.find((item) => item.id === baselineID)));
            assert.equal(targetBatchMetadata.explicit, false);
          }
          batchReached(); await batchGate; holdBatch = false;
          if (probe.failedBatch) throw new Error('Controlled native metadata batch failure');
        }
        return values;
      };
      const pendingReader = cold.getChapterData(baselineID, cachedChapters.at(-1).chapterId).then((result) => ({ result }), (error) => ({ error }));
      await Promise.race([readerReady, pendingReader.then(() => { throw new Error('Reader did not reach the intended response gate'); })]);
      if (probe.cold) cold.metadata.delete(`true:${baselineID}`);
      if (probe.listId === 'popular') cold.homeCache = undefined;
      const discovery = cold.search({ page: probe.page, listId: probe.listId }).then((result) => ({ result }), (error) => ({ error }));
      try {
        await Promise.race([batchReady, discovery.then((outcome) => { throw outcome.error ?? new Error('Discovery did not reach the intended native metadata gate'); })]);
        assert.equal(cold.metadata.get(`true:${baselineID}`).value.explicit, true, 'Fetched raw warning was not recorded before an unrelated metadata await');
        if (probe.cold) await assert.rejects(() => cold.getContent(baselineID), /excluded|classification/);
        holdReader = false; releaseReader();
        const outcome = await pendingReader;
        assert(outcome.error, 'A reader completed while its observed warning was waiting on unrelated metadata');
        assert.match(outcome.error.message, /excluded|classification/);
      } finally { holdReader = false; releaseReader(); releaseBatch(); }
      const outcome = await discovery;
      if (probe.failedBatch) assert.match(outcome.error?.message ?? '', /Controlled native metadata batch failure/);
      else {
        if (outcome.error) throw outcome.error;
        assert(!ids(outcome.result.results).includes(target), 'Raw contrary evidence was erased by nonadult bulk membership');
      }
      const retained = cold.metadata.get(`true:${target}`).value;
      assert.equal(target, baselineID, 'Conflict mutation did not target the warmed native card');
      assert.equal(retained.explicit, true, 'Observed adult evidence was not retained in the existing metadata cache');
      if (probe.listId === 'genre:action') assert(retained.genres.some((genre) => genre.id === 'action'), 'Bulk native archive genre membership was lost');
      assert.deepEqual(JSON.parse(JSON.stringify(retained)), { ...(probe.cold ? targetBatchMetadata : originalMetadata), explicit: true, contentRating: 3 }, 'Observed warning discarded complete cached or newly classified metadata');
      const observed = cold.metadata.get(`true:${target}`); observed.at -= 1000;
      const observedAt = observed.at;
      await cold.search({ page: probe.page, listId: probe.listId });
      assert.equal(cold.metadata.get(`true:${target}`).at, observedAt, 'A reused archive row extended the warning lifetime');
      const safeSearch = await cold.search({ page: 1, query: verifiedQuery });
      const nativeSearch = load(postWarningSearch);
      assert(nativeSearch('.c-tabs-item__content').toArray().some((node) => canonicalID(nativeSearch(node).find('.post-title a').attr('href')) === target), 'Post-warning native search no longer contains the selected canonical probe');
      assert(!ids(safeSearch.results).includes(target), 'A later safe search row erased the observed adult warning');
      assert.equal(cold.metadata.get(`true:${target}`).at, observedAt, 'A contrary safe row extended the warning lifetime');
      for (const operation of [() => cold.getContent(target), () => cold.getChapters(target), () => cold.getChapterData(target, cachedChapters.at(-1).chapterId), () => cold.willRequestImage(cachedDetail.cover), () => cold.willRequestImage(cachedReader.pages[0].url)]) {
        await assert.rejects(operation, /excluded|classification/);
      }
      assert.equal(cold.metadata.get(`true:${target}`).at, observedAt, 'Reusing the warning extended its lifetime');
      cold.metadata.get(`true:${target}`).at = 0;
      assert(ids((await cold.search({ page: 1, query: verifiedQuery })).results).includes(target), 'Expired warning did not reset under current verified native metadata');
      try {
        await (await cold.getPreferenceMenu()).sections[0].children[0].didChange(false);
        const unfiltered = await cold.search({ page: probe.page, listId: probe.listId });
        if (probe.overlap) assert(!ids(unfiltered.results).includes(target), 'A repeated canonical alias reappeared under opt-out');
        else assert.equal(unfiltered.results.find((item) => item.id === target)?.contentRating, 3, 'Opt-out lost the pinned SDK EXPLICIT raw-card badge');
        assert.equal((await cold.getContent(target)).contentRating, 3, 'Opt-out details discarded the observed adult classification');
      } finally { await preference(true); }
    }
  });
  await check('All eight native genre filters and OR/AND semantics are honored', async () => {
    const genres = form.find((field) => field.id === 'genres').options;
    for (const genre of genres) {
      const result = await source.search({ page: 1, filters: { genres: [genre] } });
      for (const item of result.results) assert(source.metadata.get(`true:${item.id}`).value.genres.some((value) => value.id === genre.id));
    }
    for (const condition of ['or', 'and']) {
      const selected = [genres[0], genres[1]], result = await source.search({ page: 1, filters: { genres: selected, condition: { id: condition } } });
      assert(result.results.length);
      for (const item of result.results) {
        const tags = source.metadata.get(`true:${item.id}`).value.genres.map((tag) => tag.id);
        assert(condition === 'and' ? selected.every((genre) => tags.includes(genre.id)) : selected.some((genre) => tags.includes(genre.id)));
      }
    }
  });
  await check('Native author and artist text filters work while source redirects fail visibly', async () => {
    const author = await source.search({ page: 1, filters: { author: 'Xingjiu' } });
    assert.equal(author.results.length, 1);
    const artist = await source.search({ page: 1, filters: { artist: '3rd Studio' } });
    assert.equal(artist.results.length, 1);
    assert.equal(artist.results[0].id, 'global-class-change-i-am-the-invincible-shadow-monarch');
    await assert.rejects(() => source.search({ page: 1, filters: { author: '3rd Studio' } }), /search page is incomplete/);
  });
  await check('Every source status and release filter uses native parameters', async () => {
    for (const status of form.find((field) => field.id === 'status').options) {
      const result = await source.search({ page: 1, filters: { status: [status] } });
      assert.equal(typeof result.isLastPage, 'boolean');
      assert(requests.some((request) => new URL(request.url).searchParams.getAll('status[]').includes(status.id)));
    }
    const metadata = source.metadata.get(`true:${catalog.results[0].id}`).value;
    assert(metadata.release);
    const result = await source.search({ page: 1, filters: { release: metadata.release } });
    assert(result.results.some((item) => item.id === metadata.id));
  });
  await check('Source titles, punctuation, aliases, canonical metadata and deep links survive cold details', async () => {
    const item = catalog.results[0], result = await source.search({ page: 1, query: item.title });
    assert(result.results.some((match) => match.id === item.id && match.title === item.title));
    const cold = freshSource();
    const original = cold.api.text.bind(cold.api);
    cold.api.text = async (...args) => {
      const value = await original(...args);
      detailResponses.set(JSON.stringify(args), value);
      return value;
    };
    let large;
    try {
      content = await cold.getContent(sample);
      large = await cold.getContent('global-class-change-i-am-the-invincible-shadow-monarch');
    } finally { cold.api.text = original; }
    assert.equal(content.webUrl, `${domain}/manga/${sample}/`);
    assert(content.title.includes('10,000') && content.summary?.trim());
    assert(content.additionalTitles.some((title) => title.includes('Logging 10,000 Years into the Future')));
    assert(content.tags.length && !content.tags.some((tag) => blocked.has(tag.id)));
    assert(content.additionalInfo.some((section) => section.id === 'publication'));
    const reference = await html(content.webUrl);
    const tagSections = Array.from(content.additionalInfo).filter((section) => /^source-tags(?:-\d+)?$/.test(section.id));
    assert(tagSections.every((section) => section.items.length <= 10));
    assert.deepEqual(tagSections.flatMap((section) => Array.from(section.items, (tag) => tag.title)),
      reference('.tab-summary .tags-content a').toArray().map((node) => reference(node).text().trim()));
    assert.equal((await cold.handleURL(content.webUrl)).content.id, sample);
    await imageBytes(cold, content.cover);
    const largeReference = await html(large.webUrl);
    assert.equal(large.cover, largeReference('meta[property="og:image"]').attr('content'));
    assert.deepEqual(imageDimensions(await imageBytes(cold, large.cover)), [1087, 1447]);
    const largeTags = Array.from(large.additionalInfo).filter((section) => /^source-tags(?:-\d+)?$/.test(section.id));
    assert(largeTags.every((section) => section.items.length <= 10));
    assert(largeTags.flatMap((section) => Array.from(section.items)).some((tag) => /%[a-f0-9]{2}/i.test(tag.id)), 'Encoded Unicode source tag IDs were not retained');
  });
  await check('Source-issued images stay coherent across stale readers, cached writers, concurrent instances and store failures', async () => {
    assert(nativeStore && detailResponses.size, 'Missing native store or live detail responses for image-registry checks');
    const globalID = 'global-class-change-i-am-the-invincible-shadow-monarch';
    for (const id of [sample, globalID]) assert(detailResponses.has(JSON.stringify([`${domain}/manga/${id}/`])), 'Missing captured native detail response');
    const key = 'ManhwaNex.issuedImages', saved = await nativeStore.get(key), before = requests.length;
    const replay = () => {
      const target = freshSource();
      target.api.text = async (...args) => {
        const value = detailResponses.get(JSON.stringify(args));
        assert.equal(typeof value, 'string', 'Image-registry check attempted an uncaptured provider request');
        return value;
      };
      return target;
    };
    const originalGet = nativeStore.get, originalSet = nativeStore.set;
    try {
      await nativeStore.set(key, []);
      const writer = replay(), staleReader = replay();
      await writer.getContent(globalID);
      await staleReader.getContent(globalID);
      const issued = await replay().getContent(sample);
      assert.equal((await replay().willRequestImage(issued.cover)).url, issued.cover);
      assert.equal((await staleReader.willRequestImage(issued.cover)).url, issued.cover, 'A stale reader lost another instance\'s source-issued image');
      await writer.getContent(globalID);
      assert.equal((await replay().willRequestImage(issued.cover)).url, issued.cover, 'A stale cached writer removed another instance\'s image');

      await nativeStore.set(key, []);
      await assert.rejects(() => staleReader.willRequestImage(issued.cover), /image was not issued by this source/, 'A stale reader authorized an evicted image');
      await nativeStore.set(key, [[issued.cover, '../bad'], [issued.cover], [issued.cover, null], ['https://example.com/not-issued.png', sample]]);
      await assert.rejects(() => staleReader.willRequestImage(issued.cover), /image was not issued by this source/, 'Malformed persisted entries authorized an image');
      await nativeStore.set(key, [[issued.cover, sample]]);
      assert.equal((await replay().willRequestImage(issued.cover)).url, issued.cover, 'Valid legacy persisted entries stopped working');

      await nativeStore.set(key, []);
      const pair = await Promise.all([replay().getContent(sample), replay().getContent(globalID)]);
      for (const item of pair) assert.equal((await replay().willRequestImage(item.cover)).url, item.cover, 'Concurrent native writers lost an image');

      let failWrite = true;
      nativeStore.set = async (name, value) => {
        if (name === key && failWrite) { failWrite = false; throw new Error('Intentional image-registry write failure'); }
        return originalSet.call(nativeStore, name, value);
      };
      await assert.rejects(() => replay().getContent(sample), /Intentional image-registry write failure/);
      nativeStore.set = originalSet;
      await replay().getContent(globalID);
      assert.equal((await replay().willRequestImage(pair[0].cover)).url, pair[0].cover, 'A failed store write poisoned later image operations');

      let failRead = true;
      nativeStore.get = async (name) => {
        if (name === key && failRead) { failRead = false; throw new Error('Intentional image-registry read failure'); }
        return originalGet.call(nativeStore, name);
      };
      await assert.rejects(() => replay().willRequestImage(pair[0].cover), /Intentional image-registry read failure/);
      nativeStore.get = originalGet;
      assert.equal((await replay().willRequestImage(pair[0].cover)).url, pair[0].cover, 'A failed store read poisoned later image operations');
      assert.equal(requests.length, before, 'Response-derived image-registry checks added provider requests');
    } finally {
      nativeStore.get = originalGet; nativeStore.set = originalSet;
      if (saved === null) await nativeStore.remove(key); else await nativeStore.set(key, saved);
    }
  });
  await check('Negative searches terminate honestly without repeating or inventing pages', async () => {
    const result = await source.search({ page: 1, query: 'zzzxqv-manhwanex-no-title-843021' });
    assert.equal(result.results.length, 0); assert.equal(result.isLastPage, true);
    const terminal = await source.search({ page: 100 });
    assert.equal(terminal.results.length, 0); assert.equal(terminal.isLastPage, true);
  });
  await check('All currently available chapters match the complete native AJAX list, including decimal identity', async () => {
    chapters = await source.getChapters(sample);
    const $ = await html(`${domain}/manga/${sample}/ajax/chapters/?t=1`, { method: 'POST' });
    const expected = $('.wp-manga-chapter > a').toArray().map((node) => $(node).attr('href').split('/').filter(Boolean).at(-1)).reverse();
    assert.deepEqual(Array.from(chapters, (chapter) => chapter.chapterId), expected);
    assert.equal(new Set(expected).size, expected.length);
    assert(chapters.some((chapter) => chapter.chapterId === 'chapter-339-5' && chapter.number === 339.5));
    for (const [index, chapter] of chapters.entries()) { assert.equal(chapter.index, index); assert(Number.isFinite(new Date(chapter.date).getTime())); assert.equal(chapter.webUrl, `${domain}/manga/${sample}/${chapter.chapterId}/`); }
  });
  await check('Native chapter pipeline preserves reported container and explicit-label volumes', async () => {
    const instrumented = freshSource(), original = instrumented.api.text.bind(instrumented.api);
    let labelID, containerID;
    instrumented.api.text = async (...args) => {
      const value = await original(...args);
      if (!args[0].includes('/ajax/chapters/')) return value;
      const $ = load(value), rows = $('.wp-manga-chapter');
      assert(rows.length >= 2);
      labelID = rows.eq(0).children('a').attr('href').split('/').filter(Boolean).at(-1);
      containerID = rows.eq(1).children('a').attr('href').split('/').filter(Boolean).at(-1);
      rows.eq(0).children('a').prepend('Volume 2 ');
      rows.eq(1).wrap('<div class="wp-manga-volume"></div>');
      rows.eq(1).parent().prepend('<span class="volume-name">Volume 3</span>');
      return $.html();
    };
    const result = await instrumented.getChapters(sample);
    assert.equal(result.find((chapter) => chapter.chapterId === labelID).volume, 2);
    assert.equal(result.find((chapter) => chapter.chapterId === containerID).volume, 3);
    assert.equal(result.find((chapter) => chapter.chapterId === labelID).number, chapters.find((chapter) => chapter.chapterId === labelID).number);
    // Current live rows have no source volume; these two cases mutate the real
    // response in memory to verify the complete native API-to-parser contract.
  });
  for (const selected of ['oldest', 'newest', 'decimal']) await check(`Native ${selected} reader preserves image order and actual first/last bytes`, async () => {
    const chapter = selected === 'oldest' ? chapters[0] : selected === 'newest' ? chapters.at(-1) : chapters.find((item) => item.number === 339.5);
    const cold = freshSource();
    const result = await cold.getChapterData(sample, chapter.chapterId, JSON.parse(JSON.stringify(chapter)));
    const pages = Array.from(result.pages, (page) => page.url);
    assert(pages.length && new Set(pages).size === pages.length);
    const $ = await html(chapter.webUrl);
    const expected = $('.reading-content img.wp-manga-chapter-img').toArray().map((node) => ($(node).attr('data-src') || $(node).attr('src')).trim());
    assert.deepEqual(pages, expected);
    await imageBytes(cold, pages[0]);
    if (pages.length > 1) await imageBytes(cold, pages.at(-1));
    console.log(`READER ${chapter.chapterId}: ${pages.length} pages`);
  });
  await check('A second live title completes details, chapters, reader and both image endpoints', async () => {
    const id = home.popular.items[0].id, cold = freshSource();
    const detail = await cold.getContent(id), list = await cold.getChapters(id);
    assert(detail.title && list.length);
    const result = await cold.getChapterData(id, list.at(-1).chapterId, list.at(-1));
    await imageBytes(cold, result.pages[0].url);
    if (result.pages.length > 1) await imageBytes(cold, result.pages.at(-1).url);
  });
  await check('Explicit opt-out persists and per-search adult filtering cannot widen global exclusion', async () => {
    await preference(false);
    assert.equal((await (async () => (await freshSource().getPreferenceMenu()).sections[0].children[0])()).value, false);
    const all = await source.search({ page: 1 }); assert(all.results.length);
    const adult = await source.search({ page: 1, filters: { adult: { id: '1' } } });
    assert.equal(adult.results.length, 0); assert.equal(adult.isLastPage, true);
    const disabledForm = (await source.getSearchForm()).sections.flatMap((section) => section.children ?? []);
    assert.equal(disabledForm.find((field) => field.id === 'adult').options.length, 3);
    await preference(true);
    const narrowed = await source.search({ page: 1, filters: { adult: { id: '1' } } });
    assert.equal(narrowed.results.length, 0); assert.equal(narrowed.isLastPage, true);
    const knownImage = home.latest.items[0].cover;
    const persisted = freshSource(); await persisted.willRequestImage(knownImage);
    const resumed = freshSource(), before = requests.length;
    await Promise.all(Array.from({ length: 12 }, () => resumed.willRequestImage(content.cover)));
    assert.equal(requests.length - before, 2, 'Concurrent persisted image callbacks reintroduced per-image metadata N+1');
  });
  await check('Unknown and explicit classifications fail closed without treating BL/demographics as adult labels', async () => {
    await source.search({ page: 1 });
    const raw = { ...source.metadata.values().next().value.value };
    assert.equal(source.allowed({ ...raw, classified: false }), false);
    assert.equal(source.allowed({ ...raw, classified: true, explicit: true }), false);
    assert.equal(source.allowed({ ...raw, classified: true, explicit: false, genres: [{ id: 'boys-love', title: 'Boys Love' }] }), true);
    assert.equal((await source.highlights([{ ...raw, id: 'unverified-live-probe', classified: false }], true)).length, 0);
    for (const mutation of ['foreign', 'broken', 'missing-label', 'encoded-separator']) {
      const gated = freshSource(), original = gated.api.text.bind(gated.api);
      gated.api.text = async (...args) => {
        const value = await original(...args), $ = load(value);
        const bulk = $('.mg_genres .summary-content a').first();
        const target = bulk.length ? bulk : $('.tab-summary .genres-content a').first();
        if (!target.length) return value;
        if (mutation === 'foreign') target.attr('href', 'https://example.com/manga-genre/action/');
        if (mutation === 'broken') target.attr('href', `${domain}/not-a-genre/action/`);
        if (mutation === 'missing-label') target.text('');
        if (mutation === 'encoded-separator') target.attr('href', `${domain}/manga-genre/action%2fadult/`);
        return $.html();
      };
      for (const operation of [() => gated.getContent(sample), () => gated.getChapters(sample), () => gated.getChapterData(sample, 'chapter-360'), () => gated.willRequestImage(content.cover)]) {
        await assert.rejects(operation, /taxonomy/i);
      }
      await assert.rejects(() => gated.search({ page: 1 }), /taxonomy/i);
    }
    for (const mode of ['unknown', 'explicit']) {
      const gated = freshSource(), original = gated.api.metadata.bind(gated.api);
      gated.api.metadata = async (...args) => (await original(...args)).map((item) => ({ ...item, classified: mode !== 'unknown', explicit: mode === 'explicit' }));
      await assert.rejects(() => gated.getContent(sample), /excluded|classification/i);
      await assert.rejects(() => gated.getChapters(sample), /excluded|classification/i);
      await assert.rejects(() => gated.getChapterData(sample, 'chapter-360'), /excluded|classification/i);
      await assert.rejects(() => gated.willRequestImage(content.cover), /excluded|classification/i);
    }
  });
  await check('IDs, image origins and exact read-only POST routes reject unsafe inputs', async () => {
    const before = requests.length;
    for (const id of ['../bad', 'bad%2fother', 'bad\\other', 'bad?x', 'bad#x']) await assert.rejects(() => source.getChapters(id));
    for (const url of ['https://example.com/a.png', `${domain}/wp-content/uploads/%2fother.png`, 'https://cdn.manhwanex.com/manga_test/a.png?token=bad']) await assert.rejects(() => source.willRequestImage(url));
    assert.equal(requests.length, before, 'Rejected input made an outgoing request');
    const allowed = { url: `${domain}/manga/${sample}/ajax/chapters/?t=1`, method: 'POST' };
    assert.doesNotThrow(() => assertReadOnlyManhwaNexPost(allowed));
    for (const url of [`${domain}/wp-admin/admin-ajax.php?action=delete`, `${domain}/manga/${sample}/ajax/chapters/?t=1&t=2`]) assert.throws(() => assertReadOnlyManhwaNexPost({ ...allowed, url }));
    const body = new URLSearchParams({ action: 'madara_load_more', page: '-1', template: 'madara-core/content/content-search',
      'vars[post_type]': 'wp-manga', 'vars[template]': 'search', 'vars[paged]': '0', 'vars[s]': '',
      'vars[posts_per_page]': '1', 'vars[post_name__in][0]': sample }).toString();
    const metadata = { url: `${domain}/wp-admin/admin-ajax.php`, method: 'POST', body };
    assert.doesNotThrow(() => assertReadOnlyManhwaNexPost(metadata));
    let outgoing = 0;
    const runtime = createManaRuntime({ fetchImpl: async () => { outgoing += 1; throw new Error('Unexpected outgoing request'); }, logger: () => {} });
    const client = new runtime.NetworkClient();
    for (const invalid of [
      { ...metadata, body: `${body}&toString=bad` }, { ...metadata, body: `${body}&__proto__=bad` },
      { ...metadata, body: `${body}&action=madara_load_more` }, { ...metadata, body: body.replace('madara_load_more', 'delete') },
      { ...metadata, body: body.replace('posts_per_page%5D=1', 'posts_per_page%5D=65') },
      { ...metadata, url: `${domain}/wp-admin/delete.php` },
      { ...allowed, params: { t: 2 } }
    ]) await assert.rejects(() => client.request(invalid));
    assert.equal(outgoing, 0, 'Rejected POST made an outgoing request');

  });
  await check('Preference changes invalidate in-flight discovery and cannot repopulate stale caches', async () => {
    const cold = freshSource(), original = cold.api.text.bind(cold.api);
    let release; const gate = new Promise((resolve) => { release = resolve; });
    cold.api.text = async (...args) => { const result = await original(...args); await gate; return result; };
    const pending = cold.search({ page: 1 });
    await preference(false); await (await cold.getPreferenceMenu()).sections[0].children[0].didChange(false);
    release();
    await assert.rejects(() => pending, /settings changed/i);
    assert.equal(cold.listings.size, 0);
    await preference(true);
  });
}
