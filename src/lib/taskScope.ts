/** Exclusive work owned by one mounted component. */
export function createTaskScope() {
  let mounted = true;
  let current: AbortController | null = null;
  const cancel = () => {
    current?.abort();
    current = null;
  };
  return {
    activate() { mounted = true; },
    deactivate() { mounted = false; cancel(); },
    start() {
      if (!mounted || current) return null;
      current = new AbortController();
      return current;
    },
    finish(task: AbortController) { if (current === task) current = null; },
    cancel,
  };
}
