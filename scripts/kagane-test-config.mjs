// Test-only mirror preference. Production defaults and built bundles stay unchanged.
export const KAGANE_TEST_HOST = 'kagane.moe';
export const KAGANE_TEST_ORIGIN = `https://${KAGANE_TEST_HOST}`;

export async function configureLiveTestSource(name, runtime) {
  if (name === 'Kagane') await runtime.ObjectStore.set('Kagane.mirror', KAGANE_TEST_HOST);
}
