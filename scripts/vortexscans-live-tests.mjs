import assert from 'node:assert/strict';
import { load } from 'cheerio';

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
    const malformed = freshSource(); malformed.api.getPost = async () => ({ post: { ...rawPost, genres: { unrelated: true }, ratingGenres: { unrelated: true } } });
    assert.equal((await malformed.getContent(id, { allowedContentRatings: [2] })).contentRating, 2, 'Non-array unknown metadata remains native Mature fallback');
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
    const snapshot = { featured: [], today: [], popular: [], latest: pool.slice(0, 36).map((post) => ({ ...post, genres: [{ id: 1, name: 'Mature' }] })), perPage: 36 };
    target.home = async () => snapshot;
    target.api.getTaggedPosts = async (_tag, page) => ({ posts: pool.slice((page - 1) * 36, page * 36).map((post) => ({ ...post, genres: [{ id: 1, name: 'Mature' }] })) });
    const section = await target.resolvePageSection({ id: 'home', context }, 'latest'); assert(section.items.length); assert.deepEqual(Array.from(section.viewMoreLink.request.context.allowedContentRatings), [2]);
    const start = requests.length, empty = await source.resolvePageSection({ id: 'home', context: { allowedContentRatings: [] } }, 'popular-today'); assert.equal(empty.items.length, 0); assert.equal(requests.length, start);
    const all = await source.resolvePageSection({ id: 'home' }, 'popular-today'); assert(all.items.length);
    for (const allowed of [0, 1, 2, 3]) {
      const popular = await source.resolvePageSection({ id: 'home', context: { allowedContentRatings: [allowed] } }, 'popular-today');
      assert.deepEqual(ids(popular.items), ids(all.items.filter((item) => item.contentRating === allowed)));
      assert(popular.items.every((item) => item.contentRating === allowed));
    }
  });
  let homeTarget, homeHTML, homeData, homeSections, homeResolved;
  const slug = (id) => decodeURIComponent(id.slice(id.indexOf(':') + 1));
  const canonicalHref = (href) => /^\/series\/[^/?#]+$/.test(href ?? '') ? decodeURIComponent(href.slice(8)) : undefined;
  const sameIDs = (actual, expected) => assert.deepEqual(ids(actual), Array.from(expected, canonicalID));
  const transformedHTML = (fields) => `<script>(self.$R=self.$R||{})["tsr"]=[];$_TSR.router=($R=>$R[0]=${JSON.stringify(fields).replaceAll('"id":', 'id:').replaceAll('"slug":', 'slug:')})({});</script>`;
  const fieldsFor = ({ featured = homeData.featured, latest = homeData.latest, today = homeData.today, popular = homeData.popular } = {}) => ({
    combinedSliderPosts: featured, latestMangaPosts: latest, todayPosts: { data: { posts: today } }, monthlyPosts: popular,
    transformedTopSeries: popular.map((post, index) => ({ id: index + 1, slug: post.slug, title: post.postTitle, coverImage: post.featuredImage })),
    perPage: 36, hasPinnedSeriesSection: false, latestReleaseFilters: ['latest', 'new'],
  });
  await check('All real home rows share one cold homepage and repeat without provider requests or N+1', async () => {
    homeTarget = freshSource(); const getText = homeTarget.api.getText.bind(homeTarget.api); let homeRequests = 0;
    homeTarget.api.getText = async (...args) => { homeRequests++; homeHTML = await getText(...args); return homeHTML; };
    const before = requests.length;
    homeSections = await homeTarget.getSectionsForPage({ id: 'home' });
    homeResolved = await Promise.all(homeSections.map((section) => homeTarget.resolvePageSection({ id: 'home' }, section.id)));
    homeData = await homeTarget.home();
    assert.equal(homeRequests, 1); assert(homeResolved.every((section) => section.items.length));
    const cold = requests.slice(before), collections = homeSections.filter((section) => section.id.startsWith('collection:'));
    assert.equal(cold.length, 3 + collections.length, 'Only homepage, collection index, New feed and each real collection may load');
    assert(cold.every((request) => !new URL(request.url).pathname.match(/\/post$|\/chapters$|\/chapter$|\/query$/)), 'No per-title metadata or all-time ranking request');
    const warm = requests.length;
    await homeTarget.getSectionsForPage({ id: 'home' });
    await Promise.all(homeSections.map((section) => homeTarget.resolvePageSection({ id: 'home' }, section.id)));
    assert.equal(requests.length, warm); console.log(`VORTEX HOME ${homeSections.length} sections: cold${cold.length}/warm0/home${homeRequests}`);
  });
  await check('Featured Popular Today Latest Releases and monthly ranking match exact same-response website IDs order and originals', async () => {
    assert(homeHTML && homeData); const $ = load(homeHTML), posts = new Map();
    for (const match of homeHTML.matchAll(/\{id:(\d+),slug:("(?:\\.|[^"\\])*")/g)) {
      const name = JSON.parse(match[2]); if (posts.has(name)) assert.equal(posts.get(name), Number(match[1])); posts.set(name, Number(match[1]));
    }
    const domSlugs = (anchors) => [...new Set(anchors.toArray().map((node) => canonicalHref($(node).attr('href'))).filter(Boolean))];
    const domRows = {
      featured: domSlugs($('a[aria-label^="Open "][href^="/series/"]')),
      'popular-today': domSlugs($('h2').filter((_, node) => $(node).text().trim() === 'Popular Today').first().closest('section').find('a[href^="/series/"]')),
      latest: domSlugs($('h2').filter((_, node) => $(node).text().trim() === 'Latest Releases').first().parent().parent().next().find('a[href^="/series/"]')),
      'most-popular': domSlugs($('h2').filter((_, node) => $(node).text().trim() === 'Most Popular').first().closest('section').find('a[href^="/series/"]')),
    };
    assert.equal(domRows.featured.length, 6); assert.equal(domRows['popular-today'].length, 20); assert.equal(domRows.latest.length, 36); assert.equal(domRows['most-popular'].length, 9);
    for (const [sectionID, names] of Object.entries(domRows)) {
      const items = homeResolved[homeSections.findIndex((section) => section.id === sectionID)].items;
      assert.deepEqual(Array.from(items, (item) => slug(item.id)), names);
      assert.deepEqual(ids(items), names.map((name) => canonicalID({ id: posts.get(name), slug: name })));
      for (const item of items) assert(homeHTML.includes(`featuredImage:${JSON.stringify(item.cover)}`), 'Only verbatim source originals');
    }
    const collections = homeSections.filter((section) => section.id.startsWith('collection:'));
    assert.deepEqual(Array.from(collections, (section) => ({ id: section.id, title: section.title })), $('a[href^="/collections/"]').toArray().map((node) => ({ id: `collection:${$(node).attr('href').slice('/collections/'.length)}`, title: $(node).text().trim() })));
    assert.deepEqual(Array.from(homeSections, (section) => section.title), ['Featured', 'Popular Today', 'Latest Releases', 'New', ...collections.map((section) => section.title), 'Most Popular']);
    assert(homeData.popular.every((post) => post.id > 10), 'Canonical monthly post IDs must not be ranking positions');
  });
  await check('Bounded Featured Popular Today and monthly snapshots never advertise invented continuation', async () => {
    for (const id of ['featured', 'popular-today', 'most-popular']) {
      const result = await homeTarget.resolvePageSection({ id: 'home' }, id); assert.equal(result.viewMoreLink, undefined);
    }
    await assert.rejects(homeTarget.search({ page: 1, listId: 'featured' }), /Unknown VortexScans section/);
  });
  await check('Latest View More starts at exact home36 then uses real native page2 with cumulative canonical IDs', async () => {
    const resolved = await homeTarget.resolvePageSection({ id: 'home' }, 'latest'); assert(resolved.viewMoreLink);
    const first = await homeTarget.search(resolved.viewMoreLink.request); sameIDs(first.results, homeData.latest); assert.equal(first.isLastPage, false);
    const original = homeTarget.api.getTaggedPosts.bind(homeTarget.api); let physical;
    homeTarget.api.getTaggedPosts = async (...args) => { assert.equal(args[0], 'latestUpdatePinned'); assert.equal(args[2], 36); const result = await original(...args); physical = result; return result; };
    const before = requests.length, second = await homeTarget.search({ ...resolved.viewMoreLink.request, page: 2 });
    assert(physical?.posts?.length); const seen = new Set(ids(first.results));
    sameIDs(second.results, physical.posts.filter((post) => !seen.has(canonicalID(post)) && !post.isNovel && post.seriesType !== 'NOVEL'));
    assert.equal(requests.length - before, 1); assert(second.results.length); assert(second.results.every((item) => !seen.has(item.id)));
    const warm = requests.length; assert.deepEqual(ids((await homeTarget.search({ ...resolved.viewMoreLink.request, page: 2 })).results), ids(second.results)); assert.equal(requests.length, warm);
  });
  await check('Home36 continuation survives duplicate-only excluded-only overlap terminal pages and request-scoped policy', async () => {
    assert(pool.length >= 70); const posts = pool.slice(0, 70), target = freshSource(), calls = [];
    target.home = async () => ({ ...homeData, latest: posts.slice(0, 36).map((post) => ({ ...post, genres: undefined })) });
    target.api.getTaggedPosts = async (_tag, page, count) => { calls.push(page); assert.equal(count, 36); return { posts: (page === 2 ? posts.slice(0, 36) : page === 3 ? posts.slice(28, 64) : posts.slice(64)).map((post) => ({ ...post, genres: [{ id: 1, name: 'Action' }] })) }; };
    const a = await target.search({ page: 1, listId: 'latest' }), b = await target.search({ page: 2, listId: 'latest' }), c = await target.search({ page: 3, listId: 'latest' });
    sameIDs([...a.results, ...b.results, ...c.results], posts); assert.equal(c.isLastPage, true); assert.deepEqual(calls, [2, 3, 4]);
    const safe = await target.search({ page: 1, listId: 'latest', context: { allowedContentRatings: [0] } }); sameIDs(safe.results, posts.slice(36, 64));
    const safeNext = await target.search({ page: 2, listId: 'latest', context: { allowedContentRatings: [0] } }); sameIDs(safeNext.results, posts.slice(64)); assert.equal(safeNext.isLastPage, true);
    const mature = await target.search({ page: 1, listId: 'latest', context: { allowedContentRatings: [2] } }); sameIDs(mature.results, posts.slice(0, 36));
    assert.equal((await target.search({ page: 2, listId: 'latest', context: { allowedContentRatings: [2] } })).isLastPage, true);
  });
  await check('Same-response genre enrichment requires exact numeric ID and slug and retains positive warnings and Mature unknown fallback', async () => {
    const post = homeData.featured[0], other = homeData.featured[1], sparse = { ...post, genres: [{ color: '' }] };
    const run = async (latest, genres = sparse.genres) => {
      const target = freshSource(); target.api.getText = async () => transformedHTML(fieldsFor({ featured: [{ ...sparse, genres }, { ...other, genres: undefined }], today: [], latest, popular: [sparse] }));
      return target.resolvePageSection({ id: 'home' }, 'featured');
    };
    const complete = { ...post, genres: [{ id: 1, name: 'Action' }] };
    assert.equal((await run([complete])).items[0].contentRating, 0, 'Exact same-response canonical source genres');
    assert.equal((await run([{ ...complete, id: post.id + 10000 }])).items[0].contentRating, 2, 'Same title and slug with a foreign numeric ID cannot enrich');
    assert.equal((await run([{ ...complete, slug: `${post.slug}-foreign` }])).items[0].contentRating, 2, 'Same numeric ID and title with a foreign slug cannot enrich');
    const warning = await run([complete], [{ id: 1, name: 'Hentai' }, { color: '' }]); assert.equal(warning.items[0].contentRating, 3); assert.equal(warning.items[1].contentRating, 2);
    const positive = freshSource(); positive.api.getText = async () => transformedHTML(fieldsFor({ featured: [{ ...post, genres: [{ id: 1, name: 'Hentai' }] }], latest: [complete], today: [sparse], popular: [sparse] }));
    assert.equal((await positive.resolvePageSection({ id: 'home' }, 'most-popular')).items[0].contentRating, 3, 'A later safe duplicate cannot erase same-response positive warnings');
    for (const [name, expected] of [['Hentai', 3], ['Action', 2]]) {
      const incomplete = freshSource(); incomplete.api.getText = async () => transformedHTML(fieldsFor({ featured: [{ ...post, genres: [{ id: 1, name }, { color: '' }] }], latest: [], today: [], popular: [sparse] }));
      assert.equal((await incomplete.resolvePageSection({ id: 'home' }, 'most-popular')).items[0].contentRating, expected, 'Partial warnings propagate without claiming partial ordinary metadata is Safe');
    }
    for (const [name, expected] of [['Hentai', 3], ['Ecchi', 1], ['Mature', 2]]) {
      const missingID = freshSource(); missingID.api.getText = async () => transformedHTML(fieldsFor({ featured: [{ ...post, genres: [{ name }, { color: '' }] }], latest: [complete], today: [], popular: [sparse] }));
      assert.equal((await missingID.resolvePageSection({ id: 'home' }, 'most-popular')).items[0].contentRating, expected, 'A real warning name needs no invented taxonomy ID');
      const ranked = fieldsFor({ featured: [], latest: [], today: [], popular: [sparse] }); ranked.transformedTopSeries[0].tags = [{ name }];
      const rankOnly = freshSource(); rankOnly.api.getText = async () => transformedHTML(ranked);
      assert.equal((await rankOnly.resolvePageSection({ id: 'home' }, 'most-popular')).items[0].contentRating, expected, 'Exact canonical rank tag names remain authoritative');
    }
    const today = homeData.today[0], safeToday = { ...today, genres: [{ id: 1, name: 'Action' }] };
    const ratingFields = fieldsFor({ featured: [{ ...today, genres: [{ name: 'Hentai' }, { color: '' }] }], latest: [safeToday], today: [{ ...today, genres: [] }], popular: [{ ...today, genres: [] }] });
    const $ = load(homeHTML), popularDOM = $('h2').filter((_, node) => $(node).text().trim() === 'Popular Today').first().closest('section').toString();
    const malformedCover = transformedHTML(ratingFields).replace(/"featuredImage":"(?:\\.|[^"\\])*"/g, '"featuredImage":"\\q"') + popularDOM;
    const fallback = freshSource(); fallback.api.getText = async () => malformedCover;
    const kept = await fallback.resolvePageSection({ id: 'home' }, 'popular-today');
    const originalImage = $(popularDOM).find('a[href^="/series/"]').first().find('img[src]').first().attr('data-fallback-src');
    assert.equal(kept.items[0].contentRating, 3, 'Malformed optional image metadata cannot erase a known warning');
    assert(kept.items[0].cover === originalImage || kept.items[0].cover.includes('/storage.vortexscans.org/'), 'Retain verified source DOM cover fallback');
    const invalidRating = freshSource(); invalidRating.api.getText = async () => malformedCover.replace('"Hentai"', '"\\q"');
    await assert.rejects(invalidRating.resolvePageSection({ id: 'home' }, 'popular-today'), /JSON|escape|unsupported|data|token/i, 'Malformed rating evidence must fail visibly, never downgrade');
    const otherRow = freshSource(); otherRow.api.getText = async () => transformedHTML({ ...ratingFields, todayPosts: { data: { posts: [] } } }) + popularDOM;
    assert.equal((await otherRow.resolvePageSection({ id: 'home' }, 'popular-today')).items[0].contentRating, 3, 'Exact other home records preserve warnings when today metadata is omitted');
    const noIdentity = freshSource(); noIdentity.api.getText = async () => `<script>window.ids=[{id:${today.id},slug:${JSON.stringify(today.slug)}}]</script>` + transformedHTML(fieldsFor({ featured: [], latest: [], today: [], popular: [] })) + popularDOM;
    await assert.rejects(noIdentity.resolvePageSection({ id: 'home' }, 'popular-today'), /missing verified canonical rating metadata/, 'Unverified DOM identity must error rather than become Mature');


  });
  await check('Warm home snapshots rebind complete current native context and empty policy performs no provider work', async () => {
    const before = requests.length;
    for (const allowed of [undefined, [], [0], [1], [2], [3], [0, 2]]) {
      const context = { allowedContentRatings: allowed, origin: 0 };
      for (const id of ['featured', 'popular-today', 'latest', 'most-popular']) {
        const result = await homeTarget.resolvePageSection({ id: 'home', context }, id);
        assert(result.items.every((item) => item.context === context));
        if (allowed !== undefined) assert(result.items.every((item) => allowed.includes(item.contentRating)));
        if (!allowed?.length && allowed !== undefined) assert.equal(result.items.length, 0);
        if (result.viewMoreLink) assert.equal(result.viewMoreLink.request.context, context);
      }
    }
    const absent = await homeTarget.resolvePageSection({ id: 'home' }, 'featured'); assert(absent.items.every((item) => item.context === undefined));
    assert.equal(requests.length, before);
  });
  await check('Ambiguous or conflicting homepage ranking and changed release configuration fail visibly without alternate requests', async () => {
    const fields = fieldsFor();
    for (const changed of [
      { ...fields, transformedTopSeries: [{ ...fields.transformedTopSeries[0], slug: 'missing-canonical-slug' }] },
      { ...fields, transformedTopSeries: [fields.transformedTopSeries[0], fields.transformedTopSeries[0]] },
      { ...fields, perPage: 48 }, { ...fields, hasPinnedSeriesSection: true },
    ]) {
      const target = freshSource(); target.api.getText = async () => transformedHTML(changed); const before = requests.length;
      await assert.rejects(target.resolvePageSection({ id: 'home' }, 'most-popular'), /conflicting canonical identity|configuration changed/); assert.equal(requests.length, before);
    }
  });
  await check('Native detail to chapters to reader loads complete first and last image bodies with source headers', async () => {
    const contentID = canonicalID(rawPost), detail = await source.getContent(contentID); assert(detail.webUrl);
    const chapters = await source.getChapters(contentID); assert(chapters.length);
    const chapter = chapters[0], pages = (await source.getChapterData(contentID, chapter.chapterId, chapter)).pages; assert(pages.length);
    for (const page of [pages[0], ...(pages.length > 1 ? [pages.at(-1)] : [])]) {
      const request = await source.willRequestImage(page.url), response = await fetch(request.url, { headers: request.headers, signal: AbortSignal.timeout(30_000), redirect: 'error' });
      assert(response.ok); assert(response.headers.get('content-type')?.startsWith('image/'));
      const bytes = Buffer.from(await response.arrayBuffer()); assert(bytes.length > 100);
      assert(bytes.subarray(0, 3).toString('hex') === 'ffd8ff' || bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' || (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'));
      console.log(`VORTEX COMPLETE READER ${chapter.chapterId}: ${bytes.length} bytes ${response.headers.get('content-type')}`);
    }
  });

}
