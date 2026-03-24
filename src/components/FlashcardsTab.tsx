import { useEffect, useMemo, useRef, useState } from 'react';
import { ModelCategory } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import { MarkdownContent } from './MarkdownContent';
import type { HistoryEntry } from '../types/history';

interface Flashcard {
  front: string;
  back: string;
}

interface FlashcardsTabProps {
  history: HistoryEntry[];
  selectedHistory: HistoryEntry | null;
  notes: string;
  languageModelId?: string;
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

export function FlashcardsTab({ history, selectedHistory, notes, languageModelId }: FlashcardsTabProps) {
  const loader = useModelLoader(ModelCategory.Language, false, languageModelId);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [masteredIndexes, setMasteredIndexes] = useState<number[]>([]);
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
      setActiveIndex(0);
      setIsFlipped(false);
      setMasteredIndexes([]);
    } finally {
      setBusy(false);
    }
  };

  const activeCard = cards[activeIndex] ?? null;

  const flipCard = () => {
    if (!activeCard) return;
    setIsFlipped((prev) => !prev);
  };

  const goToPrevious = () => {
    if (!cards.length) return;
    setActiveIndex((prev) => (prev - 1 + cards.length) % cards.length);
    setIsFlipped(false);
  };

  const goToNext = () => {
    if (!cards.length) return;
    setActiveIndex((prev) => (prev + 1) % cards.length);
    setIsFlipped(false);
  };

  const rateCard = (rating: 'hard' | 'ok' | 'easy') => {
    if (!cards.length) return;
    if (rating === 'easy') {
      setMasteredIndexes((prev) => (prev.includes(activeIndex) ? prev : [...prev, activeIndex]));
    }
    goToNext();
  };

  return (
    <section className="card">
      <div className="card-header">
        <div className="card-title">Flashcards</div>
        <div className="card-badge">{cards.length === 0 ? '0 / 0' : `${activeIndex + 1} / ${cards.length}`}</div>
      </div>

      <ModelBanner
        state={loader.state}
        progress={loader.progress}
        error={loader.error}
        onLoad={loader.ensure}
        label="LLM"
      />

      <div className="card-body flashcards-layout">
        <div className="flashcards-main">
          {activeCard ? (
            <>
              <div className="flashcard-area">
                <button
                  className={`study-flashcard ${isFlipped ? 'flipped' : ''}`}
                  type="button"
                  onClick={flipCard}
                >
                  <div className="card-face">
                    <div className="card-face-label">Question</div>
                    <MarkdownContent className="card-face-text markdown-content" content={activeCard.front} />
                    <div className="card-flip-hint">click to reveal</div>
                  </div>
                  <div className="card-back">
                    <MarkdownContent className="card-back-text markdown-content" content={activeCard.back} />
                    <div className="card-flip-hint card-flip-back">click to flip back</div>
                  </div>
                </button>
              </div>

              <div className="fc-nav">
                <button className="btn sm" type="button" onClick={goToPrevious}>Prev</button>
                <span className="fc-counter">{activeIndex + 1} / {cards.length}</span>
                <button className="btn sm" type="button" onClick={goToNext}>Next</button>
              </div>

              <div className="fc-rating">
                <button className="btn sm pink" type="button" onClick={() => rateCard('hard')}>Hard</button>
                <button className="btn sm" type="button" onClick={() => rateCard('ok')}>OK</button>
                <button className="btn sm cyan" type="button" onClick={() => rateCard('easy')}>Easy</button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <h3>No cards yet</h3>
              <p>Generate a set from notes, chat history, or a vision answer.</p>
            </div>
          )}
        </div>

        <div className="info-stack">
          <div className="info-block">
            <div className="info-block-head">
              <span>Deck source</span>
              <span>{cards.length} cards</span>
            </div>
            <div className="info-block-body flashcards-side-body">
              <div className="deck-list">
                <button className="deck-item" type="button" onClick={useSelectedHistory} disabled={!selectedHistory}>
                  <span className="deck-name">Selected entry</span>
                  <span className="deck-count">{selectedHistory ? 'ready' : 'empty'}</span>
                </button>
                <button className="deck-item" type="button" onClick={useNotes} disabled={!notes.trim()}>
                  <span className="deck-name">Notes</span>
                  <span className="deck-count">{notes.trim() ? 'ready' : 'empty'}</span>
                </button>
                <button className="deck-item" type="button" onClick={useRecentHistory} disabled={!history.length}>
                  <span className="deck-name">Recent history</span>
                  <span className="deck-count">{history.length} entries</span>
                </button>
              </div>

              <textarea
                className="study-textarea study-textarea-sm"
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                placeholder="Paste notes or use a selected history item to generate flashcards."
              />

              <button className="btn primary full" type="button" onClick={generateCards} disabled={busy || !sourceText.trim()}>
                {busy ? 'Generating...' : 'AI generate cards'}
              </button>
            </div>
          </div>

          <div className="info-block">
            <div className="info-block-head">
              <span>Deck stats</span>
              <span>{masteredIndexes.length} mastered</span>
            </div>
            <div className="info-block-body">
              <div className="streak-grid flashcards-stat-grid">
                <div className="streak-stat">
                  <strong>{cards.length}</strong>
                  <span>Total Cards</span>
                </div>
                <div className="streak-stat">
                  <strong>{masteredIndexes.length}</strong>
                  <span>Mastered</span>
                </div>
                <div className="streak-stat">
                  <strong>{cards.length ? activeIndex + 1 : 0}</strong>
                  <span>Current</span>
                </div>
              </div>
              <p className="study-hint">The source box stays in sync with your latest selection unless you start drafting your own material.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
