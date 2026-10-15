import assert from 'node:assert/strict';

// Rating-policy checks use the actual native bundle and mutate only captured
// current public responses in memory. No permanent provider fixtures.
export async function testVortexRatings({ source, check, freshSource, requests }) {
  let pool, rawPost;
  const ids = (items) => Array.from(items, (item) => item.id);
  const canonicalID = (post) => `${post.id}:${encodeURIComponent(post.slug).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;
  await check('Native policy distinguishes no policy from empty and captures current public catalog once', async () => {
    const target = freshSource(), original = target.api.query.bind(target.api), captured = [];
    target.api.query = async (...args) => { const value = await original(...args); captured.push(...value.posts); return value; };
    const start = requests.length;
    const empty = await target.search({ page: 1, context: { allowedContentRatings: [] } }); assert.equal(empty.results.length, 0); assert.equal(empty.isLastPage, true);
    await assert.rejects(target.getContent('1:unread', { allowedContentRatings: [] }), /excluded/); assert.equal(requests.length, start);
    const first = await target.search({ page: 1 }); assert(first.results.length);
    if (!first.isLastPage) await target.search({ page: 2 });
    pool = [...new Map(captured.map((post) => [post.id, post])).values()].filter((post) => !post.isNovel && post.seriesType !== 'NOVEL');
    assert(pool.length > 48, 'Need current multi-page native catalog for policy traversal'); rawPost = pool[0];
    const before = requests.length, nativeAll = await target.search({ page: 1, context: { allowedContentRatings: [0, 1, 2, 3] } });
    assert.deepEqual(ids(nativeAll.results), ids(first.results)); assert.equal(requests.length, before, 'Native policy reused unfiltered physical metadata');
  });
  await check('Known source genres retain native classes and incomplete metadata uses Mature details fallback', async () => {
    assert(pool?.length >= 5);
    const names = ['Action', 'Ecchi', 'Mature', 'Hentai'];
    const posts = pool.slice(0, 5).map((post, index) => ({ ...post, genres: index < 4 ? [{ id: 1, name: names[index] }] : undefined }));
    for (const allowed of [0, 1, 2, 3]) {
      const target = freshSource(); target.api.query = async () => ({ posts, totalCount: posts.length });
      const result = await target.search({ page: 1, context: { allowedContentRatings: [allowed] } });
      assert.deepEqual(ids(result.results), posts.filter((_post, index) => (index < 4 ? index : 2) === allowed).map((post) => canonicalID(post)));
      assert(result.results.every((item) => item.contentRating === allowed));
    }
    const target = freshSource(); target.api.getPost = async () => ({ post: { ...rawPost, genres: undefined } });
    const id = canonicalID(rawPost), content = await target.getContent(id, { allowedContentRatings: [2] });
    assert.equal(content.contentRating, 2); assert(content.additionalInfo.some((section) => section.id === 'content-rating-metadata'));
    await assert.rejects(target.getContent(id, { allowedContentRatings: [0, 1, 3] }), /excluded/);
    assert.equal((await target.getContent(id)).contentRating, 2);
    const demographic = freshSource(); demographic.api.getPost = async () => ({ post: { ...rawPost, genres: [{ id: 1, name: 'Harem' }, { id: 2, name: 'BL' }] } });
    assert.equal((await demographic.getContent(id, { allowedContentRatings: [0] })).contentRating, 0, 'Relationships/demographics do not invent sexualization');
  });
  await check('Native concatenated pages survive partial overlap duplicate-only and rating-excluded physical pages', async () => {
    const posts = pool.slice(0, 70); assert(posts.length > 48);
    const target = freshSource(), calls = [];
    target.api.query = async ({ page }) => { calls.push(page); return { posts: (page <= 2 ? posts.slice(0, 48) : posts.slice(40)).map((post) => ({ ...post, genres: [{ id: 1, name: 'Mature' }] })), totalCount: posts.length }; };
    const a = await target.search({ page: 1, context: { allowedContentRatings: [2] } }), b = await target.search({ page: 2, context: { allowedContentRatings: [2] } });
    assert.deepEqual(ids([...a.results, ...b.results]), posts.map((post) => canonicalID(post)));
    assert.equal(new Set(ids([...a.results, ...b.results])).size, posts.length); assert.equal(b.isLastPage, true); assert.deepEqual(calls, [1, 2, 3]);
    const before = calls.length; assert.deepEqual(ids((await target.search({ page: 2, context: { allowedContentRatings: [2] } })).results), ids(b.results)); assert.equal(calls.length, before);
    const excluded = await target.search({ page: 1, context: { allowedContentRatings: [0] } }); assert.equal(excluded.results.length, 0); assert.equal(excluded.isLastPage, true);
    assert.deepEqual(ids((await target.search({ page: 1, context: { allowedContentRatings: [2] } })).results), ids(a.results));
    const short = freshSource(), shortCalls = [];
    short.api.query = async ({ page }) => { shortCalls.push(page); return { posts: (page === 1 ? posts.slice(0, 40) : posts.slice(40)).map((post) => ({ ...post, genres: [{ id: 1, name: 'Mature' }] })), totalCount: posts.length }; };
    const shortFirst = await short.search({ page: 1, context: { allowedContentRatings: [2] } }); assert.equal(shortFirst.results.length, 40); assert.equal(shortFirst.isLastPage, false, 'Authoritative total outranks a short physical page');
    const shortNext = await short.search({ page: 2, context: { allowedContentRatings: [2] } }); assert.equal(shortNext.isLastPage, true);
    assert.deepEqual(ids([...shortFirst.results, ...shortNext.results]), posts.map((post) => canonicalID(post))); assert.deepEqual(shortCalls, [1, 2]);
    const incomplete = freshSource(); incomplete.api.query = async ({ page }) => ({ posts: page === 1 ? posts.slice(0, 40) : [], totalCount: posts.length });
    await incomplete.search({ page: 1 }); await assert.rejects(incomplete.search({ page: 2 }), /incomplete catalog page/);
    const repeated = freshSource(), repeatedCalls = []; repeated.api.query = async ({ page }) => { repeatedCalls.push(page); return { posts: posts.slice(0, 48), totalCount: posts.length }; };
    await repeated.search({ page: 1 }); await assert.rejects(repeated.search({ page: 2 }), /ten repeated catalog pages/); assert.deepEqual(repeatedCalls, Array.from({ length: 11 }, (_value, index) => index + 1));
    const skipped = freshSource(); skipped.api.query = async ({ page }) => ({ posts: (page <= 2 ? posts.slice(0, 48) : posts.slice(40)).map((post) => ({ ...post, genres: page <= 2 ? undefined : [{ id: 1, name: 'Action' }] })), totalCount: posts.length });
    const visible = await skipped.search({ page: 1, context: { allowedContentRatings: [0] } }); assert(visible.results.length); assert(visible.results.every((item) => item.contentRating === 0));
    // IDs already seen on excluded pages stay raw duplicates, not newly emitted.
    assert.deepEqual(ids(visible.results), posts.slice(48).map((post) => canonicalID(post)));
  });
  await check('Discover and view-more retain exact native policy while sparse cards use supported fallback', async () => {
    const context = { allowedContentRatings: [2] }, target = freshSource();
    target.api.getTaggedPosts = async (_tag, page) => ({ posts: pool.slice((page - 1) * 48, page * 48).map((post) => ({ ...post, genres: [{ id: 1, name: 'Mature' }] })) });
    const section = await target.resolvePageSection({ id: 'home', context }, 'latest'); assert(section.items.length); assert.deepEqual(Array.from(section.viewMoreLink.request.context.allowedContentRatings), [2]);
    const start = requests.length, empty = await source.resolvePageSection({ id: 'home', context: { allowedContentRatings: [] } }, 'popular-today'); assert.equal(empty.items.length, 0); assert.equal(requests.length, start);
    const popular = await source.resolvePageSection({ id: 'home', context }, 'popular-today'); assert(popular.items.length); assert(popular.items.every((item) => item.contentRating === 2));
    const blocked = await source.resolvePageSection({ id: 'home', context: { allowedContentRatings: [0] } }, 'popular-today'); assert.equal(blocked.items.length, 0);
  });
}
