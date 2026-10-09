import type { LoaderState } from '../hooks/useModelLoader';
import { useEffect, useState } from 'react';
import { useReducedMotion } from '../hooks/useMotion';

interface Props {
  state: LoaderState;
  progress: number;
  error: string | null;
  onLoad: () => void;
  label: string;
}

export function ModelBanner({ state, progress, error, onLoad, label }: Props) {
  const reduced = useReducedMotion();
  const [visibleState, setVisibleState] = useState(state);
  useEffect(() => {
    if (state !== 'ready' || reduced) setVisibleState(state);
  }, [state, reduced]);
  if (visibleState === 'ready') return null;
  const exiting = state === 'ready';

  return (
    <div className={`model-banner ${exiting ? 'motion-banner-out' : ''}`} aria-busy={state === 'downloading' || state === 'loading'}
      inert={exiting || undefined}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && event.animationName === 'motion-banner-out' && state === 'ready') setVisibleState('ready');
      }}>
      <div className="model-banner-state" key={visibleState}>
      {visibleState === 'idle' && (
        <>
          <div className="model-banner-copy">
            <span className="progress-label">Load the local {label} model to continue.</span>
            <span className="model-banner-note">
              {label === 'VLM'
                ? 'Needed for offline camera or image analysis.'
                : 'Needed for fully offline responses on this tab.'}
            </span>
          </div>
          <button className="btn" onClick={onLoad} type="button">Load local model</button>
        </>
      )}
      {visibleState === 'downloading' && (
        <>
          <span className="progress-label" role="status">Downloading {label} model...</span>
          <div className="progress-bar" role="progressbar" aria-label={`${label} model download`}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="progress-pct" aria-hidden="true">{(progress * 100).toFixed(0)}%</span>
        </>
      )}
      {visibleState === 'loading' && <span className="progress-label" role="status">Loading {label} model into engine...</span>}
      {visibleState === 'error' && (
        <>
          <span className="error-text" role="alert">Error: {error}</span>
          <button className="btn pink" onClick={onLoad} type="button">Retry</button>
        </>
      )}
      </div>
    </div>
  );
}
