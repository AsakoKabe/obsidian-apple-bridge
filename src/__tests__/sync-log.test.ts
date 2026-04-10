import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadSyncLog,
  appendSyncLogEntry,
  createSuccessEntry,
  createErrorEntry,
  formatLogEntry,
  formatSyncLog,
  type SyncLogEntry,
} from "../sync-log";

const FIXED_DATE = "2026-04-10T12:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_DATE));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createSuccessEntry", () => {
  it("creates a success entry with correct fields", () => {
    const entry = createSuccessEntry("calendar", 5, 250);

    expect(entry).toEqual({
      timestamp: FIXED_DATE,
      service: "calendar",
      result: "success",
      itemCount: 5,
      durationMs: 250,
    });
  });

  it("creates entry with zero items", () => {
    const entry = createSuccessEntry("notes", 0, 100);
    expect(entry.itemCount).toBe(0);
    expect(entry.result).toBe("success");
  });
});

describe("createErrorEntry", () => {
  it("creates an error entry from Error instance", () => {
    const entry = createErrorEntry("reminders", new Error("JXA failed"), 500);

    expect(entry).toEqual({
      timestamp: FIXED_DATE,
      service: "reminders",
      result: "error",
      itemCount: 0,
      error: "JXA failed",
      durationMs: 500,
    });
  });

  it("handles non-Error thrown values", () => {
    const entry = createErrorEntry("contacts", "string error", 100);
    expect(entry.error).toBe("Unknown error");
  });

  it("handles null thrown value", () => {
    const entry = createErrorEntry("notes", null, 50);
    expect(entry.error).toBe("Unknown error");
  });
});

describe("loadSyncLog", () => {
  it("returns empty array when no data", async () => {
    const loadData = vi.fn().mockResolvedValue(null);
    const entries = await loadSyncLog(loadData);
    expect(entries).toEqual([]);
  });

  it("returns empty array when no sync-log key", async () => {
    const loadData = vi.fn().mockResolvedValue({ other: "data" });
    const entries = await loadSyncLog(loadData);
    expect(entries).toEqual([]);
  });

  it("returns stored entries", async () => {
    const stored: SyncLogEntry[] = [createSuccessEntry("calendar", 3, 200)];
    const loadData = vi.fn().mockResolvedValue({ "sync-log": stored });
    const entries = await loadSyncLog(loadData);
    expect(entries).toEqual(stored);
  });
});

describe("appendSyncLogEntry", () => {
  it("appends to empty log", async () => {
    let data: Record<string, unknown> | null = null;
    const loadData = vi.fn(async () => data);
    const saveData = vi.fn(async (d: Record<string, unknown>) => {
      data = d;
    });

    const entry = createSuccessEntry("calendar", 5, 200);
    await appendSyncLogEntry(entry, loadData, saveData);

    expect(saveData).toHaveBeenCalledWith(
      expect.objectContaining({
        "sync-log": [entry],
      })
    );
  });

  it("appends to existing log", async () => {
    const existing = createSuccessEntry("reminders", 3, 100);
    let data: Record<string, unknown> = { "sync-log": [existing] };
    const loadData = vi.fn(async () => data);
    const saveData = vi.fn(async (d: Record<string, unknown>) => {
      data = d;
    });

    const newEntry = createErrorEntry("contacts", new Error("fail"), 50);
    await appendSyncLogEntry(newEntry, loadData, saveData);

    const saved = (saveData.mock.calls[0][0] as Record<string, unknown>)[
      "sync-log"
    ] as SyncLogEntry[];
    expect(saved).toHaveLength(2);
    expect(saved[0]).toEqual(existing);
    expect(saved[1]).toEqual(newEntry);
  });

  it("preserves other data keys", async () => {
    let data: Record<string, unknown> = { "other-key": "value" };
    const loadData = vi.fn(async () => data);
    const saveData = vi.fn(async (d: Record<string, unknown>) => {
      data = d;
    });

    await appendSyncLogEntry(createSuccessEntry("calendar", 1, 50), loadData, saveData);

    const saved = saveData.mock.calls[0][0] as Record<string, unknown>;
    expect(saved["other-key"]).toBe("value");
  });

  it("caps log at 200 entries", async () => {
    const entries: SyncLogEntry[] = Array.from({ length: 200 }, (_, i) =>
      createSuccessEntry("calendar", i, 10)
    );
    let data: Record<string, unknown> = { "sync-log": entries };
    const loadData = vi.fn(async () => data);
    const saveData = vi.fn(async (d: Record<string, unknown>) => {
      data = d;
    });

    const newEntry = createSuccessEntry("notes", 99, 999);
    await appendSyncLogEntry(newEntry, loadData, saveData);

    const saved = (saveData.mock.calls[0][0] as Record<string, unknown>)[
      "sync-log"
    ] as SyncLogEntry[];
    expect(saved).toHaveLength(200);
    expect(saved[199]).toEqual(newEntry);
    // First original entry should have been dropped
    expect(saved[0].itemCount).toBe(1);
  });
});

describe("formatLogEntry", () => {
  it("formats success entry", () => {
    const entry = createSuccessEntry("calendar", 5, 250);
    const formatted = formatLogEntry(entry);
    expect(formatted).toContain("calendar");
    expect(formatted).toContain("OK");
    expect(formatted).toContain("5 items");
    expect(formatted).toContain("250ms");
  });

  it("formats success entry with 1 item (singular)", () => {
    const entry = createSuccessEntry("reminders", 1, 100);
    const formatted = formatLogEntry(entry);
    expect(formatted).toContain("1 item");
    expect(formatted).not.toContain("1 items");
  });

  it("formats error entry", () => {
    const entry = createErrorEntry("contacts", new Error("permission denied"), 500);
    const formatted = formatLogEntry(entry);
    expect(formatted).toContain("contacts");
    expect(formatted).toContain("ERROR");
    expect(formatted).toContain("permission denied");
    expect(formatted).toContain("500ms");
  });

  it("formats duration in seconds when >= 1000ms", () => {
    const entry = createSuccessEntry("notes", 10, 2500);
    const formatted = formatLogEntry(entry);
    expect(formatted).toContain("2.5s");
  });
});

describe("formatSyncLog", () => {
  it("returns message when log is empty", () => {
    expect(formatSyncLog([])).toBe("No sync operations recorded yet.");
  });

  it("formats entries in reverse chronological order", () => {
    vi.setSystemTime(new Date("2026-04-10T12:00:00.000Z"));
    const entry1 = createSuccessEntry("calendar", 3, 100);
    vi.setSystemTime(new Date("2026-04-10T12:05:00.000Z"));
    const entry2 = createSuccessEntry("reminders", 5, 200);

    const formatted = formatSyncLog([entry1, entry2]);
    const lines = formatted.split("\n");
    expect(lines).toHaveLength(2);
    // Most recent first
    expect(lines[0]).toContain("reminders");
    expect(lines[1]).toContain("calendar");
  });

  it("formats mixed success and error entries", () => {
    const success = createSuccessEntry("calendar", 3, 100);
    const error = createErrorEntry("notes", new Error("failed"), 50);

    const formatted = formatSyncLog([success, error]);
    expect(formatted).toContain("OK");
    expect(formatted).toContain("ERROR");
  });
});
