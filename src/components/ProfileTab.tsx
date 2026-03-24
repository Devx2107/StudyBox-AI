import { useRef } from 'react';

interface ProfileAchievement {
  id: string;
  label: string;
  description: string;
}

interface ProfileConfig {
  userName: string;
  welcome: string;
  rankLabel: string;
  xpTarget: number;
  weeklyGoal: number;
  weeklyHighlights: string[];
  achievements: ProfileAchievement[];
}

interface ProfileTabProps {
  profile: ProfileConfig;
  streak: number;
  xp: number;
  historyCount: number;
  completedPomodoros: number;
  calendar: Array<{ key: string; dayNumber: number; studied: boolean; today: boolean }>;
  unlockedAchievements: string[];
  onExportStats: () => void;
  onImportStats: (file: File) => Promise<void>;
  importStatus: string | null;
}

export function ProfileTab({
  profile,
  streak,
  xp,
  historyCount,
  completedPomodoros,
  calendar,
  unlockedAchievements,
  onExportStats,
  onImportStats,
  importStatus,
}: ProfileTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const levelProgress = Math.max(0, Math.min(100, Math.round((xp / Math.max(profile.xpTarget, 1)) * 100)));
  const xpToNext = Math.max(profile.xpTarget - xp, 0);
  const currentMonth = new Date().toLocaleString([], { month: 'long', year: 'numeric' });

  return (
    <section className="profile-layout">
      <div className="profile-column">
        <div className="profile-hero">
          <span className="profile-hero-icon">S</span>
          <div className="profile-welcome">{profile.welcome}</div>
          <div className="profile-name">{profile.userName}</div>
          <div className="profile-rank">{profile.rankLabel}</div>
          <div className="profile-streak-copy">{streak} day streak active</div>
          <div className="profile-actions">
            <button className="btn primary" type="button" onClick={onExportStats}>Export stats</button>
            <button className="btn" type="button" onClick={() => fileInputRef.current?.click()}>Import stats</button>
          </div>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="application/json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              await onImportStats(file);
              event.target.value = '';
            }}
          />
          {importStatus && <div className="profile-import-status">{importStatus}</div>}
        </div>

        <div className="info-block">
          <div className="info-block-head">
            <span>XP this week</span>
            <span>{xp} XP</span>
          </div>
          <div className="info-block-body profile-section-body">
            <div className="profile-xp-meta">
              <span>{profile.rankLabel}</span>
              <span>{xpToNext} to next target</span>
            </div>
            <div className="profile-xp-bar">
              <div className="profile-xp-fill" style={{ width: `${levelProgress}%` }} />
            </div>
            <div className="profile-highlights">
              {profile.weeklyHighlights.map((item) => (
                <div key={item} className="profile-highlight-item">{item}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="info-block">
        <div className="info-block-head">
          <span>Achievements</span>
          <span>{unlockedAchievements.length}/{profile.achievements.length}</span>
        </div>
        <div className="info-block-body">
          <div className="profile-achievements">
            {profile.achievements.map((achievement) => {
              const unlocked = unlockedAchievements.includes(achievement.id);
              return (
                <div
                  key={achievement.id}
                  className={`profile-achievement-card ${unlocked ? 'active' : 'locked'}`}
                >
                  <div className="profile-achievement-label">{achievement.label}</div>
                  <div className="profile-achievement-desc">{achievement.description}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="info-block">
        <div className="info-block-head">
          <span>{currentMonth}</span>
          <span>Study calendar</span>
        </div>
        <div className="info-block-body">
          <div className="streak-grid profile-stat-grid">
            <div className="streak-stat">
              <strong>{xp}</strong>
              <span>Total XP</span>
            </div>
            <div className="streak-stat">
              <strong>{historyCount}</strong>
              <span>Study Entries</span>
            </div>
            <div className="streak-stat">
              <strong>{completedPomodoros}</strong>
              <span>Focus Blocks</span>
            </div>
          </div>

          <div className="calendar-grid profile-calendar-grid">
            {calendar.map((day) => (
              <div
                key={day.key}
                className={`calendar-day ${day.studied ? 'active' : ''} ${day.today ? 'today' : ''}`}
                title={day.key}
              >
                {day.dayNumber}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
