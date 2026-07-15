import { useState, useCallback, useEffect } from 'react';
import { ModelManager, ModelCategory, EventBus } from '@runanywhere/web';
import { DEFAULT_LANGUAGE_MODEL_ID } from '../runanywhere';

export type LoaderState = 'idle' | 'downloading' | 'loading' | 'ready' | 'error';

interface ModelLoaderResult {
  state: LoaderState;
  progress: number;
  error: string | null;
  ensure: () => Promise<boolean>;
}

type RegisteredModel = ReturnType<typeof ModelManager.getModels>[number];
const modelLoadLocks = new Map<string, Promise<boolean>>();

function getLoadLockKey(category: ModelCategory) {
  return String(category);
}

function getTargetModel(category: ModelCategory, preferredModelId?: string): RegisteredModel | null {
  const models = ModelManager.getModels().filter((model) => model.modality === category);
  if (models.length === 0) return null;

  const byId = (id: string) => models.find((candidate) => candidate.id === id);
  const lightest = [...models].sort(
    (a, b) => (a.memoryRequirement ?? Number.MAX_SAFE_INTEGER) - (b.memoryRequirement ?? Number.MAX_SAFE_INTEGER),
  )[0];

  return (
    (preferredModelId ? byId(preferredModelId) : null) ??
    (category === ModelCategory.Language ? byId(DEFAULT_LANGUAGE_MODEL_ID) : null) ??
    lightest
  );
}

function isTargetModelLoaded(category: ModelCategory, preferredModelId?: string) {
  const targetModel = getTargetModel(category, preferredModelId);
  const loadedModel = ModelManager.getLoadedModel(category);

  return Boolean(targetModel && loadedModel?.id === targetModel.id);
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
    isTargetModelLoaded(category, preferredModelId) ? 'ready' : 'idle',
  );
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextState = isTargetModelLoaded(category, preferredModelId) ? 'ready' : 'idle';
    setState((current) => (
      current === 'downloading' || current === 'loading' || current === nextState
        ? current
        : nextState
    ));
    if (nextState === 'ready') {
      setError(null);
    }
  }, [category, preferredModelId]);

  const ensure = useCallback(async (): Promise<boolean> => {
    const model = getTargetModel(category, preferredModelId);

    if (!model) {
      setError(`No ${category} model registered`);
      setState('error');
      return false;
    }

    if (isTargetModelLoaded(category, preferredModelId)) {
      setError(null);
      setState('ready');
      return true;
    }

    const loadLockKey = getLoadLockKey(category);
    const activeLoad = modelLoadLocks.get(loadLockKey);
    if (activeLoad) {
      setState('loading');
      let ok = false;
      try {
        ok = await activeLoad;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
        return false;
      }

      if (isTargetModelLoaded(category, preferredModelId)) {
        setError(null);
        setState('ready');
        return true;
      }

      if (!ok) {
        setError('Failed to load model');
        setState('error');
        return false;
      }
    }

    const loadPromise = (async () => {
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
      return ok;
    })();

    modelLoadLocks.set(loadLockKey, loadPromise);

    try {
      const ok = await loadPromise;
      if (ok) {
        setError(null);
        setState('ready');
        return true;
      }

      setError('Failed to load model');
      setState('error');
      return false;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
      return false;
    } finally {
      if (modelLoadLocks.get(loadLockKey) === loadPromise) {
        modelLoadLocks.delete(loadLockKey);
      }
    }
  }, [category, coexist, preferredModelId]);

  return { state, progress, error, ensure };
}
