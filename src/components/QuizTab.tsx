import { useEffect, useMemo, useRef, useState } from 'react';
import { ModelCategory } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import { MarkdownContent } from './MarkdownContent';
import { AppSelect } from './AppSelect';
import { collectStudyFragments, extractJsonCandidates } from '../lib/studyOutput';
import type { HistoryEntry, HistoryReporter } from '../types/history';

type Difficulty = 'easy' | 'medium' | 'hard';

interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

interface QuizPayload {
  title: string;
  questions: QuizQuestion[];
}

interface RawQuizQuestion {
  question?: unknown;
  options?: unknown;
  answerIndex?: unknown;
  explanation?: unknown;
  answer?: unknown;
  correctAnswer?: unknown;
  correctOption?: unknown;
}

interface QuizTabProps extends HistoryReporter {
  history: HistoryEntry[];
  selectedHistory: HistoryEntry | null;
  notes: string;
  languageModelId?: string;
}

interface SanitizedQuizQuestion {
  question: string;
  options: string[];
  answerIndex: number | null;
  explanation: string;
}

function normalizeAnswerValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-d][).:\s-]+/, '')
    .replace(/^option\s+[a-d][:\s-]*/i, '')
    .replace(/^answer\s*[:\-]\s*/i, '')
    .replace(/^correct\s+answer\s*[:\-]\s*/i, '')
    .replace(/^the\s+correct\s+answer\s+is\s*/i, '')
    .replace(/\s+/g, ' ');
}

function repairJsonCandidate(candidate: string) {
  return candidate
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

function parseNumericIndex(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function parseLetterIndex(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  if (/^[A-D]$/.test(trimmed)) return trimmed.charCodeAt(0) - 65;
  const match = trimmed.match(/(?:OPTION\s+)?([A-D])(?:[).:\s-]|$)/);
  return match ? match[1].charCodeAt(0) - 65 : null;
}

function matchAnswerText(options: string[], value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = normalizeAnswerValue(value);
  if (!normalized) return null;

  const exactIndex = options.findIndex((option) => normalizeAnswerValue(option) === normalized);
  if (exactIndex >= 0) return exactIndex;

  const containsIndex = options.findIndex((option) => {
    const normalizedOption = normalizeAnswerValue(option);
    return normalizedOption.includes(normalized) || normalized.includes(normalizedOption);
  });

  return containsIndex >= 0 ? containsIndex : null;
}

function resolveAnswerIndex(question: RawQuizQuestion, options: string[]) {
  const answerTextIndex = matchAnswerText(
    options,
    typeof question.correctAnswer === 'string'
      ? question.correctAnswer
      : typeof question.answer === 'string'
        ? question.answer
        : typeof question.correctOption === 'string'
          ? question.correctOption
          : null,
  );

  const explanationIndex = matchAnswerText(options, question.explanation);
  const letterIndex = parseLetterIndex(question.correctOption) ?? parseLetterIndex(question.answer);
  const numericIndex = parseNumericIndex(question.answerIndex);

  if (answerTextIndex !== null) return answerTextIndex;
  if (letterIndex !== null && letterIndex >= 0 && letterIndex < options.length) return letterIndex;

  if (numericIndex !== null) {
    if (numericIndex >= 0 && numericIndex < options.length) {
      return numericIndex;
    }
    if (numericIndex >= 1 && numericIndex <= options.length) {
      return numericIndex - 1;
    }
  }

  if (explanationIndex !== null) return explanationIndex;
  return null;
}

function sanitizeQuiz(payload: QuizPayload, requestedCount: number): QuizPayload | null {
  const questions = payload.questions
    .filter((question) => {
      const candidate = question as RawQuizQuestion;
      return typeof candidate.question === 'string'
        && Array.isArray(candidate.options)
        && candidate.options.length >= 4;
    })
    .map((question): SanitizedQuizQuestion => {
      const candidate = question as RawQuizQuestion;
      const rawOptions = candidate.options as unknown[];
      const options = rawOptions
        .slice(0, 4)
        .filter((option): option is string => typeof option === 'string')
        .map((option) => option.trim())
        .filter(Boolean);
      const answerIndex = resolveAnswerIndex(candidate, options);

      return {
        question: (candidate.question as string).trim(),
        options,
        answerIndex,
        explanation: typeof candidate.explanation === 'string' ? candidate.explanation.trim() : '',
      };
    })
    .filter((question): question is QuizQuestion => (
      question.options.length === 4
      && question.answerIndex !== null
      && question.answerIndex >= 0
      && question.answerIndex < question.options.length
    ))
    .slice(0, requestedCount);

  if (questions.length < 3) return null;

  return {
    title: payload.title?.trim() || 'Quiz session',
    questions,
  };
}

function parseQuiz(raw: string, requestedCount: number): QuizPayload | null {
  for (const candidate of extractJsonCandidates(raw)) {
    try {
      const parsed = JSON.parse(repairJsonCandidate(candidate)) as QuizPayload | QuizQuestion[] | { title?: string; questions?: QuizQuestion[]; items?: QuizQuestion[] };
      if (Array.isArray(parsed)) {
        return sanitizeQuiz({ title: 'Quiz session', questions: parsed }, requestedCount);
      }
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.questions)) {
        return sanitizeQuiz({ title: parsed.title ?? 'Quiz session', questions: parsed.questions }, requestedCount);
      }
      if (parsed && typeof parsed === 'object' && 'items' in parsed && Array.isArray(parsed.items)) {
        return sanitizeQuiz({ title: parsed.title ?? 'Quiz session', questions: parsed.items }, requestedCount);
      }
    } catch {
      // keep trying
    }
  }

  return null;
}

function buildFallbackQuiz(sourceText: string, requestedCount: number): QuizPayload {
  const fragments = collectStudyFragments(sourceText, Math.max(requestedCount + 2, 8));
  const title = fragments[0]?.slice(0, 40) || 'Study session';
  const pool = fragments.slice(1);
  const total = Math.min(requestedCount, Math.max(pool.length, 3));

  return {
    title,
    questions: Array.from({ length: total }, (_, index) => {
      const correct = pool[index % Math.max(pool.length, 1)] || fragments[0] || 'Review the source material.';
      const distractors = pool.filter((item) => item !== correct).slice(index, index + 3);

      while (distractors.length < 3) {
        distractors.push(`Not supported by the source material (${distractors.length + 1})`);
      }

      const options = [correct, ...distractors].slice(0, 4);
      const rotated = options.map((_, optionIndex) => options[(optionIndex + index) % options.length]);

      return {
        question: `Which option best matches study point ${index + 1}?`,
        options: rotated,
        answerIndex: rotated.indexOf(correct),
        explanation: correct,
      };
    }),
  };
}

function getResultLabel(score: number, total: number) {
  const percentage = total ? Math.round((score / total) * 100) : 0;
  if (percentage >= 90) return 'Locked in';
  if (percentage >= 75) return 'Strong run';
  if (percentage >= 50) return 'Good base';
  return 'Keep practicing';
}

export function QuizTab({ history, selectedHistory, notes, languageModelId, onHistoryEntry }: QuizTabProps) {
  const loader = useModelLoader(ModelCategory.Language, false, languageModelId);
  const defaultSource = useMemo(() => {
    if (selectedHistory) return `Prompt: ${selectedHistory.prompt}\nResponse: ${selectedHistory.response}`;
    if (notes.trim()) return notes;
    return history.slice(0, 5).map((entry) => `${entry.prompt}\n${entry.response}`).join('\n\n');
  }, [selectedHistory, notes, history]);

  const [sourceText, setSourceText] = useState(defaultSource);
  const previousDefaultRef = useRef(defaultSource);
  const [questionCount, setQuestionCount] = useState(5);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [busy, setBusy] = useState(false);
  const [quiz, setQuiz] = useState<QuizPayload | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [quizComplete, setQuizComplete] = useState(false);
  const [generationMessage, setGenerationMessage] = useState<string | null>(null);

  useEffect(() => {
    if (sourceText === previousDefaultRef.current) {
      setSourceText(defaultSource);
    }
    previousDefaultRef.current = defaultSource;
  }, [defaultSource, sourceText]);

  const resetSessionState = () => {
    setCurrentIndex(0);
    setSelectedIndex(null);
    setRevealed(false);
    setScore(0);
    setCorrectCount(0);
    setWrongCount(0);
    setCurrentStreak(0);
    setQuizComplete(false);
  };

  const useSelectedSource = () => {
    if (!selectedHistory) return;
    setSourceText(`Prompt: ${selectedHistory.prompt}\nResponse: ${selectedHistory.response}`);
  };

  const useNotesSource = () => {
    if (!notes.trim()) return;
    setSourceText(notes);
  };

  const useRecentHistory = () => {
    setSourceText(history.slice(0, 5).map((entry) => `${entry.prompt}\n${entry.response}`).join('\n\n'));
  };

  const generateQuiz = async () => {
    if (!sourceText.trim() || busy) return;

    setBusy(true);
    setGenerationMessage(null);
    try {
      if (loader.state !== 'ready') {
        const ok = await loader.ensure();
        if (!ok) {
          const fallbackQuiz = buildFallbackQuiz(sourceText, questionCount);
          setQuiz(fallbackQuiz);
          resetSessionState();
          setGenerationMessage(loader.error || 'AI model could not be loaded, so a fallback quiz was created from your source text.');
          return;
        }
      }

      const { stream, result } = await TextGeneration.generateStream(
        `Create exactly ${questionCount} ${difficulty} multiple-choice quiz questions from this study material.
Return JSON only.
Use this shape:
{"title":"topic","questions":[{"question":"...","options":["...","...","...","..."],"answerIndex":0,"explanation":"short explanation"}]}
Requirements:
- 4 options per question
- answerIndex must be 0, 1, 2, or 3
- keep wording clear
- keep explanations short

Study material:
${sourceText}`,
        {
          maxTokens: questionCount <= 5 ? 900 : questionCount <= 10 ? 1800 : 2800,
          temperature: 0.25,
        },
      );

      let accumulated = '';
      for await (const token of stream) {
        accumulated += token;
      }

      const final = (await result).text || accumulated;
      const parsedQuiz = parseQuiz(final, questionCount);
      const nextQuiz = parsedQuiz ?? buildFallbackQuiz(sourceText, questionCount);
      setQuiz(nextQuiz);
      resetSessionState();
      if (!parsedQuiz) {
        setGenerationMessage('The AI response was incomplete, so a fallback quiz was created from your source text.');
      }
    } catch (error) {
      const fallbackQuiz = buildFallbackQuiz(sourceText, questionCount);
      const message = error instanceof Error ? error.message : String(error);
      setQuiz(fallbackQuiz);
      resetSessionState();
      setGenerationMessage(`AI generation failed, so a fallback quiz was created. ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const currentQuestion = quiz?.questions[currentIndex] ?? null;
  const accuracy = correctCount + wrongCount > 0
    ? `${Math.round((correctCount / (correctCount + wrongCount)) * 100)}%`
    : '--';
  const answeredCount = quizComplete
    ? quiz?.questions.length ?? 0
    : revealed
      ? currentIndex + 1
      : currentIndex;
  const progressWidth = quiz ? (answeredCount / quiz.questions.length) * 100 : 0;

  const answerQuestion = (index: number) => {
    if (!currentQuestion || revealed) return;

    const correct = index === currentQuestion.answerIndex;
    const nextScore = score + (correct ? 1 : 0);
    const nextCorrect = correctCount + (correct ? 1 : 0);
    const nextWrong = wrongCount + (correct ? 0 : 1);
    const nextStreak = correct ? currentStreak + 1 : 0;

    setSelectedIndex(index);
    setRevealed(true);
    setScore(nextScore);
    setCorrectCount(nextCorrect);
    setWrongCount(nextWrong);
    setCurrentStreak(nextStreak);

    const isLastQuestion = !!quiz && currentIndex === quiz.questions.length - 1;
    if (isLastQuestion && quiz) {
      setQuizComplete(true);
      onHistoryEntry?.({
        source: 'quiz',
        prompt: `Quiz - ${quiz.title} (${difficulty}, ${quiz.questions.length} questions)`,
        response: `Score: ${nextScore}/${quiz.questions.length}\nCorrect: ${nextCorrect}\nWrong: ${nextWrong}\nAccuracy: ${quiz.questions.length ? Math.round((nextScore / quiz.questions.length) * 100) : 0}%`,
      });
    }
  };

  const goToNext = () => {
    if (!quiz || !revealed) return;
    if (currentIndex >= quiz.questions.length - 1) {
      setQuizComplete(true);
      return;
    }
    setCurrentIndex((prev) => prev + 1);
    setSelectedIndex(null);
    setRevealed(false);
  };

  const restartQuiz = () => {
    if (!quiz) return;
    resetSessionState();
  };

  return (
    <section className="card">
      <div className="card-header">
        <div className="card-title">Quiz</div>
        <div className="card-badge">
          {quiz ? `Q${Math.min(currentIndex + 1, quiz.questions.length)} of ${quiz.questions.length}` : 'Ready'}
        </div>
      </div>

      <ModelBanner
        state={loader.state}
        progress={loader.progress}
        error={loader.error}
        onLoad={loader.ensure}
        label="LLM"
      />

      <div className="card-body quiz-layout">
        <div className="quiz-main">
          {quiz && currentQuestion && !quizComplete ? (
            <div className="quiz-panel">
              <div className="quiz-meta">
                <span>Topic: {quiz.title}</span>
                <span>Score: {score}/{quiz.questions.length}</span>
                <span>Accuracy: {accuracy}</span>
              </div>

              <div className="quiz-score-bar">
                <div className="quiz-score-fill" style={{ width: `${progressWidth}%` }} />
              </div>

              <p className="quiz-q">{currentQuestion.question}</p>

              <div className="quiz-opts">
                {currentQuestion.options.map((option, index) => {
                  const isCorrect = revealed && index === currentQuestion.answerIndex;
                  const isWrong = revealed && selectedIndex === index && index !== currentQuestion.answerIndex;
                  const letter = String.fromCharCode(65 + index);

                  return (
                    <button
                      key={`${currentQuestion.question}-${letter}`}
                      className={`quiz-opt ${isCorrect ? 'correct' : ''} ${isWrong ? 'wrong' : ''}`}
                      type="button"
                      onClick={() => answerQuestion(index)}
                      disabled={revealed}
                    >
                      <span className="quiz-opt-letter">{letter}</span>
                      <span className="quiz-opt-text">{option}</span>
                    </button>
                  );
                })}
              </div>

              {revealed && (
                <div className="quiz-feedback">
                  <div className={`quiz-feedback-label ${selectedIndex === currentQuestion.answerIndex ? 'correct' : 'wrong'}`}>
                    {selectedIndex === currentQuestion.answerIndex ? 'Correct answer' : 'Review this one'}
                  </div>
                  <MarkdownContent className="markdown-content" content={currentQuestion.explanation || currentQuestion.options[currentQuestion.answerIndex]} />
                </div>
              )}

              <div className="study-toolbar">
                <button className="btn primary" type="button" onClick={goToNext} disabled={!revealed}>
                  {quiz && currentIndex === quiz.questions.length - 1 ? 'See results' : 'Next question'}
                </button>
                <button className="btn primary quiz-toolbar-end" type="button" onClick={restartQuiz} disabled={!quiz}>
                  Restart
                </button>
              </div>
            </div>
          ) : quiz && quizComplete ? (
            <div className="quiz-result">
              <div className="quiz-result-score">{score}/{quiz.questions.length}</div>
              <div className="quiz-result-label">{getResultLabel(score, quiz.questions.length)}</div>
              <p className="study-hint">
                Correct {correctCount} of {quiz.questions.length} with {quiz.questions.length ? Math.round((score / quiz.questions.length) * 100) : 0}% accuracy.
              </p>
              <div className="study-toolbar">
                <button className="btn primary" type="button" onClick={restartQuiz}>Retry quiz</button>
                <button className="btn primary" type="button" onClick={generateQuiz} disabled={busy || !sourceText.trim()}>
                  {busy ? 'Generating...' : 'Generate new quiz'}
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <h3>No quiz yet</h3>
              <p>Generate an AI multiple-choice quiz from notes, selected history, or recent study sessions.</p>
            </div>
          )}
        </div>

        <div className="info-stack">
          <div className="info-block">
            <div className="info-block-head">
              <span>Quiz source</span>
              <span>{questionCount} questions</span>
            </div>
            <div className="info-block-body quiz-side-body">
              <div className="deck-list">
                <button className="deck-item" type="button" onClick={useSelectedSource} disabled={!selectedHistory}>
                  <span className="deck-name">Selected entry</span>
                  <span className="deck-count">{selectedHistory ? 'ready' : 'empty'}</span>
                </button>
                <button className="deck-item" type="button" onClick={useNotesSource} disabled={!notes.trim()}>
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
                onChange={(event) => setSourceText(event.target.value)}
                placeholder="Paste notes or use a selected history item to generate a quiz."
              />

              <div className="quiz-controls">
                <label className="settings-field">
                  <span>Questions</span>
                  <AppSelect
                    value={String(questionCount)}
                    ariaLabel="Question count"
                    onChange={(nextValue) => setQuestionCount(Number(nextValue))}
                    options={[
                      { value: '3', label: '3 Questions' },
                      { value: '5', label: '5 Questions' },
                      { value: '10', label: '10 Questions' },
                    ]}
                  />
                </label>

                <label className="settings-field">
                  <span>Difficulty</span>
                  <AppSelect
                    value={difficulty}
                    ariaLabel="Difficulty"
                    onChange={(nextValue) => setDifficulty(nextValue as Difficulty)}
                    options={[
                      { value: 'easy', label: 'Easy' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'hard', label: 'Hard' },
                    ]}
                  />
                </label>
              </div>

              <button className="btn primary full" type="button" onClick={generateQuiz} disabled={busy || !sourceText.trim()}>
                {busy ? 'Generating...' : 'Start quiz'}
              </button>
              {generationMessage && <p className="error-text">{generationMessage}</p>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
