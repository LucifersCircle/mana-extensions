import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { load } from 'cheerio';
import { assertReadOnlyMangaSushiPost } from './mana-runtime.mjs';

export async function coverDimensions(source, url) {
  const request = await source.willRequestImage(url);
  const response = await fetch(request.url, { headers: request.headers, signal: AbortSignal.timeout(30_000) });
  assert(response.ok, `Cover HTTP ${response.status}: ${url}`);
  const chunks = [], reader = response.body.getReader();
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      assert(length <= 16 * 1024 * 1024, 'Cover exceeds the 16-MiB live probe bound');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks);
  const result = (width, height, format) => {
    assert(width > 0 && height > 0, 'Invalid cover dimensions');
    const measured = { width, height, bytes: bytes.length, format, mime: response.headers.get('content-type')?.split(';')[0] };
    console.log(`COVER ${format} ${width}x${height} ${measured.bytes}B ${measured.mime} ${url}`);
    return measured;
  };
  // Inspect complete response bytes, not MIME, filename or HTML display sizes.
  if (bytes.length >= 45 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    assert.equal(bytes.subarray(12, 16).toString(), 'IHDR', 'PNG has no IHDR');
    assert.equal(bytes.subarray(-8, -4).toString(), 'IEND', 'PNG is incomplete');
    return result(bytes.readUInt32BE(16), bytes.readUInt32BE(20), 'PNG');
  }
  if (bytes.length >= 30 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') {
    assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, 'WebP is incomplete');
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = bytes.subarray(offset, offset + 4).toString(), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
      assert(start + size <= bytes.length, 'Malformed WebP chunk length');
      if (kind === 'VP8X' && size >= 10) return result(bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1, 'WEBP');
      if (kind === 'VP8 ' && size >= 10 && bytes.subarray(start + 3, start + 6).toString('hex') === '9d012a') {
        return result(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff, 'WEBP');
      }
      if (kind === 'VP8L' && size >= 5 && bytes[start] === 0x2f) {
        const packed = bytes.readUInt32LE(start + 1);
        return result((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1, 'WEBP');
      }
      offset = start + size + (size % 2);
    }
    assert.fail('WebP has no supported dimension chunk');
  }
  assert(bytes.length >= 4 && bytes.readUInt16BE(0) === 0xffd8 && bytes.readUInt16BE(bytes.length - 2) === 0xffd9, 'Cover is not complete JPEG bytes');
  // Bound the SOF scan and validate segment lengths, not filename/HTML dimensions.
  let offset = 2;
  for (let count = 0; count < 1024 && offset + 3 < bytes.length; count += 1) {
    assert.equal(bytes[offset++], 0xff, 'Malformed JPEG marker');
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    assert(marker !== 0xda && marker !== 0xd9, 'JPEG has no SOF dimensions');
    const size = bytes.readUInt16BE(offset);
    assert(size >= 2 && offset + size <= bytes.length, 'Malformed JPEG segment length');
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      assert(size >= 8, 'Truncated JPEG SOF');
      return result(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3), 'JPEG');
    }
    offset += size;
  }
  assert.fail('JPEG SOF dimensions missing or beyond the bounded scan');
}

// Source-specific live assertions use the real native bundle passed by the runner.
// No saved pages, parser fixtures or substitute source implementation are used.
export async function testMangaSushiNativeRatings({ source, check, requests, freshSource, nativeStore }) {
  const domain = 'https://mangasushi.org';
  const setting = async (target, value) => {
    const field = (await target.getPreferenceMenu()).sections[0].children[0];
    if (value !== undefined) await field.didChange(value);
    return field;
  };
  const context = (ratings) => ({ allowedContentRatings: ratings });
  const ids = (items) => Array.from(items, (item) => item.id);
  let baseline, sample;
  await check('Native rating policy is authoritative with no never-saved source cap and reusable context-neutral caches', async () => {
    if (nativeStore) assert.equal(await nativeStore.get('MangaSushi.excludeNSFW'), null);
    assert.equal((await setting(source)).value, false);
    const start = requests.length;
    baseline = await source.search({ page: 1 });
    assert(baseline.results.length);
    assert(requests.slice(start).every((request) => new URL(request.url).searchParams.get('adult') !== '0'));
    assert(baseline.results.every((item) => [0, 2, 3].includes(item.contentRating)));
    if (nativeStore) assert.equal(await nativeStore.get('MangaSushi.excludeNSFW'), null, 'Reading an unset preference must not save a default');
    const warm = requests.length;
    assert.deepEqual(ids((await source.search({ page: 1, context: context([0, 1, 2, 3]) })).results), ids(baseline.results));
    const safe = await source.search({ page: 1, context: context([0]) });
    assert(safe.results.length && safe.results.every((item) => item.contentRating === 0)); sample = safe.results[0];
    assert.deepEqual(ids((await source.search({ page: 1 })).results), ids(baseline.results));
    const narrowContext = context([0]), broadContext = context([0, 1, 2, 3]);
    const concurrent = await Promise.all([source.search({ page: 1, context: narrowContext }), source.search({ page: 1, context: broadContext })]);
    assert(concurrent[0].results.every((item) => item.contentRating === 0 && item.context === narrowContext));
    assert(concurrent[1].results.every((item) => item.context === broadContext));
    assert.deepEqual(ids(concurrent[1].results), ids(baseline.results));
    const none = await source.search({ page: 1, context: context([]) });
    assert.equal(none.results.length, 0); assert.equal(none.isLastPage, true);
    assert.equal(requests.length, warm, 'Changed native policies lost reusable raw page caches');
    const exact = context([0, 2, 3]), row = await source.resolvePageSection({ id: 'home', context: exact }, 'latest');
    assert(row.items.length && row.items.every((item) => item.context === exact));
    assert.strictEqual(row.viewMoreLink.request.context, exact);
    await setting(source, false); assert.equal((await setting(freshSource())).value, false);
    await setting(source, true); assert.equal((await setting(freshSource())).value, true);
    await setting(source, false);
  });
  await check('Live native parsers map incomplete metadata to Mature and keep actual adult warnings Explicit', async () => {
    for (const adult of [false, true]) {
      const cold = freshSource(), original = cold.api.text.bind(cold.api);
      cold.api.text = async (...args) => {
        const $ = load(await original(...args));
        $('.mg_genres .summary-content a, .tab-summary .genres-content a').remove();
        $('.adult-content, .manga-adult, .adult-warning, [data-adult="1"], [data-adult="true"]').remove();
        if (adult) { $('.tab-summary').first().append('<span class="adult-warning"></span>'); $('.c-tabs-item__content').append('<span class="adult-warning"></span>'); }
        return $.html();
      };
      const details = await cold.getContent(sample.id, context([adult ? 3 : 2]));
      assert.equal(details.contentRating, adult ? 3 : 2);
      const markers = details.additionalInfo.filter((section) => section.id === 'content-rating-metadata');
      assert.equal(markers.length, adult ? 0 : 1);
      if (!adult) assert(markers[0].items.some((item) => /Incomplete metadata.*Mature compatibility fallback/.test(item.title)));
      assert.equal(details.webUrl, sample.webUrl);
      await assert.rejects(() => cold.getContent(sample.id, context([adult ? 2 : 0])), /Mana.*content-rating policy/);
      await assert.rejects(() => cold.getContent(sample.id, context([])), /Mana.*content-rating policy/);
    }
    const cold = freshSource(), details = await cold.getContent(sample.id, context([0]));
    await assert.rejects(() => cold.getContent(sample.id, context([3])), /Mana.*content-rating policy/);
    const chapters = await cold.getChapters(sample.id);
    assert(chapters.length);
    const reader = await cold.getChapterData(sample.id, chapters.at(-1).chapterId);
    await coverDimensions(cold, reader.pages[0].url);
    await coverDimensions(cold, details.cover);
  });
  await check('Native singleton ratings use only verified coarse source markers and never infer a Suggestive taxonomy', async () => {
    for (const [genre, expected] of [[null, 2], ['mature', 2], ['ecchi', 2], ['hentai', 3], ['smut', 3], ['erotica', 3]]) {
      const cold = freshSource(), original = cold.api.text.bind(cold.api);
      cold.api.text = async (...args) => {
        const $ = load(await original(...args));
        $('#navigation-ajax').remove();
        $('.c-tabs-item__content').each((_, node) => {
          const row = $(node); row.find('.mg_genres .summary-content').empty();
          row.find('.adult-content, .manga-adult, .adult-warning, [data-adult="1"], [data-adult="true"]').remove();
          if (genre) row.find('.mg_genres .summary-content').append(`<a href="${domain}/manga-genre/${genre}/">${genre}</a>`);
        });
        return $.html();
      };
      const result = await cold.search({ page: 1, context: context([expected]) });
      assert(result.results.length && result.isLastPage);
      assert(result.results.every((item) => item.contentRating === expected));
      for (const ratings of [[1], [expected === 2 ? 3 : 2], []]) {
        const none = await cold.search({ page: 1, context: context(ratings) });
        assert.equal(none.results.length, 0); assert.equal(none.isLastPage, true);
      }
    }
  });
  await check('Warm native search pages retain a newly observed adult warning instead of relabeling it Safe', async () => {
    const cold = freshSource(), initial = await cold.search({ page: 1 });
    const item = initial.results.find((item) => item.contentRating === 0);
    assert(item);
    const original = cold.api.text.bind(cold.api);
    cold.api.text = async (...args) => {
      const value = await original(...args);
      if (args[0] !== item.webUrl) return value;
      const $ = load(value); $('.tab-summary').first().append('<span class="adult-warning"></span>'); return $.html();
    };
    assert.equal((await cold.getContent(item.id, context([3]))).contentRating, 3);
    const safe = await cold.search({ page: 1, context: context([0]) });
    assert(!safe.results.some((row) => row.id === item.id));
    const all = await cold.search({ page: 1 });
    assert.equal(all.results.find((row) => row.id === item.id).contentRating, 3);
    await assert.rejects(() => cold.getContent(item.id, context([0])), /Mana.*content-rating policy/);
  });
  for (const mode of ['excluded-only', 'duplicate-only']) await check(`Native logical pagination passes ${mode} physical pages without losing later eligible IDs`, async () => {
    const cold = freshSource(), original = cold.api.text.bind(cold.api);
    let firstRows;
    cold.api.text = async (url, body) => {
      const value = await original(url, body), $ = load(value);
      if (body === undefined && url === `${domain}/?s=&post_type=wp-manga`) firstRows = $('.c-tabs-item__content').toArray().map((node) => $.html(node));
      if (body) {
        const page = Number(new URLSearchParams(body).get('page')) + 1;
        if (page === 2) {
          if (mode === 'excluded-only') $('.c-tabs-item__content').append('<span class="adult-warning"></span>');
          else $('.c-tabs-item__content').each((index, node) => $(node).replaceWith(firstRows[index % firstRows.length]));
        }
        if (page === 3) $.root().append('<span class="no-posts"></span>');
      }
      return $.html();
    };
    const first = await cold.search({ page: 1, context: context([0]) }), next = await cold.search({ page: 2, context: context([0]) });
    assert(first.results.length && next.results.length && next.isLastPage);
    assert(first.results.every((item) => item.contentRating === 0) && next.results.every((item) => item.contentRating === 0));
    const combined = [...ids(first.results), ...ids(next.results)]; assert.equal(new Set(combined).size, combined.length);
    const end = await cold.search({ page: 3, context: context([0]) }); assert.equal(end.results.length, 0); assert.equal(end.isLastPage, true);
    const warm = requests.length;
    assert.deepEqual(ids((await cold.search({ page: 2, context: context([0]) })).results), ids(next.results));
    assert.equal(requests.length, warm);
    if (mode === 'excluded-only') {
      const adult = await cold.search({ page: 1, context: context([3]) });
      assert(adult.results.length && adult.results.every((item) => item.contentRating === 3));
    }
  });
  await setting(source, true);
}

export async function testMangaSushi({ source, check, highlights, searchResult, image, requests, freshSource, nativeStore }) {
  await testMangaSushiNativeRatings({ source, check, requests, freshSource, nativeStore });
  const domain = 'https://mangasushi.org';
  const sample = 'welcome-to-the-cheap-restaurant-of-outcasts';
  const blockedTags = new Set(['adult', 'mature', 'smut', 'hentai', 'erotica', 'ecchi']);
  const preference = async (value) => {
    const field = (await source.getPreferenceMenu()).sections.flatMap((section) => section.children ?? []).find((item) => item.id === 'excludeNSFW');
    assert(field, 'Missing global NSFW setting');
    if (value !== undefined) await field.didChange(value);
    return field;
  };
  let catalog, safeContent, form, unfiltered, home, chapters, knownBlocked, coverEvidence;
  const homeIDs = {};
  await check('Explicitly saved NSFW exclusion uses native adult=0', async () => {
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
  await check('Popular, latest, search and detail covers use the largest advertised same-asset images', async () => {
    const cold = freshSource(), bodies = new Map(), original = cold.api.text.bind(cold.api);
    cold.api.text = async (url, ...args) => { const html = await original(url, ...args); bodies.set(url, html); return html; };
    const before = requests.length;
    const nativeHome = await cold.home(false);
    assert.equal(requests.length - before, 1, 'Cover selection adds no home metadata requests');
    const request = { page: 1, query: 'Hisabisa Ni Kenko', filters: { adult: { id: '0' } } };
    const searchURL = cold.searchURL(request, false);
    const search = await cold.search(request);
    assert.equal(requests.length - before, 2, 'Cover selection adds no search metadata requests');
    const id = 'hisabisa-ni-kenko-shindan-wo-uketara-saikyo-status-ni-natteita-tsuiho-sareta-ossan-boken-sha-imasara-eiyu-wo-mezasu';
    const detail = await cold.getContent(id);
    assert.equal(requests.length - before, 3, 'Cached search metadata avoids per-title cover lookups');
    coverEvidence = { home: bodies.get(`${domain}/`), search: bodies.get(searchURL), detail: bodies.get(`${domain}/manga/${id}/`), id };
    assert(coverEvidence.home && coverEvidence.search && coverEvidence.detail, 'Missing actual live cover provenance');
    const hp = load(coverEvidence.home), sp = load(coverEvidence.search), dp = load(coverEvidence.detail);
    const findImage = ($, selector, series) => $(selector).toArray().map((node) => $(node)).find((row) => row.find('.post-title a').attr('href') === `${domain}/manga/${series}/`)?.find('img').first();
    const homeSample = (selector, items) => {
      const row = hp(selector).toArray().map((node) => hp(node)).find((row) => row.find('img').first().attr('data-srcset'));
      assert(row, 'No live homepage sample advertises responsive covers');
      const series = row.find('.post-title a').attr('href').match(/\/manga\/([^/]+)/)[1];
      return [row.find('img').first(), items.find((item) => item.id === series)?.cover];
    };
    const samples = [
      homeSample('.popular-slider .slider__item', nativeHome.popular.items),
      homeSample('#loop-content .page-item-detail', nativeHome.latest.items),
      [findImage(sp, '.c-tabs-item__content', id), search.results.find((item) => item.id === id)?.cover],
      [dp('.summary_image img').first(), detail.cover]
    ];
    const decoded = new Map();
    const dimensions = (url) => { if (!decoded.has(url)) decoded.set(url, coverDimensions(source, url)); return decoded.get(url); };
    for (const [image, cover] of samples) {
      assert(image?.length && cover, 'Live largest-cover sample disappeared');
      const currentURL = image.attr('data-src') || image.attr('data-lazy-src') || image.attr('src');
      const asset = (url) => new URL(url).pathname.replace(/-\d+x\d+(\.[a-z0-9]+)$/i, '$1');
      const advertised = [image.attr('data-srcset'), image.attr('srcset')].filter(Boolean).join(',').split(',')
        .map((entry) => entry.trim().split(/\s+/)).filter(([url, descriptor]) => /^\d+w$/.test(descriptor ?? '') && asset(url) === asset(currentURL));
      assert(advertised.length, 'Live source stopped advertising same-asset cover widths');
      const [expected, descriptor] = advertised.sort((left, right) => parseInt(right[1]) - parseInt(left[1]))[0];
      assert.equal(cover, expected, 'Cover must be the largest URL actually advertised by this image');
      const current = await dimensions(currentURL), largest = await dimensions(cover);
      assert.equal(largest.width, parseInt(descriptor), 'Advertised largest width must match actual decoded pixels');
      assert(largest.width >= current.width && largest.height >= current.height, 'Selection must not downgrade real dimensions');
      assert(largest.bytes > 0);
    }
    assert(!/-\d+x\d+\.jpg$/.test(new URL(detail.cover).pathname), 'Hisabisa details must use its explicitly advertised original');
    assert.equal(detail.cover, search.results.find((item) => item.id === id)?.cover, 'Search and detail both retain the advertised full original');
    const largeRequest = { page: 1, query: 'Ochikobore Eji Minarai', filters: { adult: { id: '0' } } };
    const largeBefore = requests.length, largeSearch = await cold.search(largeRequest);
    const largeId = 'ochikobore-eji-minarai-no-shounen-jitsu-wa-saikyou-saiaku-no-asashin';
    const largeItem = largeSearch.results.find((item) => item.id === largeId);
    assert(largeItem, 'Published 640px original sample disappeared');
    const largeDetail = await cold.getContent(largeId);
    assert.equal(requests.length - largeBefore, 2, 'Large originals must not add metadata calls to search and detail');
    const largePage = load(bodies.get(cold.searchURL(largeRequest, false)));
    const largeImage = findImage(largePage, '.c-tabs-item__content', largeId);
    assert(largeImage.attr('data-srcset').split(',').some((entry) => entry.trim() === `${largeItem.cover} 640w`), '640px original must be explicitly advertised, not manufactured');
    assert.equal(largeDetail.cover, largeItem.cover);
    assert.equal((await dimensions(largeItem.cover)).width, 640, 'The former medium cap must not limit a real 640px PNG original');
  });
  await check('Cover fallbacks reject malformed or unrelated metadata and retain explicitly advertised originals', async () => {
    assert(coverEvidence, 'Live cover evidence was not captured');
    const originalHome = load(coverEvidence.home), first = originalHome('.popular-slider .slider__item').first();
    const id = first.find('.post-title a').attr('href').match(/\/manga\/([^/]+)/)[1];
    const image = first.find('img').first(), current = image.attr('data-src'), valid = image.attr('data-srcset');
    const unrelated = originalHome('.popular-slider .slider__item').eq(1).find('img').first().attr('data-srcset');
    const derivative = valid.split(',').map((entry) => entry.trim()).find((entry) => / 193w$/.test(entry));
    const sp = load(coverEvidence.search), searchRow = sp('.c-tabs-item__content').filter((_, node) => sp(node).find('.post-title a').attr('href') === `${domain}/manga/${coverEvidence.id}/`).first();
    const searchSet = searchRow.find('img').attr('data-srcset');
    const originalEntry = searchSet.split(',').map((entry) => entry.trim()).find((entry) => /\/hisabisa\.jpg 320w$/.test(entry));
    const originalURL = originalEntry?.split(/\s+/)[0];
    assert(valid && unrelated && derivative && originalEntry, 'Live mutation inputs changed');
    for (const [label, mutate, expected] of [
      ['absent', (img) => img.removeAttr('data-srcset').removeAttr('srcset'), current],
      ['malformed', (img) => img.attr('data-srcset', 'not-a-srcset, javascript:alert(1) 250w'), current],
      ['unrelated asset', (img) => img.attr('data-srcset', unrelated), current],
      ['descriptor mismatch', (img) => img.attr('data-srcset', derivative.replace(/193w$/, '250w')), current],
      ['different origin', (img) => img.attr('data-srcset', derivative.replace('mangasushi.org', 'example.com')), current],
      ['different query', (img) => img.attr('data-srcset', derivative.replace(/ 193w$/, '?unrelated=1 193w')), current],
      ['credentials', (img) => img.attr('data-srcset', derivative.replace('https://', 'https://user:pass@')), current],
      ['fragment', (img) => img.attr('data-srcset', derivative.replace(/ 193w$/, '#unrelated 193w')), current],
      ['unsafe width', (img) => img.attr('data-srcset', derivative.replace(/193w$/, '99999999999999999w')), current],
      ['different aspect ratio', (img) => img.attr('data-srcset', derivative.replace('193x278', '193x500')), current],
      ['slightly wider but shorter', (img) => img.attr('data-srcset', derivative.replace('193x278', '126x179').replace(/193w$/, '126w')), current],
      ['non-portrait image', (img) => img.attr('data-srcset', derivative.replace('193x278', '193x193')), current],
      ['different extension', (img) => img.attr('data-srcset', derivative.replace('.jpg', '.png')), current],
      ['srcset fallback', (img) => img.removeAttr('data-srcset').attr('srcset', valid), derivative.split(/\s+/)[0]],
      ['current original with no descriptor', (img) => img.attr('data-src', originalURL).attr('width', '1').attr('height', '1').attr('data-srcset', searchSet.split(',').filter((entry) => entry.trim() !== originalEntry).join(',')), originalURL],
      ['current original never downgraded', (img) => img.attr('data-src', originalURL).attr('data-srcset', searchSet), originalURL]
    ]) {
      const $ = load(coverEvidence.home), img = $('.popular-slider .slider__item').first().find('img').first();
      img.removeAttr('srcset'); mutate(img);
      const cold = freshSource(); cold.api.text = async () => $.html();
      assert.equal((await cold.home(false)).popular.items.find((item) => item.id === id)?.cover, expected, label);
    }
    for (const [label, srcset, expected] of [
      ['explicitly advertised original', originalEntry, originalURL],
      ['largest independent of srcset order', searchSet.split(',').reverse().join(','), originalURL],
      ['original wins equal-largest-width tie', `${searchSet.replace(/209x300/g, '320x459').replace(/209w/g, '320w')}`, originalURL],
      ['original absent is not manufactured', searchSet.split(',').filter((entry) => entry.trim() !== originalEntry).join(','), searchSet.split(',').map((entry) => entry.trim().split(/\s+/)).filter((entry) => entry[0] !== originalURL).sort((left, right) => parseInt(right[1]) - parseInt(left[1]))[0][0]]
    ]) {
      const $ = load(coverEvidence.search), row = $('.c-tabs-item__content').filter((_, node) => $(node).find('.post-title a').attr('href') === `${domain}/manga/${coverEvidence.id}/`).first();
      row.find('img').removeAttr('srcset').attr('data-srcset', srcset);
      const cold = freshSource(); cold.api.text = async () => $.html();
      assert.equal((await cold.search({ page: 1 })).results.find((item) => item.id === coverEvidence.id)?.cover, expected, label);
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
      const responsive = load(html);
      responsive('.wp-manga-chapter-img').first().attr('data-srcset', load(coverEvidence.home)('.popular-slider img').first().attr('data-srcset'));
      source.api.text = async () => responsive.html();
      const unchanged = await source.getChapterData(sample, 'chapter-66-1');
      assert.equal(unchanged.pages[0].url, load(html)('.wp-manga-chapter-img').first().attr('data-src')?.trim(), 'Cover srcsets must never change reader images');
      const cover = load(coverEvidence.home)('.popular-slider img').first();
      responsive('.wp-manga-chapter-img').first().attr('data-src', cover.attr('data-src')).attr('data-srcset', cover.attr('data-srcset'));
      source.api.text = async () => responsive.html();
      assert.equal((await source.getChapterData(sample, 'chapter-66-1')).pages[0].url, cover.attr('data-src'), 'Reader selection must retain literal data-src even when cover selection would choose a larger same-asset derivative');
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
  await check('Repeated provider pages stop within ten consecutive no-new-raw-ID reads', async () => {
    await preference(true);
    const cold = freshSource(), original = cold.api.text.bind(cold.api);
    let html, physicalReads = 0;
    try {
      cold.api.text = async (...args) => {
        physicalReads += 1;
        html ??= await original(...args);
        return html;
      };
      await cold.search({ page: 1 });
      await assert.rejects(cold.search({ page: 2 }), /provider repeated.*without new raw series IDs/i);
      assert.equal(physicalReads, 11, 'One initial page plus at most ten no-progress continuation reads');
      const bounded = physicalReads;
      await assert.rejects(cold.search({ page: 101 }), /Invalid MangaSushi page/i);
      assert.equal(physicalReads, bounded, 'The independent 100-page bound must reject before an outgoing request');
    } finally { cold.api.text = original; }
  });
  await preference(true);
}
