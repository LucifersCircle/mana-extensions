import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { createManaRuntime } from './mana-runtime.mjs';
import { discoverSources } from './test-sources.mjs';

const report = {};
const names = discoverSources();
const manifest = JSON.parse(readFileSync('dist/sources.json', 'utf8'));
const nonempty = (value, label) => assert(typeof value === 'string' && value.trim(), `${label} is empty`);
const url = (value) => assert(['http:', 'https:'].includes(new URL(value).protocol), `Invalid URL: ${value}`);
function highlights(items) {
  assert(Array.isArray(items) && items.length, 'No highlights returned');
  assert.equal(new Set(items.map((item) => item.id)).size, items.length, 'Duplicate content IDs');
  for (const item of items) {
    nonempty(item.id, 'Content ID'); nonempty(item.title, 'Title'); url(item.cover);
  }
}
function searchResult(result) {
  highlights(result.results);
  assert.equal(typeof result.isLastPage, 'boolean', 'Missing pagination state');
}
async function image(source, imageUrl) {
  const request = await source.willRequestImage(imageUrl);
  url(request.url);
  const response = await fetch(request.url, {
    headers: request.headers,
    signal: AbortSignal.timeout(30_000),
  });
  console.log(`IMAGE ${response.status} ${request.url}`);
  assert(response.ok, `Image HTTP ${response.status}: ${request.url}`);
  assert(response.headers.get('content-type')?.startsWith('image/'), 'Response is not an image');
  const reader = response.body.getReader();
  try {
    const { value } = await reader.read();
    assert(value?.length > 0, 'Image has no bytes');
  } finally { await reader.cancel(); }
}

for (const name of names) {
  const tests = [];
  const started = performance.now();
  async function check(label, fn) {
    const start = performance.now();
    try {
      await fn();
      tests.push({ name: label, status: 'pass', duration: performance.now() - start });
      console.log(`PASS ${name}: ${label}`);
    } catch (error) {
      tests.push({ name: label, status: 'fail', duration: performance.now() - start, error: error.stack ?? String(error) });
      console.error(`FAIL ${name}: ${label}\n${error.stack ?? error}`);
    }
  }
  let source, catalog, content, chapters, pages, sections, form;
  await check('Built Mana bundle and source metadata', () => {
    assert(manifest.sources.some((entry) => entry.id === name), 'Source missing from built manifest');
    const context = vm.createContext(createManaRuntime());
    vm.runInContext(readFileSync(`dist/sources/${name}.mana`, 'utf8'), context, { timeout: 10_000 });
    source = new context.Target();
    assert.equal(source.info.id, name);
    nonempty(source.info.version, 'Version'); url(source.info.website);
  });
  await check('Catalog search returns usable highlights', async () => {
    catalog = await source.search({ page: 1 }); searchResult(catalog);
  });
  await check('Catalog pagination advances or explicitly ends', async () => {
    assert(catalog?.results?.length, 'Catalog search failed');
    if (catalog.isLastPage) {
      console.log('Catalog explicitly reports its last page');
      return;
    }
    const next = await source.search({ page: 2 }); searchResult(next);
    const firstIds = new Set(catalog.results.map((item) => item.id));
    assert(next.results.some((item) => !firstIds.has(item.id)), 'Second page repeats first page');
  });
  await check('Title search finds a live catalog title', async () => {
    const item = catalog.results[0];
    const result = await source.search({ page: 1, query: item.title }); searchResult(result);
    assert(result.results.some((match) => match.id === item.id), `Title search lost ${item.title}`);
  });
  await check('Live content details and cover image', async () => {
    content = await source.getContent(catalog.results[0].id);
    nonempty(content.title, 'Detail title'); nonempty(content.summary, 'Summary');
    assert.equal(content.title, catalog.results[0].title);
    url(content.webUrl); url(content.cover);
    assert(Array.isArray(content.tags) && content.tags.length, 'Missing live genres');
    await image(source, content.cover);
  });
  await check('Search form exposes live genres and sort options', async () => {
    form = await source.getSearchForm();
    const fields = form.sections.flatMap((section) => section.children ?? []);
    const genres = fields.find((field) => field.id === 'genres')?.options;
    assert(genres?.length, 'No live genre options');
    for (const option of genres) { nonempty(option.id, 'Genre ID'); nonempty(option.title, 'Genre title'); }
    assert.equal(new Set(genres.map((genre) => genre.id)).size, genres.length, 'Duplicate genres');
    assert(!genres.some((genre) => genre.title.toLowerCase() === 'hidden'), 'Hidden genre leaked');
    assert(fields.find((field) => field.id === 'status')?.options?.length, 'Missing status filter');
    assert(fields.find((field) => field.id === 'type')?.options?.length, 'Missing type filter');
    assert((await source.getSortOptions()).length, 'No sort options');
  });
  await check('Genre inclusion and exclusion affect live results', async () => {
    const genre = content.tags[0];
    const included = await source.search({ page: 1, filters: { genres: { included: [genre] } } });
    searchResult(included);
    const includedDetails = await source.getContent(included.results[0].id);
    assert(includedDetails.tags.some((tag) => tag.id === genre.id), 'Included genre not respected');
    const excluded = await source.search({ page: 1, filters: { genres: { excluded: [genre] } } });
    searchResult(excluded);
    const excludedDetails = await source.getContent(excluded.results[0].id);
    assert(!excludedDetails.tags.some((tag) => tag.id === genre.id), 'Excluded genre not respected');
  });
  await check('Home discovers all published sections', async () => {
    sections = await source.getSectionsForPage({ id: 'home' });
    assert(sections.length >= 4, 'Missing home sections');
    assert.equal(new Set(sections.map((section) => section.id)).size, sections.length, 'Duplicate home sections');
    for (const id of ['popular-today', 'latest', 'new', 'most-popular']) {
      assert(sections.some((section) => section.id === id), `Missing home section ${id}`);
    }
    for (const section of sections) nonempty(section.title, 'Section title');
  });
  if (sections?.length) {
    for (const section of sections) {
      await check(`Home section: ${section.title} (${section.id})`, async () => {
        const resolved = await source.resolvePageSection({ id: 'home' }, section.id);
        highlights(resolved.items);
        if (resolved.viewMoreLink) {
          searchResult(await source.search(resolved.viewMoreLink.request));
        }
      });
    }
  } else {
    await check('Home section resolution', () => assert.fail('No discovered home sections to resolve'));
  }
  await check('Live chapter list has unique IDs and oldest-first order', async () => {
    chapters = await source.getChapters(catalog.results[0].id);
    assert(chapters.length, 'No available chapters');
    assert.equal(new Set(chapters.map((chapter) => chapter.chapterId)).size, chapters.length, 'Duplicate chapter IDs');
    chapters.forEach((chapter, i) => {
      nonempty(chapter.chapterId, 'Chapter ID'); nonempty(chapter.title, 'Chapter title');
      assert(Number.isFinite(chapter.number), 'Invalid chapter number');
      assert.equal(chapter.index, i, 'Incorrect chapter index');
      assert(Number.isFinite(new Date(chapter.date).getTime()), 'Invalid chapter date');
      if (i) assert(chapter.number >= chapters[i - 1].number, 'Chapter order reversed');
    });
  });
  await check('Chapter pages are nonempty unique URLs', async () => {
    const data = await source.getChapterData(catalog.results[0].id, chapters[0].chapterId, chapters[0]);
    pages = data.pages;
    assert(pages.length, 'Chapter has no pages');
    assert.equal(new Set(pages.map((page) => page.url)).size, pages.length, 'Duplicate chapter pages');
    for (const page of pages) url(page.url);
    console.log(`CHAPTER ${chapters[0].chapterId}: ${pages.length} pages`);
  });
  await check('First and last chapter images load with source headers', async () => {
    assert(pages?.length, 'No chapter pages to load');
    for (const page of [pages[0], ...(pages.length > 1 ? [pages.at(-1)] : [])]) await image(source, page.url);
  });
  await check('Series deep link resolves the same live content', async () => {
    const result = await source.handleURL(content.webUrl);
    assert.equal(result?.content?.id, catalog.results[0].id);
  });
  report[name] = {
    tests,
    summary: { total: tests.length, passed: tests.filter((test) => test.status === 'pass').length,
      failed: tests.filter((test) => test.status === 'fail').length, duration: performance.now() - started },
  };
}
mkdirSync('bundles', { recursive: true });
writeFileSync('bundles/live-test-results.json', `${JSON.stringify(report, null, 2)}\n`);
if (names.some((name) => !report[name]?.tests.length || report[name].summary.failed)) process.exitCode = 1;
