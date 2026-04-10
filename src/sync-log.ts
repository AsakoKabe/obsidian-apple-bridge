import type { ServiceKey } from "./sync-status";

export interface SyncLogEntry {
  timestamp: string; // ISO 8601
  service: ServiceKey;
  result: "success" | "error";
  itemCount: number;
  error?: string;
  durationMs: number;
}

const SYNC_LOG_KEY = "sync-log";
const MAX_ENTRIES = 200;

export async function loadSyncLog(
  loadData: () => Promise<Record<string, unknown> | null>
): Promise<readonly SyncLogEntry[]> {
  const data = await loadData();
  return (data?.[SYNC_LOG_KEY] as SyncLogEntry[] | undefined) ?? [];
}

export async function appendSyncLogEntry(
  entry: SyncLogEntry,
  loadData: () => Promise<Record<string, unknown> | null>,
  saveData: (data: Record<string, unknown>) => Promise<void>
): Promise<void> {
  const data = (await loadData()) ?? {};
  const existing = (data[SYNC_LOG_KEY] as SyncLogEntry[] | undefined) ?? [];
  const updated = [...existing, entry].slice(-MAX_ENTRIES);
  await saveData({ ...data, [SYNC_LOG_KEY]: updated });
}

export function createSuccessEntry(
  service: ServiceKey,
  itemCount: number,
  durationMs: number
): SyncLogEntry {
  return {
    timestamp: new Date().toISOString(),
    service,
    result: "success",
    itemCount,
    durationMs,
  };
}

export function createErrorEntry(
  service: ServiceKey,
  error: unknown,
  durationMs: number
): SyncLogEntry {
  const message = error instanceof Error ? error.message : "Unknown error";
  return {
    timestamp: new Date().toISOString(),
    service,
    result: "error",
    itemCount: 0,
    error: message,
    durationMs,
  };
}

export function formatLogEntry(entry: SyncLogEntry): string {
  const time = new Date(entry.timestamp).toLocaleString();
  const duration =
    entry.durationMs < 1000 ? `${entry.durationMs}ms` : `${(entry.durationMs / 1000).toFixed(1)}s`;

  if (entry.result === "error") {
    return `[${time}] ${entry.service} — ERROR (${duration}): ${entry.error}`;
  }

  const items = entry.itemCount === 1 ? "1 item" : `${entry.itemCount} items`;
  return `[${time}] ${entry.service} — OK, ${items} (${duration})`;
}

export function formatSyncLog(entries: readonly SyncLogEntry[]): string {
  if (entries.length === 0) return "No sync operations recorded yet.";
  return [...entries].reverse().map(formatLogEntry).join("\n");
}
