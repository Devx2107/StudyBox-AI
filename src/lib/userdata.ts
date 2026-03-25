// Public types so App.tsx and other consumers can import them.
export interface ProfileStatsConfig {
  userName: string;
  welcome: string;
  rankLabel: string;
  xpTarget: number;
  weeklyGoal: number;
  weeklyHighlights: string[];
  achievements: Array<{ id: string; label: string; description: string }>;
}

export interface PinnedAnswer {
  id: string;
  prompt: string;
  response: string;
  createdAt: string;
}

export interface PomodoroSession {
  id: string;
  label: string;
  minutes: number;
  completedAt: string;
}

export interface HistoryEntry {
  id: string;
  source: string;
  prompt: string;
  response: string;
  createdAt: string;
}

export interface UserData {
  // Profile
  userName: string;
  welcome: string;
  rankLabel: string;
  xpTarget: number;
  weeklyGoal: number;
  weeklyHighlights: string[];
  achievements: Array<{ id: string; label: string; description: string }>;

  // Appearance / navigation
  theme: string;
  activeTab: string;
  historySourceFilter: string;

  // Model preferences
  preferredLanguageModelId: string;
  preferredVisionModelId: string;

  // Pomodoro music preferences (persistent, not runtime playback state)
  pomodoroMusicSource: 'lofi' | 'rain' | null;
  pomodoroMusicVolume: number;

  // Pomodoro timer
  pomodoroMode: 'work' | 'break5' | 'break10';
  pomodoroSecondsLeft: number;

  // User data
  history: HistoryEntry[];
  notes: string;
  activityDays: string[];
  completedPomodoros: number;
  pomodoroLog: PomodoroSession[];
  pinnedAnswers: PinnedAnswer[];
}

export const DEFAULT_USERDATA: UserData = {
  userName: 'Study Explorer',
  welcome: 'Welcome back',
  rankLabel: 'Scholar',
  xpTarget: 1000,
  weeklyGoal: 200,
  weeklyHighlights: [
    '+50 XP - Solved a study problem',
    '+25 XP - Completed a focus block',
    '+30 XP - Generated flashcards',
    '+10 XP - Kept the streak alive',
  ],
  achievements: [
    { id: 'first-ask',        label: 'First Ask',     description: 'Start your first study session' },
    { id: 'five-sessions',    label: '5 Sessions',    description: 'Log five study entries' },
    { id: 'three-day-streak', label: '3-Day Streak',  description: 'Study three days in a row' },
    { id: 'pomodoro-five',    label: 'Pomodoro x5',   description: 'Complete five focus sessions' },
    { id: 'deep-work',        label: 'Deep Work',     description: 'Reach ten focus blocks' },
    { id: 'xp-1000',          label: '1000 XP',       description: 'Cross 1000 total XP' },
  ],
  theme: 'classic',
  activeTab: 'chat',
  historySourceFilter: 'all',
  preferredLanguageModelId: '',
  preferredVisionModelId: '',
  pomodoroMusicSource: 'lofi',
  pomodoroMusicVolume: 0.2,
  pomodoroMode: 'work',
  pomodoroSecondsLeft: 25 * 60,
  history: [],
  notes: '',
  activityDays: [],
  completedPomodoros: 0,
  pomodoroLog: [],
  pinnedAnswers: [],
};

const WRITE_ENDPOINT = '/__userdata';
const DATA_FILE = '/userdata.json';

/**
 * Load user data from the local file served by the dev server (or a prod static host).
 * Falls back to DEFAULT_USERDATA gracefully.
 */
export async function loadUserData(): Promise<UserData> {
  try {
    const res = await fetch(`${DATA_FILE}?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return { ...DEFAULT_USERDATA };
    const raw = await res.json() as Partial<UserData>;
    return { ...DEFAULT_USERDATA, ...raw };
  } catch {
    return { ...DEFAULT_USERDATA };
  }
}

// Debounced save — only the latest snapshot within 800ms window is written.
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Persist user data back to disk via the Vite dev-server write endpoint.
 * The save is debounced to avoid hammering the disk on every keystroke.
 */
export function saveUserData(data: UserData): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fetch(WRITE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data, null, 2),
    }).catch(() => {
      // Silently ignore — happens in prod builds where the endpoint doesn't exist.
    });
  }, 800);
}
