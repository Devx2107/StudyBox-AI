import { useEffect, useRef, useState, useSyncExternalStore, type AnimationEvent } from 'react';

const motionQuery = '(prefers-reduced-motion: reduce)';
function subscribe(listener: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

export function useReducedMotion() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(motionQuery).matches, () => true);
}

/** Read CSS timing tokens for the few lifecycles that need a JS clock. */
export function motionDuration(name: string, fallback: number) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const number = parseFloat(value);
  return Number.isFinite(number) ? number * (value.endsWith('ms') ? 1 : 1000) : fallback;
}

export function useAnimatedNumber(target: number, durationName = '--dur-count', initial = target) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(initial);
  const current = useRef(initial);
  useEffect(() => {
    if (reduced || target <= current.current) {
      current.current = target;
      setValue(target);
      return;
    }
    const from = current.current;
    const duration = motionDuration(durationName, 250);
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / Math.max(1, duration));
      current.current = from + (target - from) * (1 - (1 - progress) ** 3);
      setValue(current.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationName, reduced]);
  return reduced ? target : value;
}

export function useTabTransition<T extends string>(requested: T) {
  const reduced = useReducedMotion();
  const [displayed, setDisplayed] = useState(requested);
  const [phase, setPhase] = useState<'entering' | 'idle' | 'exiting'>('entering');
  const latest = useRef(requested);
  latest.current = requested;
  useEffect(() => {
    if (reduced) {
      setDisplayed(requested);
      setPhase('idle');
    } else if (requested !== displayed) {
      setPhase('exiting');
    } else {
      setPhase((previous) => previous === 'exiting' ? 'idle' : previous);
    }
  }, [requested, displayed, reduced]);
  const onAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.animationName === 'motion-tab-out' && phase === 'exiting') {
      setDisplayed(latest.current);
      setPhase('entering');
    } else if (event.animationName === 'motion-tab-in' && phase === 'entering') {
      setPhase('idle');
    }
  };
  return { displayed: reduced ? requested : displayed, phase: reduced ? 'idle' : phase, onAnimationEnd };
}
