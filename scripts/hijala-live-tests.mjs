import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { coverDimensions } from './mangasushi-live-tests.mjs';

// All source behavior below runs through the real built native Mana bundle.
// Negative cases mutate a fresh live response in memory, never saved fixtures.
export async function testHijala({ source, check, highlights, searchResult, image, requests, freshSource, referenceFetch = fetch }) {
  const domain = 'https://en-hijala.com', api = 'https://api.en-hijala.com';
  const raw = async (url) => { const response = await referenceFetch(url, { signal: AbortSignal.timeout(30_000) }); assert(response.ok, `Reference HTTP ${response.status}`); return response.text(); };
  const field = async (id, target = source) => (await target.getPreferenceMenu()).sections.flatMap((section) => section.children ?? []).find((item) => item.id === id);
  const setting = async (id, value, target = source) => { const entry = await field(id, target); assert(entry?.didChange, `Missing preference ${id}`); await entry.didChange(value); };
  const ids = (items) => Array.from(items, (item) => item.id);
  const transformed = (change) => { const target = freshSource(), original = target.api.text.bind(target.api); target.api.text = async (url) => change(await original(url), url); return target; };
  const replaceRequired = (text, from, to) => { assert(text.includes(from), `Live evidence changed: ${from}`); return text.replace(from, to); };
  let form, catalog, content, full, chapters, reader, explicit, originalTitles, largeTitle;

  await check('Native metadata and persistent defaults are honest about genre-based safety', async () => {
    assert.equal(source.info.version, '0.0.1-alpha.1'); assert.equal(source.info.rating, 1);
    assert.equal((await field('excludeNSFW')).value, true); assert.equal((await field('hidePaid')).value, true);
    const footer = (await source.getPreferenceMenu()).sections[0].footer;
    assert.match(footer, /Missing or invalid genres are hidden/); assert.match(footer, /not a four-category/);
  });
  await check('Search form exposes every live genre, eight statuses, five types and site filters', async () => {
    form = await source.getSearchForm(); const fields = form.sections.flatMap((section) => section.children ?? []);
    for (const id of ['genres', 'statuses', 'types', 'direction', 'minChapters', 'maxChapters', 'createdAfter', 'createdBefore']) assert(fields.some((item) => item.id === id), id);
    const taxonomy = fields.find((item) => item.id === 'genres').options;
    const archive = await raw(`${domain}/series`), serialized = archive.match(/genres:\$R\[\d+\]=\[([\s\S]*?)\],/);
    assert(serialized, 'Current serialized taxonomy not found');
    const expected = [...serialized[1].matchAll(/id:(\d+),name:("(?:\\.|[^"\\])*")/g)].map((match) => ({ id: match[1], title: JSON.parse(match[2]).trim() }));
    assert(expected.length); assert.deepEqual(Array.from(taxonomy, (item) => ({ id: item.id, title: item.title })), expected);
    console.log(`LIVE taxonomy ${taxonomy.length} genres`);
    assert.equal(new Set(ids(taxonomy)).size, taxonomy.length);
    assert.equal(fields.find((item) => item.id === 'statuses').options.length, 8);
    assert.equal(fields.find((item) => item.id === 'types').options.length, 5);
    assert.deepEqual(ids(await source.getSortOptions()), ['latest', 'popular', 'newest', 'oldest', 'chapters', 'title']);
  });
  await check('Catalog is bulk-classified with no per-title detail requests', async () => {
    const start = requests.length; catalog = await source.search({ page: 1 }); searchResult(catalog);
    assert(catalog.results.every((item) => item.contentRating === 0));
    assert(!requests.slice(start).some((item) => new URL(item.url).pathname.startsWith('/series/')));
    assert(requests.some((item) => new URL(item.url).searchParams.get('excludedGenreIds')?.split(',').includes('27')));
  });
  await check('Native page2 advances, last page ends, and repeated requests are stable', async () => {
    const next = await source.search({ page: 2 }); searchResult(next);
    assert(next.results.some((item) => !ids(catalog.results).includes(item.id)));
    assert.deepEqual(ids((await source.search({ page: 2 })).results), ids(next.results));
    let terminal = false;
    for (let page = 3; page <= 10; page++) { const result = await source.search({ page }); if (result.isLastPage) { terminal = true; break; } }
    assert(terminal, 'Live catalog never terminated');
  });
  await check('Title search and true empty search use source-published titles', async () => {
    const found = await source.search({ page: 1, query: catalog.results[0].title }); searchResult(found);
    assert(ids(found.results).includes(catalog.results[0].id));
    const empty = await source.search({ page: 1, query: 'zzzxqv-hijala-no-title-843021' }); assert.equal(empty.results.length, 0); assert.equal(empty.isLastPage, true);
  });
  await check('Every six native site sort orders returns usable live data', async () => {
    for (const sort of await source.getSortOptions()) searchResult(await source.search({ page: 1, sort: { id: sort.id } }));
  });
  await check('Native submitted filters are exactly encoded and inclusion/exclusion works', async () => {
    const fields = form.sections.flatMap((section) => section.children ?? []), genres = fields.find((item) => item.id === 'genres').options;
    const action = genres.find((item) => item.id === '1'), drama = genres.find((item) => item.id === '4');
    const request = { page: 1, sort: { id: 'chapters', ascending: true }, filters: { genres: { included: [action], excluded: [drama] }, statuses: [{ id: 'ONGOING', title: 'Ongoing' }], types: [{ id: 'MANHWA', title: 'Manhwa' }], direction: { id: 'desc', title: 'Descending' }, minChapters: '1', maxChapters: '1000', createdAfter: '2020-01-01', createdBefore: '2027-01-01' } };
    const result = await source.search(request); searchResult(result);
    const url = new URL(requests.at(-1).url);
    for (const [key, value] of Object.entries({ genreIds: '1', seriesStatus: 'ONGOING', seriesType: 'MANHWA', orderBy: 'chaptersCount', orderDirection: 'desc', minChapters: '1', maxChapters: '1000', createdAfter: '2020-01-01', createdBefore: '2027-01-01' })) assert.equal(url.searchParams.get(key), value, key);
    assert(url.searchParams.get('excludedGenreIds').split(',').includes('4'));
    const details = await source.getContent(result.results[0].id); assert(details.tags.some((item) => item.id === '1')); assert(!details.tags.some((item) => item.id === '4'));
  });
  await check('Native validation rejects invalid dates, huge integers and inverted ranges', async () => {
    for (const filters of [{ minChapters: '999999999999999999999999' }, { minChapters: '-1' }, { minChapters: '3', maxChapters: '2' }, { createdAfter: '2026-02-30' }, { createdAfter: '2026-01-02', createdBefore: '2026-01-01' }]) {
      assert.equal((await source.validateSearchForm({ filters })).valid, false);
      await assert.rejects(source.search({ page: 1, filters }));
    }
    assert.equal((await source.validateSearchForm({ filters: { minChapters: '1', createdAfter: '2026-01-01' } })).valid, true);
  });
  await check('Empty native allowed-rating context returns none without network', async () => {
    const start = requests.length, result = await source.search({ page: 1, context: { allowedContentRatings: [] } });
    assert.equal(result.results.length, 0); assert.equal(result.isLastPage, true); assert.equal(requests.length, start);
    await assert.rejects(source.getContent('mimosa', { allowedContentRatings: [] }), /excluded/);
  });
  await check('Actual source title, aliases, metadata, full cover and inline chapters agree', async () => {
    content = await source.getContent('mimosa'); assert.equal(content.title, 'Mimosa'); assert(content.summary.length > 50);
    assert(content.additionalTitles.includes('미모사')); assert(content.tags.length >= 6); assert(content.additionalInfo[0].items.length);
    assert.equal(content.cover, catalog.results.find((item) => item.id === 'mimosa').cover);
    assert(!/\/(?:thumb|small|medium)\//i.test(content.cover)); assert(content.chapters.length > 30);
    originalTitles = Array.from(content.additionalTitles);
    const measured = await coverDimensions(source, content.cover); assert(measured.width > 500 && measured.height > 500);
  });
  await check('Complete chapter list is reused, sequentially indexed and paid hidden by default', async () => {
    const start = requests.length; chapters = await source.getChapters('mimosa'); assert.equal(requests.length, start);
    assert.equal(chapters.length, content.chapters.length); assert.equal(new Set(chapters.map((item) => item.chapterId)).size, chapters.length);
    chapters.forEach((item, index) => { assert.equal(item.index, index); assert(Number.isFinite(item.number)); assert(Number.isFinite(item.date.getTime())); assert.equal(item.language, 'en_US'); assert(!item.title?.startsWith('[Paid]')); });
    assert(chapters.every((item, index) => !index || chapters[index - 1].number <= item.number));
  });
  await check('Paid preference persists across instances without enabling paid reading', async () => {
    await setting('hidePaid', false); assert.equal((await field('hidePaid', freshSource())).value, false);
    full = await source.getChapters('mimosa'); assert(full.length > chapters.length);
    const locked = full.find((item) => item.title?.startsWith('[Paid]')); assert(locked);
    const start = requests.length; await assert.rejects(source.getChapterData('mimosa', locked.chapterId), /requires access/); assert.equal(requests.length, start);
    await setting('hidePaid', true);
  });
  await check('Reader produces ordered native page objects and actual first/middle/last image bytes', async () => {
    reader = await source.getChapterData('mimosa', 'chapter-56'); assert(reader.pages.length >= 10);
    assert.equal(new Set(reader.pages.map((item) => item.url)).size, reader.pages.length);
    for (const index of [...new Set([0, Math.floor(reader.pages.length / 2), reader.pages.length - 1])]) {
      assert.equal(typeof reader.pages[index].url, 'string'); await image(source, reader.pages[index].url);
    }
  });
  await check('A second real public chapter reads actual image bytes too', async () => {
    const available = chapters.find((item) => item.chapterId !== 'chapter-56'); assert(available);
    const pages = await source.getChapterData('mimosa', available.chapterId); assert(pages.pages.length); await image(source, pages.pages[0].url);
  });
  await check('Source headers are attached to native metadata and image requests', async () => {
    const request = await source.willRequestImage(reader.pages[0].url); assert.equal(request.headers.Referer, `${domain}/`); assert.equal(request.headers.Origin, domain); assert.match(request.headers.Accept, /image/);
    assert(source.api.client, 'Missing native network client');
    assert.equal(source.api.client.builder.headers.Referer, `${domain}/`); assert.equal(source.api.client.builder.headers.Origin, domain);
  });
  await check('Every current native discovery section resolves without stale Hot or fabricated genre cards', async () => {
    const cold = freshSource(), start = requests.length, original = cold.api.text.bind(cold.api);
    let liveTotal;
    cold.api.text = async (url) => {
      const text = await original(url);
      if (url.startsWith(`${api}/api/query?`) && new URL(url).searchParams.get('perPage') === '100') {
        const total = JSON.parse(text).totalCount; assert(Number.isSafeInteger(total) && total >= 0);
        if (liveTotal !== undefined) assert.equal(total, liveTotal, 'Bulk snapshot total changed');
        liveTotal = total;
      }
      return text;
    };
    const sections = await cold.getSectionsForPage({ id: 'home' }); assert.deepEqual(ids(sections), ['featured', 'latest', 'new', 'popular', 'updates']);
    for (const section of sections) { const resolved = await cold.resolvePageSection({ id: 'home' }, section.id); highlights(resolved.items); assert.equal(new Set(ids(resolved.items)).size, resolved.items.length); if (section.id === 'featured') assert.equal(resolved.viewMoreLink, undefined); }
    assert.notEqual(liveTotal, undefined, 'Missing live bulk metadata count');
    const coldCount = requests.length - start; assert.equal(coldCount, 3 + Math.max(1, Math.ceil(liveTotal / 100)), 'Expected home, archive, New feed and complete capped bulk metadata requests');
    const warmStart = requests.length; for (const section of sections) await cold.resolvePageSection({ id: 'home' }, section.id); assert.equal(requests.length - warmStart, 0); console.log(`HOME requests cold${coldCount} warm0`);
    const updates = await cold.resolvePageSection({ id: 'home' }, 'updates'); assert(updates.items.every((item) => /^Chapter /.test(item.subtitle))); assert.equal(updates.viewMoreLink, undefined);
    assert.equal((await source.resolvePageSection({ id: 'home' }, 'popular')).viewMoreLink, undefined);
  });
  await check('Source-disabled known release tabs disappear and stale links do not fetch them', async () => {
    const target = transformed((text, url) => {
      if (url !== `${domain}/`) return text;
      const expression = /latestReleaseFilters:(\$R\[\d+\]=)?\["latest","new"\]/; assert(expression.test(text), 'Current release-tab literal changed');
      return text.replace(expression, (_match, reference = '') => `latestReleaseFilters:${reference}["latest"]`);
    });
    const sections = await target.getSectionsForPage({ id: 'home' }); assert(ids(sections).includes('latest')); assert(!ids(sections).includes('new'));
    const start = requests.length; await assert.rejects(target.resolvePageSection({ id: 'home' }, 'new'), /Unknown/); await assert.rejects(target.search({ page: 1, listId: 'new' }), /disabled/); assert.equal(requests.length, start);
  });
  await check('Latest and rendered first-nine Popular snapshots match fresh website DOM ordering', async () => {
    const target = freshSource(), original = target.api.text.bind(target.api), allPosts = [], actualRows = {}; let html;
    target.api.text = async (url) => { const text = await original(url); if (url === `${domain}/`) html = text; if (url.includes('/api/query?') && new URL(url).searchParams.get('perPage') === '100') allPosts.push(...JSON.parse(text).posts); return text; };
    for (const sectionId of ['latest', 'popular']) actualRows[sectionId] = await target.resolvePageSection({ id: 'home' }, sectionId);
    assert(html, 'No actual native home callback response captured'); const $ = load(html); assert(allPosts.length);
    const safe = new Set(allPosts.filter((post) => post.genres?.length && !post.genres.some((genre) => /^(mature|adult|smut|hentai|erotica|pornographic|pornography|ecchi|suggestive)$/i.test(genre.name.trim()))).map((post) => post.slug));
    const encode = (slug) => encodeURIComponent(slug).replace(/[!'*~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    for (const [name, sectionId, parents] of [['Latest Releases', 'latest', 3], ['Most Popular', 'popular', 2]]) {
      let row = $('h2').filter((_, node) => $(node).text() === name).first(); assert.equal(row.length, 1);
      for (let index = 0; index < parents; index++) row = row.parent();
      const slugs = [...new Set(row.find('a[href]').toArray().flatMap((node) => { const path = new URL($(node).attr('href'), domain).pathname, match = path.match(/^\/series\/([^/]+)\/?$/); return match ? [decodeURIComponent(match[1])] : []; }))];
      assert.equal(slugs.length, sectionId === 'popular' ? 9 : 20);
      const actual = actualRows[sectionId];
      assert.deepEqual(ids(actual.items), slugs.filter((slug) => safe.has(slug)).map(encode));
    }
  });
  await check('Canonical New and latest listings match public feed evidence', async () => {
    for (const [listId, tag] of [['latest', 'latestUpdatePinned'], ['new', 'new']]) {
      const data = JSON.parse(await raw(`${api}/api/posts?page=1&perPage=20&searchTerm=&isNovel=false&tag=${tag}`));
      const expected = data.posts.filter((post) => post.genres?.length && !post.genres.some((genre) => /^(mature|adult|smut|hentai|erotica|pornographic|pornography|ecchi|suggestive)$/i.test(genre.name.trim()))).map((post) => encodeURIComponent(post.slug).replace(/[!'*~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`));
      const result = await source.search({ page: 1, listId }); assert.deepEqual(ids(result.results), expected);
      if (!result.isLastPage) { const next = await source.search({ page: 2, listId }); searchResult(next); assert(next.results.every((item) => !ids(result.results).includes(item.id)), 'Continuation repeated an earlier series'); }
    }
  });
  await check('Highest-chapter-count safe title has a complete real large chapter list', async () => {
    const result = await source.search({ page: 1, sort: { id: 'chapters' } }); searchResult(result);
    const target = freshSource(); await setting('hidePaid', false, target);
    try {
      const item = result.results[0]; largeTitle = item.id; const html = await raw(item.webUrl), match = html.match(/totalChapterCount:(\d+)/); assert(match);
      const all = await target.getChapters(item.id); assert.equal(all.length, Number(match[1])); assert(all.length >= full.length);
      all.forEach((chapter, index) => assert.equal(chapter.index, index));
      console.log(`LARGE CHAPTER LIST ${item.id}: ${all.length}, real decimal chapters ${all.filter((chapter) => !Number.isInteger(chapter.number)).length}`);
    } finally { await setting('hidePaid', true, target); }
  });
  await check('A genuine live decimal chapter retains its number and reads actual image bytes', async () => {
    assert(largeTitle); const all = await source.getChapters(largeTitle), decimal = all.find((chapter) => !Number.isInteger(chapter.number)); assert(decimal, 'No real public decimal chapter found');
    const pages = await source.getChapterData(largeTitle, decimal.chapterId); assert(pages.pages.length); await image(source, pages.pages[0].url);
    console.log(`REAL DECIMAL READER ${largeTitle}/${decimal.chapterId} number${decimal.number} ${pages.pages.length} pages`);
  });
  await check('Deep links preserve encoded IDs and reader links safely resolve to native series', async () => {
    const context = await source.handleURL(`${domain}/series/mimosa/chapter-56?from=web`); assert.equal(context.content.id, 'mimosa');
    assert.equal((await source.handleURL(`${domain}/series/mimosa`)).content.title, 'Mimosa');
    for (const url of ['https://evil.example/series/mimosa', `${domain}/account`, 'https://en-hijala.com.evil.example/series/mimosa']) assert.equal(await source.handleURL(url), null);
    const encoded = catalog.results.find((item) => /%/.test(item.id)); assert(encoded); assert.equal((await source.handleURL(encoded.webUrl)).content.id, encoded.id);
    const start = requests.length;
    for (const id of ['..', '%2F', '%5C', '%00', undefined, null, '', 4]) await assert.rejects(source.getContent(id));
    assert.equal(requests.length, start, 'Malformed content ID performed a network request');
  });
  await check('NSFW preference persists, known mature titles are excluded end to end', async () => {
    await setting('excludeNSFW', false); assert.equal((await field('excludeNSFW', freshSource())).value, false);
    const result = await source.search({ page: 1 }); searchResult(result); explicit = result.results.find((item) => item.contentRating === 2); assert(explicit, 'Need a live Mature-tag title');
    const details = await source.getContent(explicit.id); assert(details.tags.some((item) => item.id === '27'));
    await setting('excludeNSFW', true);
    assert(!(await source.search({ page: 1, query: explicit.title })).results.some((item) => item.id === explicit.id));
    await assert.rejects(source.getContent(explicit.id), /excluded/); await assert.rejects(source.getChapters(explicit.id), /excluded/); await assert.rejects(source.getChapterData(explicit.id, 'chapter-1'), /excluded/);
    const resultWithBL = await source.search({ page: 1, filters: { genres: { included: [{ id: '28', title: 'seinen' }], excluded: [] } } }); assert(resultWithBL.results.length, 'Do not block demographics as NSFW');
  });
  await check('Empty types and sections stay empty and native excluded genres are enforced', async () => {
    await setting('types', []); assert.equal((await source.search({ page: 1 })).results.length, 0); await assert.rejects(source.getContent('mimosa'), /excluded/);
    await setting('types', ['MANHWA', 'MANHUA', 'MANGA', 'SPANISH', 'RUSSIAN']);
    await setting('sections', []); assert.equal((await source.getSectionsForPage({ id: 'home' })).length, 0);
    await setting('sections', ['featured', 'latest', 'new', 'popular', 'updates']);
    await setting('excludedGenres', ['1']); assert.equal((await source.search({ page: 1, filters: { genres: { included: [{ id: '1', title: 'Action' }], excluded: [] } } })).results.length, 0); await assert.rejects(source.getContent('mimosa'), /excluded/);
    await setting('excludedGenres', []);
  });
  await check('Concurrent native preference callbacks merge without losing fields', async () => {
    const menu = await source.getPreferenceMenu(), fields = menu.sections.flatMap((section) => section.children ?? []);
    await Promise.all([fields.find((item) => item.id === 'hidePaid').didChange(false), fields.find((item) => item.id === 'types').didChange(['MANHWA'])]);
    assert.equal((await field('hidePaid')).value, false); assert.deepEqual(Array.from((await field('types')).value), ['MANHWA']);
    await setting('hidePaid', true); await setting('types', ['MANHWA', 'MANHUA', 'MANGA', 'SPANISH', 'RUSSIAN']);
  });
  await check('A read begun during a queued safety save waits before using old permissive cached results', async () => {
    const target = freshSource(); await setting('excludeNSFW', false, target);
    const other = freshSource();
    const warm = await target.search({ page: 1 }); assert(warm.results.some((item) => item.contentRating === 2));
    assert((await other.search({ page: 1 })).results.some((item) => item.contentRating === 2));
    const toggle = await field('excludeNSFW', target), original = target.preferences.bind(target);
    let release, signal, entered = false, settled = false, otherSettled = false;
    const gate = new Promise((resolve) => { release = resolve; }), reached = new Promise((resolve) => { signal = resolve; });
    target.preferences = async () => { if (!entered) { entered = true; signal(); await gate; } return original(); };
    const write = toggle.didChange(true); await reached;
    const read = target.search({ page: 1 }).then((result) => { settled = true; return result; });
    const otherRead = other.search({ page: 1 }).then((result) => { otherSettled = true; return result; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 25)); assert.equal(settled, false, 'Old permissive result escaped while safety save was queued'); assert.equal(otherSettled, false, 'Another Target leaked a cached result while safety save was queued');
      release(); await write; const result = await read; assert(result.results.every((item) => item.contentRating === 0)); assert((await otherRead).results.every((item) => item.contentRating === 0));
    } finally { release(); await write; target.preferences = original; await setting('excludeNSFW', true, target); }
  });
  await check('Unknown genre metadata fails closed using a fresh live catalog response', async () => {
    const target = transformed((text, url) => { if (!url.includes('/api/query?')) return text; const data = JSON.parse(text); data.posts.forEach((post) => { delete post.genres; }); return JSON.stringify(data); });
    const result = await target.search({ page: 1 }); assert.equal(result.results.length, 0); assert.equal(result.isLastPage, true);
  });
  await check('Partial genre metadata retains valid tags and never bypasses an explicit genre exclusion', async () => {
    const target = transformed((text, url) => url === `${domain}/series/mimosa` ? replaceRequired(text, 'name:"Action"', 'name:""') : text);
    await setting('excludeNSFW', false, target);
    try {
      const details = await target.getContent('mimosa'); assert(details.tags.some((tag) => tag.id === '3')); assert.equal(details.contentRating, undefined);
      await setting('excludedGenres', ['27'], target);
      await assert.rejects(target.getContent('mimosa'), /excluded/);
      const catalogTarget = transformed((text, url) => { if (!url.includes('/api/query?')) return text; const data = JSON.parse(text); data.posts.forEach((post) => { post.genres = [...(post.genres ?? []), { id: 999999, name: '' }]; }); return JSON.stringify(data); });
      const result = await catalogTarget.search({ page: 1 }); assert.equal(result.results.length, 0); assert.equal(result.isLastPage, true);
    } finally { await setting('excludedGenres', [], target); await setting('excludeNSFW', true, target); }
  });
  await check('Filtered-empty first page advances native continuation from the consumed API page', async () => {
    const seen = [];
    const target = transformed((text, url) => { if (!url.includes('/api/query?')) return text; const data = JSON.parse(text), page = Number(new URL(url).searchParams.get('page')); seen.push(page); if (page === 1) data.posts.forEach((post) => { delete post.genres; }); return JSON.stringify(data); });
    const first = await target.search({ page: 1 }); searchResult(first); const next = await target.search({ page: 2 }); searchResult(next);
    assert.deepEqual(seen.slice(0, 3), [1, 2, 3]); assert(next.results.some((item) => !ids(first.results).includes(item.id)));
  });
  await check('Repeated API pages fail explicitly instead of looping or duplicating native pages', async () => {
    let first;
    const target = transformed((text, url) => { if (!url.includes('/api/query?')) return text; if (Number(new URL(url).searchParams.get('page')) === 1) first = text; return first ?? text; });
    await target.search({ page: 1 }); await assert.rejects(target.search({ page: 2 }), /repeated/);
  });
  await check('Settings changed during a live page2 request reject its stale result', async () => {
    const target = freshSource(); await target.search({ page: 1 }); const original = target.api.text.bind(target.api); let changed = false;
    target.api.text = async (url) => { const text = await original(url); if (url.includes('/api/query?') && !changed) { changed = true; await setting('hidePaid', false, target); } return text; };
    await assert.rejects(target.search({ page: 2 }), /settings changed/); await setting('hidePaid', true);
  });
  await check('Native decimal numbers and semantic chapter titles survive live-derived mutation', async () => {
    const target = transformed((text, url) => url === `${domain}/series/mimosa` ? replaceRequired(text, 'slug:"chapter-1",number:1,title:"1"', 'slug:"chapter-1",number:1.5,title:"Chapter 1.5: A semantic title"') : text);
    const items = await target.getChapters('mimosa'); const chapter = items.find((item) => item.chapterId === 'chapter-1'); assert.equal(chapter.number, 1.5); assert.equal(chapter.title, 'A semantic title');
  });
  await check('Earliest paid chapter is filtered before assigning zero-based native indexes', async () => {
    const target = transformed((text, url) => { if (url !== `${domain}/series/mimosa`) return text; const expression = /(slug:"chapter-1",number:1,[\s\S]{0,1500}?)isLocked:!1/; assert(expression.test(text)); return text.replace(expression, '$1isLocked:!0'); });
    const items = await target.getChapters('mimosa'); assert(!items.some((item) => item.chapterId === 'chapter-1')); assert.equal(items[0].index, 0); assert.equal(items[0].number, 2);
  });
  await check('Incomplete total and missing access status reject real detail data', async () => {
    for (const change of [(text) => text.replace(/totalChapterCount:\d+/, 'totalChapterCount:999999'), (text) => text.replace(/isLocked:!1/, 'missingLock:!1')]) {
      const target = transformed((text, url) => url === `${domain}/series/mimosa` ? change(text) : text); await assert.rejects(target.getChapters('mimosa'), /incomplete/);
    }
  });
  await check('Protected, mismatched and malformed readers are rejected from fresh live responses', async () => {
    const changes = [
      (text) => { const start = text.indexOf('publicImages:'); assert(start >= 0); const after = text.slice(start), urls = [...after.matchAll(/url:"([^"]+)"/g)]; assert(urls.length >= 2); return text.slice(0, start) + after.replace(`url:"${urls[1][1]}"`, `url:"${urls[0][1]}"`); },
      (text) => replaceRequired(text, 'requiresProtectedFetch:!1', 'requiresProtectedFetch:!0'),
      (text) => replaceRequired(text, 'seriesSlug:"mimosa"', 'seriesSlug:"different-series"'),
      (text) => text.replace(/order:0(?=[,}])/, 'order:-1'),
      (text) => text.replace(/isAccessible:!0/, 'isAccessible:!1')
    ];
    for (const change of changes) {
      const target = transformed((text, url) => url === `${domain}/series/mimosa/chapter-56` ? change(text) : text);
      await assert.rejects(target.getChapterData('mimosa', 'chapter-56'), /requires access|different chapter|invalid page ordering/);
    }
  });
  await check('Expired native pagination and raw caches refresh instead of pinning Latest forever', async () => {
    const target = freshSource(); await target.search({ page: 1 });
    for (const entry of target.pages.values()) entry.at -= 180_001;
    for (const entry of target.cache.values()) entry.at -= 180_001;
    const start = requests.length; searchResult(await target.search({ page: 1 }));
    assert(requests.slice(start).some((request) => request.url.includes('/api/query?')));
  });
  await check('Ordinary forbidden responses do not become Cloudflare or cross an access boundary', async () => {
    const target = freshSource(), original = target.api.client.get.bind(target.api.client);
    target.api.client.get = async (url) => ({ ...await original(url), status: 403, headers: {} });
    await assert.rejects(target.getContent('mimosa'), (error) => error.name !== 'CloudflareError' && /HTTP 403/.test(error.message));
  });
  await check('Verified challenge responses use the source resolution URL', async () => {
    const target = freshSource(), original = target.api.client.get.bind(target.api.client);
    target.api.client.get = async (url) => ({ ...await original(url), status: 403, headers: { 'cf-mitigated': 'challenge' } });
    await assert.rejects(target.getContent('mimosa'), (error) => error.name === 'CloudflareError' && error.resolutionURL === domain);
  });
  await check('No downloaded script execution or cross-series/invalid chapter fallback occurs', async () => {
    const target = transformed((text, url) => url === `${domain}/series/mimosa/chapter-56` ? replaceRequired(text, 'requiresProtectedFetch:!1', 'requiresProtectedFetch:(globalThis.__hijalaExecuted=true)') : text);
    await assert.rejects(target.getChapterData('mimosa', 'chapter-56'), /unsupported|incomplete/);
    const start = requests.length;
    for (const chapterId of [undefined, null, '', 4, '%2F', '..']) await assert.rejects(source.getChapterData('mimosa', chapterId), /invalid/);
    assert.equal(requests.length, start, 'Malformed chapter ID performed a network request');
    await assert.rejects(source.getChapterData('mimosa', 'not-a-real-chapter'), /does not belong/);
    assert.deepEqual(Array.from((await source.getContent('mimosa')).additionalTitles), originalTitles);
  });
}
