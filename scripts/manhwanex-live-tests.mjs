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
function webpDimensions(bytes) {
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
  const kind = bytes.subarray(12, 16).toString();
  if (kind === 'VP8X') return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  if (kind === 'VP8L') { const n = bytes.readUInt32LE(21); return [(n & 0x3fff) + 1, ((n >>> 14) & 0x3fff) + 1]; }
  assert.equal(kind, 'VP8 '); assert.equal(bytes.subarray(23, 26).toString('hex'), '9d012a');
  return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
}

export async function testManhwaNex({ source, check, requests, freshSource }) {
  const preference = async (value) => {
    const field = (await source.getPreferenceMenu()).sections.flatMap((section) => section.children ?? []).find((item) => item.id === 'excludeNSFW');
    assert(field, 'Missing persistent NSFW setting');
    if (value !== undefined) await field.didChange(value);
    return field;
  };
  let sections, home, catalog, content, chapters, form;
  const sample = 'logging-10000-years-into-the-future';
  await check('Default-safe native discovery uses two cold requests and zero warm requests', async () => {
    assert.equal((await preference()).value, true);
    const before = requests.length;
    sections = await source.getSectionsForPage({ id: 'home' });
    assert.deepEqual(Array.from(sections, (section) => section.title), ['Popular Series', 'Latest Updates']);
    home = {};
    for (const section of sections) home[section.id] = await source.resolvePageSection({ id: 'home' }, section.id);
    assert.equal(requests.length - before, 2, 'Cold discovery reintroduced metadata N+1');
    assert(home.popular.items.length && home.latest.items.length);
    for (const section of sections) await source.resolvePageSection({ id: 'home' }, section.id);
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
    assert.deepEqual(ids(next.results), reference('.page-item-detail').toArray().map((node) => canonicalID(reference(node).find('.post-title a').attr('href'))));
    assert(!next.results.some((item) => home.latest.items.some((prior) => prior.id === item.id)));
  });
  await check('Largest source-advertised covers have real intrinsic image dimensions', async () => {
    const popular = home.popular.items[0], latest = home.latest.items.find((item) => item.id === popular.id);
    assert(latest);
    assert.deepEqual(webpDimensions(await imageBytes(source, popular.cover)), [193, 278]);
    assert.deepEqual(webpDimensions(await imageBytes(source, latest.cover)), [350, 476]);
  });
  await check('Native safe search returns exact source page and next-page identities', async () => {
    catalog = await source.search({ page: 1 });
    assert(catalog.results.length && !catalog.isLastPage);
    const $ = await html(`${domain}/?s=&post_type=wp-manga&adult=0`);
    assert.deepEqual(ids(catalog.results), $('.c-tabs-item__content').toArray().map((node) => canonicalID($(node).find('.post-title a').attr('href'))));
    const next = await source.search({ page: 2 });
    const reference = await html($('.wp-pagenavi a.nextpostslink').attr('href'));
    assert.deepEqual(ids(next.results), reference('.c-tabs-item__content').toArray().map((node) => canonicalID(reference(node).find('.post-title a').attr('href'))));
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
    content = await cold.getContent(sample);
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
    const large = await cold.getContent('global-class-change-i-am-the-invincible-shadow-monarch');
    const largeReference = await html(large.webUrl);
    assert.equal(large.cover, largeReference('meta[property="og:image"]').attr('content'));
    assert.deepEqual(webpDimensions(await imageBytes(cold, large.cover)), [1087, 1447]);
    const largeTags = Array.from(large.additionalInfo).filter((section) => /^source-tags(?:-\d+)?$/.test(section.id));
    assert(largeTags.every((section) => section.items.length <= 10));
    assert(largeTags.flatMap((section) => Array.from(section.items)).some((tag) => /%[a-f0-9]{2}/i.test(tag.id)), 'Encoded Unicode source tag IDs were not retained');
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
