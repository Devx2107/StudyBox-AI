import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const ACTIVE_TAB_STORAGE_KEY = "studybox-ai-active-tab";
const THEME_STORAGE_KEY = "studybox-ai-theme";
const POMODORO_MUSIC_SOURCE_STORAGE_KEY = "studybox-ai-pomodoro-music-source";
const POMODORO_MUSIC_VOLUME_STORAGE_KEY = "studybox-ai-pomodoro-music-volume";
const NOTES_STORAGE_KEY = "studybox-ai-smart-notes";
const LEGACY_NOTES_STORAGE_KEY = "studybox-smart-notes";
const ACTIVITY_STORAGE_KEY = "studybox-ai-activity-days";
const LEGACY_ACTIVITY_STORAGE_KEY = "studybox-activity-days";
const POMODORO_COUNT_KEY = "studybox-ai-pomodoros";
const LEGACY_POMODORO_COUNT_KEY = "studybox-pomodoros";

const LANGUAGE_MODEL_STORAGE_KEY = "studybox-ai-language-model";
const VISION_MODEL_STORAGE_KEY = "studybox-ai-vision-model";
const PINNED_STORAGE_KEY = "studybox-ai-pinned-items";
const POMODORO_LOG_STORAGE_KEY = "studybox-ai-pomodoro-log";
const POMODORO_MODE_STORAGE_KEY = "studybox-ai-pomodoro-mode";
const POMODORO_SECONDS_LEFT_STORAGE_KEY = "studybox-ai-pomodoro-seconds-left";
const PROFILE_STORAGE_KEY = "studybox-ai-profile-stats";
const HISTORY_FILTER_STORAGE_KEY = "studybox-ai-history-filter";

type PomodoroMode = "work" | "break5" | "break10";
type PomodoroMusicSource = "lofi" | "rain";
type PomodoroMusicStatus = "idle" | "playing" | "paused" | "error";

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

interface PomodoroMusicState {
  selectedSource: PomodoroMusicSource | null;
  activeSource: PomodoroMusicSource | null;
  status: PomodoroMusicStatus;
  volume: number;
  currentTrackUrl: string | null;
  error: string | null;
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

const MUSIC_TRACKS = {
  lofi: Object.values(
    import.meta.glob("./assets/music/lofi/*.{mp3,wav,ogg,m4a}", { eager: true, import: "default" }) as Record<string, string>,
  ).sort(),
  rain: Object.values(
    import.meta.glob("./assets/music/rain/*.{mp3,wav,ogg,m4a}", { eager: true, import: "default" }) as Record<string, string>,
  ).sort(),
} satisfies Record<PomodoroMusicSource, string[]>;

const DEFAULT_POMODORO_MUSIC_STATE: PomodoroMusicState = {
  selectedSource: "lofi",
  activeSource: null,
  status: "paused",
  volume: 0.2,
  currentTrackUrl: null,
  error: null,
};

const themes = [
  { id: "classic", label: "Classic" },
  { id: "blue", label: "Blue" },
  { id: "pink", label: "Pink" },
  { id: "orange", label: "Orange" },
  { id: "purple", label: "Purple" },
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

function isTabId(value: string | null): value is (typeof tabs)[number]["id"] {
  return Boolean(value && tabs.some((tab) => tab.id === value));
}

function isThemeId(value: string | null): value is (typeof themes)[number]["id"] {
  return Boolean(value && themes.some((themeOption) => themeOption.id === value));
}

function isHistoryFilter(value: string | null): value is "all" | HistorySource {
  return value === "all" || value === "chat" || value === "voice" || value === "vision" || value === "quiz" || value === "tools";
}

function isPomodoroMode(value: string | null): value is PomodoroMode {
  return value === "work" || value === "break5" || value === "break10";
}

function getStoredTheme(): (typeof themes)[number]["id"] {
  if (typeof window === "undefined") return "classic";
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeId(savedTheme) ? savedTheme : "classic";
}

function getStoredActiveTab(): (typeof tabs)[number]["id"] {
  if (typeof window === "undefined") return "chat";
  const savedTab = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
  return isTabId(savedTab) ? savedTab : "chat";
}

function getStoredPomodoroMusicState(): PomodoroMusicState {
  if (typeof window === "undefined") return DEFAULT_POMODORO_MUSIC_STATE;
  const savedSource = window.localStorage.getItem(POMODORO_MUSIC_SOURCE_STORAGE_KEY);
  const savedVolume = Number(window.localStorage.getItem(POMODORO_MUSIC_VOLUME_STORAGE_KEY) ?? "");
  const volume = Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1
    ? savedVolume
    : DEFAULT_POMODORO_MUSIC_STATE.volume;
  if (savedSource === "lofi" || savedSource === "rain") {
    return {
      ...DEFAULT_POMODORO_MUSIC_STATE,
      selectedSource: savedSource,
      volume,
    };
  }
  return {
    ...DEFAULT_POMODORO_MUSIC_STATE,
    volume,
  };
}

export function App() {
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["id"]>(() => getStoredActiveTab());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historySourceFilter, setHistorySourceFilter] = useState<"all" | HistorySource>("all");
  const [historySearch, setHistorySearch] = useState("");
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [theme, setTheme] = useState<(typeof themes)[number]["id"]>(() => getStoredTheme());

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
  const [pomodoroMusic, setPomodoroMusic] = useState<PomodoroMusicState>(() => getStoredPomodoroMusicState());
  const [timerPopupOpen, setTimerPopupOpen] = useState(false);
  const timerPopupRef = useRef<HTMLDivElement | null>(null);
  const pomodoroAudioRefs = useRef<Partial<Record<PomodoroMusicSource, HTMLAudioElement>>>({});
  const lastTrackBySourceRef = useRef<Partial<Record<PomodoroMusicSource, string>>>({});
  const pomodoroPlayRequestRef = useRef(0);
  const lastAutoplaySourceRef = useRef<PomodoroMusicSource | null>(null);
  const lastPomodoroRunningRef = useRef(false);

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
  const selectedPomodoroMusicTracks = pomodoroMusic.selectedSource
    ? MUSIC_TRACKS[pomodoroMusic.selectedSource]
    : [];
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
    const sourceEntries = (["lofi", "rain"] as const).map((source) => {
      const audio = new Audio();
      audio.preload = "auto";
      audio.volume = DEFAULT_POMODORO_MUSIC_STATE.volume;
      pomodoroAudioRefs.current[source] = audio;
      return [source, audio] as const;
    });

    return () => {
      sourceEntries.forEach(([source, audio]) => {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        delete pomodoroAudioRefs.current[source];
      });
    };
  }, []);

  useEffect(() => {
    (["lofi", "rain"] as const).forEach((source) => {
      const audio = pomodoroAudioRefs.current[source];
      if (audio) {
        audio.volume = pomodoroMusic.volume;
      }
    });
  }, [pomodoroMusic.volume]);

  useEffect(() => {
    if (!pomodoroMusic.selectedSource) return;
    if (selectedPomodoroMusicTracks.length > 0) return;

    setPomodoroMusic((prev) => ({
      ...prev,
      activeSource: null,
      status: "error",
      currentTrackUrl: null,
      error: `No ${pomodoroMusic.selectedSource} tracks found.`,
    }));
  }, [pomodoroMusic.selectedSource, selectedPomodoroMusicTracks.length]);

  const getNextPomodoroTrack = useCallback((source: PomodoroMusicSource) => {
    const tracks = MUSIC_TRACKS[source];
    if (!tracks.length) return null;

    if (tracks.length === 1) {
      lastTrackBySourceRef.current[source] = tracks[0];
      return tracks[0];
    }

    const previousTrack = lastTrackBySourceRef.current[source];
    const candidates = tracks.filter((track) => track !== previousTrack);
    const nextTrack = candidates[Math.floor(Math.random() * candidates.length)] ?? tracks[0];
    lastTrackBySourceRef.current[source] = nextTrack;
    return nextTrack;
  }, []);

  const playPomodoroSource = useCallback(async (source: PomodoroMusicSource, options?: { forceNewTrack?: boolean }) => {
    const audio = pomodoroAudioRefs.current[source];
    if (!audio) return false;
    const requestId = ++pomodoroPlayRequestRef.current;

    const tracks = MUSIC_TRACKS[source];
    if (!tracks.length) {
      setPomodoroMusic((prev) => ({
        ...prev,
        selectedSource: source,
        activeSource: null,
        status: "error",
        currentTrackUrl: null,
        error: `No ${source} tracks found.`,
      }));
      return false;
    }

    const rememberedTrack = lastTrackBySourceRef.current[source];
    const shouldResumeRememberedTrack = !options?.forceNewTrack
      && rememberedTrack
      && tracks.includes(rememberedTrack);

    const nextTrack = shouldResumeRememberedTrack
      ? rememberedTrack
      : getNextPomodoroTrack(source);

    if (!nextTrack) {
      setPomodoroMusic((prev) => ({
        ...prev,
        selectedSource: source,
        activeSource: null,
        status: "error",
        currentTrackUrl: null,
        error: `No ${source} tracks found.`,
      }));
      return false;
    }

    try {
      (["lofi", "rain"] as const).forEach((otherSource) => {
        if (otherSource !== source) {
          pomodoroAudioRefs.current[otherSource]?.pause();
        }
      });

      const isSameTrack = rememberedTrack === nextTrack && Boolean(audio.src);

      if (!isSameTrack) {
        audio.src = nextTrack;
        audio.currentTime = 0;
      }

      if (options?.forceNewTrack || audio.ended) {
        audio.currentTime = 0;
      }

      audio.volume = pomodoroMusic.volume;
      await audio.play();

      if (pomodoroPlayRequestRef.current !== requestId) {
        return false;
      }

      setPomodoroMusic((prev) => ({
        ...prev,
        selectedSource: source,
        activeSource: source,
        status: "playing",
        currentTrackUrl: nextTrack,
        error: null,
      }));
      return true;
    } catch (error) {
      if (pomodoroPlayRequestRef.current !== requestId) {
        return false;
      }

      const message = error instanceof Error ? error.message : String(error);
      const friendlyMessage = message.includes("NotAllowedError")
        ? "Autoplay blocked. Click Lofi or Rain again."
        : message;

      setPomodoroMusic((prev) => ({
        ...prev,
        selectedSource: source,
        activeSource: source,
        status: "error",
        currentTrackUrl: nextTrack,
        error: friendlyMessage,
      }));
      return false;
    }
  }, [getNextPomodoroTrack, pomodoroMusic.activeSource, pomodoroMusic.currentTrackUrl, pomodoroMusic.volume]);

  const pausePomodoroMusic = useCallback(() => {
    setPomodoroMusic((prev) => {
      if (prev.activeSource) {
        const activeAudio = pomodoroAudioRefs.current[prev.activeSource];
        if (activeAudio) {
          activeAudio.pause();
        }
        lastTrackBySourceRef.current[prev.activeSource] = prev.currentTrackUrl ?? lastTrackBySourceRef.current[prev.activeSource];
      }
      return {
        ...prev,
        status: prev.activeSource ? "paused" : "idle",
        error: null,
      };
    });
  }, []);

  const togglePomodoroMusicSource = useCallback(async (source: PomodoroMusicSource) => {
    const isSameSource = pomodoroMusic.selectedSource === source || pomodoroMusic.activeSource === source;

    if (isSameSource) {
      if (pomodoroMusic.status === "playing") {
        pausePomodoroMusic();
        return;
      }

      await playPomodoroSource(source);
      return;
    }

    pausePomodoroMusic();
    await playPomodoroSource(source);
  }, [pausePomodoroMusic, playPomodoroSource, pomodoroMusic.activeSource, pomodoroMusic.selectedSource, pomodoroMusic.status]);

  useEffect(() => {
    const listeners = (["lofi", "rain"] as const).map((source) => {
      const audio = pomodoroAudioRefs.current[source];
      if (!audio) return null;

      const handleEnded = () => {
        if (pomodoroMusic.activeSource !== source) return;
        void playPomodoroSource(source, { forceNewTrack: true });
      };

      const handleError = () => {
        setPomodoroMusic((prev) => ({
          ...prev,
          status: "error",
          error: "Could not play the selected music track.",
        }));
      };

      audio.addEventListener("ended", handleEnded);
      audio.addEventListener("error", handleError);
      return { audio, handleEnded, handleError };
    }).filter(Boolean);

    return () => {
      listeners.forEach((entry) => {
        entry?.audio.removeEventListener("ended", entry.handleEnded);
        entry?.audio.removeEventListener("error", entry.handleError);
      });
    };
  }, [playPomodoroSource, pomodoroMusic.activeSource]);

  useEffect(() => {
    const wasRunning = lastPomodoroRunningRef.current;
    const shouldAutoplay = pomodoroRunning
      && Boolean(pomodoroMusic.selectedSource)
      && (!wasRunning || lastAutoplaySourceRef.current !== pomodoroMusic.selectedSource);

    lastPomodoroRunningRef.current = pomodoroRunning;

    if (!pomodoroRunning) {
      lastAutoplaySourceRef.current = pomodoroMusic.selectedSource;
      pausePomodoroMusic();
      return;
    }

    if (!pomodoroMusic.selectedSource || !shouldAutoplay) return;

    lastAutoplaySourceRef.current = pomodoroMusic.selectedSource;
    void playPomodoroSource(pomodoroMusic.selectedSource);
  }, [pausePomodoroMusic, playPomodoroSource, pomodoroMusic.selectedSource, pomodoroRunning]);

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
      if (!event.relatedTarget) {
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
    const savedFilter = localStorage.getItem(HISTORY_FILTER_STORAGE_KEY);
    if (isHistoryFilter(savedFilter)) {
      setHistorySourceFilter(savedFilter);
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

    const savedPomodoroMode = localStorage.getItem(POMODORO_MODE_STORAGE_KEY);
    if (isPomodoroMode(savedPomodoroMode)) {
      setPomodoroMode(savedPomodoroMode);
      const savedSecondsLeft = Number(localStorage.getItem(POMODORO_SECONDS_LEFT_STORAGE_KEY) ?? "");
      if (!Number.isNaN(savedSecondsLeft) && savedSecondsLeft > 0) {
        setSecondsLeft(savedSecondsLeft);
      } else {
        setSecondsLeft(POMODORO_PRESETS[savedPomodoroMode].seconds);
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
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(HISTORY_FILTER_STORAGE_KEY, historySourceFilter);
  }, [historySourceFilter]);


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
    localStorage.setItem(POMODORO_MODE_STORAGE_KEY, pomodoroMode);
  }, [pomodoroMode]);

  useEffect(() => {
    localStorage.setItem(POMODORO_SECONDS_LEFT_STORAGE_KEY, String(secondsLeft));
  }, [secondsLeft]);

  useEffect(() => {
    if (pomodoroMusic.selectedSource) {
      localStorage.setItem(POMODORO_MUSIC_SOURCE_STORAGE_KEY, pomodoroMusic.selectedSource);
    } else {
      localStorage.removeItem(POMODORO_MUSIC_SOURCE_STORAGE_KEY);
    }
  }, [pomodoroMusic.selectedSource]);

  useEffect(() => {
    localStorage.setItem(POMODORO_MUSIC_VOLUME_STORAGE_KEY, String(pomodoroMusic.volume));
  }, [pomodoroMusic.volume]);

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
  const pomodoroMusicStatusLabel = pomodoroMusic.error
    ? pomodoroMusic.error
    : pomodoroMusic.selectedSource
      ? `${pomodoroMusic.selectedSource} ${pomodoroMusic.status}`
      : "choose ambient audio";
  const navbarMusicState = pomodoroMusic.status === "playing" ? "playing" : "paused";
  const navbarMusicSource = pomodoroMusic.selectedSource ?? "lofi";

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
          <div
            className="header-timer-trigger"
            onClick={() => setTimerPopupOpen((prev) => !prev)}
            role="button"
            tabIndex={0}
            aria-expanded={timerPopupOpen}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setTimerPopupOpen((prev) => !prev);
              }
            }}
          >
            <div className={`header-timer ${pomodoroRunning ? "active" : ""}`}>
              <span className="header-timer-bottom">{pomodoroPreset.badge}</span>
              <span className="header-timer-top">{timerDisplay}</span>
            </div>
            <div className="header-timer header-music-pill" aria-hidden="true">
              <span className="header-timer-top header-music-top">{navbarMusicSource}</span>
              <span className="header-timer-bottom header-music-bottom">{navbarMusicState}</span>
            </div>
          </div>

          {timerPopupOpen && (
            <div className="header-timer-popup">
              <div className="header-timer-popup-head">
                <span>Pomodoro</span>
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
                  <button
                    className={`theme-chip pomodoro-chip pomodoro-action-chip ${pomodoroRunning ? "active" : ""}`}
                    type="button"
                    onClick={() => setPomodoroRunning((prev) => !prev)}
                  >
                    {pomodoroRunning ? "Pause" : "Play"}
                  </button>
                  <button className="theme-chip pomodoro-chip pomodoro-action-chip" type="button" onClick={endPomodoro}>
                    Stop
                  </button>
                </div>

                <div className="pomodoro-music-panel">
                  <div className="pomodoro-music-head">
                    <span>Ambient audio</span>
                    <span>{pomodoroMusicStatusLabel}</span>
                  </div>

                  <div className="pomodoro-music-options">
                    <button
                      className={`theme-chip pomodoro-music-chip ${pomodoroMusic.selectedSource === "lofi" ? "active" : ""}`}
                      type="button"
                      onClick={() => void togglePomodoroMusicSource("lofi")}
                    >
                      Lofi
                    </button>
                    <button
                      className={`theme-chip pomodoro-music-chip ${pomodoroMusic.selectedSource === "rain" ? "active" : ""}`}
                      type="button"
                      onClick={() => void togglePomodoroMusicSource("rain")}
                    >
                      Rain
                    </button>
                  </div>

                  <label className="pomodoro-volume-row">
                    <span>Volume</span>
                    <input
                      className="pomodoro-volume-slider"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={pomodoroMusic.volume}
                      onChange={(event) => {
                        const nextVolume = Number(event.target.value);
                        setPomodoroMusic((prev) => ({
                          ...prev,
                          volume: Number.isFinite(nextVolume) ? nextVolume : prev.volume,
                        }));
                      }}
                    />
                    <span>{Math.round(pomodoroMusic.volume * 100)}%</span>
                  </label>
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
          {activeTab === "chat" && <ChatTab onHistoryEntry={addHistoryEntry} languageModelId={preferredLanguageModelId || undefined} onPinAnswer={addPinnedAnswer} />}
          {activeTab === "vision" && <VisionTab onHistoryEntry={addHistoryEntry} visionModelId={preferredVisionModelId || undefined} />}
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
                      <button className="chat-header-btn history-preview-btn" onClick={copySelectedEntry} type="button">Copy</button>
                      <button className="chat-header-btn history-preview-btn" onClick={shareSelectedEntry} type="button">Share</button>
                      <button className="chat-header-btn history-preview-btn" onClick={exportSelectedAsText} type="button">Export .txt</button>
                      <button className="chat-header-btn history-preview-btn" onClick={exportSelectedAsMarkdown} type="button">Export .md</button>
                      <button className="chat-header-btn history-preview-btn" onClick={exportSelectedAsPdf} type="button">Print / PDF</button>
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
