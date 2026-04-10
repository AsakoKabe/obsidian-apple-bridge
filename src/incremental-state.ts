import type { ServiceKey } from "./sync-status";

export const INCREMENTAL_STATE_KEY = "incremental-sync-state";

export interface IncrementalSyncState {
  lastSuccessfulSync: Record<ServiceKey, string | null>;
}

const DEFAULT_STATE: IncrementalSyncState = {
  lastSuccessfulSync: {
    calendar: null,
    reminders: null,
    notes: null,
    contacts: null,
  },
};

export function isUnchangedSinceLastSync(
  itemModDate: string | null,
  lastSync: string | null
): boolean {
  if (!itemModDate || !lastSync) return false;
  return new Date(itemModDate).getTime() <= new Date(lastSync).getTime();
}

export async function loadIncrementalState(
  loadData: () => Promise<Record<string, unknown> | null>
): Promise<IncrementalSyncState> {
  const data = await loadData();
  const stored = data?.[INCREMENTAL_STATE_KEY] as IncrementalSyncState | undefined;
  if (!stored?.lastSuccessfulSync) return { ...DEFAULT_STATE };
  return {
    lastSuccessfulSync: {
      ...DEFAULT_STATE.lastSuccessfulSync,
      ...stored.lastSuccessfulSync,
    },
  };
}

export async function saveLastSuccessfulSync(
  service: ServiceKey,
  timestamp: string,
  loadData: () => Promise<Record<string, unknown> | null>,
  saveData: (data: Record<string, unknown>) => Promise<void>
): Promise<void> {
  const data = (await loadData()) ?? {};
  const current = (data[INCREMENTAL_STATE_KEY] as IncrementalSyncState | undefined) ?? {
    ...DEFAULT_STATE,
  };
  const updated: IncrementalSyncState = {
    lastSuccessfulSync: {
      ...DEFAULT_STATE.lastSuccessfulSync,
      ...current.lastSuccessfulSync,
      [service]: timestamp,
    },
  };
  await saveData({ ...data, [INCREMENTAL_STATE_KEY]: updated });
}
