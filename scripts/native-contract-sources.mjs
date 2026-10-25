import { createHash, createDecipheriv } from 'node:crypto';
// Small source-specific seeds/oracles for the same native method contract.
// Oracles inspect consumed live responses only; they do not fetch reference copies.
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { decode } from 'html-entities';
const plain = value => JSON.parse(JSON.stringify(value));
const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const chapterIDs = chapters => Array.from(chapters, c => c.chapterId);
const qiPath = value => encodeURIComponent(value).replace(/[!'()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
const captured = (state, match) => {
  const values = state.transport.captures.filter(item => match(new URL(item.url)));
  assert(values.length, 'Missing the response consumed by the native method'); return values.at(-1);
};
const json = (state, match) => JSON.parse(captured(state, match).text);
const html = (state, match) => load(captured(state, match).text);
const methods = ['getSectionsForPage', 'resolvePageSection'];
const controls = ['getSearchForm', 'getSortOptions'];
const selectedGenres = filter => Array.from(Array.isArray(filter.genres) ? filter.genres : filter.genres.included, option => option.id);
const queryGenres = (key, separator) => (state, _result, filter) => {
  const requests = state.transport.requests.slice(state.filterRequestStart);
  assert(requests.some(request => {
    const parameters = new URL(request.url).searchParams;
    const sent = separator ? (parameters.get(key) ?? '').split(separator) : parameters.getAll(key);
    return selectedGenres(filter).every(id => sent.includes(id));
  }), 'Native filtered search did not transmit the selected source genre IDs');
};
function genre(state, fields, mode = 'multi') {
  const field = fields.find(item => item.id === 'genres');
  assert(field?.options?.length, 'Advertised genre filter has no native options');
  const matching = field.options.find(option => state.content.tags?.some(tag => tag.id === option.id));
  const option = matching ?? field.options.find(option => option.id);
  assert(option, 'Native genre filter has no selectable option');
  if (matching && !state.config.separateBrowseAndSearch) { state.filterQuery = state.content.title; state.filterExpectedID = state.id; }
  return { genres: mode === 'exclude' ? { included: [option] } : [option] };
}
function madara(host, sample) {
  return {
    sample, methods: [...methods, ...controls, 'getPreferenceMenu'], controls: true, documentLimit: 12,
    filter: genre, filtered: queryGenres('genre[]'),
    detail(state) {
      const expected = `https://${host}/manga/${state.id}/`, $ = html(state, url => url.href === expected);
      assert.equal(state.content.webUrl, expected);
      assert.equal($('link[rel="canonical"]').attr('href'), expected);
      // Optional source fields remain optional. Identity and nonempty title are not.
      const heading = norm($('.post-title h1').text());
      assert(heading, 'Source detail has no title');
      assert([heading, ...(state.content.additionalTitles ?? [])].includes(state.content.title) || state.content.title === heading, 'Native detail title lost source identity');
    },
    inventory(state) {
      const captures = state.transport.captures.filter(item => new URL(item.url).pathname === `/manga/${state.id}/ajax/chapters/`);
      assert(captures.length, 'Native AJAX inventory was not consumed');
      const pages = new Map(captures.map(item => [new URL(item.url).searchParams.get('t') ?? '1', item]));
      const ordered = [...pages].sort(([a], [b]) => Number(a) - Number(b)), expected = [], offered = new Set([1]);
      for (const [page, capture] of ordered) {
        const $ = load(capture.text), rows = $('.wp-manga-chapter > a'); assert(rows.length, 'Empty native inventory page');
        for (const node of rows.toArray()) {
          const url = new URL($(node).attr('href'));
          assert.equal(url.hostname, host); assert(url.pathname.startsWith(`/manga/${state.id}/`));
          expected.push(url.pathname.split('/').filter(Boolean).at(-1));
        }
        for (const node of $('.pagination a[data-page]').toArray()) offered.add(Number($(node).attr('data-page')));
        assert(Number.isSafeInteger(Number(page)) && Number(page) > 0);
      }
      assert([...offered].every(page => pages.has(String(page))), 'Native inventory omitted an advertised chapter page');
      assert.equal(new Set(expected).size, expected.length, 'Source inventory contains duplicate chapter IDs');
      assert.deepEqual(chapterIDs(state.chapters), expected.reverse(), 'Native chapter inventory/order differs from all consumed source rows');
    },
    reader(state) {
      const expected = `https://${host}/manga/${state.id}/${state.chapter.chapterId}/`, $ = html(state, url => url.href === expected);
      assert.equal($('link[rel="canonical"]').attr('href'), expected);
      assert.equal($('#wp-manga-current-chap').attr('value'), state.chapter.chapterId);
      const pages = $('.reading-content img.wp-manga-chapter-img').toArray().map(node => {
        const image = $(node); return norm(image.attr('data-src') || image.attr('data-lazy-src') || image.attr('src'));
      });
      assert.deepEqual(Array.from(state.reader.pages, page => page.url), pages, 'Native reader differs from complete source image order');
    },
  };
}
export const sourceContracts = {
  GourmetScans: {
    sample: 'tcit', chapter: 'chapter-12_1', section: 'manga',
    // One Discover + three search + two (detail, refreshed inventory, reader) + one filter = 11 documents.
    issuedImageOwnership: false, methods: [...methods, ...controls], controls: true, documentLimit: 11,
    filter(state, fields) {
      const option = fields.find(field => field.id === 'genres')?.options?.find(value => value.id === 'romance');
      assert(option, 'GourmetScans genre taxonomy lacks the seed genre');
      state.filterQuery = state.content.title; state.filterExpectedID = state.id;
      return { genres: option };
    },
    filtered(state, _result, filter) {
      assert(state.transport.requests.slice(state.filterRequestStart).some(request => new URL(request.url).searchParams.get('genre[]') === filter.genres.id), 'Native genre filter was not transmitted');
    },
    detail(state) {
      const expected = `https://gourmetsupremacy.com/project/${state.id}/`, $ = html(state, url => url.href === expected);
      assert.equal(state.content.webUrl, expected); assert.equal($('link[rel="canonical"]').attr('href'), expected);
      const heading = $('.post-title h1').first().clone(); heading.children().remove();
      assert.equal(state.content.title, norm(heading.text()));
      const genres = $('.tab-summary .genres-content a').toArray().map(a => [$(a).attr('href').split('/').filter(Boolean).at(-1), norm($(a).text())]);
      assert.deepEqual(Array.from(state.content.tags, tag => [tag.id, tag.title]), genres);
      const ids = genres.map(([id]) => id);
      const expectedRating = ids.some(id => ['smut', 'hentai', 'erotica'].includes(id)) ? 3 : ids.some(id => ['adult', 'mature'].includes(id)) ? 2 : 1;
      assert.equal(state.content.contentRating, expectedRating, 'Native rating differs from source metadata or documented unknown fallback');
    },
    inventory(state) {
      const $ = html(state, url => url.href === `https://gourmetsupremacy.com/project/${state.id}/`);
      const rows = $('.wp-manga-chapter').toArray(), ids = rows.map(node => $(node).children('a').first().attr('href').split('/').filter(Boolean).at(-1));
      const count = Number(norm($('.tab-summary .post-content_item').filter((_, node) => norm($(node).find('.summary-heading').text()) === 'Chapters').find('.summary-content').text()));
      assert.equal(rows.length, count); assert.equal(new Set(ids).size, count);
      const freeIDs = rows.filter(node => {
        const row = $(node);
        return !row.is('.premium, .locked, .paid, .login-required, .required-login, [data-price], [data-coin]') && !row.find('.fa-lock, .fa-user-lock, .ion-locked, .chapter-premium, .login-required, .required-login, [data-price], [data-coin]').length && !/(?:premium|locked|paid)/i.test(row.attr('class') ?? '');
      }).map(node => $(node).children('a').first().attr('href').split('/').filter(Boolean).at(-1));
      assert.deepEqual(chapterIDs(state.chapters), freeIDs.reverse(), 'Native inventory must include every free source chapter in chronological display order');
    },
    async reader(state) {
      const verify = state => {
      const expected = `https://gourmetsupremacy.com/project/${state.id}/${state.chapter.chapterId}/`, $ = html(state, url => url.href === expected);
      assert.equal($('link[rel="canonical"]').attr('href'), expected); assert.equal($('#wp-manga-current-chap').val(), state.chapter.chapterId);
      const script = $('script').toArray().map(node => $(node).text()).find(value => value.includes('var chapter_data='));
      assert(script, 'Missing consumed public reader envelope');
      const payload = JSON.parse(script.match(/var chapter_data='([^']+)';/)[1]);
      const nonce = script.match(/var wpmangaprotectornonce='([^']+)';/)[1];
      let block = Buffer.alloc(0), material = Buffer.alloc(0);
      while (material.length < 32) { block = createHash('md5').update(Buffer.concat([block, Buffer.from(nonce), Buffer.from(payload.s, 'hex')])).digest(); material = Buffer.concat([material, block]); }
      const cipher = createDecipheriv('aes-256-cbc', material.subarray(0, 32), Buffer.from(payload.iv, 'hex'));
      const pages = JSON.parse(JSON.parse(Buffer.concat([cipher.update(Buffer.from(payload.ct, 'base64')), cipher.final()]).toString('utf8')));
      assert.equal(pages.length, $('.reading-content .page-break[id^="chapter-img-"]').length);
      assert.deepEqual(Array.from(state.reader.pages, page => page.url), pages, 'Native crypto/reader manifest differs from independent Node decoder');
      };
      verify(state);
      // A second real consumed reader checks positional occurrences, not URL uniqueness.
      const id = 'the-struggle-of-being-reincarnated-as-the-marquesss-daughter-ill-deal-with-whats-coming-to-me-bahasa-indonesia';
      await state.source.getContent(id, state.context);
      const inventory = await state.source.getChapters(id);
      const chapter = inventory.find(item => item.chapterId === 'chapter-1');
      assert(chapter, 'Reader occurrence sample is absent from the validated free inventory');
      const reader = await state.source.getChapterData(id, chapter.chapterId, chapter);
      verify({ ...state, id, chapter, reader });
      console.log(`Gourmet occurrence oracle: ${reader.pages.length} ordered page occurrences`);
    },
  },
  GenzToons: {
    sample: 'senior-disciple-lee-hwe', chapter: 'chapter/6518be2bf4d-6519a16a0b5', methods: [...methods, 'getSearchForm'], controls: true, documentLimit: 8, imageLimit: 3,
    filter(state, fields) {
      const field = fields.find(item => item.id === 'genres'); assert(field);
      const tag = state.content.tags.find(item => field.options.some(option => option.id === item.id)); assert(tag, 'Detail genre has no native option');
      state.filterExpectedID = state.id;
      return { genres: { included: [tag], excluded: [] } };
    },
    filtered(state, result, filter) {
      const $ = html(state, url => url.href === 'https://genztoons.org/series');
      const selected = filter.genres.included.map(item => item.id.toLowerCase());
      const expected = $('#searched_series_page > button').toArray().filter(node => $(node).attr('data-type') !== 'novel').filter(node => {
        const labels = JSON.parse($(node).attr('tags') ?? '[]').map(value => value.toLowerCase());
        return selected.every(value => labels.includes(value));
      }).map(node => $(node).find('a').first().attr('href').slice(8, -1));
      assert.deepEqual(Array.from(result.results, item => item.id), expected, 'Genre search differs from complete provider catalog');
      assert.equal(result.isLastPage, true);
      const requests = state.transport.requests.slice(state.filterRequestStart);
      assert(requests.length <= 1 && requests.every(request => request.url === 'https://genztoons.org/series'), 'Genre filtering must not fetch per-title metadata');
    },
    detail(state) {
      const $ = html(state, url => url.href === `https://genztoons.org/series/${state.id}/`);
      assert.equal(state.content.webUrl, $('link[rel="canonical"]').attr('href'));
      assert.equal(state.content.title, norm($('h1').first().text()));
      const cover = $('[style*="--photoURL:url"]').first().attr('style').match(/url\(([^)]+)\)/)[1];
      assert.equal(state.content.cover, cover, 'Retain the exact provider cover URL');
      const catalog = html(state, url => url.href === 'https://genztoons.org/series');
      const expected = catalog('#searched_series_page > button').toArray().filter(node => catalog(node).attr('data-type') !== 'novel').map(node => catalog(node).find('a').first().attr('href').slice(8, -1));
      assert.deepEqual(Array.from(state.catalog.results, item => item.id), expected, 'Complete comic catalog with novels excluded');
    },
    inventory(state) {
      const $ = html(state, url => url.href === `https://genztoons.org/series/${state.id}/`);
      const expected = $('#chapters > a').toArray().filter(node => {
        const row = $(node);
        return !row.find('img[alt~="Coin"], img[src*="material-symbols:lock"]').length && !/upcoming/i.test(row.text());
      }).map(node => ({ id: $(node).attr('href').slice(1, -1), number: Number($(node).attr('title').match(/(\d+(?:\.\d+)?)/)[1]) })).sort((a, b) => a.number - b.number);
      assert.deepEqual(Array.from(state.chapters, chapter => [chapter.chapterId, chapter.number]), expected.map(row => [row.id, row.number]), 'Complete public chapter inventory and decimal order');
    },
    reader(state) {
      const $ = html(state, url => url.href === `https://genztoons.org/${state.chapter.chapterId}/`);
      assert.equal($('h1 a').first().attr('href'), `/series/${state.id}/`);
      assert.equal($('link[rel="canonical"]').attr('href'), state.chapter.webUrl);
      const pages = $('#pages > img').toArray().map((node, index) => {
        assert.equal($(node).attr('count'), String(index));
        return 'https://cdn.meowing.org/uploads/' + $(node).attr('uid');
      });
      assert.deepEqual(Array.from(state.reader.pages, page => page.url), pages, 'Complete source reader UID manifest');
    },
  },
  QiScans: {
    // Candidate identities come from saved genuine browser evidence and the
    // upstream PB route inspection, not a successful legacy-v1 native response.
    // This contract must remain unrun while the administrative denial persists.
    sample: '4190634673-eleceed', chapter: 'chapter-1', section: 'banners',
    issuedImageOwnership: false, separateBrowseAndSearch: true,
    methods: [...methods, ...controls], controls: true, documentLimit: 32,
    budgetReason: 'Complete v1 inventory at 30 rows/page plus discovery, search, metadata, reader and controls. The saved browser inventory has 404 rows (14 equivalent v1 pages), not a verified legacy count. Reader reuses only a complete short-lived inventory; budget exhaustion fails without truncation.',
    filter(_state, fields) {
      const option = fields.find(field => field.id === 'genres')?.options?.find(value => value.id);
      assert(option, 'QiScans native genre menu has no selectable source option');
      return { genres: option };
    },
    filtered(state, _result, filter) {
      const requests = state.transport.requests.slice(state.filterRequestStart);
      assert(requests.some(request => {
        const url = new URL(request.url);
        return url.origin === 'https://api.qimanhwa.com' && url.pathname === '/api/v1/series'
          && url.searchParams.get('genre') === filter.genres.id && !url.searchParams.has('q');
      }), 'Native QiScans filtered browse did not transmit the selected source genre slug');
    },
    detail(state) {
      const raw = json(state, url => url.origin === 'https://api.qimanhwa.com' && url.pathname === `/api/v1/series/${qiPath(state.id)}`);
      assert.equal(raw.slug, state.id); assert.equal(state.content.webUrl, `https://qimanhwa.com/series/${qiPath(raw.slug)}`);
      assert.equal(state.content.title, norm(decode(raw.title)));
      assert.equal(state.content.cover, raw.cover ? new URL(raw.cover, 'https://qimanhwa.com').href : '');
      assert.equal(state.content.contentRating, 1, 'Unclassified QiScans must retain its disclosed compatibility fallback, not Safe');
      assert.deepEqual(Array.from(state.content.additionalTitles ?? []), (raw.alternativeTitles || '').split(/, ?/).map(value => norm(decode(value))).filter(Boolean));
      if (raw.genres?.length) {
        const taxonomy = json(state, url => url.origin === 'https://api.qimanhwa.com' && url.pathname === '/api/v1/series/genres');
        const expected = raw.genres.map(genre => {
          const matches = taxonomy.filter(option => option.id === genre.id);
          return matches.length === 1 && matches[0].slug
            ? [matches[0].slug, norm(decode(matches[0].name)), false]
            : [String(genre.id), norm(decode(genre.name)), true];
        });
        assert.deepEqual(Array.from(state.content.tags ?? [], tag => [tag.id, tag.title, tag.isNonInteractive === true]), expected, 'Native genre chips must link to the consumed search taxonomy');
      }
    },
    inventory(state) {
      const captures = state.transport.captures.filter(item => {
        const url = new URL(item.url);
        return url.origin === 'https://api.qimanhwa.com' && url.pathname === `/api/v1/series/${qiPath(state.id)}/chapters`;
      });
      assert(captures.length, 'Native QiScans v1 inventory was not consumed');
      const rows = [], ids = new Set(); let total, pageCount;
      for (const [index, capture] of captures.entries()) {
        const url = new URL(capture.url), raw = JSON.parse(capture.text), page = index + 1;
        assert.equal(url.searchParams.get('page'), String(page));
        assert.equal(url.searchParams.get('perPage'), '30'); assert.equal(url.searchParams.get('sort'), 'desc');
        assert.equal(raw.current, page); assert(Array.isArray(raw.data));
        assert(Number.isSafeInteger(raw.totalItems) && raw.totalItems >= 0);
        assert(Number.isSafeInteger(raw.totalPages) && raw.totalPages >= 1);
        if (total !== undefined) assert.equal(raw.totalItems, total, 'QiScans source inventory changed during traversal');
        if (pageCount !== undefined) assert.equal(raw.totalPages, pageCount);
        total = raw.totalItems; pageCount = raw.totalPages;
        assert.equal(raw.next, page === pageCount ? null : page + 1);
        for (const row of raw.data) {
          assert(typeof row.slug === 'string' && row.slug.trim(), 'Source chapter slug is empty');
          assert(!ids.has(row.slug), 'Source v1 continuation repeated a chapter identity');
          ids.add(row.slug); rows.push(row);
        }
      }
      assert.equal(captures.length, pageCount, 'Native traversal omitted advertised v1 pages');
      assert.equal(rows.length, total, 'Native traversal omitted source chapter rows');
      const available = rows.filter(row => row.publishStatus === 'PUBLIC' && row.isFree === true && row.requiresPurchase === false && row.price === 0 && (row.discountedPrice == null || row.discountedPrice === 0))
        .sort((a, b) => a.number - b.number || Date.parse(a.createdAt) - Date.parse(b.createdAt));
      assert.deepEqual(Array.from(state.chapters, row => [row.chapterId, row.number]), available.map(row => [row.slug, row.number]), 'Native chapters must retain every public/free source slug and exact decimal number');
      assert.deepEqual(Array.from(state.chapters, row => row.webUrl), available.map(row => `https://qimanhwa.com/series/${qiPath(state.id)}/${qiPath(row.slug)}`));
    },
    reader(state) {
      const raw = json(state, url => url.origin === 'https://api.qimanhwa.com' && url.pathname === `/api/v1/series/${qiPath(state.id)}/chapters/${qiPath(state.chapter.chapterId)}`);
      assert.equal(raw.slug, state.chapter.chapterId); assert.equal(raw.number, state.chapter.number);
      if (raw.series) assert.equal(raw.series.slug, state.id);
      assert.equal(raw.publishStatus, 'PUBLIC'); assert.equal(raw.isFree, true); assert.equal(raw.requiresPurchase, false);
      assert.equal(raw.price, 0); assert(raw.discountedPrice == null || raw.discountedPrice === 0);
      assert(Array.isArray(raw.images) && raw.images.length > 0); assert.equal(raw.images.length, raw.totalImages);
      assert.equal(new Set(raw.images.map(image => image.order)).size, raw.images.length);
      assert(raw.images.every(image => Number.isSafeInteger(image.order) && image.order >= 0));
      const ordered = [...raw.images].sort((a, b) => a.order - b.order);
      assert.deepEqual(Array.from(state.reader.pages, page => page.url), ordered.map(image => new URL(image.url, 'https://qimanhwa.com').href), 'Native reader must preserve the complete source image manifest/order');
    },
  },
  Hijala: {
    sample: 'mimosa', chapter: 'chapter-56', issuedImageOwnership: false, methods: [...methods, ...controls, 'getPreferenceMenu'], controls: true, documentLimit: 12,
    // Observe this run's already-parsed native data. Never replace a response or source method result.
    observe(source, state) {
      const original = source.allowedDetail.bind(source);
      source.allowedDetail = async (...args) => { const value = await original(...args); state.hijala = plain(value); return value; };
    },
    filter: (state, fields) => genre(state, fields, 'exclude'), filtered: queryGenres('genreIds', ','),
    detail(state) {
      assert.equal(state.hijala?.post.slug, state.id); assert.equal(state.content.webUrl, `https://en-hijala.com/series/${state.id}`);
      assert.equal(state.content.cover, new URL(state.hijala.post.featuredImage, 'https://en-hijala.com').href);
    },
    inventory(state) {
      const { post, chapters } = state.hijala;
      assert.equal(chapters.length, post._count.chapters, 'Native complete source inventory count');
      const expected = chapters.filter(c => !(c.isLocked === true || c.isAccessible === false || (c.isAccessible !== true && (c.isLockedByCoins === true || c.isShortLinkLocked === true || c.isPermanentlyLocked || (c.price ?? 0) > 0))))
        .sort((a, b) => a.number - b.number || a.slug.localeCompare(b.slug)).map(c => c.slug);
      assert.deepEqual(chapterIDs(state.chapters), expected, 'Native inventory must retain every publicly readable source chapter');
    },
    reader(state) {
      const expected = `https://en-hijala.com/series/${state.id}/${state.chapter.chapterId}`;
      const $ = html(state, url => url.href === expected);
      assert.equal($('link[rel="canonical"]').attr('href'), expected, 'Native reader chapter identity differs from the source');
      const rows = $('img[data-reader-page-image="true"]').toArray();
      assert.deepEqual(rows.map(node => Number($(node).attr('data-reader-index'))), rows.map((_, index) => index), 'Source reader page indices are incomplete');
      assert.deepEqual(Array.from(state.reader.pages, page => page.url), rows.map(node => new URL($(node).attr('src'), expected).href), 'Native reader differs from complete source image order');
    },
  },
  Kagane: {
    reverseChapterIndices: true,
    sample: '019c2084-fa67-791d-8ba5-494744577445', methods: [...methods, ...controls, 'getPreferenceMenu'], controls: true,
    documentLimit: 20, budgetReason: 'Official native taxonomy, alternate editions or recommendations, the one-request chapter index, and reader integrity bootstrap.',
    filter: (state, fields) => genre(state, fields, 'exclude'),
    filtered(state, _result, filter) {
      const requests = state.transport.requests.slice(state.filterRequestStart).filter(request => new URL(request.url).pathname === '/api/v2/search/series');
      assert(requests.some(request => selectedGenres(filter).every(id => JSON.parse(request.body).genres?.values?.includes(id))), 'Native filtered search did not transmit the selected source genre IDs');
    },
    detail(state) {
      const raw = json(state, url => url.pathname === `/api/v2/series/${state.id}`);
      assert.equal(raw.series_id, state.id);
      assert.equal(state.content.webUrl, `https://kagane.org/series/${state.id}`);
      const cover = [...raw.series_covers].sort((a, b) => Number(b.is_main) - Number(a.is_main))[0];
      assert(cover?.image_id && state.content.cover.endsWith(`/api/v2/image/${cover.image_id}`), 'Native cover lost its source image identity');
    },
    inventory(state) {
      const index = json(state, url => url.pathname === `/api/v2/series/${state.id}/books/index` && url.searchParams.get('fields') === 'List'), column = index.fields.indexOf('book_id');
      assert(column >= 0 && index.books.length === index.count);
      // Each row is a column array named by `fields`.
      const books = new Map(index.books.map(row => [row[column], Object.fromEntries(index.fields.map((field, position) => [field, row[position]]))]));
      assert.equal(books.size, index.count, 'Native chapter index has duplicate IDs');
      const available = book => typeof book.available_at === 'number' ? book.available_at * 1000 : new Date(book.available_at).getTime();
      const readable = [...books.values()].filter(book => !book.is_locked && !book.requires_login && !book.is_paid && (!book.available_at || available(book) <= Date.now()))
        .sort((a, b) => (a.sort_no ?? 0) - (b.sort_no ?? 0)).reverse();
      assert.deepEqual(chapterIDs(state.chapters), readable.map(book => book.book_id), 'Native chapter identity/order differs from complete source inventory'); state.books = books;
    },
    reader(state) {
      const raw = state.books.get(state.chapter.chapterId);
      if (Number.isSafeInteger(raw.page_count) && raw.page_count > 0) assert.equal(state.reader.pages.length, raw.page_count, 'Native reader truncated advertised pages');
      const manifest = json(state, url => url.pathname === `/api/v2/books/${state.chapter.chapterId}`);
      const ordered = [...manifest.manifest.pages].sort((a, b) => a.page_no - b.page_no);
      assert.deepEqual(Array.from(state.reader.pages, page => new URL(page.url).pathname), ordered.map(page => `/api/v2/books/page/${state.chapter.chapterId}/${encodeURIComponent(page.page_id)}.${page.ext || 'jxl'}`), 'Native reader identity/order differs from the complete consumed manifest');
      for (const page of state.reader.pages) assert.equal(new URL(page.url).origin, new URL(manifest.cache_url || 'https://kagane.org').origin, 'Native reader changed the advertised image server');
    },
  },
  MangaTaro: {
    sample: 'eleceed', chapter: '1224', issuedImageOwnership: false, methods: [...methods, ...controls], controls: true, documentLimit: 12,
    filter(state, fields) {
      const option = (key, id) => { const value = fields.find(field => field.id === key)?.options?.find(item => item.id === id); assert(value, 'Missing live MangaTaro filter'); return value; };
      state.filterQuery = state.content.title; state.filterExpectedID = state.id;
      return { genres: [option('genres', '7')], years: [option('years', '2018')], types: [option('types', 'Manhwa')], statuses: [option('statuses', 'Ongoing')], genreMatchMode: option('genreMatchMode', 'all') };
    },
    filtered(state) {
      const requests = state.transport.requests.slice(state.filterRequestStart);
      const sent = requests.find(request => request.url === 'https://mangataro.org/wp-json/manga/v1/load'); assert(sent);
      assert.deepEqual(JSON.parse(sent.body), { page: 1, search: state.content.title, years: '[2018]', genres: '[7]', types: '["Manhwa"]', statuses: '["Ongoing"]', sort: 'post_desc', genreMatchMode: 'all' });
    },
    detail(state) {
      const expected = `https://mangataro.org/manga/${state.id}`, $ = html(state, url => url.href === expected);
      assert.equal(state.content.webUrl, expected); assert.equal($('link[rel="canonical"]').attr('href'), expected);
      assert.equal(state.content.title, norm($('h1').last().text()));
      assert.equal(state.content.cover, $('button[data-manga-cover]').first().attr('data-manga-cover'));
      assert.equal(norm(state.content.summary), norm($('#description-content-tab').text()), 'Native summary must preserve complete source description');
      assert.equal(state.content.contentRating, 1, 'Unclassified Eleceed must use explicit Suggestive compatibility, not Safe');
    },
    inventory(state) {
      const captures = state.transport.captures.filter(item => new URL(item.url).pathname === '/auth/manga-chapters');
      assert(captures.length, 'Native public chapter inventory was not consumed');
      const responses = captures.map(item => JSON.parse(item.text)).sort((a, b) => a.offset - b.offset);
      const rows = []; for (const response of responses) { assert.equal(response.success, true); assert.equal(response.offset, rows.length); rows.push(...response.chapters); }
      assert.equal(responses.at(-1).has_more, false); assert.equal(rows.length, responses.at(-1).total);
      const media = rows.filter(item => item.chapter_type === 'media' && !item.locked && !item.is_locked && !item.requires_login && !(Number(item.price) > 0)).reverse();
      assert.deepEqual(chapterIDs(state.chapters), media.map(item => item.id), 'Native chapter inventory must retain every public media identity in source order');
      assert.deepEqual(Array.from(state.chapters, item => item.webUrl), media.map(item => item.url));
    },
    reader(state) {
      const raw = json(state, url => url.pathname === '/auth/chapter-content' && url.searchParams.get('chapter_id') === state.chapter.chapterId);
      assert.equal(raw.success, true); assert.equal(String(raw.chapter_id), state.chapter.chapterId); assert.equal(raw.chapter_type, 'media');
      assert.equal(raw.images.length, raw.total); assert.deepEqual(Array.from(state.reader.pages, page => page.url), raw.images, 'Native reader must preserve the complete source image manifest');
    },
  },
  MangaSushi: madara('mangasushi.org', 'welcome-to-the-cheap-restaurant-of-outcasts'),
  ManhwaNex: madara('manhwanex.com', 'logging-10000-years-into-the-future'),
  MangaStash: {
    sample: 'ayashimon', chapter: 'ayashimon/chapter-1', separateBrowseAndSearch: true, methods: [...methods, ...controls, 'getPreferenceMenu'], controls: true, documentLimit: 12,
    diagnoseFailure(state, label, captures) {
      const home = label === 'Native discovery schema and representative section';
      const reader = label === 'Native reader identity, ordered manifest and first/last image bytes';
      if (!home && !reader) return;
      const expected = home ? 'https://mangastash.org/' : `https://mangastash.org/${state.chapter?.chapterId}`;
      const response = captures.filter(item => item.url === expected && item.responseURL === expected && item.status === 200).at(-1);
      if (!response) { console.log(`MangaStash diagnostic: ${home ? 'home' : 'reader'} has no exact successful consumed response`); return; }
      const $ = load(response.text), count = nodes => Math.min(nodes.length, 1000);
      if (home) {
        // Only bounded public navigation labels and DOM markers are retained;
        // no story body, headers, cookies, scripts or raw provider exceptions.
        const marker = node => ({ tag: /^[a-z][a-z0-9-]{0,39}$/.test(node.tagName ?? '') ? node.tagName : '<other>', id: ($(node).attr('id') ?? '').slice(0, 80), class: ($(node).attr('class') ?? '').slice(0, 120) });
        const sections = $('section.home-section');
        const headings = sections.slice(0, 12).toArray().map(node => {
          const titles = $(node).find('h2.section-title'), title = norm(titles.first().text());
          return { titleCount: count(titles), title: title.slice(0, 96), ...marker(node),
            children: $(node).children().slice(0, 12).toArray().map(marker),
            cards: count($(node).find('.series-card')), updates: count($(node).find('.update-row')) };
        });
        console.log(`MangaStash home shape: ${JSON.stringify({ sections: count(sections), headings })}`);
      } else {
        const expectedSeries = `https://mangastash.org/${state.id}/`;
        const identity = (value, target) => {
          if (value === undefined) return 'missing';
          if (!value) return 'empty';
          try {
            const url = new URL(value, 'https://mangastash.org');
            if (url.href === target) return value === value.trim() ? 'exact-resolved' : 'whitespace-resolved';
            return url.origin === 'https://mangastash.org' ? 'different-same-origin' : 'other-origin';
          } catch { return 'invalid'; }
        };
        const back = $('.reader-back'), selected = $('.chapter-select option[selected]'), options = $('.chapter-select option');
        const marker = node => ({ tag: /^[a-z][a-z0-9-]{0,39}$/.test(node.tagName ?? '') ? node.tagName : '<other>', id: ($(node).attr('id') ?? '').slice(0, 80), class: ($(node).attr('class') ?? '').slice(0, 120) });
        const ownerAnchors = $('a[href]').filter((_, node) => identity($(node).attr('href'), expectedSeries) === 'exact-resolved');
        const chapterAnchors = $('a[href]').filter((_, node) => identity($(node).attr('href'), expected) === 'exact-resolved');
        const article = $('script[type="application/ld+json"]').toArray().flatMap(node => { try { const value = JSON.parse($(node).html() ?? ''); return value['@type'] === 'Article' ? [value] : []; } catch { return []; } });
        console.log(`MangaStash reader shape: ${JSON.stringify({ readers: count($('.reader')), backCount: count(back), back: identity(back.attr('href'), expectedSeries),
          selectedCount: count(selected), selected: identity(selected.attr('value'), expected), options: count(options),
          matchingOptions: count(options.filter((_, node) => identity($(node).attr('value'), expected) === 'exact-resolved')),
          canonicalCount: count($('link[rel="canonical"]')), canonical: identity($('link[rel="canonical"]').attr('href'), expected),
          pageContainers: count($('#reader-pages > .reader-page')),
          ownerAnchors: ownerAnchors.slice(0, 12).toArray().map(marker), chapterAnchors: chapterAnchors.slice(0, 12).toArray().map(marker),
          navigation: $('.reader').children().slice(0, 12).toArray().map(node => ({ ...marker(node), children: $(node).children().slice(0, 12).toArray().map(marker) })),
          selects: $('select').slice(0, 12).toArray().map(node => ({ ...marker(node), options: count($(node).find('option')), selected: count($(node).find('option[selected]')) })),
          articleCount: article.length, articleURL: article[0]?.url === expected, articleID: article[0]?.['@id'] === expected,
          articleOwner: article[0]?.isPartOf?.url === expectedSeries, articleOwnerTitle: article[0]?.isPartOf?.name === state.content.title,
          headingCount: count($('.reader-chapter-title')), headingMatchesArticle: norm($('.reader-chapter-title').text()) === article[0]?.headline,
          configScripts: count($('script:not([src])').filter((_, node) => /\bconst\s+readerConfig\s*=/.test($(node).html() ?? ''))) })}`);
      }
    },
    filter: genre, filtered: queryGenres('genre[]'),
    detail(state) {
      const $ = html(state, url => url.href === `https://mangastash.org/${state.id}/`);
      assert.equal(state.content.webUrl, `https://mangastash.org/${state.id}/`);
      assert.equal(state.content.title, norm($('.series-meta h1').text()));
      assert.equal(state.content.cover, $('meta[property="og:image"]').attr('content'));
    },
    inventory(state) {
      const $ = html(state, url => url.href === `https://mangastash.org/${state.id}/`), rows = $('#chapter-list > .chapter-row').toArray();
      const count = norm($('.cl-toolbar h2').text()).match(/^Chapters \((\d+)\)$/); assert(count);
      assert.equal(rows.length, Number(count[1]), 'Complete source inventory count');
      const expected = rows.filter(node => {
        const row = $(node); return !row.is('.locked,.chapter-locked,[data-locked="true"],[aria-disabled="true"]') && !row.find('.locked,.chapter-locked,.chapter-lock').length
          && !/locked|premium|log ?in|sign ?in|unlock|members only|subscription/i.test(norm(row.find('.chapter-meta').text()));
      }).map(node => new URL($(node).attr('href'), 'https://mangastash.org').pathname.slice(1));
      assert.deepEqual(chapterIDs(state.chapters), expected, 'Native inventory/order differs from complete source rows');
    },
    reader(state) {
      const $ = html(state, url => url.href === `https://mangastash.org/${state.chapter.chapterId}`);
      assert.equal($('.chapter-select option[selected]').attr('value'), `/${state.chapter.chapterId}`);
      const pages = $('#reader-pages > .reader-page .reader-page-inner > img').toArray().map(node => new URL($(node).attr('data-src') || $(node).attr('src'), 'https://mangastash.org').href);
      assert.deepEqual(Array.from(state.reader.pages, page => page.url), pages, 'Native reader differs from complete source image order');
    },
  },
  Marumaru: {
    sample: '17155', query: '라멘 아카네코', methods, controls: false, documentLimit: 12,
    imageLimit: 4,
    budgetReason: 'Up to four measured image transfers: a native cover challenge, one exact title-page browser cover capture, and the first/last direct reader images. Failed attempts count; no repeated challenge resolution or substitute cover is allowed.',
    detail(state) {
      const raw = json(state, url => url.pathname === `/api/works/${state.id}`); assert.equal(String(raw.work.id), state.id);
      assert.equal(state.content.title, raw.work.title); assert.equal(state.content.webUrl, `https://marumaru105.com/manhwa/${state.id}`);
      assert.equal(state.content.cover, raw.work.thumbUrl || raw.work.coverUrl);
    },
    inventory(state) {
      const raw = json(state, url => url.hostname === 'api.storagewebtoon.store' && url.pathname.endsWith(`/works/${state.id}`));
      assert.equal(raw.ok, true); assert.equal(String(raw.item.id), state.id); assert.equal(raw.episodes.length, raw.item.episode_count);
      const expected = raw.episodes.filter(c => c.ready !== false).sort((a, b) => a.number - b.number);
      assert.deepEqual(Array.from(state.chapters, c => [c.chapterId, c.number]), expected.map(c => [String(c.id), c.number]), 'Native inventory must include every available source episode');
    },
    reader(state) {
      const raw = json(state, url => url.hostname === 'api.storagewebtoon.store' && url.pathname.endsWith(`/episodes/${state.chapter.chapterId}`));
      assert.equal(raw.ok, true); assert.equal(String(raw.item.work_id), state.id); assert.equal(String(raw.item.id), state.chapter.chapterId);
      assert.deepEqual(Array.from(state.reader.pages, page => page.url), raw.item.body.map(page => page.url), 'Native reader must preserve the complete source image order');
    },
  },
  VortexScans: {
    sample: '619:the-ancient-sovereign-of-eternity',
    issuedImageOwnership: false,
    methods: [...methods, ...controls], controls: true, documentLimit: 12,
    filter: (state, fields) => genre(state, fields, 'exclude'), filtered: queryGenres('genreIds', ','),
    detail(state) {
      const raw = json(state, url => url.pathname === '/api/post' && url.searchParams.get('postId') === state.id.split(':')[0]).post;
      // Vortex IDs and series paths use RFC 3986 escaping, including apostrophes.
      const slug = encodeURIComponent(raw.slug).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
      assert.equal(`${raw.id}:${slug}`, state.id); assert.equal(state.content.title, raw.postTitle);
      assert.equal(state.content.cover, raw.featuredImage); assert.equal(state.content.webUrl, `https://vortexscans.org/series/${slug}`);
    },
    inventory(state) {
      const captures = state.transport.captures.filter(item => {
        const url = new URL(item.url);
        return url.origin === 'https://api.vortexscans.org' && url.pathname === '/api/chapters' && url.searchParams.get('postId') === state.id.split(':')[0];
      });
      assert(captures.length > 0 && captures.length <= 20, 'Missing or unbounded native chapter inventory');
      const byID = new Map(); let offset = 0, total, lastCount, take;
      for (const capture of captures) {
        const url = new URL(capture.url), raw = JSON.parse(capture.text), rows = raw.post?.chapters;
        assert.equal(url.searchParams.get('skip'), String(offset)); assert.equal(url.searchParams.get('order'), 'desc');
        take = Number(url.searchParams.get('take')); assert(Number.isSafeInteger(take) && take > 0);
        assert(Array.isArray(rows) && rows.length <= take);
        if (raw.totalChapterCount !== undefined) {
          assert(Number.isSafeInteger(raw.totalChapterCount) && raw.totalChapterCount >= 0);
          if (total !== undefined) assert.equal(raw.totalChapterCount, total, 'Source total changed during inventory');
          total = raw.totalChapterCount;
        }
        const before = byID.size;
        for (const chapter of rows) {
          assert(Number.isSafeInteger(chapter.id) && chapter.id > 0);
          if (chapter.mangaPostId !== undefined) assert.equal(String(chapter.mangaPostId), state.id.split(':')[0]);
          if (byID.has(chapter.id)) assert.deepEqual(chapter, byID.get(chapter.id), 'Overlapping chapter identity changed');
          byID.set(chapter.id, chapter);
        }
        assert(rows.length === 0 || byID.size > before, 'Source chapter page repeated without progress');
        offset += rows.length; lastCount = rows.length;
      }
      const chapters = [...byID.values()];
      if (total !== undefined) assert.equal(chapters.length, total, 'Native inventory truncated source total');
      else assert(lastCount < take, 'A saturated source chapter page without a total is not a proven complete inventory');
      const expected = chapters.filter(c => !c.isLocked && c.isAccessible !== false && !c.isTimeLocked && !c.isShortLinkLocked && !c.isPermanentlyLocked && !(Number(c.price) > 0 && c.isPurchased !== true && c.hasPurchased !== true))
        .sort((a, b) => Number.parseFloat(a.number) - Number.parseFloat(b.number) || new Date(a.createdAt) - new Date(b.createdAt));
      assert.deepEqual(chapterIDs(state.chapters), expected.map(c => String(c.id)), 'Native inventory/order differs from complete source chapters');
    },
    reader(state) {
      const raw = json(state, url => url.pathname === '/api/chapter' && url.searchParams.get('chapterId') === state.chapter.chapterId).chapter;
      assert.equal(String(raw.id), state.chapter.chapterId); assert.equal(String(raw.mangaPostId), state.id.split(':')[0]);
      const position = image => {
        const filename = new URL(image.url.replace(/ /g, '%20')).pathname.split('/').at(-1);
        return Number(filename.match(/page[-_ ]*0*(\d+)/i)?.[1] ?? filename.match(/0*(\d+)/)?.[1] ?? Number.MAX_SAFE_INTEGER);
      };
      const ordered = [...raw.images].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || position(a) - position(b));
      assert.deepEqual(Array.from(state.reader.pages, page => page.url), ordered.map(image => image.url.replace(/ /g, '%20')), 'Native reader differs from the complete source image order');
    },
  },
};
