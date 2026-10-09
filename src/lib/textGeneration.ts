import { TextGeneration } from '@runanywhere/web-llamacpp';

type Generate = typeof TextGeneration.generateStream;

function cancelled() {
  return new DOMException('Generation cancelled.', 'AbortError');
}

/** Keep both SDK error channels observed and cancel abandoned native streams. */
export function createTextGenerator(generate: Generate) {
  return async (prompt: Parameters<Generate>[0], options?: Parameters<Generate>[1], signal?: AbortSignal) => {
    if (signal?.aborted) throw cancelled();
    const session = await generate(prompt, options);
    // result can reject before the token iterator throws. Observe it immediately
    // while preserving its rejection for callers awaiting the final response.
    void session.result.catch(() => undefined);
    let stopped = false;
    const detach = () => signal?.removeEventListener('abort', cancel);
    const cancel = () => {
      if (stopped) return;
      stopped = true;
      detach();
      try { session.cancel(); } catch { /* Preserve the original generation error. */ }
    };
    if (signal?.aborted) { cancel(); throw cancelled(); }
    signal?.addEventListener('abort', cancel, { once: true });

    const result = session.result.then(
      (value) => { detach(); return value; },
      (error) => { cancel(); throw error; },
    );
    void result.catch(() => undefined);

    async function* stream() {
      let complete = false;
      try {
        for await (const token of session.stream) {
          if (signal?.aborted) throw cancelled();
          if (stopped) return;
          yield token;
        }
        if (signal?.aborted) throw cancelled();
        complete = true;
      } finally {
        if (!complete) cancel();
      }
    }
    return { ...session, stream: stream(), result, cancel };
  };
}

export const generateTextStream = createTextGenerator(TextGeneration.generateStream.bind(TextGeneration));
