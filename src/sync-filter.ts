export interface SyncFilter {
  mode: "include" | "exclude";
  names: string[];
}

export function filterByName<T>(
  items: readonly T[],
  getName: (item: T) => string,
  filter: SyncFilter | undefined
): T[] {
  if (!filter) return [...items];

  const nameSet = new Set(filter.names);

  if (filter.mode === "include") {
    return items.filter((item) => nameSet.has(getName(item)));
  }

  return items.filter((item) => !nameSet.has(getName(item)));
}
