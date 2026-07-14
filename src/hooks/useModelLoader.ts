import { useState, useCallback, useRef } from 'react';
import { ModelManager, ModelCategory, EventBus } from '@runanywhere/web';
import { DEFAULT_LANGUAGE_MODEL_ID } from '../runanywhere';

export type LoaderState = 'idle' | 'downloading' | 'loading' | 'ready' | 'error';

interface ModelLoaderResult {
  state: LoaderState;
  progress: number;
  error: string | null;
  ensure: () => Promise<boolean>;
}

/**
 * Hook to download + load models for a given category.
 * Tracks download progress and loading state.
 *
 * @param category - Which model category to ensure is loaded.
 * @param coexist  - If true, only unload same-category models (allows STT+LLM+TTS to coexist).
 * @param preferredModelId - Optional specific registered model id to load for the category.
 */
export function useModelLoader(
  category: ModelCategory,
  coexist = false,
  preferredModelId?: string,
): ModelLoaderResult {
  const [state, setState] = useState<LoaderState>(() =>
    ModelManager.getLoadedModel(category) ? 'ready' : 'idle',
  );
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const ensure = useCallback(async (): Promise<boolean> => {
    const loadedModel = ModelManager.getLoadedModel(category);

    // Already loaded
    if (loadedModel && (!preferredModelId || loadedModel.id === preferredModelId)) {
      setState('ready');
      return true;
    }

    // A load is already in flight (e.g. called twice in quick succession,
    // such as a double-click). Wait for it instead of immediately reporting
    // failure — the caller would otherwise see a spurious "could not load"
    // error even though the model is actively loading successfully.
    if (loadingRef.current) {
      while (loadingRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const nowLoaded = ModelManager.getLoadedModel(category);
      if (nowLoaded && (!preferredModelId || nowLoaded.id === preferredModelId)) {
        setState('ready');
        return true;
      }
      return false;
    }
    loadingRef.current = true;

    try {
      const models = ModelManager.getModels().filter((m) => m.modality === category);
      if (models.length === 0) {
        setError(`No ${category} model registered`);
        setState('error');
        return false;
      }

      // Selection priority:
      // 1. An explicitly requested model id (preferredModelId)
      // 2. The category-wide default (e.g. DEFAULT_LANGUAGE_MODEL_ID for
      //    Language), if it's registered
      // 3. The lightest registered model, as a last-resort fallback so the
      //    app still works if the default isn't present in this category
      const byId = (id: string) => models.find((candidate) => candidate.id === id);
      const lightest = [...models].sort(
        (a, b) => (a.memoryRequirement ?? Number.MAX_SAFE_INTEGER) - (b.memoryRequirement ?? Number.MAX_SAFE_INTEGER),
      )[0];

      const model =
        (preferredModelId ? byId(preferredModelId) : null) ??
        (category === ModelCategory.Language ? byId(DEFAULT_LANGUAGE_MODEL_ID) : null) ??
        lightest;

      // Download if needed
      if (model.status !== 'downloaded' && model.status !== 'loaded') {
        setState('downloading');
        setProgress(0);

        const unsub = EventBus.shared.on('model.downloadProgress', (evt) => {
          if (evt.modelId === model.id) {
            setProgress(evt.progress ?? 0);
          }
        });

        await ModelManager.downloadModel(model.id);
        unsub();
        setProgress(1);
      }

      // Load
      setState('loading');
      const ok = await ModelManager.loadModel(model.id, { coexist });
      if (ok) {
        setState('ready');
        return true;
      } else {
        setError('Failed to load model');
        setState('error');
        return false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
      return false;
    } finally {
      loadingRef.current = false;
    }
  }, [category, coexist, preferredModelId]);

  return { state, progress, error, ensure };
}
