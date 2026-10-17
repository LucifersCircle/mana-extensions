import assert from 'node:assert/strict';
// Executes the built source. No provider fixtures or substitute HTTP reader path.
// A host without the official WebViewPage API must fail, never omit this source.
export async function testMarumaru({ source, check, searchResult, image }) {
  const context = { allowedContentRatings: [0, 1, 2, 3] };
  let catalog, detail, chapters;
  await check('Rendered native catalog returns canonical Korean titles', async () => {
    catalog = await source.search({ page: 1, context }); searchResult(catalog);
    for (const item of catalog.results) assert.match(item.id, /^[1-9]\d*$/);
  });
  await check('Rendered native text search retains canonical identity', async () => {
    const result = await source.search({ page: 1, query: '라멘 아카네코', context }); searchResult(result);
    assert(result.results.some(item => item.id === '17155'));
  });
  await check('Rendered details preserve chapter identity and genuine source labels', async () => {
    detail = await source.getContent('17155', context);
    assert.equal(detail.title, '라멘 아카네코');
    assert(detail.chapters?.length > 1);
    assert.equal(new Set(detail.chapters.map(c => c.chapterId)).size, detail.chapters.length);
    assert(detail.chapters.some(c => c.chapterId === '21332' && c.number === 2 && c.title.includes('1-2화')));
    await image(source, detail.cover);
  });
  await check('Native chapter indexes preserve ascending inventory and exact source numbers', async () => {
    assert(detail, 'Detail prerequisite failed'); chapters = await source.getChapters('17155');
    assert.deepEqual(chapters.map(c => [c.chapterId, c.number, c.title]), detail.chapters.map(c => [c.chapterId, c.number, c.title]));
    chapters.forEach((c, index) => { assert.equal(c.index, index); assert(Number.isFinite(c.number) && c.number > 0); });
  });
  await check('Rendered reader includes later lazy-loaded cuts and native image bytes', async () => {
    assert(chapters?.some(c => c.chapterId === '21331'), 'Reader chapter prerequisite failed');
    const result = await source.getChapterData('17155', '21331');
    assert(result.pages?.length > 8, 'Reader stopped at the initial eight mounted images');
    assert.equal(new Set(result.pages.map(p => p.url)).size, result.pages.length);
    result.pages.forEach((p, i) => assert.equal(p.url, `https://peer.storagewebtoon.store/api/media/episode/21331/${i + 1}.webp`));
    for (const page of [result.pages[0], result.pages.at(-1)]) await image(source, page.url);
  });
}
