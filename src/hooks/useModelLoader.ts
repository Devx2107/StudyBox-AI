import { useState, useCallback, useEffect, useRef } from 'react';
import { ModelManager, ModelCategory, EventBus } from '@runanywhere/web';
import { DEFAULT_LANGUAGE_MODEL_ID } from '../runanywhere';
import { isMemoryAllocationError } from '../lib/localLlmLoader';

export type LoaderState = 'idle' | 'downloading' | 'loading' | 'ready' | 'error';

interface ModelLoaderResult {
  state: LoaderState;
  progress: number;
  error: string | null;
  /** Read the latest failure immediately after awaiting ensure(). */
  getError: () => string | null;
  ensure: () => Promise<boolean>;
}

type RegisteredModel = ReturnType<typeof ModelManager.getModels>[number];
const modelLoadLocks = new Map<string, { modelId: string; promise: Promise<boolean> }>();

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
  const errorRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const getError = useCallback(() => errorRef.current, []);
  const updateError = useCallback((message: string | null) => {
    errorRef.current = message;
    if (mountedRef.current) setError(message);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const nextState = isTargetModelLoaded(category, preferredModelId) ? 'ready' : 'idle';
    setState((current) => (
      current === 'downloading' || current === 'loading' || current === nextState
        ? current
        : nextState
    ));
    if (nextState === 'ready') {
      updateError(null);
    }
  }, [category, preferredModelId, updateError]);

  const ensure = useCallback(async (): Promise<boolean> => {
    const model = getTargetModel(category, preferredModelId);
    updateError(null);

    if (!model) {
      updateError(`No ${category} model registered`);
      setState('error');
      return false;
    }

    if (isTargetModelLoaded(category, preferredModelId)) {
      updateError(null);
      setState('ready');
      return true;
    }

    const loadLockKey = getLoadLockKey(category);
    // Recheck after waiting: another caller may have acquired the category lock.
    while (modelLoadLocks.has(loadLockKey)) {
      const activeLoad = modelLoadLocks.get(loadLockKey)!;
      setState('loading');
      try {
        await activeLoad.promise;
      } catch (err) {
        if (activeLoad.modelId === model.id) {
          updateError(err instanceof Error ? err.message : String(err));
          if (mountedRef.current) setState('error');
          return false;
        }
      }

      if (isTargetModelLoaded(category, preferredModelId)) {
        updateError(null);
        if (mountedRef.current) setState('ready');
        return true;
      }
    }

    const loadPromise = (async () => {
      let phase = 'download';
      let failure: string | null = null;
      const currentModel = () => ModelManager.getModels().find((entry) => entry.id === model.id);
      const captureFailure = (event: { modelId: string; error: string }) => {
        if (event.modelId === model.id) failure = event.error;
      };
      const unsubscribers = [
        EventBus.shared.on('model.downloadFailed', captureFailure),
        EventBus.shared.on('model.loadFailed', captureFailure),
        EventBus.shared.on('model.downloadProgress', (evt) => {
          if (evt.modelId === model.id && mountedRef.current) {
            setProgress(Math.max(0, Math.min(1, evt.progress ?? 0)));
          }
        }),
      ];

      try {
        // The SDK reports failures through events/registry state and can resolve
        // downloadModel() without throwing. Never load an incomplete download.
        const status = currentModel()?.status;
        if (status !== 'downloaded' && status !== 'loaded') {
          if (mountedRef.current) { setState('downloading'); setProgress(0); }
          await ModelManager.downloadModel(model.id);
          const downloaded = currentModel();
          if (failure || (downloaded?.status !== 'downloaded' && downloaded?.status !== 'loaded')) {
            throw new Error(failure || downloaded?.error || 'The download did not complete. Please retry.');
          }
          if (mountedRef.current) setProgress(1);
        }

        phase = 'load';
        failure = null;
        if (mountedRef.current) setState('loading');
        const ok = await ModelManager.loadModel(model.id, { coexist });
        if (!ok) {
          throw new Error(failure || currentModel()?.error || 'The model engine could not load this model.');
        }
        return true;
      } catch (err) {
        const detail = failure || (err instanceof Error ? err.message : String(err));
        const recovery = isMemoryAllocationError(detail)
          ? category === ModelCategory.Language
            ? ' Select LFM2 350M in Settings → Language model, refresh the page to release memory, and load again.'
            : ' Refresh the page to release memory, close unused tabs, and load again.'
          : '';
        throw new Error(`Could not ${phase} ${model.name}: ${detail}${recovery}`);
      } finally {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
      }
    })();

    modelLoadLocks.set(loadLockKey, { modelId: model.id, promise: loadPromise });

    try {
      const ok = await loadPromise;
      if (ok) {
        updateError(null);
        if (mountedRef.current) setState('ready');
        return true;
      }

      updateError(`Could not load ${model.name}`);
      if (mountedRef.current) setState('error');
      return false;
    } catch (err) {
      updateError(err instanceof Error ? err.message : String(err));
      if (mountedRef.current) setState('error');
      return false;
    } finally {
      if (modelLoadLocks.get(loadLockKey)?.promise === loadPromise) {
        modelLoadLocks.delete(loadLockKey);
      }
    }
  }, [category, coexist, preferredModelId, updateError]);

  return { state, progress, error, getError, ensure };
}
