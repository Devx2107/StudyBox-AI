import { useEffect, useMemo, useRef, useState } from "react";
import { getAccelerationMode, initSDK } from "./runanywhere";
import { ChatTab } from "./components/ChatTab";
import { VisionTab } from "./components/VisionTab";
import { VoiceTab } from "./components/VoiceTab";
import { SmartNotesTab } from "./components/SmartNotesTab";
import { FlashcardsTab } from "./components/FlashcardsTab";
import { QuizTab } from "./components/QuizTab";
import { ConceptMapTab } from "./components/ConceptMapTab";
import { SettingsTab } from "./components/SettingsTab";
import { ProfileTab } from "./components/ProfileTab";
import { MarkdownContent } from "./components/MarkdownContent";
import type { HistoryEntry, HistorySource } from "./types/history";
import type { ClaudeSettings } from "./lib/anthropic";

const tabs = [
  { id: "chat", label: "Chat", icon: "C", eyebrow: "Tutor mode", title: "Talk to", accent: "Your AI.", badge: "LLM Core" },
  { id: "vision", label: "Vision", icon: "V", eyebrow: "Camera mode", title: "See and", accent: "Describe.", badge: "VLM Lens" },
  { id: "voice", label: "Voice", icon: "O", eyebrow: "Voice mode", title: "Speak and", accent: "Learn.", badge: "Speech Stack" },
  { id: "notes", label: "Notes", icon: "N", eyebrow: "Notes mode", title: "Write and", accent: "Summarise.", badge: "Smart Notes" },
  { id: "flashcards", label: "Cards", icon: "F", eyebrow: "Recall mode", title: "Flip and", accent: "Master.", badge: "Flashcards" },
  { id: "quiz", label: "Quiz", icon: "Q", eyebrow: "Quiz mode", title: "Test", accent: "Yourself.", badge: "Quiz Lab" },
  { id: "map", label: "Map", icon: "M", eyebrow: "Map mode", title: "Map", accent: "It Out.", badge: "Concept Graph" },
  { id: "profile", label: "Profile", icon: "P", eyebrow: "Profile mode", title: "Keep", accent: "Grinding.", badge: "Profile" },
  { id: "settings", label: "Settings", icon: "S", eyebrow: "Settings mode", title: "Tune Your", accent: "Workspace.", badge: "Preferences" },
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
const LANGUAGE_MODEL_STORAGE_KEY = "studybox-ai-language-model";
const VISION_MODEL_STORAGE_KEY = "studybox-ai-vision-model";
const PINNED_STORAGE_KEY = "studybox-ai-pinned-items";
const POMODORO_LOG_STORAGE_KEY = "studybox-ai-pomodoro-log";
const PROFILE_STORAGE_KEY = "studybox-ai-profile-stats";

type PomodoroMode = "work" | "break5" | "break10";

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

interface ProfileStatsConfig {
  userName: string;
  welcome: string;
  rankLabel: string;
  xpTarget: number;
  weeklyGoal: number;
  weeklyHighlights: string[];
  achievements: Array<{ id: string; label: string; description: string }>;
}

interface StudyStatsExport {
  exportedAt: string;
  version: 1;
  profile: ProfileStatsConfig;
  stats: {
    history: HistoryEntry[];
    notes: string;
    activityDays: string[];
    completedPomodoros: number;
    pomodoroLog: PomodoroSession[];
    pinnedAnswers: PinnedAnswer[];
  };
}

const POMODORO_PRESETS: Record<PomodoroMode, { label: string; badge: string; seconds: number }> = {
  work: { label: "Focus Session", badge: "work", seconds: 25 * 60 },
  break5: { label: "5 Min Break", badge: "break", seconds: 5 * 60 },
  break10: { label: "10 Min Break", badge: "break", seconds: 10 * 60 },
};

const themes = [
  { id: "classic", label: "Classic" },
  { id: "blue", label: "Blue" },
  { id: "pink", label: "Pink" },
  { id: "orange", label: "Orange" },
  { id: "purple", label: "Purple" },
] as const;

const claudeModels = [
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { id: "claude-3-5-haiku-latest", label: "Claude Haiku 3.5" },
] as const;

const historySourceLabels: Record<HistorySource, string> = {
  chat: "Chat",
  voice: "Voice",
  vision: "Vision",
  quiz: "Quiz",
  tools: "Tools",
};

const DEFAULT_PROFILE_STATS: ProfileStatsConfig = {
  userName: "Study Explorer",
  welcome: "Welcome back",
  rankLabel: "Level 8 Scholar",
  xpTarget: 1000,
  weeklyGoal: 200,
  weeklyHighlights: [
    "+50 XP - Solved a study problem",
    "+25 XP - Completed a focus block",
    "+30 XP - Generated flashcards",
    "+10 XP - Kept the streak alive",
  ],
  achievements: [
    { id: "first-ask", label: "First Ask", description: "Start your first study session" },
    { id: "five-sessions", label: "5 Sessions", description: "Log five study entries" },
    { id: "three-day-streak", label: "3-Day Streak", description: "Study three days in a row" },
    { id: "pomodoro-five", label: "Pomodoro x5", description: "Complete five focus sessions" },
    { id: "deep-work", label: "Deep Work", description: "Reach ten focus blocks" },
    { id: "xp-1000", label: "1000 XP", description: "Cross 1000 total XP" },
  ],
};

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
  const [historySourceFilter, setHistorySourceFilter] = useState<"all" | HistorySource>("all");
  const [historySearch, setHistorySearch] = useState("");
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [theme, setTheme] = useState<(typeof themes)[number]["id"]>("classic");
  const [providerMode, setProviderMode] = useState<"local" | "hybrid" | "claude">("local");
  const [claudeApiKey, setClaudeApiKey] = useState("");
  const [claudeModel, setClaudeModel] = useState<(typeof claudeModels)[number]["id"]>("claude-sonnet-4-20250514");
  const [preferredLanguageModelId, setPreferredLanguageModelId] = useState("");
  const [preferredVisionModelId, setPreferredVisionModelId] = useState("");
  const [profileStats, setProfileStats] = useState<ProfileStatsConfig>(DEFAULT_PROFILE_STATS);
  const [statsImportStatus, setStatsImportStatus] = useState<string | null>(null);
  const [pinnedAnswers, setPinnedAnswers] = useState<PinnedAnswer[]>([]);
  const [notes, setNotes] = useState("");
  const [activityDays, setActivityDays] = useState<string[]>([]);
  const [completedPomodoros, setCompletedPomodoros] = useState(0);
  const [pomodoroMode, setPomodoroMode] = useState<PomodoroMode>("work");
  const [secondsLeft, setSecondsLeft] = useState(POMODORO_PRESETS.work.seconds);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroLog, setPomodoroLog] = useState<PomodoroSession[]>([]);
  const [timerPopupOpen, setTimerPopupOpen] = useState(false);
  const timerPopupRef = useRef<HTMLDivElement | null>(null);

  const currentTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const showSupportSection = activeTab !== "profile" && activeTab !== "settings" && activeTab !== "quiz";
  const accelerationMode = sdkReady ? getAccelerationMode() : null;
  const historySourceOptions = useMemo(() => {
    const presentSources = new Set(history.map((entry) => entry.source));
    return [
      { id: "all" as const, label: "All" },
      ...(["chat", "voice", "vision", "quiz", "tools"] as const)
        .filter((source) => presentSources.has(source))
        .map((source) => ({ id: source, label: historySourceLabels[source] })),
    ];
  }, [history]);
  const filteredHistory = history.filter((entry) => {
    const query = historySearch.trim().toLowerCase();
    const matchesSource = historySourceFilter === "all" || entry.source === historySourceFilter;
    if (!matchesSource) return false;
    if (!query) return true;
    return `${entry.source} ${entry.prompt} ${entry.response}`.toLowerCase().includes(query);
  });
  const selectedHistory = filteredHistory.find((entry) => entry.id === selectedHistoryId)
    ?? filteredHistory[0]
    ?? null;
  const streak = useMemo(() => getStreak(activityDays), [activityDays]);
  const xp = history.length * 10 + completedPomodoros * 25;
  const pomodoroPreset = POMODORO_PRESETS[pomodoroMode];
  const claude: ClaudeSettings = useMemo(() => ({
    apiKey: claudeApiKey,
    model: claudeModel,
  }), [claudeApiKey, claudeModel]);
  const achievements = [
    { id: "first-ask", label: "First Ask", unlocked: history.length >= 1 },
    { id: "five-sessions", label: "5 Sessions", unlocked: history.length >= 5 },
    { id: "three-day-streak", label: "3-Day Streak", unlocked: streak >= 3 },
    { id: "pomodoro-five", label: "Pomodoro x5", unlocked: completedPomodoros >= 5 },
    { id: "deep-work", label: "Deep Work", unlocked: completedPomodoros >= 10 },
    { id: "xp-1000", label: "1000 XP", unlocked: xp >= 1000 },
  ];
  const unlockedAchievementIds = achievements.filter((achievement) => achievement.unlocked).map((achievement) => achievement.id);

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
    if (!window.matchMedia("(pointer: fine)").matches) return undefined;

    const mainCursor = document.createElement("div");
    const trailCursor = document.createElement("div");
    mainCursor.className = "nb-cursor";
    trailCursor.className = "nb-cursor-trail";
    document.body.appendChild(trailCursor);
    document.body.appendChild(mainCursor);

    const interactiveSelector = "button, a, input, textarea, select, [role=\"button\"], .nav-tab, .history-item, .theme-chip, .btn";
    let targetX = -100;
    let targetY = -100;
    let cursorX = -100;
    let cursorY = -100;
    let trailX = -100;
    let trailY = -100;
    let frameId = 0;

    const isInteractiveTarget = (target: EventTarget | null) =>
      target instanceof Element ? target.closest(interactiveSelector) : null;

    const showCursor = () => {
      document.body.classList.add("cursor-visible");
    };

    const hideCursor = () => {
      document.body.classList.remove("cursor-visible", "cursor-hover", "cursor-click");
    };

    const animate = () => {
      cursorX += (targetX - cursorX) * 0.35;
      cursorY += (targetY - cursorY) * 0.35;
      trailX += (targetX - trailX) * 0.14;
      trailY += (targetY - trailY) * 0.14;

      mainCursor.style.transform = `translate(${cursorX}px, ${cursorY}px)`;
      trailCursor.style.transform = `translate(${trailX}px, ${trailY}px)`;
      frameId = window.requestAnimationFrame(animate);
    };

    const handleMouseMove = (event: MouseEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
      showCursor();
    };

    const handleMouseOver = (event: MouseEvent) => {
      if (isInteractiveTarget(event.target)) {
        document.body.classList.add("cursor-hover");
      }
    };

    const handleMouseOut = (event: MouseEvent) => {
      if (!isInteractiveTarget(event.relatedTarget)) {
        document.body.classList.remove("cursor-hover");
      }
    };

    const handleMouseDown = () => {
      document.body.classList.add("cursor-click");
    };

    const handleMouseUp = () => {
      document.body.classList.remove("cursor-click");
    };

    const handleMouseLeave = () => {
      hideCursor();
    };

    const handleWindowBlur = () => {
      hideCursor();
    };

    const handleWindowMouseOut = (event: MouseEvent) => {
      if (!event.relatedTarget && !event.toElement) {
        hideCursor();
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseover", handleMouseOver);
    document.addEventListener("mouseout", handleMouseOut);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("mouseout", handleWindowMouseOut);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("mouseleave", handleMouseLeave);

    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseover", handleMouseOver);
      document.removeEventListener("mouseout", handleMouseOut);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mouseout", handleWindowMouseOut);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("mouseleave", handleMouseLeave);
      document.body.classList.remove("cursor-visible", "cursor-hover", "cursor-click");
      mainCursor.remove();
      trailCursor.remove();
    };
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
    let cancelled = false;

    const loadProfileStats = async () => {
      const savedProfile = localStorage.getItem(PROFILE_STORAGE_KEY);
      if (savedProfile) {
        try {
          const parsed = JSON.parse(savedProfile) as ProfileStatsConfig;
          if (!cancelled) setProfileStats({ ...DEFAULT_PROFILE_STATS, ...parsed });
          return;
        } catch {
          localStorage.removeItem(PROFILE_STORAGE_KEY);
        }
      }

      try {
        const response = await fetch("/profile-stats.json");
        if (!response.ok) throw new Error(`Profile seed failed (${response.status})`);
        const payload = await response.json() as Partial<ProfileStatsConfig>;
        if (!cancelled) {
          setProfileStats({ ...DEFAULT_PROFILE_STATS, ...payload });
        }
      } catch {
        if (!cancelled) {
          setProfileStats(DEFAULT_PROFILE_STATS);
        }
      }
    };

    void loadProfileStats();

    return () => {
      cancelled = true;
    };
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

    const savedLanguageModel = localStorage.getItem(LANGUAGE_MODEL_STORAGE_KEY);
    if (savedLanguageModel) setPreferredLanguageModelId(savedLanguageModel);

    const savedVisionModel = localStorage.getItem(VISION_MODEL_STORAGE_KEY);
    if (savedVisionModel) setPreferredVisionModelId(savedVisionModel);

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
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profileStats));
  }, [profileStats]);

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
    if (preferredLanguageModelId) localStorage.setItem(LANGUAGE_MODEL_STORAGE_KEY, preferredLanguageModelId);
    else localStorage.removeItem(LANGUAGE_MODEL_STORAGE_KEY);
  }, [preferredLanguageModelId]);

  useEffect(() => {
    if (preferredVisionModelId) localStorage.setItem(VISION_MODEL_STORAGE_KEY, preferredVisionModelId);
    else localStorage.removeItem(VISION_MODEL_STORAGE_KEY);
  }, [preferredVisionModelId]);

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
    if (!timerPopupOpen) return undefined;

    const handleOutsideClick = (event: MouseEvent) => {
      if (!timerPopupRef.current?.contains(event.target as Node)) {
        setTimerPopupOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [timerPopupOpen]);

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
      setPomodoroMode("break5");
      setSecondsLeft(POMODORO_PRESETS.break5.seconds);
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

  const skipPomodoro = () => {
    setPomodoroRunning(false);
    const nextMode: PomodoroMode = pomodoroMode === "work" ? "break5" : "work";
    setPomodoroMode(nextMode);
    setSecondsLeft(POMODORO_PRESETS[nextMode].seconds);
  };

  const selectPomodoroMode = (mode: PomodoroMode) => {
    setPomodoroRunning(false);
    setPomodoroMode(mode);
    setSecondsLeft(POMODORO_PRESETS[mode].seconds);
  };

  const endPomodoro = () => {
    setPomodoroRunning(false);
    setPomodoroMode("work");
    setSecondsLeft(POMODORO_PRESETS.work.seconds);
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

  const timerDisplay = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;

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

  const exportStudyStats = () => {
    const payload: StudyStatsExport = {
      exportedAt: new Date().toISOString(),
      version: 1,
      profile: profileStats,
      stats: {
        history,
        notes,
        activityDays,
        completedPomodoros,
        pomodoroLog,
        pinnedAnswers,
      },
    };

    downloadBlob(
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8",
      `studybox-ai-stats-${new Date().toISOString().slice(0, 10)}.json`,
    );
    setStatsImportStatus(`Exported stats on ${new Date(payload.exportedAt).toLocaleString()}`);
  };

  const importStudyStats = async (file: File) => {
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as Partial<StudyStatsExport>;

      if (!parsed || parsed.version !== 1 || !parsed.profile || !parsed.stats) {
        throw new Error("This file is not a valid StudyBox-AI stats export.");
      }

      setProfileStats({ ...DEFAULT_PROFILE_STATS, ...parsed.profile });
      setHistory(Array.isArray(parsed.stats.history) ? parsed.stats.history : []);
      setSelectedHistoryId(parsed.stats.history?.[0]?.id ?? null);
      setNotes(typeof parsed.stats.notes === "string" ? parsed.stats.notes : "");
      setActivityDays(Array.isArray(parsed.stats.activityDays) ? parsed.stats.activityDays : []);
      setCompletedPomodoros(
        typeof parsed.stats.completedPomodoros === "number" ? parsed.stats.completedPomodoros : 0,
      );
      setPomodoroLog(Array.isArray(parsed.stats.pomodoroLog) ? parsed.stats.pomodoroLog : []);
      setPinnedAnswers(Array.isArray(parsed.stats.pinnedAnswers) ? parsed.stats.pinnedAnswers : []);
      setStatsImportStatus(`Imported stats from ${file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatsImportStatus(`Import failed: ${message}`);
    }
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
            <div className="logo-version">ON-DEVICE AI</div>
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
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="header-timer-shell" ref={timerPopupRef}>
          <button
            className={`header-timer ${pomodoroRunning ? "active" : ""}`}
            type="button"
            onClick={() => setTimerPopupOpen((prev) => !prev)}
            aria-expanded={timerPopupOpen}
          >
            <span className="header-timer-mode">{pomodoroPreset.badge}</span>
            <span className="header-timer-time">{timerDisplay}</span>
          </button>

          {timerPopupOpen && (
            <div className="header-timer-popup">
              <div className="header-timer-popup-head">
                <span>Pomodoro Timer</span>
                <span>{pomodoroPreset.label}</span>
              </div>

              <div className="header-timer-popup-body">
                {pomodoroMode !== "work" && (
                  <div className="pomodoro-mode-switcher header-timer-break-options">
                    <button
                      className={`theme-chip pomodoro-chip ${pomodoroMode === "break5" ? "active" : ""}`}
                      onClick={() => selectPomodoroMode("break5")}
                      type="button"
                    >
                      5 min
                    </button>
                    <button
                      className={`theme-chip pomodoro-chip ${pomodoroMode === "break10" ? "active" : ""}`}
                      onClick={() => selectPomodoroMode("break10")}
                      type="button"
                    >
                      10 min
                    </button>
                  </div>
                )}

                <div className="header-timer-display">{timerDisplay}</div>

                <div className="pomodoro-mode-switcher header-timer-modes">
                  <button
                    className={`theme-chip pomodoro-chip ${pomodoroMode === "work" ? "active" : ""}`}
                    onClick={() => selectPomodoroMode("work")}
                    type="button"
                  >
                    work
                  </button>
                  <button
                    className={`theme-chip pomodoro-chip ${pomodoroMode !== "work" ? "active" : ""}`}
                    onClick={() => selectPomodoroMode("break5")}
                    type="button"
                  >
                    break
                  </button>
                </div>

                <div className="header-timer-actions">
                  <button className="btn primary" type="button" onClick={() => setPomodoroRunning((prev) => !prev)}>
                    {pomodoroRunning ? "Pause" : "Start"}
                  </button>
                  <button className="btn pink" type="button" onClick={endPomodoro}>End</button>
                </div>

                <div className="pomodoro-meta">
                  <span>{Math.round(pomodoroPreset.seconds / 60)} min session | {completedPomodoros} completed pomodoros</span>
                </div>
              </div>
            </div>
          )}
        </div>

      </header>

      <div className="hero-strip">
        <div className="hero-copy">
          <div className="hero-eyebrow">{currentTab.eyebrow}</div>
          <div className="hero-title">
            {currentTab.title} <span>{currentTab.accent}</span>
          </div>
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

      <div className="content full-page">
        <div className="main-stack">
          {activeTab === "chat" && <ChatTab onHistoryEntry={addHistoryEntry} providerMode={providerMode} claude={claude} languageModelId={preferredLanguageModelId || undefined} onPinAnswer={addPinnedAnswer} />}
          {activeTab === "vision" && <VisionTab onHistoryEntry={addHistoryEntry} providerMode={providerMode} claude={claude} visionModelId={preferredVisionModelId || undefined} />}
          {activeTab === "voice" && <VoiceTab onHistoryEntry={addHistoryEntry} languageModelId={preferredLanguageModelId || undefined} />}
          {activeTab === "notes" && (
            <SmartNotesTab
              history={history}
              selectedHistory={selectedHistory}
              notes={notes}
              languageModelId={preferredLanguageModelId || undefined}
              onNotesChange={setNotes}
            />
          )}
          {activeTab === "flashcards" && (
            <FlashcardsTab history={history} selectedHistory={selectedHistory} notes={notes} languageModelId={preferredLanguageModelId || undefined} />
          )}
          {activeTab === "quiz" && (
            <QuizTab
              history={history}
              selectedHistory={selectedHistory}
              notes={notes}
              languageModelId={preferredLanguageModelId || undefined}
              onHistoryEntry={addHistoryEntry}
            />
          )}
          {activeTab === "map" && (
            <ConceptMapTab history={history} selectedHistory={selectedHistory} notes={notes} languageModelId={preferredLanguageModelId || undefined} />
          )}
          {activeTab === "profile" && (
            <ProfileTab
              profile={profileStats}
              streak={streak}
              xp={xp}
              historyCount={history.length}
              completedPomodoros={completedPomodoros}
              calendar={studyCalendar}
              unlockedAchievements={unlockedAchievementIds}
              onExportStats={exportStudyStats}
              onImportStats={importStudyStats}
              importStatus={statsImportStatus}
            />
          )}
          {activeTab === "settings" && (
            <SettingsTab
              theme={theme}
              themes={[...themes]}
              onThemeChange={(value) => setTheme(value as (typeof themes)[number]["id"])}
              providerMode={providerMode}
              onProviderModeChange={setProviderMode}
              claudeApiKey={claudeApiKey}
              onClaudeApiKeyChange={setClaudeApiKey}
              claudeModel={claudeModel}
              claudeModels={[...claudeModels]}
              onClaudeModelChange={(value) => setClaudeModel(value as (typeof claudeModels)[number]["id"])}
              preferredLanguageModelId={preferredLanguageModelId}
              onPreferredLanguageModelChange={setPreferredLanguageModelId}
              preferredVisionModelId={preferredVisionModelId}
              onPreferredVisionModelChange={setPreferredVisionModelId}
              accelerationMode={accelerationMode}
            />
          )}
          {showSupportSection && (
          <section className="support-grid">
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
                    <MarkdownContent className="pinned-question markdown-content" content={item.prompt} />
                    <div className="history-preview-label">Answer</div>
                    <MarkdownContent className="pinned-answer markdown-content" content={item.response} />
                  </div>
                ))}
              </div>
            </div>
            <div className="info-block history-block">
              <div className="info-block-head">
                <span>History log</span>
                <div className="history-header-tools">
                  {historySourceOptions.map((option) => (
                    <button
                      key={option.id}
                      className={`chat-header-btn history-header-btn ${historySourceFilter === option.id ? "active" : ""}`}
                      onClick={() => setHistorySourceFilter(option.id)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                  <button className="history-clear" onClick={clearHistory} type="button">Clear</button>
                </div>
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
                      <span className="history-source">{historySourceLabels[entry.source] ?? entry.source}</span>
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
                    <MarkdownContent className="markdown-content" content={selectedHistory.prompt} />
                    <div className="history-preview-label">Response</div>
                    <MarkdownContent className="markdown-content" content={selectedHistory.response} />
                  </div>
                )}
              </div>
            </div>
          </section>
          )}
        </div>
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
