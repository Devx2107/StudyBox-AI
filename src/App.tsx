import { useEffect, useMemo, useState } from "react";
import { getAccelerationMode, initSDK } from "./runanywhere";
import { ChatTab } from "./components/ChatTab";
import { VisionTab } from "./components/VisionTab";
import { VoiceTab } from "./components/VoiceTab";
import { ToolsTab } from "./components/ToolsTab";
import { SmartNotesTab } from "./components/SmartNotesTab";
import { FlashcardsTab } from "./components/FlashcardsTab";
import { ConceptMapTab } from "./components/ConceptMapTab";
import type { HistoryEntry } from "./types/history";
import type { ClaudeSettings } from "./lib/anthropic";

const tabs = [
  { id: "chat", label: "Chat", icon: "C", eyebrow: "Tutor mode", badge: "LLM Core" },
  { id: "vision", label: "Vision", icon: "V", eyebrow: "Camera mode", badge: "VLM Lens" },
  { id: "tools", label: "Tools", icon: "T", eyebrow: "Tool mode", badge: "Agent Tools" },
  { id: "voice", label: "Voice", icon: "O", eyebrow: "Voice mode", badge: "Speech Stack" },
  { id: "notes", label: "Notes", icon: "N", eyebrow: "Notes mode", badge: "Smart Notes" },
  { id: "flashcards", label: "Cards", icon: "F", eyebrow: "Recall mode", badge: "Flashcards" },
  { id: "map", label: "Map", icon: "M", eyebrow: "Map mode", badge: "Concept Graph" },
] as const;

const HISTORY_STORAGE_KEY = "studybox-ai-history-log";
const LEGACY_HISTORY_STORAGE_KEY = "studybox-history-log";
const THEME_STORAGE_KEY = "studybox-ai-theme";
const LEGACY_THEME_STORAGE_KEY = "studybox-theme";
const NOTES_STORAGE_KEY = "studybox-ai-smart-notes";
const LEGACY_NOTES_STORAGE_KEY = "studybox-smart-notes";
const ACTIVITY_STORAGE_KEY = "studybox-ai-activity-days";
const LEGACY_ACTIVITY_STORAGE_KEY = "studybox-activity-days";
const POMODORO_COUNT_KEY = "studybox-ai-pomodoros";
const LEGACY_POMODORO_COUNT_KEY = "studybox-pomodoros";
const PROVIDER_MODE_KEY = "studybox-ai-provider-mode";
const LEGACY_PROVIDER_MODE_KEY = "studybox-provider-mode";
const CLAUDE_API_KEY_STORAGE_KEY = "studybox-ai-claude-api-key";
const LEGACY_CLAUDE_API_KEY_STORAGE_KEY = "studybox-claude-api-key";
const CLAUDE_MODEL_STORAGE_KEY = "studybox-ai-claude-model";
const LEGACY_CLAUDE_MODEL_STORAGE_KEY = "studybox-claude-model";
const PINNED_STORAGE_KEY = "studybox-ai-pinned-items";
const POMODORO_LOG_STORAGE_KEY = "studybox-ai-pomodoro-log";

type PomodoroMode = "work" | "short" | "long";

interface PinnedAnswer {
  id: string;
  prompt: string;
  response: string;
  createdAt: string;
}

interface PomodoroSession {
  id: string;
  label: string;
  minutes: number;
  completedAt: string;
}

const POMODORO_PRESETS: Record<PomodoroMode, { label: string; badge: string; seconds: number }> = {
  work: { label: "Focus Session", badge: "work", seconds: 25 * 60 },
  short: { label: "Short Break", badge: "break", seconds: 5 * 60 },
  long: { label: "Long Break", badge: "long break", seconds: 15 * 60 },
};

const themes = [
  { id: "classic", label: "Classic" },
  { id: "dark", label: "Dark" },
  { id: "contrast", label: "Contrast" },
  { id: "neon", label: "Neon" },
] as const;

const claudeModels = [
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { id: "claude-3-5-haiku-latest", label: "Claude Haiku 3.5" },
] as const;

function toSafeFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "studybox-ai-answer";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildHistoryExport(entry: HistoryEntry) {
  const createdAt = new Date(entry.createdAt).toLocaleString();
  const source = entry.source.toUpperCase();

  return {
    title: `StudyBox-AI Export - ${entry.source}`,
    text: [
      "StudyBox-AI Export",
      "",
      `Source: ${source}`,
      `Created: ${createdAt}`,
      "",
      "Prompt",
      entry.prompt,
      "",
      "Response",
      entry.response,
    ].join("\n"),
    markdown: [
      "# StudyBox-AI Export",
      "",
      `- Source: ${source}`,
      `- Created: ${createdAt}`,
      "",
      "## Prompt",
      "",
      entry.prompt,
      "",
      "## Response",
      "",
      entry.response,
      "",
    ].join("\n"),
    json: JSON.stringify(entry, null, 2),
    html: `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>StudyBox-AI Export</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 32px; color: #111; line-height: 1.5; }
            h1, h2 { margin: 0 0 12px; }
            .meta { margin-bottom: 24px; color: #444; }
            .block { margin-bottom: 24px; border: 2px solid #111; padding: 16px; }
            pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: inherit; }
          </style>
        </head>
        <body>
          <h1>StudyBox-AI Export</h1>
          <div class="meta">Source: ${source}<br />Created: ${escapeHtml(createdAt)}</div>
          <div class="block">
            <h2>Prompt</h2>
            <pre>${escapeHtml(entry.prompt)}</pre>
          </div>
          <div class="block">
            <h2>Response</h2>
            <pre>${escapeHtml(entry.response)}</pre>
          </div>
        </body>
      </html>
    `,
  };
}

function dayKeyFromIso(iso: string) {
  return iso.slice(0, 10);
}

function getStreak(days: string[]) {
  if (!days.length) return 0;
  const sorted = [...new Set(days)].sort((a, b) => b.localeCompare(a));
  let streak = 1;
  let cursor = new Date(`${sorted[0]}T00:00:00`);

  for (let i = 1; i < sorted.length; i += 1) {
    const expected = new Date(cursor);
    expected.setDate(expected.getDate() - 1);
    const expectedKey = expected.toISOString().slice(0, 10);
    if (sorted[i] !== expectedKey) break;
    streak += 1;
    cursor = expected;
  }
  return streak;
}

export function App() {
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["id"]>("chat");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [theme, setTheme] = useState<(typeof themes)[number]["id"]>("classic");
  const [providerMode, setProviderMode] = useState<"local" | "hybrid" | "claude">("local");
  const [claudeApiKey, setClaudeApiKey] = useState("");
  const [claudeModel, setClaudeModel] = useState<(typeof claudeModels)[number]["id"]>("claude-sonnet-4-20250514");
  const [pinnedAnswers, setPinnedAnswers] = useState<PinnedAnswer[]>([]);
  const [notes, setNotes] = useState("");
  const [activityDays, setActivityDays] = useState<string[]>([]);
  const [completedPomodoros, setCompletedPomodoros] = useState(0);
  const [pomodoroMode, setPomodoroMode] = useState<PomodoroMode>("work");
  const [secondsLeft, setSecondsLeft] = useState(POMODORO_PRESETS.work.seconds);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroLog, setPomodoroLog] = useState<PomodoroSession[]>([]);

  const currentTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const accel = sdkReady ? getAccelerationMode() : null;
  const filteredHistory = history.filter((entry) => {
    const query = historySearch.trim().toLowerCase();
    if (!query) return true;
    return `${entry.source} ${entry.prompt} ${entry.response}`.toLowerCase().includes(query);
  });
  const selectedHistory = filteredHistory.find((entry) => entry.id === selectedHistoryId)
    ?? filteredHistory[0]
    ?? null;
  const streak = useMemo(() => getStreak(activityDays), [activityDays]);
  const xp = history.length * 10 + completedPomodoros * 25;
  const claudeConfigured = Boolean(claudeApiKey.trim());
  const pomodoroPreset = POMODORO_PRESETS[pomodoroMode];
  const claude: ClaudeSettings = useMemo(() => ({
    apiKey: claudeApiKey,
    model: claudeModel,
  }), [claudeApiKey, claudeModel]);
  const achievements = [
    { label: "First Ask", unlocked: history.length >= 1 },
    { label: "5 Sessions", unlocked: history.length >= 5 },
    { label: "3-Day Streak", unlocked: streak >= 3 },
    { label: "Pomodoro x5", unlocked: completedPomodoros >= 5 },
  ];

  const studyCalendar = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const todayKey = new Date().toISOString().slice(0, 10);

    return Array.from({ length: totalDays }, (_, index) => {
      const dayNumber = index + 1;
      const date = new Date(year, month, dayNumber);
      const key = dayKeyFromIso(date.toISOString());
      return {
        key,
        dayNumber,
        studied: activityDays.includes(key),
        today: key === todayKey,
      };
    });
  }, [activityDays]);

  useEffect(() => {
    initSDK()
      .then(() => setSdkReady(true))
      .catch((err) => setSdkError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY) ?? localStorage.getItem(LEGACY_HISTORY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as HistoryEntry[];
      setHistory(parsed);
      setSelectedHistoryId(parsed[0]?.id ?? null);
    } catch {
      localStorage.removeItem(HISTORY_STORAGE_KEY);
      localStorage.removeItem(LEGACY_HISTORY_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const savedTheme = (localStorage.getItem(THEME_STORAGE_KEY) ?? localStorage.getItem(LEGACY_THEME_STORAGE_KEY)) as (typeof themes)[number]["id"] | null;
    if (savedTheme && themes.some((themeOption) => themeOption.id === savedTheme)) {
      setTheme(savedTheme);
    }

    const savedNotes = localStorage.getItem(NOTES_STORAGE_KEY) ?? localStorage.getItem(LEGACY_NOTES_STORAGE_KEY);
    if (savedNotes) setNotes(savedNotes);

    const savedPinned = localStorage.getItem(PINNED_STORAGE_KEY);
    if (savedPinned) {
      try {
        setPinnedAnswers(JSON.parse(savedPinned) as PinnedAnswer[]);
      } catch {
        localStorage.removeItem(PINNED_STORAGE_KEY);
      }
    }

    const savedProviderMode = (localStorage.getItem(PROVIDER_MODE_KEY) ?? localStorage.getItem(LEGACY_PROVIDER_MODE_KEY)) as "local" | "hybrid" | "claude" | null;
    if (savedProviderMode === "local" || savedProviderMode === "hybrid" || savedProviderMode === "claude") {
      setProviderMode(savedProviderMode);
    }

    const savedClaudeKey = localStorage.getItem(CLAUDE_API_KEY_STORAGE_KEY) ?? localStorage.getItem(LEGACY_CLAUDE_API_KEY_STORAGE_KEY);
    if (savedClaudeKey) setClaudeApiKey(savedClaudeKey);

    const savedClaudeModel = (localStorage.getItem(CLAUDE_MODEL_STORAGE_KEY) ?? localStorage.getItem(LEGACY_CLAUDE_MODEL_STORAGE_KEY)) as (typeof claudeModels)[number]["id"] | null;
    if (savedClaudeModel && claudeModels.some((model) => model.id === savedClaudeModel)) {
      setClaudeModel(savedClaudeModel);
    }

    const savedDays = localStorage.getItem(ACTIVITY_STORAGE_KEY) ?? localStorage.getItem(LEGACY_ACTIVITY_STORAGE_KEY);
    if (savedDays) {
      try {
        setActivityDays(JSON.parse(savedDays) as string[]);
      } catch {
        localStorage.removeItem(ACTIVITY_STORAGE_KEY);
        localStorage.removeItem(LEGACY_ACTIVITY_STORAGE_KEY);
      }
    }

    const savedPomodoros = Number(localStorage.getItem(POMODORO_COUNT_KEY) ?? localStorage.getItem(LEGACY_POMODORO_COUNT_KEY) ?? "0");
    if (!Number.isNaN(savedPomodoros)) setCompletedPomodoros(savedPomodoros);

    const savedPomodoroLog = localStorage.getItem(POMODORO_LOG_STORAGE_KEY);
    if (savedPomodoroLog) {
      try {
        setPomodoroLog(JSON.parse(savedPomodoroLog) as PomodoroSession[]);
      } catch {
        localStorage.removeItem(POMODORO_LOG_STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(PROVIDER_MODE_KEY, providerMode);
  }, [providerMode]);

  useEffect(() => {
    localStorage.setItem(CLAUDE_API_KEY_STORAGE_KEY, claudeApiKey);
  }, [claudeApiKey]);

  useEffect(() => {
    localStorage.setItem(CLAUDE_MODEL_STORAGE_KEY, claudeModel);
  }, [claudeModel]);

  useEffect(() => {
    localStorage.setItem(NOTES_STORAGE_KEY, notes);
  }, [notes]);

  useEffect(() => {
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinnedAnswers));
  }, [pinnedAnswers]);

  useEffect(() => {
    localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(activityDays));
  }, [activityDays]);

  useEffect(() => {
    localStorage.setItem(POMODORO_COUNT_KEY, String(completedPomodoros));
  }, [completedPomodoros]);

  useEffect(() => {
    localStorage.setItem(POMODORO_LOG_STORAGE_KEY, JSON.stringify(pomodoroLog));
  }, [pomodoroLog]);

  useEffect(() => {
    if (!pomodoroRunning) return undefined;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => prev - 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pomodoroRunning]);

  useEffect(() => {
    if (secondsLeft > 0) return;

    const finishedMode = pomodoroMode;
    const finishedPreset = POMODORO_PRESETS[finishedMode];

    setPomodoroRunning(false);
    setPomodoroLog((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: finishedPreset.label,
        minutes: Math.round(finishedPreset.seconds / 60),
        completedAt: new Date().toISOString(),
      },
      ...prev,
    ].slice(0, 12));

    if (finishedMode === "work") {
      setCompletedPomodoros((prev) => prev + 1);
      setActivityDays((prev) => {
        const today = new Date().toISOString().slice(0, 10);
        return prev.includes(today) ? prev : [today, ...prev];
      });
      setPomodoroMode("short");
      setSecondsLeft(POMODORO_PRESETS.short.seconds);
    } else {
      setPomodoroMode("work");
      setSecondsLeft(POMODORO_PRESETS.work.seconds);
    }
  }, [secondsLeft, pomodoroMode]);

  const markActivity = (day: string) => {
    setActivityDays((prev) => (prev.includes(day) ? prev : [day, ...prev]));
  };

  const addHistoryEntry = (entry: Omit<HistoryEntry, "id" | "createdAt">) => {
    const createdAt = new Date().toISOString();
    const nextEntry: HistoryEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt,
    };

    setHistory((prev) => [nextEntry, ...prev].slice(0, 100));
    setSelectedHistoryId(nextEntry.id);
    markActivity(dayKeyFromIso(createdAt));
  };

  const clearHistory = () => {
    setHistory([]);
    setSelectedHistoryId(null);
  };

  const resetPomodoro = () => {
    setPomodoroRunning(false);
    setSecondsLeft(POMODORO_PRESETS[pomodoroMode].seconds);
  };

  const skipPomodoro = () => {
    setPomodoroRunning(false);
    const nextMode: PomodoroMode = pomodoroMode === "work" ? "short" : "work";
    setPomodoroMode(nextMode);
    setSecondsLeft(POMODORO_PRESETS[nextMode].seconds);
  };

  const selectPomodoroMode = (mode: PomodoroMode) => {
    setPomodoroRunning(false);
    setPomodoroMode(mode);
    setSecondsLeft(POMODORO_PRESETS[mode].seconds);
  };

  const addPinnedAnswer = (entry: { prompt: string; response: string }) => {
    setPinnedAnswers((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        prompt: entry.prompt,
        response: entry.response,
        createdAt: new Date().toISOString(),
      },
      ...prev.filter((item) => item.response !== entry.response),
    ].slice(0, 12));
  };

  const removePinnedAnswer = (id: string) => {
    setPinnedAnswers((prev) => prev.filter((item) => item.id !== id));
  };

  const downloadBlob = (content: string, type: string, filename: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportSelectedAsMarkdown = () => {
    if (!selectedHistory) return;
    const exportData = buildHistoryExport(selectedHistory);
    downloadBlob(exportData.markdown, "text/markdown;charset=utf-8", `${toSafeFilename(selectedHistory.prompt)}.md`);
  };

  const exportSelectedAsText = () => {
    if (!selectedHistory) return;
    const exportData = buildHistoryExport(selectedHistory);
    downloadBlob(exportData.text, "text/plain;charset=utf-8", `${toSafeFilename(selectedHistory.prompt)}.txt`);
  };

  const exportSelectedAsJson = () => {
    if (!selectedHistory) return;
    const exportData = buildHistoryExport(selectedHistory);
    downloadBlob(exportData.json, "application/json;charset=utf-8", `${toSafeFilename(selectedHistory.prompt)}.json`);
  };

  const copySelectedEntry = async () => {
    if (!selectedHistory) return;
    const exportData = buildHistoryExport(selectedHistory);
    await navigator.clipboard.writeText(exportData.text);
  };

  const shareSelectedEntry = async () => {
    if (!selectedHistory) return;
    const exportData = buildHistoryExport(selectedHistory);

    if (navigator.share) {
      await navigator.share({
        title: exportData.title,
        text: exportData.text,
      });
      return;
    }

    await navigator.clipboard.writeText(exportData.text);
  };

  const exportSelectedAsPdf = () => {
    if (!selectedHistory) return;
    const exportData = buildHistoryExport(selectedHistory);

    const printWindow = window.open("", "_blank", "width=900,height=1200");
    if (!printWindow) return;
    printWindow.document.write(exportData.html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  if (sdkError) {
    return (
      <div className="app-loading">
        <h2>SDK Error</h2>
        <p className="error-text">{sdkError}</p>
      </div>
    );
  }

  if (!sdkReady) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <h2>Loading RunAnywhere SDK...</h2>
        <p>Initializing on-device AI engine</p>
      </div>
    );
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <header>
        <div className="logo-block">
          <div className="logo-icon">S</div>
          <div>
            <div className="logo-text">STUDYBOX-AI</div>
            <div className="logo-version">v2.0 // ON-DEVICE AI</div>
          </div>
        </div>

        <nav>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`nav-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              <span className="tab-icon">{tab.icon}</span>
              {tab.label}
              <span className={`status-dot ${activeTab === tab.id ? "online" : ""}`} />
            </button>
          ))}
        </nav>

        <div className="header-right">
          <div className="model-badge">{providerMode === "local" ? "local runtime" : providerMode === "hybrid" ? "hybrid ai" : "claude ai"}</div>
          <div className="model-badge">{currentTab.badge}</div>
          {claudeConfigured && <div className="model-badge">claude linked</div>}
          {accel && <div className="model-badge">{accel}</div>}
        </div>
      </header>

      <div className="hero-strip">
        <div>
          <div className="hero-eyebrow">{currentTab.eyebrow}</div>
          <div className="hero-title">
            STUDYBOX <span className="glitch">AI</span>
          </div>
          <div className="hero-sub">// offline - fast - local</div>
        </div>

        <div className="hero-stats">
          <div className="stat-block">
            <div className="stat-num">{streak}</div>
            <div className="stat-label">day streak</div>
          </div>
          <div className="stat-block">
            <div className="stat-num">{xp}</div>
            <div className="stat-label">study xp</div>
          </div>
        </div>
      </div>

      <div className="ticker" aria-hidden="true">
        <div className="ticker-inner">
          <div className="ticker-item">Offline-first tutoring</div>
          <div className="ticker-item">Pomodoro + streak + smart notes</div>
          <div className="ticker-item">Flashcards and concept maps from your study history</div>
          <div className="ticker-item">Runs with on-device AI models</div>
          <div className="ticker-item">Offline-first tutoring</div>
          <div className="ticker-item">Pomodoro + streak + smart notes</div>
          <div className="ticker-item">Flashcards and concept maps from your study history</div>
          <div className="ticker-item">Runs with on-device AI models</div>
        </div>
      </div>

      <div className="content">
        <div className="main-stack">
          {activeTab === "chat" && <ChatTab onHistoryEntry={addHistoryEntry} providerMode={providerMode} claude={claude} onPinAnswer={addPinnedAnswer} />}
          {activeTab === "vision" && <VisionTab onHistoryEntry={addHistoryEntry} providerMode={providerMode} claude={claude} />}
          {activeTab === "tools" && <ToolsTab onHistoryEntry={addHistoryEntry} />}
          {activeTab === "voice" && <VoiceTab onHistoryEntry={addHistoryEntry} />}
          {activeTab === "notes" && (
            <SmartNotesTab
              history={history}
              selectedHistory={selectedHistory}
              notes={notes}
              onNotesChange={setNotes}
            />
          )}
          {activeTab === "flashcards" && (
            <FlashcardsTab history={history} selectedHistory={selectedHistory} notes={notes} />
          )}
          {activeTab === "map" && (
            <ConceptMapTab history={history} selectedHistory={selectedHistory} notes={notes} />
          )}
        </div>

        <aside className="info-stack">
          <div className="info-block">
            <div className="info-block-head">
              <span>Pomodoro</span>
              <span>{pomodoroPreset.badge}</span>
            </div>
            <div className="info-block-body pomodoro-body">
              <div className="pomodoro-mode-switcher">
                {(["work", "short", "long"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={`theme-chip pomodoro-chip ${pomodoroMode === mode ? "active" : ""}`}
                    onClick={() => selectPomodoroMode(mode)}
                    type="button"
                  >
                    {POMODORO_PRESETS[mode].badge}
                  </button>
                ))}
              </div>
              <div className="pomodoro-time">
                {String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:
                {String(secondsLeft % 60).padStart(2, "0")}
              </div>
              <div className="pomodoro-label">{pomodoroPreset.label}</div>
              <div className="pomodoro-actions">
                <button className="btn primary" type="button" onClick={() => setPomodoroRunning((prev) => !prev)}>
                  {pomodoroRunning ? "Pause" : "Start"}
                </button>
                <button className="btn" type="button" onClick={resetPomodoro}>Reset</button>
                <button className="btn" type="button" onClick={skipPomodoro}>Skip</button>
              </div>
              <div className="pomodoro-meta">
                <span>{completedPomodoros} completed pomodoros</span>
                <span>{Math.round(pomodoroPreset.seconds / 60)} min session</span>
              </div>
              <div className="session-log">
                {pomodoroLog.length === 0 && <p className="history-empty">No sessions logged yet.</p>}
                {pomodoroLog.map((session) => (
                  <div key={session.id} className="session-item">
                    <span className={`session-dot ${session.label === "Focus Session" ? "work" : "break"}`} />
                    <span>{session.label}</span>
                    <span className="session-time">{new Date(session.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="info-block">
            <div className="info-block-head">
              <span>Study streak</span>
              <span>{streak} days</span>
            </div>
            <div className="info-block-body">
              <div className="streak-grid">
                <div className="streak-stat">
                  <strong>{xp}</strong>
                  <span>XP</span>
                </div>
                <div className="streak-stat">
                  <strong>{history.length}</strong>
                  <span>Entries</span>
                </div>
                <div className="streak-stat">
                  <strong>{completedPomodoros}</strong>
                  <span>Focus Blocks</span>
                </div>
              </div>
              <div className="achievement-wall">
                {achievements.map((achievement) => (
                  <div key={achievement.label} className={`achievement-chip ${achievement.unlocked ? "active" : ""}`}>
                    {achievement.label}
                  </div>
                ))}
              </div>
              <div className="calendar-grid">
                {studyCalendar.map((day) => (
                  <div
                    key={day.key}
                    className={`calendar-day ${day.studied ? "active" : ""} ${day.today ? "today" : ""}`}
                    title={day.key}
                  >
                    {day.dayNumber}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="info-block">
            <div className="info-block-head">
              <span>Pinned answers</span>
              <span>{pinnedAnswers.length} saved</span>
            </div>
            <div className="info-block-body pinned-list">
              {pinnedAnswers.length === 0 && (
                <p className="history-empty">Pin AI answers from chat and they will stay here for quick review.</p>
              )}
              {pinnedAnswers.map((item) => (
                <div key={item.id} className="pinned-item">
                  <button className="pinned-remove" onClick={() => removePinnedAnswer(item.id)} type="button">Remove</button>
                  <div className="history-preview-label">Prompt</div>
                  <p className="pinned-question">{item.prompt}</p>
                  <div className="history-preview-label">Answer</div>
                  <p className="pinned-answer">{item.response}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="info-block">
            <div className="info-block-head">
              <span>Theme</span>
              <span>{theme}</span>
            </div>
            <div className="info-block-body theme-switcher">
              {themes.map((themeOption) => (
                <button
                  key={themeOption.id}
                  className={`theme-chip ${theme === themeOption.id ? "active" : ""}`}
                  onClick={() => setTheme(themeOption.id)}
                  type="button"
                >
                  {themeOption.label}
                </button>
              ))}
            </div>
          </div>

          <div className="info-block">
            <div className="info-block-head">
              <span>Provider</span>
              <span>{providerMode}</span>
            </div>
            <div className="info-block-body provider-panel">
              <div className="provider-switcher">
                {(["local", "hybrid", "claude"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={`theme-chip ${providerMode === mode ? "active" : ""}`}
                    onClick={() => setProviderMode(mode)}
                    type="button"
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <input
                className="history-search"
                type="password"
                placeholder="Paste Claude API key (stored in this browser)"
                value={claudeApiKey}
                onChange={(e) => setClaudeApiKey(e.target.value)}
              />
              <select
                className="history-search"
                value={claudeModel}
                onChange={(e) => setClaudeModel(e.target.value as (typeof claudeModels)[number]["id"])}
              >
                {claudeModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
              <p className="provider-note">
                VLM means vision-language model for camera and image tasks. In local mode the app downloads models to your device. Claude mode uses your API key for stronger text and image answers.
              </p>
            </div>
          </div>

          <div className="info-block history-block">
            <div className="info-block-head">
              <span>History log</span>
              <button className="history-clear" onClick={clearHistory} type="button">Clear</button>
            </div>
            <div className="info-block-body history-body">
              <input
                className="history-search"
                type="search"
                placeholder="Search prompts and answers..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
              />

              <div className="history-list">
                {filteredHistory.length === 0 && (
                  <p className="history-empty">No history yet. Ask something and it will show up here.</p>
                )}
                {filteredHistory.map((entry) => (
                  <button
                    key={entry.id}
                    className={`history-item ${selectedHistory?.id === entry.id ? "active" : ""}`}
                    onClick={() => setSelectedHistoryId(entry.id)}
                    type="button"
                  >
                    <span className="history-source">{entry.source}</span>
                    <span className="history-prompt">{entry.prompt}</span>
                    <span className="history-time">{new Date(entry.createdAt).toLocaleString()}</span>
                  </button>
                ))}
              </div>

              {selectedHistory && (
                <div className="history-preview">
                  <div className="history-actions">
                    <button className="btn" onClick={copySelectedEntry} type="button">Copy</button>
                    <button className="btn" onClick={shareSelectedEntry} type="button">Share</button>
                    <button className="btn" onClick={exportSelectedAsText} type="button">Export .txt</button>
                    <button className="btn" onClick={exportSelectedAsMarkdown} type="button">Export .md</button>
                    <button className="btn" onClick={exportSelectedAsJson} type="button">Export .json</button>
                    <button className="btn primary" onClick={exportSelectedAsPdf} type="button">Print / PDF</button>
                  </div>
                  <div className="history-preview-label">Prompt</div>
                  <p>{selectedHistory.prompt}</p>
                  <div className="history-preview-label">Response</div>
                  <p>{selectedHistory.response}</p>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      <footer>
        <div className="footer-left">studybox-ai interface // extended study mode</div>
        <div className="footer-right">
          active module <span>{currentTab.badge}</span>
        </div>
      </footer>
    </div>
  );
}
