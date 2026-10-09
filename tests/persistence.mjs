import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/snapshotPersistence.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { createSnapshotPersistence } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const storageKey = 'recovery-test';
const tick = () => new Promise(resolve => setImmediate(resolve));
function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

test('edits can be recovered immediately before the delayed file save', async () => {
  const storage = memoryStorage();
  const writes = [];
  const store = createSnapshotPersistence({ storage, storageKey, write: async body => { writes.push(body); return true; } });
  const latest = { notes: 'Latest notes', preferredLanguageModelId: 'small-model' };
  store.save(latest);
  assert.deepEqual(store.restore(), latest);
  assert.deepEqual(createSnapshotPersistence({ storage, storageKey, write: async () => true }).restore(), latest);
  assert.equal(writes.length, 0);
  await store.flush();
  assert.deepEqual(writes.map(JSON.parse), [latest]);
  assert.equal(store.restore(), null);
});

test('multiple edits in the debounce window write only the latest snapshot', async () => {
  const writes = [];
  const store = createSnapshotPersistence({ storage: memoryStorage(), storageKey, write: async body => { writes.push(JSON.parse(body)); return true; } });
  store.save({ notes: 'first' });
  store.save({ notes: 'latest' });
  await store.flush();
  assert.deepEqual(writes, [{ notes: 'latest' }]);
});

test('overlapping file saves are serialized and an old success retains newer recovery data', async () => {
  const storage = memoryStorage();
  const first = deferred();
  const second = deferred();
  const writes = [];
  const store = createSnapshotPersistence({ storage, storageKey, write: body => {
    writes.push(JSON.parse(body));
    return writes.length === 1 ? first.promise : second.promise;
  } });
  store.save({ notes: 'first' });
  const savingFirst = store.flush();
  store.save({ notes: 'latest' });
  const savingSecond = store.flush();
  assert.deepEqual(writes, [{ notes: 'first' }]);
  first.resolve(true);
  await savingFirst;
  await tick();
  assert.deepEqual(writes, [{ notes: 'first' }, { notes: 'latest' }]);
  assert.deepEqual(store.restore(), { notes: 'latest' });
  second.resolve(true);
  await savingSecond;
  assert.equal(store.restore(), null);
});

test('static-host HTTP failures keep edits available across reloads', async () => {
  const storage = memoryStorage();
  const store = createSnapshotPersistence({ storage, storageKey, write: async () => false });
  store.save({ notes: 'production notes' });
  await store.flush();
  assert.deepEqual(createSnapshotPersistence({ storage, storageKey, write: async () => false }).restore(), { notes: 'production notes' });
});

test('network errors keep the recovery copy and a later edit can save successfully', async () => {
  let available = false;
  const store = createSnapshotPersistence({ storage: memoryStorage(), storageKey, write: async () => {
    if (!available) throw new Error('offline');
    return true;
  } });
  store.save({ notes: 'offline edit' });
  await store.flush();
  assert.deepEqual(store.restore(), { notes: 'offline edit' });
  available = true;
  store.save({ notes: 'online edit' });
  await store.flush();
  assert.equal(store.restore(), null);
});

test('unavailable or quota-limited browser storage does not block file saves', async () => {
  for (const storage of [null, {
    getItem() { throw new Error('disabled'); },
    setItem() { throw new Error('quota exceeded'); },
    removeItem() { throw new Error('disabled'); },
  }]) {
    const writes = [];
    const store = createSnapshotPersistence({ storage, storageKey, write: async body => { writes.push(JSON.parse(body)); return true; } });
    store.save({ notes: 'saved to disk' });
    await store.flush();
    assert.deepEqual(writes, [{ notes: 'saved to disk' }]);
    assert.equal(store.restore(), null);
  }
});

test('invalid recovery data falls back without touching other stored data', () => {
  const storage = memoryStorage();
  storage.setItem('other-setting', 'preserved');
  const store = createSnapshotPersistence({ storage, storageKey, write: async () => true });
  for (const invalid of ['{broken', 'null', '42', '[]', '"text"']) {
    storage.setItem(storageKey, invalid);
    assert.equal(store.restore(), null);
  }
  assert.equal(storage.getItem('other-setting'), 'preserved');
});
