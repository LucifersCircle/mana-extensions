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
    const response = await referenceFetch(url, { headers: { Accept: 'application/json', Referer: domain + '/',
      ...(url.startsWith(domain + '/') ? { 'X-Site': 'marumaru' } : {}) }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200); assert.equal(response.url, url);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json(?:;|$)/i);
    assert.notEqual(response.headers.get('cf-mitigated'), 'challenge');
    return response.json();
  }
  const tuples = rows => Array.from(rows, c => [c.chapterId, c.number, c.title, c.webUrl]);
  const available = rows => rows.filter(c => c.ready !== false);
  async function referenceDetail(id) {
    const metadata = await json(`${domain}/api/works/${id}`);
    assert.equal(String(metadata.work.id), id); assert.equal(metadata.work.mediaType, 'MANHWA');
    assert.equal(metadata.episodesUrl, `${api}/works/${id}`);
    const listing = await json(metadata.episodesUrl);
    assert.equal(listing.ok, true); assert.equal(String(listing.item.id), id);
    assert.equal(listing.item.title, metadata.work.title); assert.equal(listing.item.adult, metadata.work.adult);
    assert.equal(listing.item.media_type, 'MANHWA');
    assert.equal(listing.item.episode_count, metadata.work.episodeCount);
    assert.equal(listing.episodes.length, metadata.work.episodeCount);
    assert.equal(new Set(listing.episodes.map(c => String(c.id))).size, listing.episodes.length);
    assert.equal(new Set(listing.episodes.map(c => c.number)).size, listing.episodes.length);
    // Validate every row before filtering, including rows whose readers are not ready.
    const rows = listing.episodes.map(c => {
      assert.match(String(c.id), /^[1-9]\d*$/); assert(Number.isSafeInteger(Number(c.id)));
      assert(Number.isFinite(c.number) && c.number > 0 && c.number <= Number.MAX_SAFE_INTEGER);
      assert.equal(typeof c.title, 'string'); assert(c.title.trim());
      assert.match(c.published_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/);
      assert(Number.isFinite(Date.parse(c.published_at)));
      for (const key of ['work_id', 'workId']) if (c[key] !== undefined) assert.equal(String(c[key]), id);
      if (c.embed_url !== undefined) assert.equal(c.embed_url, `${api}/episodes/${c.id}`);
      return { chapterId: String(c.id), number: c.number, title: c.title,
        webUrl: `${domain}/manhwa/${id}/${c.id}`, ready: c.ready, embed: c.embed_url };
    }).sort((a, b) => a.number - b.number);
    return { metadata, listing, rows };
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
  await check('Native details validate complete inventory and hide only explicitly unavailable readers', async () => {
    const before = requests.length;
    detail = await execute(() => source.getContent('17155', context));
    assert.equal(requests.length - before, 2, 'Detail must use one metadata and one complete inventory request');
    const live = await referenceDetail('17155'); work = live.metadata.work; reference = live.rows;
    assert.equal(detail.title, work.title); assert.equal(detail.cover, work.thumbUrl || work.coverUrl);
    assert.equal(detail.webUrl, `${domain}/manhwa/17155`);
    assert.equal(reference.length, work.episodeCount);
    assert.equal(detail.chapters.length, available(reference).length);
    assert.equal(JSON.stringify(tuples(detail.chapters)), JSON.stringify(tuples(available(reference))));
    const multipart = reference.filter(c => c.title === '라멘 아카네코 1-2화');
    assert.equal(multipart.length, 1, 'Live inventory no longer contains the genuine multipart label');
    readerChapter = reference.find(c => c.title === '라멘 아카네코 2화' && c.ready === true);
    assert(readerChapter, 'Live inventory lacks the selected ready reader label');
    console.log('MARUMARU_API_INVENTORY', JSON.stringify({ advertised: reference.length, visible: detail.chapters.length,
      unavailable: reference.filter(c => c.ready === false).length,
      oldest: reference.slice(0, 3).map(c => [c.chapterId, c.number]), newest: reference.slice(-2).map(c => [c.chapterId, c.number]) }));
  });
  await check('Native direct cover returns exact authorized full image bytes', async () => {
    assert(detail?.cover, 'Detail prerequisite failed'); await nativeImage(detail.cover, 'cover');
  });
  await check('Native chapter refresh re-evaluates the complete inventory without per-chapter requests', async () => {
    assert(detail, 'Detail prerequisite failed'); const before = requests.length;
    chapters = await execute(() => source.getChapters('17155'));
    assert.equal(requests.length - before, 2, 'Refresh must use one metadata and one complete inventory request');
    const live = await referenceDetail('17155'); reference = live.rows;
    assert.equal(reference.length, live.metadata.work.episodeCount);
    assert.equal(JSON.stringify(tuples(chapters)), JSON.stringify(tuples(available(reference))));
    chapters.forEach((c, index) => { assert.equal(c.index, index); assert(Number.isFinite(c.number) && c.number > 0); });
    const unavailable = reference.find(c => c.ready === false);
    if (unavailable) {
      const beforeUnavailable = requests.length;
      await assert.rejects(execute(() => source.getChapterData('17155', unavailable.chapterId)), /inventory/);
      assert.equal(requests.length, beforeUnavailable, 'A known unavailable reader must fail before any reader request');
    }
  });
  await check('Native second title retains exact available chapter IDs, source numbers and multipart labels', async () => {
    const id = '21861', result = await execute(() => source.getContent(id, context)), live = await referenceDetail(id);
    assert.equal(live.rows.length, live.metadata.work.episodeCount);
    assert.equal(result.chapters.length, available(live.rows).length);
    assert.equal(JSON.stringify(tuples(result.chapters)), JSON.stringify(tuples(available(live.rows))));
    assert(result.chapters.some(c => /1-1화$/.test(c.title)), 'Live second title lost its available multipart label');
    console.log('MARUMARU_SECOND_API_INVENTORY', JSON.stringify({ id, advertised: live.rows.length, visible: result.chapters.length,
      unavailable: live.rows.filter(c => c.ready === false).length }));
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
