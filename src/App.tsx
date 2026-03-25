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
import { loadUserData, saveUserData, DEFAULT_USERDATA, type XpUpdate } from "./lib/userdata";


const tabs = [
  { id: "chat", label: "Chat", icon: "C", eyebrow: "Tutor mode", title: "Talk to", accent: "Your AI.", badge: "LLM Core" },
  { id: "vision", label: "Vision", icon: "V", eyebrow: "Camera mode", title: "See and", accent: "Describe.", badge: "VLM Lens" },
  { id: "voice", label: "Voice", icon: "O", eyebrow: "Voice mode", title: "Speak and", accent: "Learn.", badge: "Speech Stack" },
  { id: "notes", label: "Notes", icon: "N", eyebrow: "Notes mode", title: "Write and", accent: "Summarise.", badge: "Smart Notes" },
  { id: "flashcards", label: "Cards", icon: "F", eyebrow: "Recall mode", title: "Flip and", accent: "Master.", badge: "Flashcards" },
  { id: "map", label: "Map", icon: "M", eyebrow: "Map mode", title: "Map", accent: "It Out.", badge: "Concept Graph" },
  { id: "quiz", label: "Quiz", icon: "Q", eyebrow: "Quiz mode", title: "Test", accent: "Yourself.", badge: "Quiz Lab" },
  { id: "profile", label: "Profile", icon: "P", eyebrow: "Profile mode", title: "Keep", accent: "Grinding.", badge: "Profile" },
  { id: "settings", label: "Settings", icon: "S", eyebrow: "Settings mode", title: "Tune Your", accent: "Workspace.", badge: "Preferences" },
] as const;



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
  achievements: Array<{ id: string; label: string; description: string }>;
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
};

const DEFAULT_PROFILE_STATS = DEFAULT_USERDATA;
const XP_PER_CHAT = 10;
const XP_PER_VOICE = 10;
const XP_PER_QUIZ = 30;
const XP_PER_FLASHCARDS = 20;
const XP_PER_VISION = 20;

function calculateTotalXp(stats: {
  totalChatMessages: number;
  totalQuizzesDone: number;
  totalFlashcardGenerations: number;
  totalVoiceMessages: number;
  totalVisionScans: number;
}) {
  return (
    stats.totalChatMessages * XP_PER_CHAT
    + stats.totalQuizzesDone * XP_PER_QUIZ
    + stats.totalFlashcardGenerations * XP_PER_FLASHCARDS
    + stats.totalVoiceMessages * XP_PER_VOICE
    + stats.totalVisionScans * XP_PER_VISION
  );
}


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

function dayKeyPart(value: number) {
  return String(value).padStart(2, "0");
}

function dayKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${dayKeyPart(date.getMonth() + 1)}-${dayKeyPart(date.getDate())}`;
}

function dayKeyFromIso(iso: string) {
  return dayKeyFromDate(new Date(iso));
}

function dateFromDayKey(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isDayKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return dayKeyFromDate(dateFromDayKey(value)) === value;
}

function normalizeActivityDays(days: string[], today = new Date()) {
  const todayKey = dayKeyFromDate(today);
  return [...new Set(days.filter((day) => isDayKey(day) && day <= todayKey))]
    .sort((a, b) => b.localeCompare(a));
}

function getStreak(days: string[], today = new Date()) {
  const normalizedDays = normalizeActivityDays(days, today);
  if (!normalizedDays.length) return 0;

  const todayKey = dayKeyFromDate(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = dayKeyFromDate(yesterday);
  const daySet = new Set(normalizedDays);
  const startKey = daySet.has(todayKey)
    ? todayKey
    : daySet.has(yesterdayKey)
      ? yesterdayKey
      : null;

  if (!startKey) return 0;

  let streak = 0;
  const cursor = dateFromDayKey(startKey);
  while (daySet.has(dayKeyFromDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
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
  return value === "all" || value === "chat" || value === "voice" || value === "vision" || value === "quiz";
}

function isPomodoroMode(value: string | null): value is PomodoroMode {
  return value === "work" || value === "break5" || value === "break10";
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

  const [preferredLanguageModelId, setPreferredLanguageModelId] = useState("");
  const [preferredVisionModelId, setPreferredVisionModelId] = useState("");
  const [profileStats, setProfileStats] = useState<ProfileStatsConfig>(DEFAULT_PROFILE_STATS);
  const [pinnedAnswers, setPinnedAnswers] = useState<PinnedAnswer[]>([]);
  const [notes, setNotes] = useState("");
  const [activityDays, setActivityDays] = useState<string[]>([]);
  const [completedPomodoros, setCompletedPomodoros] = useState(0);
  const [totalStudyEntries, setTotalStudyEntries] = useState(0);
  const [totalXp, setTotalXp] = useState(0);
  const [xpUpdates, setXpUpdates] = useState<XpUpdate[]>([]);
  const [totalChatMessages, setTotalChatMessages] = useState(0);
  const [totalQuizzesDone, setTotalQuizzesDone] = useState(0);
  const [totalCardsGenerated, setTotalCardsGenerated] = useState(0);
  const [totalFlashcardGenerations, setTotalFlashcardGenerations] = useState(0);
  const [totalVoiceMessages, setTotalVoiceMessages] = useState(0);
  const [totalVisionScans, setTotalVisionScans] = useState(0);
  const [pomodoroMode, setPomodoroMode] = useState<PomodoroMode>("work");
  const [secondsLeft, setSecondsLeft] = useState(POMODORO_PRESETS.work.seconds);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroLog, setPomodoroLog] = useState<PomodoroSession[]>([]);
  const [pomodoroMusic, setPomodoroMusic] = useState<PomodoroMusicState>(DEFAULT_POMODORO_MUSIC_STATE);
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
      ...(["chat", "voice", "vision", "quiz"] as const)
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
  const normalizedActivityDays = useMemo(() => normalizeActivityDays(activityDays), [activityDays]);
  const streak = useMemo(() => getStreak(normalizedActivityDays), [normalizedActivityDays]);
  const xp = totalXp;
  const pomodoroPreset = POMODORO_PRESETS[pomodoroMode];
  const selectedPomodoroMusicTracks = pomodoroMusic.selectedSource
    ? MUSIC_TRACKS[pomodoroMusic.selectedSource]
    : [];
  const achievements = [
    { id: "first-ask", label: "First Ask", unlocked: totalStudyEntries >= 1 },
    { id: "five-sessions", label: "5 Sessions", unlocked: totalStudyEntries >= 5 },
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
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const todayKey = dayKeyFromDate(now);
    const leadingEmptyDays = Array.from({ length: firstDayOfWeek }, () => null);
    const monthDays = Array.from({ length: totalDays }, (_, index) => {
      const dayNumber = index + 1;
      const date = new Date(year, month, dayNumber);
      const key = dayKeyFromDate(date);
      return {
        key,
        dayNumber,
        studied: normalizedActivityDays.includes(key),
        today: key === todayKey,
      };
    });
    return [...leadingEmptyDays, ...monthDays];
  }, [normalizedActivityDays]);

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

  // ── Single unified load from userdata.json ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void loadUserData().then((data) => {
      if (cancelled) return;

      // Profile
      setProfileStats({
        userName: data.userName,
        welcome: data.welcome,
        rankLabel: data.rankLabel,
        xpTarget: data.xpTarget,
        weeklyGoal: data.weeklyGoal,
        achievements: data.achievements,
      });

      // Navigation + appearance
      if (isTabId(data.activeTab)) setActiveTab(data.activeTab);
      if (isThemeId(data.theme)) setTheme(data.theme);
      if (isHistoryFilter(data.historySourceFilter)) setHistorySourceFilter(data.historySourceFilter as "all" | HistorySource);

      // Model preferences
      if (data.preferredLanguageModelId) setPreferredLanguageModelId(data.preferredLanguageModelId);
      if (data.preferredVisionModelId) setPreferredVisionModelId(data.preferredVisionModelId);

      // Music preferences
      setPomodoroMusic((prev) => ({
        ...prev,
        selectedSource: data.pomodoroMusicSource ?? prev.selectedSource,
        volume: data.pomodoroMusicVolume,
      }));

      // Pomodoro
      if (isPomodoroMode(data.pomodoroMode)) {
        setPomodoroMode(data.pomodoroMode);
        setSecondsLeft(data.pomodoroSecondsLeft > 0 ? data.pomodoroSecondsLeft : POMODORO_PRESETS[data.pomodoroMode].seconds);
      }
      setPomodoroLog(data.pomodoroLog);
      setCompletedPomodoros(data.completedPomodoros);
      setTotalStudyEntries(data.totalStudyEntries);
      setTotalXp(data.totalXp);
      setXpUpdates(data.xpUpdates);
      setTotalChatMessages(data.totalChatMessages);
      setTotalQuizzesDone(data.totalQuizzesDone);
      setTotalCardsGenerated(data.totalCardsGenerated);
      setTotalFlashcardGenerations(data.totalFlashcardGenerations);
      setTotalVoiceMessages(data.totalVoiceMessages);
      setTotalVisionScans(data.totalVisionScans);

      // User data
      setHistory(data.history as HistoryEntry[]);
      setSelectedHistoryId(data.history[0]?.id ?? null);
      setNotes(data.notes);
      setActivityDays(normalizeActivityDays(data.activityDays));
      setPinnedAnswers(data.pinnedAnswers);
    });
    return () => { cancelled = true; };
  }, []);


  // ── Single unified save to userdata.json (debounced) ────────────────────
  useEffect(() => {
    // Always sync theme to body immediately (zero-delay, not debounced).
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    setTotalXp(calculateTotalXp({
      totalChatMessages,
      totalQuizzesDone,
      totalFlashcardGenerations,
      totalVoiceMessages,
      totalVisionScans,
    }));
  }, [totalChatMessages, totalQuizzesDone, totalFlashcardGenerations, totalVoiceMessages, totalVisionScans]);

  useEffect(() => {
    saveUserData({
      userName: profileStats.userName,
      welcome: profileStats.welcome,
      rankLabel: profileStats.rankLabel,
      xpTarget: profileStats.xpTarget,
      weeklyGoal: profileStats.weeklyGoal,
      achievements: profileStats.achievements,
      theme,
      activeTab,
      historySourceFilter,
      preferredLanguageModelId,
      preferredVisionModelId,
      pomodoroMusicSource: pomodoroMusic.selectedSource,
      pomodoroMusicVolume: pomodoroMusic.volume,
      pomodoroMode,
      pomodoroSecondsLeft: secondsLeft,
      history,
      totalStudyEntries,
      totalXp,
      totalChatMessages,
      totalQuizzesDone,
      totalCardsGenerated,
      totalFlashcardGenerations,
      totalVoiceMessages,
      totalVisionScans,
      notes,
      activityDays: normalizedActivityDays,
      completedPomodoros,
      pomodoroLog,
      pinnedAnswers,
      xpUpdates,
    });
  }, [
    profileStats,
    theme, activeTab, historySourceFilter,
    preferredLanguageModelId, preferredVisionModelId,
    pomodoroMusic.selectedSource, pomodoroMusic.volume,
    pomodoroMode, secondsLeft,
    history, totalStudyEntries, totalXp,
    totalChatMessages, totalQuizzesDone, totalCardsGenerated, totalFlashcardGenerations, totalVoiceMessages, totalVisionScans,
    notes, normalizedActivityDays, completedPomodoros, pomodoroLog, pinnedAnswers, xpUpdates,
  ]);


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
        const today = dayKeyFromDate(new Date());
        return normalizeActivityDays([today, ...prev]);
      });
      setPomodoroMode("break5");
      setSecondsLeft(POMODORO_PRESETS.break5.seconds);
    } else {
      setPomodoroMode("work");
      setSecondsLeft(POMODORO_PRESETS.work.seconds);
    }
  }, [secondsLeft, pomodoroMode]);

  const markActivity = (day: string) => {
    setActivityDays((prev) => normalizeActivityDays([day, ...prev]));
  };

  const addXpUpdate = (label: string, amount: number, createdAt = new Date().toISOString()) => {
    setXpUpdates((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label,
        amount,
        createdAt,
      },
      ...prev,
    ].slice(0, 24));
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
    setTotalStudyEntries((prev) => prev + 1);
    if (entry.source === "chat") setTotalChatMessages((prev) => prev + 1);
    if (entry.source === "quiz") setTotalQuizzesDone((prev) => prev + 1);
    if (entry.source === "voice") setTotalVoiceMessages((prev) => prev + 1);
    if (entry.source === "vision") setTotalVisionScans((prev) => prev + 1);
    if (entry.source === "chat") addXpUpdate("Chat session", XP_PER_CHAT, createdAt);
    if (entry.source === "quiz") addXpUpdate("Quiz completed", XP_PER_QUIZ, createdAt);
    if (entry.source === "voice") addXpUpdate("Voice session", XP_PER_VOICE, createdAt);
    if (entry.source === "vision") addXpUpdate("Vision scan", XP_PER_VISION, createdAt);
    markActivity(dayKeyFromIso(createdAt));
  };

  const removePinnedAnswersForHistoryEntry = useCallback((entry: HistoryEntry) => {
    setPinnedAnswers((prev) => prev.filter((item) => (
      item.prompt !== entry.prompt || item.response !== entry.response
    )));
  }, []);

  const clearHistory = () => {
    setHistory([]);
    setSelectedHistoryId(null);
    setPinnedAnswers([]);
  };

  const removeSelectedHistory = () => {
    if (!selectedHistory) return;

    removePinnedAnswersForHistoryEntry(selectedHistory);
    setHistory((prev) => {
      const next = prev.filter((entry) => entry.id !== selectedHistory.id);
      setSelectedHistoryId(next[0]?.id ?? null);
      return next;
    });
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
            <FlashcardsTab
              history={history}
              selectedHistory={selectedHistory}
              notes={notes}
              languageModelId={preferredLanguageModelId || undefined}
              onCardsGenerated={(count) => {
                setTotalCardsGenerated((prev) => prev + count);
                setTotalFlashcardGenerations((prev) => prev + 1);
                addXpUpdate(
                  count === 1 ? "Generated 1 flashcard" : `Generated ${count} flashcards`,
                  XP_PER_FLASHCARDS,
                );
              }}
            />
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
              activityStats={{
                chatMessages: totalChatMessages,
                quizzesDone: totalQuizzesDone,
                cardsGenerated: totalCardsGenerated,
                voiceMessages: totalVoiceMessages,
                visionScans: totalVisionScans,
              }}
              xpUpdates={xpUpdates.slice(0, 4)}
              calendar={studyCalendar}
              unlockedAchievements={unlockedAchievementIds}
              onUpdateUserName={(name) => setProfileStats((prev) => ({ ...prev, userName: name }))}
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
                    <button className="chat-header-btn history-preview-btn pinned-remove" onClick={() => removePinnedAnswer(item.id)} type="button">Remove</button>
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
                    <button className="chat-header-btn history-preview-btn history-remove" onClick={removeSelectedHistory} type="button">Remove</button>
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
