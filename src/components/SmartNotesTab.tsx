import { useMemo, useState } from 'react';
import { ModelCategory } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import type { HistoryEntry } from '../types/history';

interface SmartNotesTabProps {
  history: HistoryEntry[];
  selectedHistory: HistoryEntry | null;
  notes: string;
  onNotesChange: (next: string) => void;
}

export function SmartNotesTab({ history, selectedHistory, notes, onNotesChange }: SmartNotesTabProps) {
  const loader = useModelLoader(ModelCategory.Language);
  const [busy, setBusy] = useState(false);
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
    if (!recentContext.trim() || busy) return;

    if (loader.state !== 'ready') {
      const ok = await loader.ensure();
      if (!ok) return;
    }

    setBusy(true);
    try {
      const { stream, result } = await TextGeneration.generateStream(
        `Turn this study session into concise notes with short headings, bullet points, and key takeaways.\n\n${recentContext}`,
        { maxTokens: 280, temperature: 0.25 },
      );

      let accumulated = '';
      for await (const token of stream) {
        accumulated += token;
      }
      const final = (await result).text || accumulated;
      onNotesChange(mode === 'replace' || !notes.trim() ? final : `${notes}\n\n${final}`);
    } finally {
      setBusy(false);
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
          <button className="btn" type="button" onClick={appendSelected} disabled={!selectedHistory}>
            Add selected entry
          </button>
          <button className="btn" type="button" onClick={clearNotes} disabled={!notes.trim()}>
            Clear notes
          </button>
        </div>

        <textarea
          className="study-textarea"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Write notes here, then let the AI condense your study history into something cleaner."
        />
        <p className="study-hint">Append keeps your current scratchpad. Replace rewrites the pad from recent study history in one pass.</p>
      </div>
    </section>
  );
}
