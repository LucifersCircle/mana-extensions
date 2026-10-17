import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { createManaRuntime, redactURL, redactText } from './mana-runtime.mjs';
import { testKagane } from './kagane-live-tests.mjs';
import { testHijala } from './hijala-live-tests.mjs';
import { createManaTestTransport } from './mana-test-browser.mjs';
import { createManaTestWebView } from './mana-test-webview.mjs';
import { fetchTestImage, resolvedBrowserImageProof } from './mana-test-images.mjs';
import { verifyRasterImageBytes } from './mana-test-image-bytes.mjs';
import { failedSources } from './test-sources.mjs';
import { readSelection } from './changed-sources.mjs';
import { testMangaSushi, coverDimensions } from './mangasushi-live-tests.mjs';
import { testManhwaNex } from './manhwanex-live-tests.mjs';
import { testMarumaru } from './marumaru-live-tests.mjs';
import { testMangaStash } from './mangastash-live-tests.mjs';
import { getVortexContentWithSynopsis, testVortexRatings, testVortexSynopsis } from './vortexscans-live-tests.mjs';
import { load } from 'cheerio';

rmSync('bundles/live-test-results.json', { force: true });
if (process.argv.length > 2) throw new Error('Use LIVE_TEST_SELECTION, not unvalidated CLI source arguments');
const names = readSelection().selectedSources;
const report = {};
const testTransport = createManaTestTransport();
const testWebViews = createManaTestWebView();
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
async function assertVortexGenres(contentId, content) {
  const postId = contentId.match(/^(\d+):/)?.[1];
  assert(postId, 'Missing canonical numeric post ID');
  const reference = await testTransport.fetch(`https://api.vortexscans.org/api/post?postId=${postId}`, { signal: AbortSignal.timeout(30_000) });
  assert.equal(reference.status, 200, 'Live genre reference failed');
  const { post } = await reference.json();
  assert.equal(String(post.id), postId, 'Live genre reference identity changed');
  assert(Array.isArray(post.genres), 'Live genre field is malformed');
  assert(Array.isArray(content.tags), 'Native genre field is malformed');
  const expected = post.genres.filter((genre) => genre.name.toLowerCase() !== 'hidden')
    .map((genre) => ({ id: String(genre.id), title: genre.name }));
  assert.deepEqual(Array.from(content.tags, (genre) => ({ id: genre.id, title: genre.title })), expected,
    'Detail genres differ from the live source, including legitimately untagged titles');
}

async function image(source, imageUrl) {
  const response = await fetchTestImage(source, imageUrl, {
    fetchImpl: testTransport.fetch,
    captureCoverImage: testWebViews.captureCoverImage,
    log: (transport, status, target) => console.log(`IMAGE ${transport} ${status} ${redactURL(target)}`),
  });
  const requestedURL = response.requestedImageURL;
  url(requestedURL);
  assert(response.ok, `Image HTTP ${response.status}: ${redactURL(requestedURL)}`);
  const octetCover = source.info.id === 'VortexScans' && new URL(requestedURL).hostname === 'storage.vortexscans.org'
    && response.headers.get('content-type')?.split(';')[0] === 'application/octet-stream';
  const proof = resolvedBrowserImageProof(response);
  const verifiedMarumaruCover = source.info.id === 'Marumaru' && proof?.url === requestedURL
    && response.url === requestedURL && response.headers.get('content-type') === 'application/octet-stream';
  assert(response.headers.get('content-type')?.startsWith('image/') || octetCover || verifiedMarumaruCover, 'Response is not an image');
  if (verifiedMarumaruCover) {
    const raster = verifyRasterImageBytes(new Uint8Array(await response.arrayBuffer()));
    assert.deepEqual(raster, { format: proof.format, width: proof.width, height: proof.height });
    console.log(`IMAGE browser-decoded ${raster.format} ${raster.width}x${raster.height} application/octet-stream`);
    return;
  }
  const reader = response.body.getReader();
  try {
    const { value } = await reader.read();
    assert(value?.length > 0, 'Image has no bytes');
    if (octetCover) {
      const bytes = Buffer.from(value);
      assert(bytes.subarray(0, 12).toString('hex').startsWith('89504e470d0a1a0a')
        || bytes.subarray(0, 3).toString('hex') === 'ffd8ff'
        || (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'), 'Octet-stream cover lacks a valid image signature');
    }
    if (new URL(requestedURL).hostname === 'kagane.org') {
      const bytes = Buffer.from(value), signature = bytes.subarray(0, 12).toString('hex');
      assert(signature.startsWith('ffd8ff') || signature.startsWith('89504e470d0a1a0a')
        || signature.startsWith('47494638') || signature.startsWith('ff0a')
        || signature === '0000000c4a584c200d0a870a'
        || (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
        || bytes.subarray(4, 8).toString() === 'ftyp', 'Unrecognized Kagane cover image bytes');
    }
  } finally { await reader.cancel(); }
}

try {
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
      tests.push({ name: label, status: 'fail', duration: performance.now() - start, error: redactText(error.stack ?? String(error)) });
      console.error(`FAIL ${name}: ${label}\n${redactText(error.stack ?? error)}`);
    }
  }
  let suiteError;
  try {
  let source, catalog, content, detailPost, chapters, pages, sections, form, context;
  const requests = [];
  await check('Built Mana bundle and source metadata', () => {
    const entries = manifest.sources.filter((entry) => entry.id === name);
    assert.equal(entries.length, 1, 'Source must have one unique built manifest entry');
    context = vm.createContext(createManaRuntime({ fetchImpl: testTransport.fetch, webViewPage: testWebViews.WebViewPage, logger: (request) => { requests.push(request); console.log(`[http] ${request.status ?? 'ERROR'} ${request.url} (${request.durationMs}ms)${request.error ? `: ${request.error}` : ''}`); } }));
    vm.runInContext(readFileSync(`dist/sources/${name}.mana`, 'utf8'), context, { timeout: 10_000 });
    source = testWebViews.wrapSource(new context.Target());
    assert.equal(source.info.id, name);
    nonempty(source.info.version, 'Version');
    assert.equal(source.info.version, entries[0].version, 'Bundle version differs from built manifest');
    url(source.info.website);
  });
  await check('Malformed native rating contexts fail closed before provider I/O', async () => {
    let attempted = 0;
    const closed = vm.createContext(createManaRuntime({ logger: () => {}, fetchImpl: async () => { attempted++; throw new Error('Unexpected request from malformed native policy'); } }));
    vm.runInContext(readFileSync(`dist/sources/${name}.mana`, 'utf8'), closed, { timeout: 10_000 });
    const target = new closed.Target();
    for (const allowedContentRatings of [null, '1', 1, {}, { includes: () => true }, [1, '3'], [1, 99], [1, NaN]]) {
      const invalid = { allowedContentRatings };
      for (const run of [() => target.search({ page: 1, context: invalid }), () => target.getContent('unread', invalid),
        () => target.getSectionsForPage({ id: 'home', context: invalid }), () => target.resolvePageSection({ id: 'home', context: invalid }, 'latest')]) {
        await assert.rejects(run, /Invalid Mana content-rating policy/);
      }
    }
    assert.equal(attempted, 0);
  });
  if (name !== 'VortexScans') {
    if (name === 'Kagane') {
      await testKagane({ source, check, referenceFetch: testTransport.fetch, highlights, searchResult, image, requests, freshSource: () => testWebViews.wrapSource(new context.Target()) });
    } else if (name === 'Hijala') {
      await testHijala({ source, check, nativeStore: context.ObjectStore, highlights, searchResult, image, requests, freshSource: () => testWebViews.wrapSource(new context.Target()), referenceFetch: testTransport.fetch });
    } else if (name === 'MangaSushi') {
      await testMangaSushi({ source, check, nativeStore: context.ObjectStore, highlights, searchResult, image, requests, freshSource: () => testWebViews.wrapSource(new context.Target()) });
    } else if (name === 'ManhwaNex') {
      await testManhwaNex({ source, check, nativeStore: context.ObjectStore, requests, freshSource: () => testWebViews.wrapSource(new context.Target()) });
    } else if (name === 'Marumaru') {
      await testMarumaru({ source, check, searchResult, image });
    } else if (name === 'MangaStash') {
      await testMangaStash({ check, referenceFetch: testTransport.fetch });
    } else await check('Supported source-specific live contract', () => assert.fail(`No live contract implemented for ${name}`));
    continue;
  }
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
    ({ content, post: detailPost } = await getVortexContentWithSynopsis(source, catalog.results[0].id));
    nonempty(content.title, 'Detail title');
    assert.equal(content.title, catalog.results[0].title);
    url(content.webUrl); url(content.cover);
    await assertVortexGenres(catalog.results[0].id, content);
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
    const genre = form.sections.flatMap((section) => section.children ?? [])
      .find((field) => field.id === 'genres')?.options?.[0];
    assert(genre, 'No verified native genre is available for filter checks');
    const included = await source.search({ page: 1, filters: { genres: { included: [genre] } } });
    searchResult(included);
    const includedDetails = await source.getContent(included.results[0].id);
    await assertVortexGenres(included.results[0].id, includedDetails);
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
  let popularEvidence;
  await check('Popular Today uses source-published originals with one homepage request', async () => {
    const cold = new context.Target(), original = cold.api.getText.bind(cold.api);
    cold.api.getText = async (...args) => { const html = await original(...args); popularEvidence = html; return html; };
    const before = requests.length;
    const result = await cold.resolvePageSection({ id: 'home' }, 'popular-today');
    assert.equal(requests.length - before, 1, 'Original cover selection must not add per-title requests');
    highlights(result.items);
    const $ = load(popularEvidence), section = $('h1,h2,h3,h4,p').filter((_, node) => $(node).text().trim() === 'Popular Today').first().closest('section');
    const pairs = [];
    for (const item of result.items) {
      const slug = decodeURIComponent(item.id.slice(item.id.indexOf(':') + 1));
      const anchor = section.find('a[href^="/series/"]').filter((_, node) => decodeURIComponent(($(node).attr('href') ?? '').slice('/series/'.length)) === slug).first();
      assert(anchor.length, 'Original cover must retain its canonical homepage series');
      const img = anchor.find('img[src]').first(), proxy = new URL(img.attr('src')), originalURL = new URL(item.cover);
      assert.equal(originalURL.origin, 'https://storage.vortexscans.org');
      assert.equal(proxy.pathname, `/${originalURL.hostname}${originalURL.pathname}`, 'Selected original must be the same asset as this card proxy');
      assert(img.attr('data-fallback-src') === item.cover || popularEvidence.includes(`featuredImage:${JSON.stringify(item.cover)}`), 'Original URL must be supplied verbatim by the actual homepage');
      pairs.push({ original: item.cover, proxy: img.attr('src') });
    }
    const samples = [pairs.find((pair) => pair.original.endsWith('.png')), pairs.find((pair) => pair.original.endsWith('.webp'))].filter(Boolean);
    assert.equal(samples.length, 2, 'Live originals should exercise both PNG and WebP bytes');
    for (const pair of samples) {
      const full = await coverDimensions(source, pair.original), card = await coverDimensions(source, pair.proxy);
      // A width-limited proxy need not enlarge an already-small source image.
      // The independently verified large Dao original remains covered below.
      assert(full.width >= card.width && full.height >= card.height, 'Published original must not be smaller in either dimension than its same-asset card proxy');
      assert(full.bytes > 0 && card.bytes > 0);
    }
  });
  await check('Popular Today metadata is source-bound and missing or invalid originals retain card images', async () => {
    assert(popularEvidence, 'Missing live homepage provenance');
    const $ = load(popularEvidence), section = $('h1,h2,h3,h4,p').filter((_, node) => $(node).text().trim() === 'Popular Today').first().closest('section');
    const anchor = section.find('a[href^="/series/"]').first(), href = anchor.attr('href'), current = anchor.find('img[src]').first().attr('src');
    const baseline = new context.Target(); baseline.api.getText = async () => popularEvidence;
    const first = (await baseline.resolvePageSection({ id: 'home' }, 'popular-today')).items[0];
    assert(first && first.cover !== current);
    const noOriginals = popularEvidence.replace(/featuredImage:"(?:\\.|[^"\\])*"/g, 'featuredImage:null');
    for (const [label, value, expected] of [
      ['missing metadata', undefined, current],
      ['malformed URL', 'not-a-url', current],
      ['unrelated asset', first.cover.replace(/[^/]+$/, 'unrelated.png'), current],
      ['different origin', first.cover.replace('storage.vortexscans.org', 'example.com'), current],
      ['credentials', first.cover.replace('https://', 'https://user:pass@'), current],
      ['fragment', `${first.cover}#different`, current],
      ['query', `${first.cover}?different=1`, current],
      ['exact source fallback attribute', first.cover, first.cover]
    ]) {
      const page = load(noOriginals);
      // A series can also appear above Popular Today; that duplicate must not receive this mutation.
      page('body').prepend(anchor.clone());
      // Target this exact Popular Today card, not an earlier duplicate series link elsewhere on the home page.
      const popular = page('h1,h2,h3,h4,p').filter((_, node) => page(node).text().trim() === 'Popular Today').first().closest('section');
      const img = popular.find(`a[href="${href}"]`).first().find('img[src]').first();
      assert.equal(img.attr('src'), current, 'Fallback mutation must target the original Popular Today image');
      img.removeAttr('data-fallback-src'); if (value !== undefined) img.attr('data-fallback-src', value);
      const cold = new context.Target(); cold.api.getText = async () => page.html();
      const before = requests.length;
      const result = await cold.resolvePageSection({ id: 'home' }, 'popular-today');
      assert.equal(result.items.find((item) => item.id === first.id)?.cover, expected, label);
      assert.equal(requests.length, before, 'Fallback selection must not trigger a title or image lookup');
    }
    for (const [label, replacement, expected] of [
      ['escaped serialized URL', JSON.stringify(first.cover).replaceAll('/', '\\/'), first.cover],
      ['malformed quoted image metadata retains identity', '"\\q"', current],
      ['invalid serialized URL', JSON.stringify('javascript:alert(1)'), current],
      ['unrelated serialized asset', JSON.stringify(first.cover.replace(/[^/]+$/, 'unrelated.png')), current]
    ]) {
      const mutated = popularEvidence.replaceAll(`featuredImage:${JSON.stringify(first.cover)}`, `featuredImage:${replacement}`);
      const cold = new context.Target(); cold.api.getText = async () => mutated;
      assert.equal((await cold.resolvePageSection({ id: 'home' }, 'popular-today')).items.find((item) => item.id === first.id)?.cover, expected, label);
    }
  });
  await check('Search and detail retain source originals including octet-stream WebP bytes', async () => {
    const cold = new context.Target(), client = cold.api.client, original = client.request, evidence = [];
    const query = 'Dao of the Bizarre Immortal', slug = 'dao-of-the-bizarre-immortal', id = `289:${slug}`;
    // Capture the same native response bytes before the bundle parses them, not an unrelated homepage snapshot.
    client.request = async function (...args) {
      const response = await original.apply(this, args);
      evidence.push({ url: response.request.url, data: response.data });
      return response;
    };
    const before = requests.length;
    let item, detail;
    try {
      const result = await cold.search({ page: 1, query });
      item = result.results.find((entry) => entry.id === id);
      assert(item, 'Published Dao sample disappeared');
      detail = await cold.getContent(item.id);
    } finally { client.request = original; }
    assert.equal(requests.length - before, 2, 'Search and detail must not add image metadata calls');
    assert.equal(evidence.length, 2, 'Both native API responses must supply provenance');
    const searchURL = new URL(evidence[0].url), detailURL = new URL(evidence[1].url);
    assert.equal(`${searchURL.origin}${searchURL.pathname}`, 'https://api.vortexscans.org/api/query');
    assert.equal(searchURL.searchParams.get('searchTerm'), query);
    assert.equal(`${detailURL.origin}${detailURL.pathname}`, 'https://api.vortexscans.org/api/post');
    assert.equal(detailURL.searchParams.get('postId'), '289');
    const matches = JSON.parse(evidence[0].data).posts.filter((post) => post.id === 289 && post.slug === slug);
    assert.equal(matches.length, 1, 'Search provenance must identify the exact canonical series once');
    const searchPost = matches[0], detailPost = JSON.parse(evidence[1].data).post;
    for (const post of [searchPost, detailPost]) {
      assert.equal(post.id, 289, 'API provenance changed canonical post ID');
      assert.equal(post.slug, slug, 'API provenance changed canonical slug');
      assert.equal(post.postTitle, query, 'API provenance changed the fixed sample title');
      nonempty(post.featuredImage, 'Source featuredImage');
    }
    assert.equal(item.title, searchPost.postTitle);
    assert.equal(detail.title, detailPost.postTitle);
    assert.equal(item.webUrl, `https://vortexscans.org/series/${slug}`);
    assert.equal(detail.webUrl, item.webUrl);
    assert.equal(item.cover, searchPost.featuredImage, 'Search retains its exact source featuredImage URL');
    assert.equal(detail.cover, detailPost.featuredImage, 'Detail retains its exact source featuredImage URL');
    assert.equal(detail.cover, item.cover, 'Both API-backed surfaces retain the exact featuredImage URL');
    const measured = await coverDimensions(cold, item.cover);
    assert.equal(measured.format, 'WEBP', 'Verify the real WebP signature, not its MIME label');
    assert(measured.width > 400 && measured.height > 400);
    assert(measured.bytes > 0);
    console.log(`VORTEX ORIGINAL MIME ${measured.mime}: valid ${measured.format}`);
  });
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
  await testVortexSynopsis({ check, requests, post: detailPost, freshSource: () => testWebViews.wrapSource(new context.Target()) });
  await testVortexRatings({ source, check, requests, freshSource: () => testWebViews.wrapSource(new context.Target()) });
  } catch (error) {
    // Keep executed checks, but never present an aborted suite as a complete report.
    suiteError = `Source suite aborted before completion; remaining checks were not run.\n${redactText(error?.stack ?? String(error))}`;
    console.error(`FAIL ${name}: ${suiteError}`);
  } finally {
    report[name] = {
      tests,
      summary: { total: tests.length, passed: tests.filter((test) => test.status === 'pass').length,
        failed: tests.filter((test) => test.status === 'fail').length, duration: performance.now() - started },
      ...(suiteError ? { error: suiteError } : {}),
    };
  }
}
} finally {
  try { await Promise.all([testTransport.close(), testWebViews.close()]); }
  catch (error) { console.error(redactText(error.message)); process.exitCode = 1; }
}
mkdirSync('bundles', { recursive: true });
writeFileSync('bundles/live-test-results.json', `${JSON.stringify(report, null, 2)}\n`);
if (failedSources(report, names).length) process.exitCode = 1;
