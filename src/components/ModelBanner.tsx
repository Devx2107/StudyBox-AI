import type { LoaderState } from '../hooks/useModelLoader';

interface Props {
  state: LoaderState;
  progress: number;
  error: string | null;
  onLoad: () => void;
  label: string;
}

export function ModelBanner({ state, progress, error, onLoad, label }: Props) {
  if (state === 'ready') return null;

  return (
    <div className="model-banner">
      {state === 'idle' && (
        <>
          <div className="model-banner-copy">
            <span className="progress-label">No local {label} model downloaded yet.</span>
            <span className="model-banner-note">
              {label === 'VLM'
                ? 'Needed for offline camera or image analysis.'
                : 'Needed for fully offline responses on this tab.'}
            </span>
          </div>
          <button className="btn" onClick={onLoad} type="button">Load local model</button>
        </>
      )}
      {state === 'downloading' && (
        <>
          <span className="progress-label">Downloading {label} model...</span>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="progress-pct">{(progress * 100).toFixed(0)}%</span>
        </>
      )}
      {state === 'loading' && <span className="progress-label">Loading {label} model into engine...</span>}
      {state === 'error' && (
        <>
          <span className="error-text">Error: {error}</span>
          <button className="btn pink" onClick={onLoad} type="button">Retry</button>
        </>
      )}
    </div>
  );
}
