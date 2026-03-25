import { useState } from 'react';
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
  calendar: Array<{ key: string; dayNumber: number; studied: boolean; today: boolean } | null>;
  unlockedAchievements: string[];
  onUpdateUserName: (name: string) => void;
}

export function ProfileTab({
  profile,
  streak,
  xp,
  historyCount,
  completedPomodoros,
  activityStats,
  xpUpdates,
  calendar,
  unlockedAchievements,
  onUpdateUserName,
}: ProfileTabProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(profile.userName);
  const levelProgress = Math.max(0, Math.min(100, Math.round((xp / Math.max(profile.xpTarget, 1)) * 100)));
  const xpToNext = Math.max(profile.xpTarget - xp, 0);
  const currentMonth = new Date().toLocaleString([], { month: 'long', year: 'numeric' });

  return (
    <section className="profile-layout">
      <div className="profile-column">
        <div className="profile-hero">
          <span className="profile-hero-icon">S</span>
          <div className="profile-welcome">{profile.welcome}</div>
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
          <div className="profile-rank">{profile.rankLabel}</div>
          <div className="profile-streak-copy">{streak} day streak active</div>
        </div>

        <div className="info-block">
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
        </div>
      </div>
    </section>
  );
}
