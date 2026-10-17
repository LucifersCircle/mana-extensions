// Shared live contract for the installed @mana-app/types API, not a source mock.
// A test is one app capability. Provider-wide/style/regression sweeps remain local.
import assert from 'node:assert/strict';
import { fetchTestImage, withSourceTransport, authorizeTestImage } from './mana-test-images.mjs';
import { verifyRasterImageBytes } from './mana-test-image-bytes.mjs';
import { sourceContracts } from './native-contract-sources.mjs';

export const text = (value, label) => assert(typeof value === 'string' && value.trim(), `${label} is empty`);
export function httpURL(value) {
  text(value, 'URL'); const url = new URL(value);
  assert(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, 'Invalid public HTTP URL');
}
const ids = items => Array.from(items, item => item.id);
export function highlights(items, context) {
  assert(Array.isArray(items) && items.length, 'Native operation returned no highlights');
  assert.equal(new Set(ids(items)).size, items.length, 'Duplicate native content IDs');
  for (const item of items) {
    text(item.id, 'Content ID'); text(item.title, 'Content title'); httpURL(item.cover);
    if (item.webUrl !== undefined) httpURL(item.webUrl);
    if (item.contentRating !== undefined) assert([0, 1, 2, 3].includes(item.contentRating), 'Invalid native content rating');
    if (item.context !== undefined) assert.equal(item.context, context, 'Native context reference changed');
  }
}
function searchResult(value, context) {
  highlights(value?.results, context); assert.equal(typeof value.isLastPage, 'boolean', 'Missing native pagination state');
}
function formFields(form) {
  assert(Array.isArray(form?.sections), 'Native form has no sections');
  const fields = [];
  const visit = (items, depth = 0) => {
    assert(depth <= 4 && Array.isArray(items), 'Invalid native form tree');
    for (const field of items) {
      if (field.kind === 'group') { visit(field.children, depth + 1); continue; }
      text(field.id, 'Form field ID'); text(field.title, 'Form field title');
      fields.push(field);
      if (field.options !== undefined) {
        assert(Array.isArray(field.options), 'Invalid native field options');
        assert.equal(new Set(ids(field.options)).size, field.options.length, 'Duplicate native option IDs');
        for (const option of field.options) { assert.equal(typeof option.id, 'string'); text(option.title, 'Option title'); }
      }
    }
  };
  for (const section of form.sections) {
    if (section.children !== undefined) visit(section.children);
    if (section.field !== undefined) visit([section.field]);
  }
  assert.equal(new Set(ids(fields)).size, fields.length, 'Duplicate native form field IDs');
  return fields;
}

// Count every SDK transport attempt, even failures. No response cache disguises
// repeated native requests. Only method outputs and native source caches are reused.
export function createContractTransport(fetchImpl, { documentLimit = 12, imageLimit = 3 } = {}) {
  const captures = [], requests = [], imageURLs = new Set();
  let documents = 0, images = 0, captureBytes = 0, blocked = 0;
  return {
    captures, requests, imageURLs,
    stats: () => ({ documents, images, documentLimit, imageLimit, blocked }),
    async fetch(input, init = {}) {
      const url = String(input), image = imageURLs.has(url);
      if ((image ? images >= imageLimit : documents >= documentLimit)) {
        blocked++;
        throw new Error(`Native request budget exceeded (${image ? imageLimit + ' images' : documentLimit + ' documents'}); inventory was not truncated`);
      }
      if (image) images++; else documents++;
      const request = { url, method: init.method ?? 'GET', body: init.body, image, status: undefined };
      requests.push(request);
      const response = await fetchImpl(input, init); request.status = response.status;
      if (!image && response.ok) {
        const copy = response.clone(), reader = copy.body?.getReader(), parts = [];
        let size = 0, reads = 0;
        try {
          if (reader) for (;;) {
            assert(++reads <= 16384, 'Native consumed-response capture read limit exceeded');
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            assert(size <= 16 * 1024 * 1024 && captureBytes + value.byteLength <= 64 * 1024 * 1024, 'Native consumed-response capture size budget exceeded');
            // Reserve bytes before yielding so concurrent native responses share
            // one real aggregate limit rather than each borrowing the remainder.
            captureBytes += value.byteLength;
            parts.push(Buffer.from(value));
          }
          captures.push({ ...request, responseURL: response.url, text: Buffer.concat(parts).toString('utf8') });
        } catch (error) {
          // Cancel both tee branches. Awaiting only the clone's cancellation can
          // deadlock while the unconsumed SDK branch is still open.
          void reader?.cancel(error).catch(() => {});
          void response.body?.cancel(error).catch(() => {});
          throw error;
        } finally { reader?.releaseLock(); }
      }
      return response;
    },
  };
}

async function image(source, url, origin, transport) {
  transport.imageURLs.add(url);
  const response = await fetchTestImage(source, url, { origin, fetchImpl: transport.fetch });
  assert.equal(response.status, 200, 'Native image HTTP status');
  assert.equal(response.requestedImageURL, url, 'Native image identity changed');
  assert.equal(response.url, url, 'Native image redirected to another resource');
  const mime = response.headers.get('content-type')?.split(';')[0].toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(bytes.length > 0 && bytes.length <= 16 * 1024 * 1024, 'Invalid native image body size');
  const length = response.headers.get('content-length'), encoding = response.headers.get('content-encoding');
  if (length && (!encoding || encoding === 'identity')) {
    assert(/^\d+$/.test(length)); assert.equal(bytes.length, Number(length), 'Incomplete native image transfer');
  }
  assert(mime?.startsWith('image/') || (origin === 'cover' && ['Marumaru', 'VortexScans'].includes(source.info.id) && mime === 'application/octet-stream'), 'Native image MIME is unsupported');
  // Full PNG/JPEG/WebP container and dimension validation, not a header-only
  // success. Other formats remain unverified until the host can validate them.
  const { format } = verifyRasterImageBytes(bytes);
  console.log(`IMAGE ${origin}: ${format}, ${bytes.length} complete bytes`);
}

export async function testNativeContract({ name, source, manifestEntry, check, notApplicable, transport }) {
  const config = sourceContracts[name];
  assert(config, `No native contract configuration for ${name}`);
  const context = { allowedContentRatings: [0, 1, 2, 3] }, state = { source, transport, context, config };
  config.observe?.(source, state);
  const missing = (capability, reason) => { notApplicable.push({ capability, reason }); console.log(`N/A ${name}: ${capability}: ${reason}`); };
  await check('Native initialization and advertised capabilities', async () => {
    assert.equal(source.info.id, name); text(source.info.version, 'Source version');
    assert.equal(source.info.version, manifestEntry.version); httpURL(source.info.website);
    for (const method of ['search', 'getContent', 'getChapters', 'getChapterData', 'getCoverTransport', 'getPageTransport', ...config.methods])
      assert.equal(typeof source[method], 'function', `Missing native ${method}`);
    if (source.onEnvironmentLoaded) await source.onEnvironmentLoaded();
  });
  await check('Native discovery schema and representative section', async () => {
    assert.equal(typeof source.getSectionsForPage, 'function'); assert.equal(typeof source.resolvePageSection, 'function');
    const link = { id: 'home', context }, sections = await source.getSectionsForPage(link);
    assert(Array.isArray(sections) && sections.length, 'Native discovery has no sections');
    assert.equal(new Set(ids(sections)).size, sections.length, 'Duplicate native section IDs');
    for (const section of sections) { text(section.id, 'Section ID'); text(section.title, 'Section title'); assert(Number.isInteger(section.style), 'Invalid native section style'); }
    if (source.willResolveSectionsForPage) await source.willResolveSectionsForPage(link);
    const section = config.section ? sections.find(item => item.id === config.section) : sections[0];
    assert(section, 'Representative native section is unavailable');
    const resolved = await source.resolvePageSection(link, section.id); highlights(resolved?.items, context);
    state.discovery = resolved;
  });
  await check('Native catalog search and offered continuation', async () => {
    const catalog = await source.search({ page: 1, context }); searchResult(catalog, context); state.catalog = catalog;
    if (!catalog.isLastPage) {
      const next = await source.search({ page: 2, context }); searchResult(next, context);
      const old = new Set(ids(catalog.results)); assert(next.results.some(item => !old.has(item.id)), 'Native continuation repeats page one');
    } else missing('search continuation', 'The sampled native catalog explicitly ends on page one');
    const item = catalog.results[0];
    const found = await source.search({ page: 1, query: item.title, context }); searchResult(found, context);
    assert(found.results.some(result => result.id === item.id), 'Native title search lost the exact catalog ID');
  });
  await check('Native details identity, metadata and complete cover bytes', async () => {
    const id = config.sample ?? state.catalog?.results[0]?.id; text(id, 'Sample ID'); state.id = id;
    const content = await source.getContent(id, context); state.content = content;
    text(content.title, 'Detail title'); httpURL(content.cover); httpURL(content.webUrl);
    if (content.contentRating !== undefined) assert([0, 1, 2, 3].includes(content.contentRating), 'Invalid detail content rating');
    if (content.tags !== undefined) { assert(Array.isArray(content.tags)); for (const tag of content.tags) { text(tag.id, 'Tag ID'); text(tag.title, 'Tag title'); } }
    await config.detail?.(state);
    await image(source, content.cover, 'cover', transport);
    if (source.handleURL) {
      const link = await source.handleURL(content.webUrl);
      assert.equal(link?.content?.id, id, 'Native deep link changed the selected content identity');
    } else missing('deep links', 'No native handleURL method is advertised');
  });
  await check('Native complete chapter inventory, identity and ordering', async () => {
    assert(state.content, 'Native details prerequisite failed');
    const chapters = await source.getChapters(state.id); state.chapters = chapters;
    assert(Array.isArray(chapters) && chapters.length, 'Native sample has no readable chapters');
    assert.equal(new Set(Array.from(chapters, chapter => chapter.chapterId)).size, chapters.length, 'Duplicate native chapter IDs');
    assert.deepEqual(Array.from(chapters, chapter => chapter.index), Array.from({ length: chapters.length }, (_, i) => config.reverseChapterIndices ? chapters.length - 1 - i : i), 'Native chapter indices do not follow their source-ordered identities');
    for (const chapter of chapters) {
      text(chapter.chapterId, 'Chapter ID'); assert(Number.isFinite(chapter.number), 'Invalid chapter number'); text(chapter.language, 'Chapter language');
      assert(Number.isFinite(Date.prototype.getTime.call(chapter.date)), 'Invalid native Date object');
      if (chapter.webUrl !== undefined) httpURL(chapter.webUrl);
    }
    if (state.content.chapters) assert.deepEqual(Array.from(chapters, c => [c.chapterId, c.number, c.index]), Array.from(state.content.chapters, c => [c.chapterId, c.number, c.index]), 'Native detail/refresh inventories disagree');
    await config.inventory(state);
  });
  await check('Native reader identity, ordered manifest and first/last image bytes', async () => {
    assert(state.chapters?.length, 'Native inventory prerequisite failed');
    const chapter = config.chapter ? state.chapters.find(item => item.chapterId === config.chapter) : state.chapters[0];
    assert(chapter, 'Selected native chapter is not in validated inventory'); state.chapter = chapter;
    const reader = await source.getChapterData(state.id, chapter.chapterId, chapter); state.reader = reader;
    assert(Array.isArray(reader?.pages) && reader.pages.length, 'Native comic reader has no image pages');
    const pages = Array.from(reader.pages, page => page.url);
    assert.equal(new Set(pages).size, pages.length, 'Duplicate native reader pages'); pages.forEach(httpURL);
    await config.reader?.(state);
    for (const url of new Set([pages[0], pages.at(-1)])) await image(source, url, 'page', transport);
  });
  if (config.controls) {
    await check('Native advertised controls and representative filtered search', async () => {
      assert(state.content, 'Native details prerequisite failed');
      const fields = source.getSearchForm ? formFields(await source.getSearchForm()) : [];
      if (!source.getSearchForm) missing('advanced search form', 'Not advertised by this source');
      if (source.getPreferenceMenu) formFields(await source.getPreferenceMenu());
      else missing('preferences', 'Not advertised by this source');
      if (source.getSortOptions) {
        const sorts = await source.getSortOptions(); assert(Array.isArray(sorts) && sorts.length); assert.equal(new Set(ids(sorts)).size, sorts.length);
        for (const sort of sorts) { assert.equal(typeof sort.id, 'string'); text(sort.title, 'Sort title'); }
      } else missing('sorting', 'Not advertised by this source');
      const filter = await config.filter(state, fields);
      if (source.validateSearchForm) assert.equal((await source.validateSearchForm({ filters: filter })).valid, true, 'Valid native form rejected');
      state.filterRequestStart = transport.requests.length;
      const result = await source.search({ page: 1, ...(state.filterQuery ? { query: state.filterQuery } : {}), filters: filter, context }); searchResult(result, context);
      if (state.filterExpectedID) assert(result.results.some(item => item.id === state.filterExpectedID), 'Native filtered search lost its selected identity');
      await config.filtered?.(state, result, filter);
    });
  } else {
    missing('settings/filter/sort controls', 'Source advertises none');

  }
  await check('Native policy and image-origin guards fail before network', async () => {
    let attempts = 0;
    const forbidden = async () => { attempts++; throw new Error('Native guard unexpectedly attempted provider I/O'); };
    await assert.rejects(withSourceTransport(source, forbidden, () => source.search({ page: 1, context: { allowedContentRatings: null } })), /Invalid Mana content-rating policy/);
    await assert.rejects(withSourceTransport(source, forbidden, () => source.getContent(state.id ?? config.sample ?? 'invalid', { allowedContentRatings: [] })), /excluded|policy/i);
    const foreign = 'https://invalid.example/not-issued.png';
    for (const [method, wrongOrigin] of [['getCoverTransport', 2], ['getPageTransport', 1]]) {
      await assert.rejects(async () => withSourceTransport(source, forbidden, () => source[method]({ url: foreign, origin: wrongOrigin }).get(foreign)));
    }
    if (config.issuedImageOwnership !== false) {
      for (const origin of ['cover', 'page']) await assert.rejects(withSourceTransport(source, forbidden, () => authorizeTestImage(source, foreign, { origin })));
    } else missing('issued-image ownership registry', 'This source preserves native request origin rather than a URL grant registry');
    assert.equal(attempts, 0, 'Guard failed after provider I/O instead of before it');
  });
}
