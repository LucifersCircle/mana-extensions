import assert from 'node:assert/strict';
import test from 'node:test';
import { createManaRuntime } from './mana-runtime.mjs';
import { configureLiveTestSource, KAGANE_TEST_HOST, KAGANE_TEST_ORIGIN } from './kagane-test-config.mjs';

test('live Kagane uses the native moe mirror preference in its isolated runtime only', async () => {
  const selected = createManaRuntime(), other = createManaRuntime();
  assert.equal(KAGANE_TEST_ORIGIN, 'https://kagane.moe');
  assert.equal(await selected.ObjectStore.get('Kagane.mirror'), null);
  await configureLiveTestSource('Kagane', selected);
  assert.equal(await selected.ObjectStore.get('Kagane.mirror'), KAGANE_TEST_HOST);
  await configureLiveTestSource('MangaSushi', other);
  assert.equal(await other.ObjectStore.get('Kagane.mirror'), null);
  assert.equal(await createManaRuntime().ObjectStore.get('Kagane.mirror'), null);
});
