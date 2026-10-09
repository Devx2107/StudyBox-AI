import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/localLlmLoader.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { createLocalLlmLoader, isMemoryAllocationError } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`,
);

function fixture() {
  const temporaryFiles = new Set();
  const downloads = new Set(['large', 'small']);
  const operations = [];
  const engine = {
    async loadModelFromData({ model }) {
      temporaryFiles.add(`/models/${model.id}.gguf`);
      operations.push(`load:${model.id}`);
    },
    async unloadModel() { operations.push('unload'); },
    cleanup() { operations.push('destroy'); },
  };
  const filesystem = { unlinkFile(path) { operations.push(`unlink:${path}`); temporaryFiles.delete(path); } };
  return { engine, filesystem, temporaryFiles, downloads, operations, loader: createLocalLlmLoader(engine, filesystem) };
}

test('a failed allocation removes its temporary copy and permits a smaller load', async () => {
  const f = fixture();
  const originalLoad = f.engine.loadModelFromData;
  const allocationError = new RangeError('Array buffer allocation failed');
  f.engine.loadModelFromData = async function (context) {
    await originalLoad.call(this, context);
    if (context.model.id === 'large') throw allocationError;
  };
  await assert.rejects(f.loader.loadModelFromData({ model: { id: 'large' } }), error => error === allocationError);
  assert.equal(f.temporaryFiles.size, 0);
  assert.deepEqual(f.operations, ['load:large', 'unload', 'destroy', 'unlink:/models/large.gguf']);
  assert.deepEqual([...f.downloads], ['large', 'small']);
  await f.loader.loadModelFromData({ model: { id: 'small' } });
  assert.deepEqual([...f.temporaryFiles], ['/models/small.gguf']);
});

test('successful model copies stay available for inference until unload', async () => {
  const f = fixture();
  await f.loader.loadModelFromData({ model: { id: 'small' } });
  assert.equal(f.temporaryFiles.has('/models/small.gguf'), true);
  await f.loader.unloadAndCleanup('small');
  assert.equal(f.temporaryFiles.size, 0);
  assert.deepEqual(f.operations, ['load:small', 'unload', 'unlink:/models/small.gguf']);
  assert.deepEqual([...f.downloads], ['large', 'small']);
});

test('unload failures still release the temporary file', async () => {
  const f = fixture();
  await f.loader.loadModelFromData({ model: { id: 'small' } });
  f.engine.unloadModel = async () => { throw new Error('Engine unavailable'); };
  await assert.rejects(f.loader.unloadModel(), /Engine unavailable/);
  assert.equal(f.temporaryFiles.size, 0);
});

test('cleanup failures do not replace the original model-load error', async () => {
  const f = fixture();
  const allocationError = new RangeError('Array buffer allocation failed');
  f.engine.loadModelFromData = async () => { throw allocationError; };
  f.engine.unloadModel = async () => { throw new Error('Unload failed'); };
  f.engine.cleanup = () => { throw new Error('Destroy failed'); };
  f.filesystem.unlinkFile = () => { throw new Error('Filesystem unavailable'); };
  await assert.rejects(f.loader.loadModelFromData({ model: { id: 'large' } }), error => error === allocationError);
});

test('cleanup only targets the requested model in the virtual filesystem', async () => {
  const f = fixture();
  f.temporaryFiles.add('/models/unrelated.gguf');
  await f.loader.loadModelFromData({ model: { id: 'small' } });
  await f.loader.unloadModel();
  assert.deepEqual([...f.temporaryFiles], ['/models/unrelated.gguf']);
});

test('memory recovery applies to allocation errors, not network or model-format errors', () => {
  for (const message of ['Array buffer allocation failed', 'ArrayBuffer allocation failed', 'WebAssembly memory allocation failed', 'Cannot enlarge memory arrays', 'Out of memory']) {
    assert.equal(isMemoryAllocationError(message), true, message);
  }
  for (const message of ['Failed to fetch', 'HTTP 404', 'Unsupported model architecture', 'Memory access out of bounds']) {
    assert.equal(isMemoryAllocationError(message), false, message);
  }
});
