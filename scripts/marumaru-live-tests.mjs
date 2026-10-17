import assert from 'node:assert/strict';
import { fetchTestImage, withSourceTransport } from './mana-test-images.mjs';
import { verifyRasterImageBytes } from './mana-test-image-bytes.mjs';

// Executes the built source through the official SDK's ordinary HTTP dispatcher.
// Reference data is fetched live; inventory counts and reader URLs are not fixtures.
export async function testMarumaru({ source, check, searchResult }) {
  const requests = [], referenceFetch = globalThis.fetch;
  const execute = callback => withSourceTransport(source, (url, options) => {
    requests.push(url); return referenceFetch(url, options);
  }, callback);
  const domain = 'https://marumaru105.com';
  const api = 'https://api.storagewebtoon.store/api/v1/reader/A2';
  const context = { allowedContentRatings: [0, 1, 2, 3] };
  let catalog, detail, chapters, reference, work, readerChapter;
  async function json(url) {
    const response = await referenceFetch(url, { headers: { Accept: 'application/json',
      ...(url.startsWith(domain + '/') ? { 'X-Site': 'marumaru' } : {}) }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200); assert.equal(response.url, url);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json(?:;|$)/i);
    assert.notEqual(response.headers.get('cf-mitigated'), 'challenge');
    return response.json();
  }
  const tuples = rows => Array.from(rows, c => [c.chapterId, c.number, c.title, c.webUrl]);
  async function referenceDetail(id) {
    const metadata = await json(`${domain}/api/works/${id}`);
    assert.equal(String(metadata.work.id), id); assert.equal(metadata.work.mediaType, 'MANHWA');
    assert.equal(metadata.episodesUrl, `${api}/works/${id}`);
    const listing = await json(metadata.episodesUrl);
    assert.equal(listing.ok, true); assert.equal(String(listing.item.id), id);
    assert.equal(listing.item.episode_count, metadata.work.episodeCount);
    assert.equal(listing.episodes.length, metadata.work.episodeCount);
    assert.equal(new Set(listing.episodes.map(c => c.id)).size, listing.episodes.length);
    return { metadata, listing, rows: listing.episodes.map(c => ({ chapterId: String(c.id), number: c.number,
      title: c.title, webUrl: `${domain}/manhwa/${id}/${c.id}`, ready: c.ready, embed: c.embed_url })).sort((a, b) => a.number - b.number) };
  }
  async function nativeImage(url, origin) {
    // No captureCoverImage callback: a challenge is a failed native check, not browser proof.
    const response = await fetchTestImage(source, url, { origin, fetchImpl: referenceFetch,
      log: (transport, status, target) => console.log(`IMAGE ${transport} ${status} ${target}`) });
    assert.equal(response.status, 200); assert.equal(response.url, url); assert.equal(response.requestedImageURL, url);
    const mime = response.headers.get('content-type') ?? '';
    assert(origin === 'cover' && /^application\/octet-stream(?:;|$)/i.test(mime) || /^image\/(?:jpeg|png|webp)(?:;|$)/i.test(mime));
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert(bytes.length > 0 && bytes.length <= 16000000);
    const raster = verifyRasterImageBytes(bytes);
    assert(raster.width > 0 && raster.height > 0);
    console.log('MARUMARU_NATIVE_IMAGE', JSON.stringify({ origin, bytes: bytes.length, ...raster }));
  }
  await check('Native API catalog and pagination retain canonical titles without per-card requests', async () => {
    const before = requests.length;
    catalog = await execute(() => source.search({ page: 1, context })); searchResult(catalog);
    assert.equal(requests.length - before, 1);
    const live = await json(`${domain}/api/works?mediaType=MANHWA&page=0&size=49`);
    assert.equal(catalog.results.length, live.items.length);
    assert.deepEqual(Array.from(catalog.results, c => c.id), live.items.map(c => String(c.id)));
    assert.equal(catalog.isLastPage, live.total <= live.size);
    if (!catalog.isLastPage) {
      const second = await execute(() => source.search({ page: 2, context })); searchResult(second);
      const next = await json(`${domain}/api/works?mediaType=MANHWA&page=1&size=49`);
      assert.deepEqual(Array.from(second.results, c => c.id), next.items.map(c => String(c.id)));
    }
  });
  await check('Native API text search retains canonical identity and source pagination', async () => {
    const result = await execute(() => source.search({ page: 1, query: '라멘 아카네코', context })); searchResult(result);
    assert(result.results.some(item => item.id === '17155'));
    const live = await json(`${domain}/api/search?q=${encodeURIComponent('라멘 아카네코')}&page=0&media=MANHWA&sort=LATEST`);
    assert.deepEqual(Array.from(result.results, c => c.id), live.items.map(c => String(c.id)));
    assert.equal(result.isLastPage, live.total <= live.size);
  });
  await check('Native details preserve complete advertised chapter inventory including unready rows', async () => {
    const before = requests.length;
    detail = await execute(() => source.getContent('17155', context));
    assert.equal(requests.length - before, 2, 'Detail must use one metadata and one complete inventory request');
    const live = await referenceDetail('17155'); work = live.metadata.work; reference = live.rows;
    assert.equal(detail.title, work.title); assert.equal(detail.cover, work.thumbUrl || work.coverUrl);
    assert.equal(detail.webUrl, `${domain}/manhwa/17155`);
    assert.equal(detail.chapters.length, work.episodeCount);
    assert.equal(JSON.stringify(tuples(detail.chapters)), JSON.stringify(tuples(reference)));
    const multipart = reference.filter(c => c.title === '라멘 아카네코 1-2화');
    assert.equal(multipart.length, 1, 'Live inventory no longer contains the genuine multipart label');
    readerChapter = reference.find(c => c.title === '라멘 아카네코 2화' && c.ready === true);
    assert(readerChapter, 'Live inventory lacks the selected ready reader label');
    console.log('MARUMARU_API_INVENTORY', JSON.stringify({ count: reference.length, unready: reference.filter(c => !c.ready).length,
      oldest: reference.slice(0, 3).map(c => [c.chapterId, c.number]), newest: reference.slice(-2).map(c => [c.chapterId, c.number]) }));
  });
  await check('Native direct cover returns exact authorized full image bytes', async () => {
    assert(detail?.cover, 'Detail prerequisite failed'); await nativeImage(detail.cover, 'cover');
  });
  await check('Native chapter indexes reuse the detail inventory and retain exact source numbers', async () => {
    assert(detail, 'Detail prerequisite failed'); const before = requests.length;
    chapters = await execute(() => source.getChapters('17155')); assert.equal(requests.length, before);
    assert.equal(JSON.stringify(tuples(chapters)), JSON.stringify(tuples(reference)));
    chapters.forEach((c, index) => { assert.equal(c.index, index); assert(Number.isFinite(c.number) && c.number > 0); });
  });
  await check('Native second-title inventory preserves every advertised chapter and label', async () => {
    const id = '21861', result = await execute(() => source.getContent(id, context)), live = await referenceDetail(id);
    assert.equal(result.chapters.length, live.metadata.work.episodeCount);
    assert.equal(JSON.stringify(tuples(result.chapters)), JSON.stringify(tuples(live.rows)));
    assert(result.chapters.some(c => /1-1화$/.test(c.title)), 'Live second title lost its multipart label');
    console.log('MARUMARU_SECOND_API_INVENTORY', JSON.stringify({ id, count: result.chapters.length }));
  });
  await check('Native reader preserves every advertised image and direct first/last bytes', async () => {
    assert(readerChapter && chapters?.some(c => c.chapterId === readerChapter.chapterId), 'Reader prerequisite failed');
    assert.equal(readerChapter.embed, `${api}/episodes/${readerChapter.chapterId}`);
    const before = requests.length, result = await execute(() => source.getChapterData('17155', readerChapter.chapterId));
    assert.equal(requests.length - before, 1, 'Reader must reuse the validated title inventory');
    const live = await json(readerChapter.embed); assert.equal(live.ok, true); assert.equal(live.item.ready, true);
    assert.equal(String(live.item.work_id), '17155'); assert.equal(String(live.item.id), readerChapter.chapterId);
    assert.equal(live.item.number, readerChapter.number); assert.equal(live.item.title, readerChapter.title);
    assert.equal(result.pages.length, live.item.body.length);
    assert(result.pages.length > 8, 'Reader stopped at the former eight mounted-image boundary');
    assert.deepEqual(Array.from(result.pages, p => p.url), live.item.body.map(p => p.url));
    assert.equal(new Set(result.pages.map(p => p.url)).size, result.pages.length);
    for (const page of [result.pages[0], result.pages.at(-1)]) await nativeImage(page.url, 'page');
    console.log('MARUMARU_NATIVE_READER', JSON.stringify({ pages: result.pages.length }));
  });
}
