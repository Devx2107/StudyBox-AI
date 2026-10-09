import { useEffect, useState } from 'react';
import { motionDuration, useReducedMotion } from '../hooks/useMotion';

export interface AchievementNotice {
  id: string;
  label: string;
  description?: string;
}

export function AchievementToast({ notice, onDone }: { notice: AchievementNotice; onDone: () => void }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<'entering' | 'holding' | 'exiting'>(reduced ? 'holding' : 'entering');
  useEffect(() => {
    if (reduced) setPhase('holding');
  }, [reduced]);
  useEffect(() => {
    if (phase !== 'holding') return;
    const timer = window.setTimeout(() => reduced ? onDone() : setPhase('exiting'), motionDuration('--dur-achievement-hold', 2000));
    return () => window.clearTimeout(timer);
  }, [phase, reduced, onDone]);
  return (
    <aside className={`achievement-toast motion-${phase}`} role="status" aria-live="polite" aria-atomic="true"
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.animationName === 'motion-toast-in') setPhase('holding');
        if (event.animationName === 'motion-toast-out') onDone();
      }}>
      <div className="card-badge">Achievement unlocked</div>
      <strong>{notice.label}</strong>
      {notice.description && <span>{notice.description}</span>}
    </aside>
  );
}
