import { describe, it, expect, vi } from "vitest";
import {
  isUnchangedSinceLastSync,
  loadIncrementalState,
  saveLastSuccessfulSync,
  INCREMENTAL_STATE_KEY,
} from "../incremental-state";

describe("isUnchangedSinceLastSync", () => {
  it("returns false when itemModDate is null", () => {
    expect(isUnchangedSinceLastSync(null, "2026-04-10T12:00:00Z")).toBe(false);
  });

  it("returns false when lastSync is null", () => {
    expect(isUnchangedSinceLastSync("2026-04-10T10:00:00Z", null)).toBe(false);
  });

  it("returns false when both are null", () => {
    expect(isUnchangedSinceLastSync(null, null)).toBe(false);
  });

  it("returns true when itemModDate is older than lastSync", () => {
    expect(isUnchangedSinceLastSync("2026-04-10T10:00:00Z", "2026-04-10T12:00:00Z")).toBe(true);
  });

  it("returns true when itemModDate equals lastSync", () => {
    expect(isUnchangedSinceLastSync("2026-04-10T12:00:00Z", "2026-04-10T12:00:00Z")).toBe(true);
  });

  it("returns false when itemModDate is newer than lastSync", () => {
    expect(isUnchangedSinceLastSync("2026-04-10T14:00:00Z", "2026-04-10T12:00:00Z")).toBe(false);
  });
});

describe("loadIncrementalState", () => {
  it("returns null timestamps when no data exists", async () => {
    const loadData = vi.fn().mockResolvedValue(null);
    const state = await loadIncrementalState(loadData);
    expect(state.lastSuccessfulSync).toEqual({
      calendar: null,
      reminders: null,
      notes: null,
      contacts: null,
    });
  });

  it("returns null timestamps when key is missing", async () => {
    const loadData = vi.fn().mockResolvedValue({ someOtherKey: "data" });
    const state = await loadIncrementalState(loadData);
    expect(state.lastSuccessfulSync.calendar).toBeNull();
  });

  it("returns existing timestamps", async () => {
    const loadData = vi.fn().mockResolvedValue({
      [INCREMENTAL_STATE_KEY]: {
        lastSuccessfulSync: {
          calendar: "2026-04-10T12:00:00Z",
          reminders: null,
          notes: null,
          contacts: null,
        },
      },
    });
    const state = await loadIncrementalState(loadData);
    expect(state.lastSuccessfulSync.calendar).toBe("2026-04-10T12:00:00Z");
    expect(state.lastSuccessfulSync.reminders).toBeNull();
  });
});

describe("saveLastSuccessfulSync", () => {
  it("saves timestamp for a service", async () => {
    let stored: Record<string, unknown> = {};
    const loadData = vi.fn().mockResolvedValue(stored);
    const saveData = vi.fn().mockImplementation(async (d: Record<string, unknown>) => {
      stored = d;
    });

    await saveLastSuccessfulSync("calendar", "2026-04-10T12:00:00Z", loadData, saveData);

    expect(saveData).toHaveBeenCalled();
    const saved = saveData.mock.calls[0][0] as Record<string, unknown>;
    const state = saved[INCREMENTAL_STATE_KEY] as {
      lastSuccessfulSync: Record<string, string | null>;
    };
    expect(state.lastSuccessfulSync.calendar).toBe("2026-04-10T12:00:00Z");
  });

  it("preserves other services' timestamps", async () => {
    const existing = {
      [INCREMENTAL_STATE_KEY]: {
        lastSuccessfulSync: {
          calendar: "2026-04-09T10:00:00Z",
          reminders: "2026-04-09T10:00:00Z",
          notes: null,
          contacts: null,
        },
      },
    };
    const loadData = vi.fn().mockResolvedValue(existing);
    const saveData = vi.fn();

    await saveLastSuccessfulSync("calendar", "2026-04-10T12:00:00Z", loadData, saveData);

    const saved = saveData.mock.calls[0][0] as Record<string, unknown>;
    const state = saved[INCREMENTAL_STATE_KEY] as {
      lastSuccessfulSync: Record<string, string | null>;
    };
    expect(state.lastSuccessfulSync.calendar).toBe("2026-04-10T12:00:00Z");
    expect(state.lastSuccessfulSync.reminders).toBe("2026-04-09T10:00:00Z");
  });
});
