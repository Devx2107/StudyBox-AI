/** getUserMedia cannot be aborted, so release a late capture after it resolves. */
export async function startMediaCapture<Args extends unknown[]>(
  capture: { start: (...args: Args) => Promise<void>; stop: () => void },
  signal: AbortSignal,
  ...args: Args
) {
  signal.throwIfAborted();
  const stop = () => { try { capture.stop(); } catch { /* Preserve startup/cancellation errors. */ } };
  signal.addEventListener('abort', stop, { once: true });
  try {
    await capture.start(...args);
    if (signal.aborted) {
      stop();
      signal.throwIfAborted();
    }
  } catch (error) {
    stop();
    throw error;
  } finally {
    signal.removeEventListener('abort', stop);
  }
}
