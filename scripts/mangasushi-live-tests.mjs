import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { load } from 'cheerio';
import { assertReadOnlyMangaSushiPost } from './mana-runtime.mjs';

// Source-specific live assertions use the real native bundle passed by the runner.
// No saved pages, parser fixtures or substitute source implementation are used.
export async function testMangaSushi({ source, check, highlights, searchResult, image, requests, freshSource }) {
  const domain = 'https://mangasushi.org';
  const sample = 'welcome-to-the-cheap-restaurant-of-outcasts';
  const blockedTags = new Set(['adult', 'mature', 'smut', 'hentai', 'erotica', 'ecchi']);
  const preference = async (value) => {
    const field = (await source.getPreferenceMenu()).sections.flatMap((section) => section.children ?? []).find((item) => item.id === 'excludeNSFW');
    assert(field, 'Missing global NSFW setting');
    if (value !== undefined) await field.didChange(value);
    return field;
  };
  let catalog, safeContent, form, unfiltered, home, chapters, knownBlocked;
  const homeIDs = {};
  await check('Global NSFW exclusion defaults on and uses native adult=0', async () => {
    assert.equal((await preference()).value, true);
    catalog = await source.search({ page: 1 }); searchResult(catalog);
    assert(requests.some((request) => new URL(request.url).searchParams.get('adult') === '0'));
    safeContent = await source.getContent(catalog.results[0].id);
    assert(safeContent.tags?.length, 'Safe classification needs actual genres');
    assert(!safeContent.tags.some((tag) => blockedTags.has(tag.id)));
    await image(source, safeContent.cover);
  });
  await check('Native catalog pagination advances without using filtered counts', async () => {
    assert.equal(catalog.isLastPage, false, 'Current live catalog should have continuation');
    const next = await source.search({ page: 2 });
    assert.equal(typeof next.isLastPage, 'boolean');
    assert(next.results.some((item) => !catalog.results.some((prior) => prior.id === item.id)));
    assert(requests.some((request) => request.url.endsWith('/wp-admin/admin-ajax.php')));
  });
  await check('Full title search and safe details retain the canonical identity', async () => {
    const item = catalog.results[0];
    const result = await source.search({ page: 1, query: item.title }); searchResult(result);
    assert(result.results.some((match) => match.id === item.id && match.title === item.title));
    assert.equal(safeContent.title, item.title);
    assert(safeContent.summary?.trim());
    assert(safeContent.additionalInfo?.some((section) => section.items?.length), 'Missing live authors/artists');
    const link = await source.handleURL(safeContent.webUrl);
    assert.equal(link?.content?.id, item.id);
  });
  await check('English aliases retain canonical IDs, original titles and complete comma-containing alternatives', async () => {
    for (const [id, query, expected] of [
      ['botsuraku-yotei-nanode-kajishokunin-wo-mezasu', 'Botsuraku Yotei Nanode', 'Expecting to Fall into Ruin, I Aim to Become a Blacksmith'],
      ['tensei-akuma-no-saikyou-yuusha-ikusei-keikaku', 'Tensei Akuma', 'Reincarnated Devil’s Plan for Raising the Strongest Hero'],
      ['academy-saikyou-no-mob-healer-shinigee-sekai-no-mob-ni-tensei-shita-ore-wa-hazure-job-healer-to-gensaku-chishiki-de-musou-suru', 'Academy Saikyou no Mob Healer', "The Academy's Strongest Mob Healer: Reincarnated as a Mob in a Deadly Game World, I Dominate with the Useless Job [Healer] and My Original Knowledge"]
    ]) {
      const raw = (await source.firstListing(source.searchURL({ page: 1, query }, true), true)).items.find((item) => item.id === id);
      assert(raw); assert.notEqual(raw.title, expected);
      for (const title of [raw.title, expected, expected.replace(/[‘’]/g, "'").replace(/'/g, '’').toUpperCase(), expected.replace(/[‘’]/g, "'")]) {
        const results = await source.search({ page: 1, query: title });
        assert.equal(results.results.find((item) => item.id === id)?.title, expected);
      }
      const details = await source.getContent(id);
      assert.equal(details.title, expected);
      assert(details.additionalTitles.includes(raw.title));
      for (const alternative of raw.alternatives) assert(details.additionalTitles.includes(alternative));
      // Exercise the native bundle's actual outbound adapter, using a live row.
      assert.equal(source.highlight({ ...raw, alternatives: raw.alternatives.map((value) => value.replace(expected, '')) }).title, raw.title);
      assert.equal(source.highlight({ ...raw, alternatives: [`Unrelated ${expected} sequel`] }).title, raw.title);
      assert.equal(source.highlight({ ...raw, id: 'unregistered-id', alternatives: [expected] }).title, raw.title);
      assert.equal(raw.title, (await source.resolveMetadata(id, raw.title, true)).title, 'Display must not replace cached source titles');
    }
  });
  await check('Japanese-only alternatives retain the original title in search and details', async () => {
    const raw = (await source.firstListing(source.searchURL({ page: 1, query: 'Ken yo' }, true), true)).items.find((item) => item.id === 'ken-yo-kaku-katariki');
    assert(raw); assert(raw.alternatives.some((value) => /[\u3040-\u9fff]/.test(value)));
    const result = await source.search({ page: 1, query: raw.title });
    assert.equal(result.results.find((item) => item.id === raw.id)?.title, raw.title);
    assert.equal((await source.getContent(raw.id)).title, raw.title);
  });
  await check('Cold metadata classification still queries the source original, not its English display alias', async () => {
    const cold = freshSource(), before = requests.length;
    const content = await cold.getContent('botsuraku-yotei-nanode-kajishokunin-wo-mezasu');
    assert.equal(content.title, 'Expecting to Fall into Ruin, I Aim to Become a Blacksmith');
    const queries = requests.slice(before).filter((request) => new URL(request.url).searchParams.has('s')).map((request) => new URL(request.url).searchParams.get('s'));
    assert.equal(queries[0], 'Botsuraku Yotei Nanode, Kajishokunin wo Mezasu');
  });
  await check('Removing an English alias from live metadata restores the original search and detail display', async () => {
    const cold = freshSource(), original = cold.api.text.bind(cold.api);
    const id = 'botsuraku-yotei-nanode-kajishokunin-wo-mezasu';
    const title = 'Botsuraku Yotei Nanode, Kajishokunin wo Mezasu';
    const alias = 'Expecting to Fall into Ruin, I Aim to Become a Blacksmith';
    cold.api.text = async (url, ...args) => (await original(url, ...args)).replaceAll(alias, '');
    const result = await cold.search({ page: 1, query: title });
    assert.equal(result.results.find((item) => item.id === id)?.title, title);
    assert.equal((await cold.getContent(id)).title, title);
  });
  await check('Search exposes live genres, all statuses, site fields and seven orders', async () => {
    form = await source.getSearchForm();
    const fields = form.sections.flatMap((section) => section.children ?? []);
    for (const id of ['genres', 'condition', 'author', 'artist', 'release', 'status', 'adult']) assert(fields.some((field) => field.id === id), `Missing ${id}`);
    assert(fields.find((field) => field.id === 'genres').options.length > 30);
    assert.deepEqual(Array.from(fields.find((field) => field.id === 'status').options, (option) => option.id), ['on-going', 'end', 'canceled', 'on-hold', 'upcoming']);
    assert.deepEqual(Array.from(await source.getSortOptions(), (option) => option.id), ['relevance', 'latest', 'alphabet', 'rating', 'trending', 'views', 'new-manga']);
  });
  await check('Every native search order returns live results', async () => {
    for (const sort of await source.getSortOptions()) searchResult(await source.search({ page: 1, sort: { id: sort.id } }));
  });
  await check('Native OR and AND genre conditions and author/artist/year/status filters', async () => {
    const genres = safeContent.tags.slice(0, 2);
    assert.equal(genres.length, 2, 'Need two live genres');
    for (const condition of ['or', 'and']) {
      const result = await source.search({ page: 1, filters: { genres, condition: { id: condition } } }); searchResult(result);
      for (const item of result.results.slice(0, 2)) {
        const details = await source.getContent(item.id);
        const matches = genres.filter((genre) => details.tags.some((tag) => tag.id === genre.id)).length;
        assert(condition === 'and' ? matches === genres.length : matches > 0);
      }
    }
    const fields = form.sections.flatMap((section) => section.children ?? []);
    const status = fields.find((field) => field.id === 'status').options.find((option) => option.id === 'on-going');
    searchResult(await source.search({ page: 1, filters: { status: [status] } }));
    const staff = safeContent.additionalInfo.flatMap((section) => section.items ?? []);
    for (const [field, role] of [['author', 'Author'], ['artist', 'Artist']]) {
      const person = staff.find((item) => item.subtitle === role);
      assert(person, `Missing live ${role}`);
      const filtered = await source.search({ page: 1, filters: { [field]: person.title } }); searchResult(filtered);
      assert(filtered.results.some((item) => item.id === catalog.results[0].id));
    }
    const releasePage = await fetch(`${domain}/?s=&post_type=wp-manga&adult=0`, { signal: AbortSignal.timeout(30_000) });
    assert(releasePage.ok);
    const releaseHTML = load(await releasePage.text());
    const releaseRow = releaseHTML('.c-tabs-item__content').toArray().find((node) => releaseHTML(node).find('.post-title a').attr('href') === safeContent.webUrl);
    const year = releaseHTML(releaseRow).find('.mg_release .summary-content').text().trim();
    assert(/^\d{4}$/.test(year), 'Missing actual live release year');
    const result = await source.search({ page: 1, filters: { release: year } }); searchResult(result);
    assert(requests.some((request) => new URL(request.url).searchParams.get('release') === year));
    assert(result.results.some((item) => item.id === catalog.results[0].id), 'Release filter lost the verified series');
  });
  await check('Negative search returns a genuinely empty terminal page', async () => {
    const result = await source.search({ page: 1, query: 'zzzxqv-mangasushi-no-such-title-843021' });
    assert.equal(result.results.length, 0); assert.equal(result.isLastPage, true);
  });
  await check('Preference callback persists across instances and unfiltered catalog is usable', async () => {
    await preference(false);
    const other = freshSource();
    const value = (await other.getPreferenceMenu()).sections[0].children[0].value;
    assert.equal(value, false);
    unfiltered = await source.search({ page: 1 }); searchResult(unfiltered);
    for (const item of unfiltered.results) {
      const details = await source.getContent(item.id);
      if (details.tags?.some((tag) => blockedTags.has(tag.id))) { knownBlocked = item; break; }
    }
    assert(knownBlocked, 'No explicit live tag found to test exclusion');
  });
  await check('Discovery mirrors both site rows exactly with no invented popular continuation', async () => {
    home = await source.getSectionsForPage({ id: 'home' });
    assert.deepEqual(Array.from(home, (section) => section.id), ['popular', 'latest']);
    const response = await fetch(`${domain}/`, { signal: AbortSignal.timeout(30_000) });
    assert(response.ok); const $ = load(await response.text());
    for (const [id, selector] of [['popular', '.popular-slider .slider__item'], ['latest', '#loop-content .page-item-detail']]) {
      const expected = $(selector).toArray().map((node) => $(node).find('.post-title a').attr('href').match(/\/manga\/([^/]+)/)[1]);
      homeIDs[id] = expected;
      const section = await source.resolvePageSection({ id: 'home' }, id); highlights(section.items);
      assert.deepEqual(Array.from(section.items, (item) => item.id), expected);
      if (id === 'popular') assert.equal(section.viewMoreLink, undefined);
      else {
        assert(section.viewMoreLink); const next = await source.search({ page: 2, listId: id }); searchResult(next);
        assert(next.results.some((item) => !expected.includes(item.id)));
      }
    }
  });
  await check('Unfiltered discovery keeps English titles with two cold requests and zero warm requests', async () => {
    const cold = freshSource(), before = requests.length, started = performance.now();
    const rows = await Promise.all(['popular', 'latest'].map((id) => cold.resolvePageSection({ id: 'home' }, id)));
    assert.equal(requests.length - before, 2, 'Unfiltered cold discovery needs one home and one metadata batch, never one request per title');
    console.log(`UNFILTERED DISCOVERY COLD: ${requests.length - before} requests, ${Math.round(performance.now() - started)}ms`);
    const warmBefore = requests.length, warmStarted = performance.now();
    const warmRows = await Promise.all(['popular', 'latest'].map((id) => cold.resolvePageSection({ id: 'home' }, id)));
    assert.equal(requests.length - warmBefore, 0);
    console.log(`UNFILTERED DISCOVERY WARM: 0 requests, ${Math.round(performance.now() - warmStarted)}ms`);
    for (const row of [rows[0], warmRows[0]]) assert.equal(row.items.find((item) => item.id === 'yondome-wa-iya-na-shizokusei-majutsushi')?.title, 'Death Attribute Magician');
    const nativeHome = await cold.home(false);
    for (const [index, id] of ['popular', 'latest'].entries()) {
      assert.deepEqual(Array.from(rows[index].items, (item) => item.id), homeIDs[id]);
      for (const item of rows[index].items) {
        const raw = nativeHome[id].items.find((entry) => entry.id === item.id);
        const metadata = cold.fresh(cold.metadata.get(`false:${item.id}`));
        assert.equal(item.title, cold.highlight({ ...raw, alternatives: metadata?.alternatives ?? raw.alternatives }).title);
      }
    }
  });
  await check('Sample details, asynchronous chapters, decimals and original labels', async () => {
    const content = await source.getContent(sample);
    assert.equal(content.title, 'Welcome to the Cheap Restaurant of Outcasts!');
    assert(content.summary?.trim()); assert(content.additionalTitles?.length);
    chapters = await source.getChapters(sample);
    assert(chapters.length > 50); assert.equal(new Set(chapters.map((chapter) => chapter.chapterId)).size, chapters.length);
    chapters.forEach((chapter, index) => {
      assert.equal(chapter.index, index); assert(Number.isFinite(new Date(chapter.date).getTime()));
      assert(chapter.title?.trim()); if (index) assert(chapter.number >= chapters[index - 1].number);
    });
    assert(chapters.some((chapter) => chapter.number === 66.1 && chapter.title === 'Chapter 66.1'));
  });
  await check('Multiple readers preserve ordered lazy images and image bytes', async () => {
    for (const chapter of [chapters[0], chapters.find((chapter) => chapter.number === 66.1)]) {
      const data = await source.getChapterData(sample, chapter.chapterId, chapter);
      assert(data.pages.length); assert.equal(new Set(data.pages.map((page) => page.url)).size, data.pages.length);
      assert(data.pages.every((page) => new URL(page.url).pathname.includes('/WP-manga/data/')));
      await image(source, data.pages[0].url); await image(source, data.pages.at(-1).url);
      if (chapter.number === 66.1) {
        assert.equal(data.pages.length, 12);
        assert.deepEqual(Array.from(data.pages, (page) => new URL(page.url).pathname.split('/').at(-1)), Array.from({ length: 12 }, (_, i) => `${String(i).padStart(2, '0')}.jpg`));
      }
    }
  });
  await check('Editorial notices never become reading content, even with exclusion off', async () => {
    for (const id of ['mangasushi-donations', 'we-need-more-translators']) {
      const result = await source.search({ page: 1, query: id.replaceAll('-', ' ') });
      assert(!result.results.some((item) => item.id === id));
      await assert.rejects(source.getContent(id), /editorial notice/i);
      await assert.rejects(source.getChapters(id), /editorial notice/i);
      await assert.rejects(source.getChapterData(id, 'chapter-1'), /editorial notice/i);
    }
  });
  await check('Reader rejects mismatched identity, duplicate URLs and numbered page gaps', async () => {
    const readerURL = `${domain}/manga/${sample}/chapter-66-1/`;
    const html = await source.api.text(readerURL);
    const original = source.api.text;
    try {
      source.api.text = async () => html;
      await assert.rejects(source.getChapterData('not-the-requested-series', 'chapter-9'), /different series or chapter/i);
      const duplicate = load(html); duplicate('.reading-content').append(duplicate('.wp-manga-chapter-img').first().clone());
      source.api.text = async () => duplicate.html();
      await assert.rejects(source.getChapterData(sample, 'chapter-66-1'), /duplicate reader pages/i);
      const missing = load(html); missing('#image-5').remove();
      source.api.text = async () => missing.html();
      await assert.rejects(source.getChapterData(sample, 'chapter-66-1'), /numbering is incomplete/i);
    } finally { source.api.text = original; }
  });
  await check('Changing the preference invalidates an in-flight unfiltered response', async () => {
    await preference(false);
    const original = source.api.text;
    let arrive, release;
    const arrived = new Promise((resolve) => { arrive = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    try {
      source.api.text = async (...args) => { const html = await original.apply(source.api, args); arrive(); await gate; return html; };
      const pending = source.search({ page: 1, query: 'Lonely Attack' });
      await Promise.race([arrived, pending.then(() => assert.fail('Request unexpectedly completed before the gate'))]);
      const rejected = assert.rejects(pending, /settings changed/i);
      await preference(true); release(); await rejected;
    } finally { release(); source.api.text = original; }
  });
  await check('Unknown classification is blocked and malformed search is not an empty success', async () => {
    await preference(true);
    await assert.rejects(source.getContent(sample), /classification/i);
    await assert.rejects(source.getChapters(sample), /classification/i);
    await assert.rejects(source.getChapterData(sample, 'chapter-66-1'), /classification/i);
    const html = await source.api.text(`${domain}/?s=&post_type=wp-manga&adult=0`);
    const original = source.api.text;
    try {
      source.api.text = async () => html.replaceAll('search-advanced-form', 'changed-search-markup');
      await assert.rejects(source.search({ page: 1, query: 'malformed-layout-probe' }), /search page is incomplete/i);
      source.api.text = async () => html.replaceAll('c-tabs-item__content', 'changed-result-row');
      await assert.rejects(source.search({ page: 1, query: 'malformed-result-probe' }), /result layout changed/i);
    } finally { source.api.text = original; }
  });
  await check('Re-enabling global exclusion blocks cached NSFW detail, chapters, reader and deep links', async () => {
    await preference(true);
    const safe = await source.search({ page: 1 });
    assert(!safe.results.some((item) => item.id === knownBlocked.id));
    await assert.rejects(source.getContent(knownBlocked.id), /excluded|classification/i);
    await assert.rejects(source.getChapters(knownBlocked.id), /excluded|classification/i);
    await assert.rejects(source.getChapterData(knownBlocked.id, 'chapter-1'), /excluded|classification/i);
    await assert.rejects(source.handleURL(knownBlocked.webUrl), /excluded|classification/i);
  });
  await check('Filtered discovery preserves rows and only returns verifiably safe titles', async () => {
    const safeIDs = new Set();
    let terminal = false;
    for (let page = 1; page <= 50; page += 1) {
      const result = await source.search({ page });
      for (const item of result.results) { assert(!safeIDs.has(item.id), 'Catalog continuation repeats a series'); safeIDs.add(item.id); }
      if (result.isLastPage) { terminal = true; break; }
    }
    assert(terminal && safeIDs.size, 'No complete safe catalog for home parity');
    const cold = freshSource();
    const bodies = [];
    const original = cold.api.text.bind(cold.api);
    cold.api.text = async (url, body) => { if (body) bodies.push(new URLSearchParams(body)); return original(url, body); };
    const started = performance.now(), before = requests.length;
    const [sections, ...rows] = await Promise.all([
      cold.getSectionsForPage({ id: 'home' }),
      cold.resolvePageSection({ id: 'home' }, 'popular'),
      cold.resolvePageSection({ id: 'home' }, 'latest')
    ]);
    assert.deepEqual(Array.from(sections, (section) => section.id), ['popular', 'latest']);
    const coldRequests = requests.length - before;
    assert.equal(coldRequests, 2, 'Cold home should share one homepage request and one native metadata batch');
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].get('template'), 'madara-core/content/content-search');
    assert.equal(bodies[0].get('page'), '0');
    const adultClause = [...bodies[0].entries()].find(([key, value]) => /^vars\[meta_query\].*\[key\]$/.test(key) && value === 'manga_adult_content');
    assert(adultClause, 'Metadata batch must retain the native adult filter');
    assert.equal(bodies[0].get(adultClause[0].replace(/\[key\]$/, '[value]')), '', 'Metadata batch must request adult=0, never adult=1');
    console.log(`DISCOVERY COLD: ${coldRequests} requests, ${Math.round(performance.now() - started)}ms`);
    const warmBefore = requests.length, warmStarted = performance.now();
    const warmRows = await Promise.all(sections.map((section) => cold.resolvePageSection({ id: 'home' }, section.id)));
    assert.equal(requests.length - warmBefore, 0, 'Warm discovery should reuse cached native metadata');
    console.log(`DISCOVERY WARM: 0 requests, ${Math.round(performance.now() - warmStarted)}ms`);
    for (const row of [rows[0], warmRows[0]]) assert.equal(row.items.find((item) => item.id === 'yondome-wa-iya-na-shizokusei-majutsushi')?.title, 'Death Attribute Magician');
    for (const [index, section] of sections.entries()) {
      const result = rows[index];
      const expected = homeIDs[section.id].filter((id) => safeIDs.has(id));
      assert.deepEqual(Array.from(warmRows[index].items, (item) => item.id), expected);
      assert.deepEqual(Array.from(result.items, (item) => item.id), expected, 'Safe home titles must not disappear during canonical enrichment');
      assert(Array.isArray(result.items)); // All popular titles may be NSFW or unclassified.
      console.log(`SAFE HOME ${section.id}: ${result.items.length} of the site's titles visible`);
      for (const item of result.items) {
        const details = await source.getContent(item.id);
        assert(details.tags?.length && !details.tags.some((tag) => blockedTags.has(tag.id)));
        assert.equal(item.title, details.title, 'Discovery and detail titles must agree');
      }
      if (section.id === 'popular') assert.equal(result.viewMoreLink, undefined);
    }
  });
  await check('Setting changes invalidate a pending discovery metadata batch', async () => {
    const cold = freshSource();
    const original = cold.api.text.bind(cold.api);
    let started, release;
    const ready = new Promise((resolve) => { started = resolve; });
    cold.api.text = async (url, body) => {
      const html = await original(url, body);
      if (body && new URLSearchParams(body).get('template') === 'madara-core/content/content-search') {
        started();
        return new Promise((resolve) => { release = () => resolve(html); });
      }
      return html;
    };
    const pending = cold.search({ page: 1, listId: 'latest' });
    try {
      await Promise.race([ready, pending.then(() => { throw new Error('Discovery completed without the metadata gate'); })]);
      const field = (await cold.getPreferenceMenu()).sections[0].children[0];
      await field.didChange(false);
      release();
      await assert.rejects(pending, /settings changed/i);
      assert.equal(cold.metadata.size, 0, 'A stale discovery batch must not repopulate metadata after a settings change');
      await field.didChange(true);
    } finally { release?.(); cold.api.text = original; }
  });
  await check('Malformed discovery metadata fails visibly instead of trusting home titles', async () => {
    const cold = freshSource();
    const original = cold.api.text.bind(cold.api);
    cold.api.text = async (url, body) => body ? '<html><title>Unexpected metadata</title></html>' : original(url, body);
    await assert.rejects(cold.search({ page: 1, listId: 'latest' }), /unrecognized continuation/i);
  });
  await check('Read-only host rejects duplicate AJAX actions before any request', async () => {
    // Invoke the same pure guard used by the runtime. A regression must never
    // send the malformed action to a live site, even if it stopped rejecting it.
    assert.throws(() => assertReadOnlyMangaSushiPost({ url: `${domain}/wp-admin/admin-ajax.php`, method: 'POST',
      body: 'action=madara_load_more&action=wp-manga-save-rating&page=1&template=madara-core%2Fcontent%2Fcontent-search&vars%5Bpost_type%5D=wp-manga' }), /duplicate|conflicting/i);
  });
  await check('Repeated nonempty AJAX pages fail visibly instead of looping', async () => {
    await preference(true);
    await source.search({ page: 1 });
    const html = await source.api.text(`${domain}/?s=&post_type=wp-manga&adult=0`);
    const original = source.api.text;
    try {
      source.api.text = async () => html;
      await assert.rejects(source.search({ page: 2 }), /repeated a catalog page/i);
    } finally { source.api.text = original; }
  });
  await preference(true);
}
