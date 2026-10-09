interface SnapshotPersistenceOptions {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  storageKey: string;
  write: (snapshot: string) => Promise<boolean>;
}

/** Keep refresh recovery immediate while serializing the slower file writes. */
export function createSnapshotPersistence({ storage, storageKey, write }: SnapshotPersistenceOptions) {
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const restore = (): Record<string, unknown> | null => {
    try {
      const snapshot: unknown = JSON.parse(storage?.getItem(storageKey) ?? 'null');
      return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
        ? snapshot as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  };

  const flush = async (): Promise<void> => {
    clearTimer();
    // A later snapshot must reach disk after any earlier request has finished.
    if (inFlight) {
      await inFlight;
      return flush();
    }
    if (pending === null) return;
    const snapshot = pending;
    pending = null;
    inFlight = (async () => {
      try {
        if (await write(snapshot)) {
          // Never clear a newer recovery copy while an older save completes.
          if (storage?.getItem(storageKey) === snapshot) storage.removeItem(storageKey);
        }
      } catch {
        // The recovery copy remains available if writing or storage is unavailable.
      }
    })();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  };

  return {
    restore,
    save(data: unknown) {
      const snapshot = JSON.stringify(data, null, 2);
      try { storage?.setItem(storageKey, snapshot); } catch { /* Disk saving still works. */ }
      pending = snapshot;
      clearTimer();
      timer = setTimeout(() => { void flush(); }, 800);
    },
    flush,
  };
}
