import type { VoicePipeline } from '@runanywhere/web';

/** beta.10 calls onSynthesisComplete without awaiting its returned promise. */
export async function processVoiceTurn(
  pipeline: Pick<VoicePipeline, 'processTurn'>,
  audio: Parameters<VoicePipeline['processTurn']>[0],
  options: Parameters<VoicePipeline['processTurn']>[1],
  callbacks: Parameters<VoicePipeline['processTurn']>[2],
) {
  let playback: Promise<void> | undefined;
  const result = await pipeline.processTurn(audio, options, {
    ...callbacks,
    onSynthesisComplete: (...args) => {
      try { playback = Promise.resolve(callbacks?.onSynthesisComplete?.(...args)); }
      catch (error) { playback = Promise.reject(error); }
      void playback.catch(() => undefined);
      return playback;
    },
  });
  await playback;
  return result;
}
