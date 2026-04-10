/** Sync status tracking and error classification for Apple Bridge. */

export type ServiceKey = "calendar" | "reminders" | "notes" | "contacts";

export type ErrorKind = "permission" | "unavailable" | "general";

export interface SyncStatus {
  lastSyncAt: string | null; // ISO timestamp
  lastError: string | null;
  errorKind: ErrorKind | null;
  itemCount: number | null; // null = never synced; 0 = synced, empty
}

export type SyncStatusMap = Record<ServiceKey, SyncStatus>;

const STATUS_KEY = "sync-status";

const EMPTY_STATUS: SyncStatus = {
  lastSyncAt: null,
  lastError: null,
  errorKind: null,
  itemCount: null,
};

export function classifyError(message: string): ErrorKind {
  if (/not authorized|not allowed|access denied/i.test(message)) {
    return "permission";
  }
  if (/not running|can't get|unavailable|osascript/i.test(message)) {
    return "unavailable";
  }
  return "general";
}

export function makeStatusSuccess(itemCount: number): SyncStatus {
  return {
    lastSyncAt: new Date().toISOString(),
    lastError: null,
    errorKind: null,
    itemCount,
  };
}

export function makeStatusError(error: unknown): SyncStatus {
  const message = error instanceof Error ? error.message : String(error);
  return {
    lastSyncAt: new Date().toISOString(),
    lastError: message,
    errorKind: classifyError(message),
    itemCount: null,
  };
}

/** Loads the full status map from plugin data, filling missing keys with defaults. */
export async function loadStatusMap(loadData: () => Promise<unknown>): Promise<SyncStatusMap> {
  const data = (await loadData()) as Record<string, unknown> | null;
  const stored = (data?.[STATUS_KEY] ?? {}) as Partial<SyncStatusMap>;
  return {
    calendar: stored.calendar ?? { ...EMPTY_STATUS },
    reminders: stored.reminders ?? { ...EMPTY_STATUS },
    notes: stored.notes ?? { ...EMPTY_STATUS },
    contacts: stored.contacts ?? { ...EMPTY_STATUS },
  };
}

/** Persists an updated status for one service into plugin data. */
export async function saveServiceStatus(
  service: ServiceKey,
  status: SyncStatus,
  loadData: () => Promise<unknown>,
  saveData: (data: unknown) => Promise<void>
): Promise<void> {
  const data = ((await loadData()) as Record<string, unknown> | null) ?? {};
  const current = (data[STATUS_KEY] ?? {}) as Partial<SyncStatusMap>;
  await saveData({
    ...data,
    [STATUS_KEY]: { ...current, [service]: status },
  });
}

/** Returns a human-readable relative time string ("2 min ago", "just now", etc.). */
export function relativeTime(isoTimestamp: string): string {
  const elapsed = Date.now() - new Date(isoTimestamp).getTime();
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
