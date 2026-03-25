import { useMemo, useState } from 'react';
import type { XpUpdate } from '../lib/userdata';

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
  achievements: ProfileAchievement[];
}

interface ProfileTabProps {
  profile: ProfileConfig;
  streak: number;
  xp: number;
  historyCount: number;
  completedPomodoros: number;
  activityStats: {
    chatMessages: number;
    quizzesDone: number;
    cardsGenerated: number;
    voiceMessages: number;
    visionScans: number;
  };
  xpUpdates: XpUpdate[];
  activityDays: string[];
  unlockedAchievements: string[];
  onUpdateUserName: (name: string) => void;
}

function dayKeyPart(value: number) {
  return String(value).padStart(2, '0');
}

function dayKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${dayKeyPart(date.getMonth() + 1)}-${dayKeyPart(date.getDate())}`;
}

export function ProfileTab({
  profile,
  streak,
  xp,
  historyCount,
  completedPomodoros,
  activityStats,
  xpUpdates,
  activityDays,
  unlockedAchievements,
  onUpdateUserName,
}: ProfileTabProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(profile.userName);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const levelProgress = Math.max(0, Math.min(100, Math.round((xp / Math.max(profile.xpTarget, 1)) * 100)));
  const xpToNext = Math.max(profile.xpTarget - xp, 0);
  const currentMonth = useMemo(
    () => calendarMonth.toLocaleString([], { month: 'long', year: 'numeric' }),
    [calendarMonth],
  );
  const isCurrentCalendarMonth = useMemo(() => {
    const now = new Date();
    return now.getFullYear() === calendarMonth.getFullYear()
      && now.getMonth() === calendarMonth.getMonth();
  }, [calendarMonth]);
  const calendar = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const todayKey = dayKeyFromDate(new Date());
    const daySet = new Set(activityDays);
    const leadingEmptyDays = Array.from({ length: firstDayOfWeek }, () => null);
    const monthDays = Array.from({ length: totalDays }, (_, index) => {
      const dayNumber = index + 1;
      const date = new Date(year, month, dayNumber);
      const key = dayKeyFromDate(date);

      return {
        key,
        dayNumber,
        studied: daySet.has(key),
        today: key === todayKey,
      };
    });

    const calendarDays = [...leadingEmptyDays, ...monthDays];
    const trailingEmptyDays = Array.from({ length: Math.max(42 - calendarDays.length, 0) }, () => null);

    return [...calendarDays, ...trailingEmptyDays];
  }, [activityDays, calendarMonth]);

  const goToPreviousMonth = () => {
    setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    if (isCurrentCalendarMonth) return;
    setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  return (
    <section className="profile-layout">
      <div className="info-block profile-panel profile-panel-xp">
        <div className="info-block-head">
          <span>Total XP</span>
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
          <div className="profile-xp-stream">
            {xpUpdates.length === 0 && (
              <div className="profile-xp-update empty">No XP updates yet.</div>
            )}
            {xpUpdates.map((update) => (
              <div key={update.id} className="profile-xp-update">
                <span>{update.label}</span>
                <strong>+{update.amount} XP</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="profile-hero profile-panel profile-panel-hero">
        <span className="profile-hero-icon">S</span>
        <div className="profile-welcome">{profile.welcome}</div>
        <div className="profile-name-row">
          {isEditingName ? (
            <input
              className="profile-name-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = editName.trim();
                  if (val) onUpdateUserName(val);
                  else setEditName(profile.userName);
                  setIsEditingName(false);
                } else if (e.key === 'Escape') {
                  setEditName(profile.userName);
                  setIsEditingName(false);
                }
              }}
              onBlur={() => {
                const val = editName.trim();
                if (val) onUpdateUserName(val);
                else setEditName(profile.userName);
                setIsEditingName(false);
              }}
              autoFocus
              maxLength={30}
            />
          ) : (
            <div className="profile-name-display" onClick={() => setIsEditingName(true)} title="Click to edit name">
              <div className="profile-name">{profile.userName}</div>
              <svg className="edit-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            </div>
          )}
        </div>
        <div className="profile-rank">{profile.rankLabel}</div>
        <div className="profile-streak-copy">{streak} day streak active</div>
      </div>

      <div className="info-block profile-panel profile-panel-activity">
        <div className="info-block-head">
          <span>Activity stats</span>
          <span>lifetime</span>
        </div>
        <div className="info-block-body">
          <div className="streak-grid profile-activity-grid">
            <div className="streak-stat">
              <strong>{activityStats.chatMessages}</strong>
              <span>Chat Messages</span>
            </div>
            <div className="streak-stat">
              <strong>{activityStats.quizzesDone}</strong>
              <span>Quizzes Done</span>
            </div>
            <div className="streak-stat">
              <strong>{activityStats.cardsGenerated}</strong>
              <span>Cards Generated</span>
            </div>
            <div className="streak-stat">
              <strong>{activityStats.voiceMessages}</strong>
              <span>Voice Messages</span>
            </div>
            <div className="streak-stat">
              <strong>{activityStats.visionScans}</strong>
              <span>Vision Scans</span>
            </div>
            <div className="streak-stat">
              <strong>{completedPomodoros}</strong>
              <span>Focus Blocks</span>
            </div>
          </div>
        </div>
      </div>

      <div className="info-block profile-panel profile-panel-calendar">
        <div className="info-block-head">
          <span>{currentMonth}</span>
          <span>Study calendar</span>
        </div>
        <div className="info-block-body">
          <div className="profile-calendar-shell">
            <button
              className="flashcard-arrow flashcard-arrow-left profile-calendar-arrow"
              type="button"
              onClick={goToPreviousMonth}
              aria-label="Previous month"
            >
              &#8249;
            </button>

            <div className="calendar-grid profile-calendar-grid">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                <div key={`header-${i}`} className="calendar-day-header">{d}</div>
              ))}
              {calendar.map((day, i) => {
                if (!day) return <div key={`empty-${i}`} className="calendar-day empty" />;
                return (
                  <div
                    key={day.key}
                    className={`calendar-day ${day.studied ? 'active' : ''} ${day.today ? 'today' : ''}`}
                    title={day.key}
                  >
                    {day.dayNumber}
                  </div>
                );
              })}
            </div>

            <button
              className="flashcard-arrow flashcard-arrow-right profile-calendar-arrow"
              type="button"
              onClick={goToNextMonth}
              aria-label="Next month"
              disabled={isCurrentCalendarMonth}
            >
              &#8250;
            </button>
          </div>
        </div>
      </div>

      <div className="info-block profile-panel profile-panel-achievements">
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
    </section>
  );
}
