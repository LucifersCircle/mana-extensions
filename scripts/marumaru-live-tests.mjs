import assert from 'node:assert/strict';
import { load } from 'cheerio';

// Executes the built source. No provider fixtures or substitute HTTP reader path.
// A host without the official WebViewPage API must fail, never omit this source.
export async function testMarumaru({ source, check, searchResult, image, renderedDetail }) {
  const context = { allowedContentRatings: [0, 1, 2, 3] };
  let catalog, detail, chapters, reference, readerChapter;
  await check('Rendered native catalog returns canonical Korean titles', async () => {
    catalog = await source.search({ page: 1, context }); searchResult(catalog);
    for (const item of catalog.results) assert.match(item.id, /^[1-9]\d*$/);
  });
  await check('Rendered native text search retains canonical identity', async () => {
    const result = await source.search({ page: 1, query: '라멘 아카네코', context }); searchResult(result);
    assert(result.results.some(item => item.id === '17155'));
  });
  await check('Rendered details preserve complete DOM chapter identity and genuine source labels', async () => {
    detail = await source.getContent('17155', context);
    assert.equal(detail.title, '라멘 아카네코');
    assert.equal(detail.webUrl, 'https://marumaru105.com/manhwa/17155');
    assert(detail.chapters?.length > 1);
    assert.equal(new Set(detail.chapters.map(c => c.chapterId)).size, detail.chapters.length);
    // Observe the exact successful WebView result consumed by this source call.
    // This is an independent DOM oracle, not another fetch or the parsed cache.
    const html = renderedDetail?.();
    assert(typeof html === 'string' && html.length > 0, 'Exact rendered detail reference unavailable');
    const $ = load(html);
    assert.equal($('.hero-v2-title').length, 1);
    assert.equal($('.hero-v2-title').text().trim(), detail.title);
    assert.equal($('.hero-v2-thumb img').attr('src'), detail.cover);
    reference = $('a.ep-row-v2-link').toArray().map(element => {
      const row = $(element), href = row.attr('href');
      const match = /^(?:https:\/\/marumaru105\.com)?\/manhwa\/17155\/([1-9]\d*)$/.exec(href ?? '');
      assert(match, 'Reference chapter link is not canonical or belongs to another title');
      assert.equal(row.find('.ep-row-v2-no').length, 1);
      assert.equal(row.find('.ep-row-v2-title strong').length, 1);
      const numberText = row.find('.ep-row-v2-no').text().trim();
      const number = Number(numberText), title = row.find('.ep-row-v2-title strong').text().trim();
      assert(numberText && Number.isFinite(number) && number > 0 && number <= Number.MAX_SAFE_INTEGER && title,
        'Reference chapter metadata is incomplete');
      return { chapterId: match[1], number, title, webUrl: `https://marumaru105.com/manhwa/17155/${match[1]}` };
    }).reverse();
    assert(reference.length > 1, 'Rendered reference has no usable chapter inventory');
    assert.equal(new Set(reference.map(c => c.chapterId)).size, reference.length, 'Reference repeats a chapter identity');
    assert.equal($('.ep-section-count').length, 1, 'Rendered reference has no unique advertised chapter count');
    assert.equal(Number($('.ep-section-count').text().trim()), reference.length, 'Rendered reference is not the complete advertised chapter inventory');
    const endpoint = selector => {
      const link = $(selector);
      assert.equal(link.length, 1, 'Rendered chapter endpoint is missing or ambiguous');
      const match = /^(?:https:\/\/marumaru105\.com)?\/manhwa\/17155\/([1-9]\d*)$/.exec(link.attr('href') ?? '');
      assert(match, 'Rendered chapter endpoint is not canonical');
      return match[1];
    };
    const firstId = endpoint('.hero-v2-actions-bottom a.cta-ghost');
    const latestId = endpoint('.hero-v2-actions-bottom a.cta-primary');
    // Keep the genuine multipart and reader-label coverage without assuming that
    // provider database IDs are permanent. Numbers come only from the DOM field.
    const multipart = reference.filter(c => c.title === '라멘 아카네코 1-2화');
    const reader = reference.filter(c => c.title === '라멘 아카네코 2화');
    const diagnosticId = value => value.length <= 32 ? value : 'oversized-id';
    console.log('MARUMARU_DOM_INVENTORY', JSON.stringify({ count: reference.length,
      oldest: reference.slice(0, 4).map(c => [diagnosticId(c.chapterId), c.number]),
      newest: reference.slice(-2).map(c => [diagnosticId(c.chapterId), c.number]),
      firstLink: diagnosticId(firstId), latestLink: diagnosticId(latestId),
      multipartMatches: multipart.length, readerMatches: reader.length }));
    assert(firstId === reference[0].chapterId && latestId === reference.at(-1).chapterId,
      'Rendered chapter rows do not match the same-page first/latest chapter links');
    const tuples = rows => Array.from(rows, c => [c.chapterId, c.number, c.title, c.webUrl]);
    assert(JSON.stringify(tuples(detail.chapters)) === JSON.stringify(tuples(reference)), 'Native inventory differs from the exact rendered DOM');
    if (reader.length === 1) readerChapter = reader[0];
    assert.equal(multipart.length, 1, 'Rendered DOM no longer contains the genuine multipart chapter label');
    assert.equal(reader.length, 1, 'Rendered DOM no longer contains the selected genuine reader label');
  });
  await check('Rendered detail cover returns authorized actual image bytes', async () => {
    assert(detail?.cover, 'Detail cover prerequisite failed');
    await image(source, detail.cover, 'cover');
  });
  await check('Native chapter indexes preserve ascending inventory and exact source numbers', async () => {
    assert(detail, 'Detail prerequisite failed'); chapters = await source.getChapters('17155');
    assert(JSON.stringify(chapters.map(c => [c.chapterId, c.number, c.title])) === JSON.stringify(detail.chapters.map(c => [c.chapterId, c.number, c.title])),
      'Chapter API inventory differs from the native detail inventory');
    chapters.forEach((c, index) => { assert.equal(c.index, index); assert(Number.isFinite(c.number) && c.number > 0); });
  });
  await check('Rendered reader includes later lazy-loaded cuts and native image bytes', async () => {
    assert(readerChapter && chapters?.some(c => c.chapterId === readerChapter.chapterId), 'DOM-bound reader chapter prerequisite failed');
    const result = await source.getChapterData('17155', readerChapter.chapterId);
    assert(result.pages?.length > 8, 'Reader stopped at the initial eight mounted images');
    assert.equal(new Set(result.pages.map(p => p.url)).size, result.pages.length);
    result.pages.forEach((p, i) => assert.equal(p.url, `https://peer.storagewebtoon.store/api/media/episode/${readerChapter.chapterId}/${i + 1}.webp`));
    for (const page of [result.pages[0], result.pages.at(-1)]) await image(source, page.url, 'page');
  });
}
