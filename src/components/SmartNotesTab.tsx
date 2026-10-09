import { useEffect, useMemo, useRef, useState } from 'react';
import { ModelCategory } from '@runanywhere/web';
import { generateTextStream } from '../lib/textGeneration';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import type { HistoryEntry } from '../types/history';
import { MarkdownContent } from './MarkdownContent';

interface SmartNotesTabProps {
  history: HistoryEntry[];
  selectedHistory: HistoryEntry | null;
  notes: string;
  languageModelId?: string;
  onNotesChange: (next: string) => void;
}

export function SmartNotesTab({ history, selectedHistory, notes, languageModelId, onNotesChange }: SmartNotesTabProps) {
  const loader = useModelLoader(ModelCategory.Language, false, languageModelId);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [generationId, setGenerationId] = useState(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const cancelRef = useRef<(() => void) | null>(null);
  const previewFrame = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelRef.current?.();
      cancelAnimationFrame(previewFrame.current);
    };
  }, []);
  const recentContext = useMemo(
    () => history.slice(0, 8).map((entry, index) => (
      `${index + 1}. [${entry.source}] Prompt: ${entry.prompt}\nResponse: ${entry.response}`
    )).join('\n\n'),
    [history],
  );

  const summarizeHistory = async () => {
    await runSummary('append');
  };

  const replaceWithSummary = async () => {
    await runSummary('replace');
  };

  const runSummary = async (mode: 'append' | 'replace') => {
    if (!recentContext.trim() || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setPreview('');
    setError(null);
    setGenerationId((id) => id + 1);
    const prefix = mode === 'replace' || !notes.trim() ? '' : `${notes}\n\n`;
    try {
      const ok = await loader.ensure();
      if (!mountedRef.current) return;
      if (!ok) throw new Error(loader.getError() || 'Could not load the local LLM.');
      const { stream, result, cancel } = await generateTextStream(
        `Turn this study session into concise notes with short headings, bullet points, and key takeaways.\n\n${recentContext}`,
        // 280 tokens was too tight to cover up to 8 history entries with
        // headings + bullets + takeaways for each - summaries were getting
        // cut off mid-bullet, especially with stronger models that actually
        // try to follow the full instruction instead of trailing off early.
        { maxTokens: 700, temperature: 0.25 },
      );
      cancelRef.current = cancel;
      if (!mountedRef.current) { cancel(); return; }

      let accumulated = '';
      for await (const token of stream) {
        accumulated += token;
        if (!mountedRef.current) break;
        if (!previewFrame.current) previewFrame.current = requestAnimationFrame(() => {
          previewFrame.current = 0;
          if (mountedRef.current) setPreview(accumulated);
        });
      }
      const final = ((await result).text || accumulated).trim();
      if (!final) throw new Error('The model returned empty notes. Your existing notes were kept; please try again.');
      if (mountedRef.current) onNotesChange(`${prefix}${final}`);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      cancelAnimationFrame(previewFrame.current);
      previewFrame.current = 0;
      cancelRef.current = null;
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  const appendSelected = () => {
    if (!selectedHistory) return;
    const block = `Source: ${selectedHistory.source}\nPrompt: ${selectedHistory.prompt}\nResponse: ${selectedHistory.response}`;
    onNotesChange(notes.trim() ? `${notes}\n\n${block}` : block);
  };

  const clearNotes = () => {
    onNotesChange('');
  };

  return (
    <section className="card">
      <div className="card-header">
        <div className="card-title">Smart notes</div>
        <div className="card-badge">persistent pad</div>
      </div>

      <ModelBanner
        state={loader.state}
        progress={loader.progress}
        error={loader.error}
        onLoad={loader.ensure}
        label="LLM"
      />

      <div className="card-body study-layout">
        <div className="study-toolbar">
          <button className="btn primary" type="button" onClick={summarizeHistory} disabled={busy || !history.length}>
            {busy ? 'Summarizing...' : 'Auto-summarize history'}
          </button>
          <button className="btn" type="button" onClick={replaceWithSummary} disabled={busy || !history.length}>
            Replace with summary
          </button>
          <button className="btn" type="button" onClick={appendSelected} disabled={busy || !selectedHistory}>
            Add selected entry
          </button>
          <button className="btn" type="button" onClick={clearNotes} disabled={busy || !notes.trim()}>
            Clear notes
          </button>
        </div>

        <div className={`notes-editor-shell ${busy ? 'is-generating' : ''}`} aria-busy={busy}>
        <textarea
          className="study-textarea"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Write notes here, then let the AI condense your study history into something cleaner."
          disabled={busy}
          aria-hidden={busy || undefined}
        />
        {busy && (
          <div className="notes-stream-preview study-textarea" role="region" aria-label="Generated notes preview" tabIndex={0}>
            {preview ? <MarkdownContent className="markdown-content" content={preview}
              motion={{ id: generationId, active: true, mode: 'blocks' }} /> : (
              <div className="notes-skeleton" aria-label="Generating notes">
                <div className="skeleton-line" /><div className="skeleton-line" /><div className="skeleton-line" />
              </div>
            )}
          </div>
        )}
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <p className="study-hint">Append keeps your current scratchpad. Replace rewrites the pad from recent study history in one pass.</p>
      </div>
    </section>
  );
}
