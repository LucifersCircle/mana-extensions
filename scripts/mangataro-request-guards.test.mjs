// Host infrastructure only: permit the proven public catalog read, not POSTs in general.
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertReadOnlyMangaTaroPost, redactURL } from './mana-runtime.mjs';
test('MangaTaro host permits only the exact public browse POST and redacts its public chapter token', () => {
  const body = { page: 1, search: 'Eleceed', years: '[2018]', genres: '[7]', types: '["Manhwa"]', statuses: '["Ongoing"]', sort: 'popular_desc', genreMatchMode: 'all' };
  const request = { url: 'https://mangataro.org/wp-json/manga/v1/load', method: 'POST', body: JSON.stringify(body) };
  assert.doesNotThrow(() => assertReadOnlyMangaTaroPost(request));
  for (const changes of [{ url: 'https://mangataro.org/auth/login' }, { url: request.url + '?action=write' }, { method: 'DELETE' }, { body: JSON.stringify({ ...body, action: 'write' }) }, { body: JSON.stringify({ ...body, page: 0 }) }, { body: JSON.stringify({ ...body, sort: ['post_desc'] }) }, { body: JSON.stringify({ ...body, sort: null }) }, { body: JSON.stringify({ ...body, genres: '["7"]' }) }, { body: JSON.stringify({ ...body, types: '["Account"]' }) }, { body: JSON.stringify({ ...body, statuses: '["unknown"]' }) }]) assert.throws(() => assertReadOnlyMangaTaroPost({ ...request, ...changes }));
  assert.equal(new URL(redactURL('https://mangataro.org/auth/manga-chapters?_t=public-bootstrap&_ts=1')).searchParams.get('_t'), '[redacted]');
});
