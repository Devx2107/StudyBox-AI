// Public types so App.tsx and other consumers can import them.
export interface ProfileStatsConfig {
  userName: string;
  welcome: string;
  rankLabel: string;
  xpTarget: number;
  weeklyGoal: number;
  achievements: Array<{ id: string; label: string; description: string }>;
}

export interface XpUpdate {
  id: string;
  label: string;
  amount: number;
  createdAt: string;
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
  totalStudyEntries: number;
  totalXp: number;
  totalChatMessages: number;
  totalQuizzesDone: number;
  totalCardsGenerated: number;
  totalFlashcardGenerations: number;
  totalVoiceMessages: number;
  totalVisionScans: number;
  notes: string;
  activityDays: string[];
  completedPomodoros: number;
  pomodoroLog: PomodoroSession[];
  pinnedAnswers: PinnedAnswer[];
  xpUpdates: XpUpdate[];
}

export const DEFAULT_USERDATA: UserData = {
  userName: 'Study Explorer',
  welcome: 'Welcome back',
  rankLabel: 'Scholar',
  xpTarget: 1000,
  weeklyGoal: 200,
  achievements: [
    { id: 'first-ask',        label: 'First Session',     description: 'Start your first study session' },
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
  totalStudyEntries: 0,
  totalXp: 0,
  totalChatMessages: 0,
  totalQuizzesDone: 0,
  totalCardsGenerated: 0,
  totalFlashcardGenerations: 0,
  totalVoiceMessages: 0,
  totalVisionScans: 0,
  notes: '',
  activityDays: [],
  completedPomodoros: 0,
  pomodoroLog: [],
  pinnedAnswers: [],
  xpUpdates: [],
};

const DEFAULT_ACHIEVEMENTS_BY_ID = new Map(
  DEFAULT_USERDATA.achievements.map((achievement) => [achievement.id, achievement]),
);

function calculateTotalXp(stats: {
  totalChatMessages: number;
  totalQuizzesDone: number;
  totalFlashcardGenerations: number;
  totalVoiceMessages: number;
  totalVisionScans: number;
}) {
  return (
    stats.totalChatMessages * 10
    + stats.totalQuizzesDone * 30
    + stats.totalFlashcardGenerations * 20
    + stats.totalVoiceMessages * 10
    + stats.totalVisionScans * 20
  );
}

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
    const achievements = Array.isArray(raw.achievements)
      ? raw.achievements
        .filter((achievement): achievement is UserData['achievements'][number] => (
          Boolean(achievement)
          && typeof achievement.id === 'string'
        ))
        .map((achievement) => {
          const canonical = DEFAULT_ACHIEVEMENTS_BY_ID.get(achievement.id);
          return canonical
            ? { ...canonical }
            : {
                id: achievement.id,
                label: typeof achievement.label === 'string' ? achievement.label : achievement.id,
                description: typeof achievement.description === 'string' ? achievement.description : '',
              };
        })
      : DEFAULT_USERDATA.achievements;
    const history = Array.isArray(raw.history) ? raw.history : DEFAULT_USERDATA.history;
    const completedPomodoros = typeof raw.completedPomodoros === 'number'
      ? raw.completedPomodoros
      : DEFAULT_USERDATA.completedPomodoros;
    const countBySource = (source: string) => history.filter((entry) => entry.source === source).length;
    const totalChatMessages = typeof raw.totalChatMessages === 'number'
      ? raw.totalChatMessages
      : countBySource('chat');
    const totalQuizzesDone = typeof raw.totalQuizzesDone === 'number'
      ? raw.totalQuizzesDone
      : countBySource('quiz');
    const totalCardsGenerated = typeof raw.totalCardsGenerated === 'number'
      ? raw.totalCardsGenerated
      : 0;
    const totalFlashcardGenerations = typeof raw.totalFlashcardGenerations === 'number'
      ? raw.totalFlashcardGenerations
      : 0;
    const totalVoiceMessages = typeof raw.totalVoiceMessages === 'number'
      ? raw.totalVoiceMessages
      : countBySource('voice');
    const totalVisionScans = typeof raw.totalVisionScans === 'number'
      ? raw.totalVisionScans
      : countBySource('vision');
    const xpUpdates = Array.isArray(raw.xpUpdates)
      ? raw.xpUpdates.filter((update): update is XpUpdate => (
        Boolean(update)
        && typeof update.id === 'string'
        && typeof update.label === 'string'
        && typeof update.amount === 'number'
        && typeof update.createdAt === 'string'
      ))
      : DEFAULT_USERDATA.xpUpdates;

    return {
      ...DEFAULT_USERDATA,
      ...raw,
      achievements,
      history,
      completedPomodoros,
      xpUpdates,
      totalStudyEntries: typeof raw.totalStudyEntries === 'number'
        ? raw.totalStudyEntries
        : history.length,
      totalXp: calculateTotalXp({
        totalChatMessages,
        totalQuizzesDone,
        totalFlashcardGenerations,
        totalVoiceMessages,
        totalVisionScans,
      }),
      totalChatMessages,
      totalQuizzesDone,
      totalCardsGenerated,
      totalFlashcardGenerations,
      totalVoiceMessages,
      totalVisionScans,
    };
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
