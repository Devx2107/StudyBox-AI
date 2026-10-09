import type { ModelManager } from '@runanywhere/web';
import type { LlamaCppBridge, TextGeneration } from '@runanywhere/web-llamacpp';

type Loader = Parameters<typeof ModelManager.setLLMLoader>[0];
type Engine = Pick<typeof TextGeneration, 'loadModelFromData' | 'unloadModel' | 'cleanup'>;
type Filesystem = Pick<LlamaCppBridge, 'unlinkFile'>;

/** Own temporary MEMFS copies without touching the downloaded browser cache. */
export function createLocalLlmLoader(engine: Engine, filesystem: Filesystem): Loader {
  let activeModelId: string | null = null;
  const removeCopy = (modelId: string) => {
    try { filesystem.unlinkFile(`/models/${modelId}.gguf`); } catch { /* Best-effort temporary-file cleanup. */ }
  };

  const unloadModel = async () => {
    try {
      await engine.unloadModel();
    } finally {
      if (activeModelId) removeCopy(activeModelId);
      activeModelId = null;
    }
  };

  return {
    async loadModelFromData(context) {
      try {
        await engine.loadModelFromData(context);
        activeModelId = context.model.id;
      } catch (error) {
        // beta.10 leaves a partial file behind when streaming into MEMFS fails.
        // Release both the inference component and its temporary model copy so
        // selecting a smaller model does not retain the failed allocation.
        try { await engine.unloadModel(); } catch { /* Preserve the load error. */ }
        try { engine.cleanup(); } catch { /* The WASM runtime may have failed. */ }
        removeCopy(context.model.id);
        activeModelId = null;
        throw error;
      }
    },
    unloadModel,
    async unloadAndCleanup(modelId) {
      const previousModelId = activeModelId;
      try { await unloadModel(); }
      finally { if (previousModelId !== modelId) removeCopy(modelId); }
    },
  };
}

export function isMemoryAllocationError(message: string): boolean {
  return /array\s*buffer allocation failed|out of memory|cannot allocate memory|memory allocation failed|failed to allocate|cannot enlarge memory|unable to grow (?:the )?(?:wasm )?memory/i.test(message);
}
