import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

// Exercise the actual hook with React's server renderer and an SDK fixture.
// No browser, network, model download, or application data is used.
const require = createRequire(import.meta.url);
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/hooks/useModelLoader.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{
    name: 'model-loader-fixtures',
    setup(builder) {
      builder.onResolve({ filter: /^react$/ }, () => ({
        path: pathToFileURL(require.resolve('react')).href, external: true,
      }));
      builder.onResolve({ filter: /^@runanywhere\/web$/ }, () => ({ path: 'sdk', namespace: 'fixture' }));
      builder.onResolve({ filter: /^\.\.\/runanywhere$/ }, () => ({ path: 'catalog', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'catalog'
        ? `export const DEFAULT_LANGUAGE_MODEL_ID = 'primary';`
        : `export const ModelCategory = { Language: 'language' };
           export const ModelManager = Object.fromEntries(
             ['getModels', 'getLoadedModel', 'downloadModel', 'loadModel'].map(method =>
               [method, (...args) => globalThis.__modelLoaderFixture[method](...args)]));
           export const EventBus = { shared: { on: (...args) => globalThis.__modelLoaderFixture.on(...args) } };`,
      }));
    },
  }],
});
const { useModelLoader } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function setup(status = 'registered') {
  const fixture = {
    models: [
      { id: 'primary', name: 'Primary model', modality: 'language', status, memoryRequirement: 10 },
      { id: 'secondary', name: 'Smaller model', modality: 'language', status: 'registered', memoryRequirement: 1 },
    ],
    loaded: new Map(), listeners: new Map(), downloads: [], loads: [],
    getModels() { return this.models; },
    getLoadedModel(category) { return this.models.find(model => model.id === this.loaded.get(category)) ?? null; },
    update(id, patch) { this.models = this.models.map(model => model.id === id ? { ...model, ...patch } : model); },
    async downloadModel(id) { this.downloads.push(id); this.update(id, { status: 'downloaded' }); },
    async loadModel(id) {
      this.loads.push(id);
      this.loaded.set('language', id);
      this.update(id, { status: 'loaded' });
      return true;
    },
    on(event, callback) {
      const listeners = this.listeners.get(event) ?? new Set();
      this.listeners.set(event, listeners);
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    emit(event, payload) { this.listeners.get(event)?.forEach(callback => callback(payload)); },
    assertClean() { assert.equal([...this.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0); },
  };
  globalThis.__modelLoaderFixture = fixture;
  return fixture;
}

function loader(preferredModelId) {
  let result;
  function Harness() { result = useModelLoader('language', false, preferredModelId); return null; }
  renderToString(createElement(Harness));
  return result;
}

test('a swallowed download failure stops before loading and Retry can succeed', async () => {
  const fixture = setup();
  const success = fixture.downloadModel;
  fixture.downloadModel = async function (id) {
    this.downloads.push(id);
    this.update(id, { status: 'error', error: 'Failed to fetch' });
    this.emit('model.downloadFailed', { modelId: id, error: 'Failed to fetch' });
  };
  const hook = loader();
  assert.equal(await hook.ensure(), false);
  assert.equal(hook.getError(), 'Could not download Primary model: Failed to fetch');
  assert.deepEqual(fixture.loads, []);
  fixture.assertClean();
  fixture.downloadModel = success;
  assert.equal(await hook.ensure(), true);
  assert.equal(hook.getError(), null);
  assert.deepEqual(fixture.loads, ['primary']);
  fixture.assertClean();
});

test('thrown download errors preserve details and unsubscribe', async () => {
  const fixture = setup();
  fixture.downloadModel = async () => { throw new Error('Storage quota exceeded'); };
  const hook = loader();
  assert.equal(await hook.ensure(), false);
  assert.match(hook.getError(), /Could not download Primary model: Storage quota exceeded/);
  assert.deepEqual(fixture.loads, []);
  fixture.assertClean();
});

test('download completion is verified even without a failure event', async () => {
  const fixture = setup();
  fixture.downloadModel = async () => {};
  const hook = loader();
  assert.equal(await hook.ensure(), false);
  assert.match(hook.getError(), /download did not complete/);
  assert.deepEqual(fixture.loads, []);
  fixture.assertClean();
});

test('engine failures expose the SDK event detail instead of a generic message', async () => {
  const fixture = setup('downloaded');
  fixture.loadModel = async function (id) {
    this.update(id, { status: 'error', error: 'Generic engine failure' });
    this.emit('model.loadFailed', { modelId: id, error: 'WebAssembly memory allocation failed' });
    return false;
  };
  const hook = loader();
  assert.equal(await hook.ensure(), false);
  assert.match(hook.getError(), /^Could not load Primary model: WebAssembly memory allocation failed/);
  assert.match(hook.getError(), /Select LFM2 350M in Settings/);
  assert.deepEqual(fixture.downloads, []);
  fixture.assertClean();
});

test('registry errors are preserved when the SDK emits no event', async () => {
  const fixture = setup('downloaded');
  fixture.loadModel = async function (id) { this.update(id, { status: 'error', error: 'Unsupported architecture' }); return false; };
  const hook = loader();
  assert.equal(await hook.ensure(), false);
  assert.match(hook.getError(), /Unsupported architecture/);
  fixture.assertClean();
});

test('downloaded models load without another download and loaded models are reused', async () => {
  const fixture = setup('downloaded');
  const hook = loader();
  assert.equal(await hook.ensure(), true);
  assert.equal(await loader().ensure(), true);
  assert.deepEqual(fixture.downloads, []);
  assert.deepEqual(fixture.loads, ['primary']);
  fixture.assertClean();
});

test('concurrent callers share one download and load', async () => {
  const fixture = setup();
  const first = loader();
  const second = loader();
  assert.deepEqual(await Promise.all([first.ensure(), second.ensure()]), [true, true]);
  assert.deepEqual(fixture.downloads, ['primary']);
  assert.deepEqual(fixture.loads, ['primary']);
  fixture.assertClean();
});

test('shared failures reach each waiting caller synchronously after ensure', async () => {
  const fixture = setup();
  fixture.downloadModel = async function (id) {
    this.update(id, { status: 'error', error: 'HTTP 403' });
    this.emit('model.downloadFailed', { modelId: id, error: 'HTTP 403' });
  };
  const first = loader();
  const second = loader();
  assert.deepEqual(await Promise.all([first.ensure(), second.ensure()]), [false, false]);
  assert.equal(first.getError(), second.getError());
  assert.match(second.getError(), /HTTP 403/);
  fixture.assertClean();
});

test('a failed model does not prevent a waiting request for a different model', async () => {
  const fixture = setup();
  const success = fixture.downloadModel;
  fixture.downloadModel = async function (id) {
    if (id === 'primary') { this.update(id, { status: 'error', error: 'Primary unavailable' }); return; }
    await success.call(this, id);
  };
  const first = loader();
  const second = loader('secondary');
  assert.deepEqual(await Promise.all([first.ensure(), second.ensure()]), [false, true]);
  assert.equal(second.getError(), null);
  assert.deepEqual(fixture.loads, ['secondary']);
  fixture.assertClean();
});

test('multiple requests for the next model remain serialized and deduplicated', async () => {
  const fixture = setup();
  const hooks = [loader(), loader('secondary'), loader('secondary')];
  assert.deepEqual(await Promise.all(hooks.map(hook => hook.ensure())), [true, true, true]);
  assert.deepEqual(fixture.downloads, ['primary', 'secondary']);
  assert.deepEqual(fixture.loads, ['primary', 'secondary']);
  fixture.assertClean();
});

test('failures for other model categories do not contaminate this load', async () => {
  const fixture = setup();
  const success = fixture.downloadModel;
  fixture.downloadModel = async function (id) {
    this.emit('model.downloadFailed', { modelId: 'unrelated', error: 'Unrelated failure' });
    await success.call(this, id);
  };
  const hook = loader();
  assert.equal(await hook.ensure(), true);
  assert.equal(hook.getError(), null);
  fixture.assertClean();
});
