import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getEventListeners } from 'node:events';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const modules = await Promise.all(['textGeneration', 'mediaCapture', 'taskScope', 'voicePlayback'].map(async name => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL(`../src/lib/${name}.ts`, import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'sdk-fixture', setup(builder) {
      builder.onResolve({ filter: /^@runanywhere\/web-llamacpp$/ }, () => ({ path: 'sdk', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: 'export const TextGeneration = { generateStream() { throw new Error("Provide a test generator"); } };',
      }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}));
const [{ createTextGenerator }, { startMediaCapture }, { createTaskScope }, { processVoiceTurn }] = modules;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function session(stream, result = Promise.resolve({ text: 'complete' })) {
  return { stream, result, cancellations: 0, cancel() { this.cancellations += 1; } };
}

test('successful streams preserve tokens and final output without cancellation', async () => {
  const native = session((async function* () { yield 'one'; yield 'two'; })());
  const controller = new AbortController();
  const managed = await createTextGenerator(async () => native)('prompt', {}, controller.signal);
  const tokens = [];
  for await (const token of managed.stream) tokens.push(token);
  assert.deepEqual(tokens, ['one', 'two']);
  assert.equal((await managed.result).text, 'complete');
  assert.equal(native.cancellations, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('an already cancelled task never starts native generation', async () => {
  const controller = new AbortController();
  controller.abort();
  let starts = 0;
  await assert.rejects(createTextGenerator(async () => { starts += 1; })('prompt', {}, controller.signal), { name: 'AbortError' });
  assert.equal(starts, 0);
});

test('cancellation during async startup cancels the late native session', async () => {
  const gate = deferred();
  const output = deferred();
  const native = session((async function* () {})(), output.promise);
  const controller = new AbortController();
  const opening = createTextGenerator(() => gate.promise)('prompt', {}, controller.signal);
  controller.abort();
  gate.resolve(native);
  await assert.rejects(opening, { name: 'AbortError' });
  output.reject(new Error('Cancelled native result'));
  await tick();
  assert.equal(native.cancellations, 1);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('cancellation during iteration prevents further tokens and removes listeners', async () => {
  const gate = deferred();
  const output = deferred();
  const native = session((async function* () { yield 'first'; await gate.promise; yield 'late'; })(), output.promise);
  const controller = new AbortController();
  const managed = await createTextGenerator(async () => native)('prompt', {}, controller.signal);
  assert.equal((await managed.stream.next()).value, 'first');
  const next = managed.stream.next();
  controller.abort();
  gate.resolve();
  await assert.rejects(next, { name: 'AbortError' });
  output.resolve({ text: 'first' });
  await managed.result;
  assert.equal(native.cancellations, 1);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('breaking out of token iteration cancels native generation exactly once', async () => {
  const output = deferred();
  const native = session((async function* () { yield 'first'; yield 'second'; })(), output.promise);
  const managed = await createTextGenerator(async () => native)('prompt');
  for await (const token of managed.stream) { assert.equal(token, 'first'); break; }
  managed.cancel();
  assert.equal(native.cancellations, 1);
  output.resolve({ text: 'first' });
  await managed.result;
});

test('a result rejecting before the stream error remains observed and preserves both errors', async () => {
  const output = deferred();
  const gate = deferred();
  const failure = new Error('Native inference failed');
  const native = session((async function* () { await gate.promise; throw failure; })(), output.promise);
  const managed = await createTextGenerator(async () => native)('prompt');
  output.reject(failure);
  await tick();
  gate.resolve();
  await assert.rejects(managed.stream.next(), error => error === failure);
  await assert.rejects(managed.result, error => error === failure);
  assert.equal(native.cancellations, 1);
});

test('a failing cancellation callback does not replace the stream error', async () => {
  const failure = new Error('Original inference error');
  const native = session((async function* () { throw failure; })());
  native.cancel = () => { throw new Error('Cancel failed'); };
  const managed = await createTextGenerator(async () => native)('prompt');
  await assert.rejects(managed.stream.next(), error => error === failure);
});

test('late microphone/camera permission grants are stopped after cancellation', async () => {
  const gate = deferred();
  const controller = new AbortController();
  let active = false;
  const capture = { async start() { await gate.promise; active = true; }, stop() { active = false; } };
  const pending = startMediaCapture(capture, controller.signal);
  controller.abort();
  gate.resolve();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(active, false);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('successful media startup forwards callbacks and releases startup listeners', async () => {
  const controller = new AbortController();
  let active = false;
  const capture = { async start(onChunk) { active = true; onChunk(42); }, stop() { active = false; } };
  let sample;
  await startMediaCapture(capture, controller.signal, value => { sample = value; });
  assert.equal(sample, 42);
  assert.equal(active, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('media permission failures clean up and retain the original error', async () => {
  const controller = new AbortController();
  const failure = new Error('Permission denied');
  let stopped = false;
  const capture = { async start() { throw failure; }, stop() { stopped = true; throw new Error('Cleanup failed'); } };
  await assert.rejects(startMediaCapture(capture, controller.signal), error => error === failure);
  assert.equal(stopped, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('a cancelled media request does not ask for permission', async () => {
  const controller = new AbortController();
  controller.abort();
  let started = false;
  const capture = { async start() { started = true; }, stop() {} };
  await assert.rejects(startMediaCapture(capture, controller.signal), { name: 'AbortError' });
  assert.equal(started, false);
});

test('task ownership rejects duplicate work and aborts on unmount', () => {
  const scope = createTaskScope();
  const first = scope.start();
  assert.ok(first);
  assert.equal(scope.start(), null);
  scope.deactivate();
  assert.equal(first.signal.aborted, true);
  assert.equal(scope.start(), null);
  scope.activate();
  assert.ok(scope.start());
});

test('an old completion cannot unlock or cancel the next task', () => {
  const scope = createTaskScope();
  const first = scope.start();
  scope.cancel();
  const second = scope.start();
  scope.finish(first);
  assert.equal(scope.start(), null);
  assert.equal(second.signal.aborted, false);
  scope.finish(second);
  assert.ok(scope.start());
});

test('voice completion waits for playback even when the SDK ignores the callback promise', async () => {
  const playback = deferred();
  const response = { transcription: 'question', response: 'answer' };
  const pipeline = { async processTurn(audio, options, callbacks) {
    callbacks.onSynthesisComplete(new Float32Array(1), 16000);
    return response;
  } };
  let complete = false;
  const turn = processVoiceTurn(pipeline, new Float32Array(1), {}, {
    onSynthesisComplete: () => playback.promise,
  }).then(value => { complete = true; return value; });
  await tick();
  assert.equal(complete, false);
  playback.resolve();
  assert.equal(await turn, response);
});

test('asynchronous playback errors are observed and reported to the voice caller', async () => {
  const failure = new Error('Audio output unavailable');
  const pipeline = { async processTurn(audio, options, callbacks) {
    callbacks.onSynthesisComplete(new Float32Array(1), 16000);
    await tick();
    return {};
  } };
  await assert.rejects(processVoiceTurn(pipeline, new Float32Array(1), {}, {
    onSynthesisComplete: async () => { throw failure; },
  }), error => error === failure);
});

test('voice turns with no synthesis still finish normally', async () => {
  const response = { transcription: '', response: '' };
  assert.equal(await processVoiceTurn({ async processTurn() { return response; } }, new Float32Array(0), {}, {}), response);
});
