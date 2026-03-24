import { useEffect, useMemo, useRef, useState } from 'react';
import { ModelCategory } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import type { HistoryEntry } from '../types/history';

interface Flashcard {
  front: string;
  back: string;
}

interface FlashcardsTabProps {
  history: HistoryEntry[];
  selectedHistory: HistoryEntry | null;
  notes: string;
}

function parseFlashcards(raw: string): Flashcard[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Flashcard[];
      return parsed.filter((card) => card.front && card.back).slice(0, 8);
    } catch {
      // fall through to text parsing
    }
  }

  return raw
    .split(/\n{2,}/)
    .map((block) => {
      const [front, back] = block.split(/\nA:\s*/i);
      return {
        front: front?.replace(/^Q:\s*/i, '').trim() ?? '',
        back: back?.trim() ?? '',
      };
    })
    .filter((card) => card.front && card.back)
    .slice(0, 8);
}

export function FlashcardsTab({ history, selectedHistory, notes }: FlashcardsTabProps) {
  const loader = useModelLoader(ModelCategory.Language);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [flipped, setFlipped] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const defaultSource = useMemo(() => {
    if (selectedHistory) {
      return `Prompt: ${selectedHistory.prompt}\nResponse: ${selectedHistory.response}`;
    }
    if (notes.trim()) return notes;
    return history.slice(0, 5).map((entry) => `${entry.prompt}\n${entry.response}`).join('\n\n');
  }, [selectedHistory, notes, history]);
  const [sourceText, setSourceText] = useState(defaultSource);
  const previousDefaultRef = useRef(defaultSource);

  useEffect(() => {
    if (!sourceText.trim() || sourceText === previousDefaultRef.current) {
      setSourceText(defaultSource);
    }
    previousDefaultRef.current = defaultSource;
  }, [defaultSource, sourceText]);

  const useSelectedHistory = () => {
    if (!selectedHistory) return;
    setSourceText(`Prompt: ${selectedHistory.prompt}\nResponse: ${selectedHistory.response}`);
  };

  const useNotes = () => {
    if (!notes.trim()) return;
    setSourceText(notes);
  };

  const useRecentHistory = () => {
    setSourceText(history.slice(0, 5).map((entry) => `${entry.prompt}\n${entry.response}`).join('\n\n'));
  };

  const generateCards = async () => {
    if (!sourceText.trim() || busy) return;

    if (loader.state !== 'ready') {
      const ok = await loader.ensure();
      if (!ok) return;
    }

    setBusy(true);
    try {
      const { stream, result } = await TextGeneration.generateStream(
        `Create 6 study flashcards from this material. Return only JSON in this shape: [{"front":"question","back":"answer"}]. Keep each side short.\n\n${sourceText}`,
        { maxTokens: 320, temperature: 0.3 },
      );

      let accumulated = '';
      for await (const token of stream) {
        accumulated += token;
      }
      const final = (await result).text || accumulated;
      setCards(parseFlashcards(final));
      setFlipped(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <div className="card-title">Flashcards</div>
        <div className="card-badge">{cards.length} cards</div>
      </div>

      <ModelBanner
        state={loader.state}
        progress={loader.progress}
        error={loader.error}
        onLoad={loader.ensure}
        label="LLM"
      />

      <div className="card-body study-layout">
        <textarea
          className="study-textarea study-textarea-sm"
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          placeholder="Paste notes or use a selected history item to generate flashcards."
        />

        <div className="study-toolbar">
          <button className="btn" type="button" onClick={useSelectedHistory} disabled={!selectedHistory}>
            Use selected history
          </button>
          <button className="btn" type="button" onClick={useNotes} disabled={!notes.trim()}>
            Use notes
          </button>
          <button className="btn" type="button" onClick={useRecentHistory} disabled={!history.length}>
            Use recent history
          </button>
          <button className="btn primary" type="button" onClick={generateCards} disabled={busy || !sourceText.trim()}>
            {busy ? 'Generating...' : 'Generate flashcards'}
          </button>
        </div>
        <p className="study-hint">The source box stays in sync with your latest selection unless you start drafting your own material.</p>

        <div className="flashcards-grid">
          {cards.length === 0 && (
            <div className="empty-state">
              <h3>No cards yet</h3>
              <p>Generate a set from notes, chat history, or a vision answer.</p>
            </div>
          )}
          {cards.map((card, index) => (
            <button
              key={`${card.front}-${index}`}
              className={`flashcard ${flipped === index ? 'active' : ''}`}
              type="button"
              onClick={() => setFlipped(flipped === index ? null : index)}
            >
              <div className="flashcard-face">{flipped === index ? card.back : card.front}</div>
              <div className="flashcard-meta">{flipped === index ? 'answer' : 'question'}</div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
