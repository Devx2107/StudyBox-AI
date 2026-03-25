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

interface QuizTabProps extends HistoryReporter {
  history: HistoryEntry[];
  selectedHistory: HistoryEntry | null;
  notes: string;
  languageModelId?: string;
}

function sanitizeQuiz(payload: QuizPayload, requestedCount: number): QuizPayload | null {
  const questions = payload.questions
    .filter((question) => question.question && Array.isArray(question.options) && question.options.length >= 4)
    .map((question) => ({
      question: question.question.trim(),
      options: question.options.slice(0, 4).map((option) => option.trim()).filter(Boolean),
      answerIndex: Number(question.answerIndex),
      explanation: question.explanation?.trim() || '',
    }))
    .filter((question) => question.options.length === 4 && question.answerIndex >= 0 && question.answerIndex < question.options.length)
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
      const parsed = JSON.parse(candidate) as QuizPayload | QuizQuestion[];
      if (Array.isArray(parsed)) {
        return sanitizeQuiz({ title: 'Quiz session', questions: parsed }, requestedCount);
      }
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.questions)) {
        return sanitizeQuiz(parsed, requestedCount);
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
        `Create a ${difficulty} multiple-choice quiz from the study material below.
Return only JSON using this shape:
{"title":"topic","questions":[{"question":"...","options":["A","B","C","D"],"answerIndex":1,"explanation":"short explanation"}]}
Rules:
- generate exactly ${questionCount} questions
- each question must have 4 options
- keep answer explanations short and useful
- avoid trick questions
- keep wording clear for study review

Study material:
${sourceText}`,
        {
          maxTokens: questionCount <= 5 ? 1200 : questionCount <= 10 ? 2200 : 3600,
          temperature: 0.35,
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
                <button className="btn" type="button" onClick={restartQuiz} disabled={!quiz}>
                  Restart
                </button>
              </div>
            </div>
          ) : quiz && quizComplete ? (
            <div className="quiz-result">
              <div className="quiz-result-score">{score}/{quiz.questions.length}</div>
              <div className="quiz-result-label">{getResultLabel(score, quiz.questions.length)}</div>
              <p className="study-hint">Accuracy {quiz.questions.length ? Math.round((score / quiz.questions.length) * 100) : 0}% across this session.</p>
              <div className="study-toolbar">
                <button className="btn primary" type="button" onClick={restartQuiz}>Retry quiz</button>
                <button className="btn" type="button" onClick={generateQuiz} disabled={busy || !sourceText.trim()}>
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
              <span>Generate quiz</span>
              <span>{questionCount} questions</span>
            </div>
            <div className="info-block-body quiz-side-body">
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
                      { value: '5', label: '5 Questions' },
                      { value: '10', label: '10 Questions' },
                      { value: '20', label: '20 Questions' },
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

              <div className="study-toolbar">
                <button className="btn" type="button" onClick={useSelectedSource} disabled={!selectedHistory}>
                  Use selected history
                </button>
                <button className="btn" type="button" onClick={useNotesSource} disabled={!notes.trim()}>
                  Use notes
                </button>
                <button className="btn" type="button" onClick={useRecentHistory} disabled={!history.length}>
                  Use recent history
                </button>
              </div>

              <button className="btn primary full" type="button" onClick={generateQuiz} disabled={busy || !sourceText.trim()}>
                {busy ? 'Generating...' : 'Start quiz'}
              </button>
              {generationMessage && <p className="error-text">{generationMessage}</p>}
            </div>
          </div>

          <div className="info-block">
            <div className="info-block-head">
              <span>This session</span>
              <span>{accuracy}</span>
            </div>
            <div className="info-block-body">
              <ul className="feat-list">
                <li>Correct: <strong>{correctCount}</strong></li>
                <li>Wrong: <strong>{wrongCount}</strong></li>
                <li>Accuracy: <strong>{accuracy}</strong></li>
                <li>Streak: <strong>{currentStreak}</strong> in a row</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
