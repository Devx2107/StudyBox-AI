import { useEffect, useMemo } from 'react';
import { createTaskScope } from '../lib/taskScope';

/** One generation per mounted tab, including async model/stream startup. */
export function useGenerationTask() {
  const scope = useMemo(createTaskScope, []);
  useEffect(() => {
    scope.activate();
    return () => scope.deactivate();
  }, [scope]);
  return scope;
}
