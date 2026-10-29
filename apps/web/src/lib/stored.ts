import { useCallback, useState } from "react";

/** State kept in this browser between visits, such as display options. */
export function useStored<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return initial;
      const parsed = JSON.parse(stored) as T;
      // An object gains any options added since it was stored.
      return typeof initial === "object" ? { ...initial, ...parsed } : parsed;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage can be refused; the setting still holds for this page.
      }
    },
    [key],
  );
  return [value, set];
}
