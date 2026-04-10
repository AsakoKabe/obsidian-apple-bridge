import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  classifyError,
  makeStatusSuccess,
  makeStatusError,
  loadStatusMap,
  saveServiceStatus,
  relativeTime,
} from "../sync-status";

describe("classifyError", () => {
  it("returns 'permission' for authorization errors", () => {
    expect(classifyError("not authorized to access Calendar")).toBe("permission");
    expect(classifyError("Access Denied by system")).toBe("permission");
    expect(classifyError("Operation not allowed")).toBe("permission");
  });

  it("returns 'unavailable' for app-not-running errors", () => {
    expect(classifyError("Application is not running")).toBe("unavailable");
    expect(classifyError("Can't get application")).toBe("unavailable");
    expect(classifyError("Service unavailable")).toBe("unavailable");
    expect(classifyError("osascript failed")).toBe("unavailable");
  });

  it("returns 'general' for unrecognized errors", () => {
    expect(classifyError("Something went wrong")).toBe("general");
    expect(classifyError("Network timeout")).toBe("general");
  });
});

describe("makeStatusSuccess", () => {
  it("returns a success status with item count", () => {
    const status = makeStatusSuccess(42);
    expect(status.lastSyncAt).toBeTruthy();
    expect(status.lastError).toBeNull();
    expect(status.errorKind).toBeNull();
    expect(status.itemCount).toBe(42);
  });

  it("sets lastSyncAt to a valid ISO timestamp", () => {
    const before = Date.now();
    const status = makeStatusSuccess(0);
    const after = Date.now();
    const ts = new Date(status.lastSyncAt!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe("makeStatusError", () => {
  it("extracts message from Error instances", () => {
    const status = makeStatusError(new Error("not authorized"));
    expect(status.lastError).toBe("not authorized");
    expect(status.errorKind).toBe("permission");
    expect(status.itemCount).toBeNull();
  });

  it("converts non-Error values to string", () => {
    const status = makeStatusError("raw string error");
    expect(status.lastError).toBe("raw string error");
    expect(status.errorKind).toBe("general");
  });

  it("sets lastSyncAt to a valid ISO timestamp", () => {
    const status = makeStatusError(new Error("fail"));
    expect(new Date(status.lastSyncAt!).getTime()).toBeGreaterThan(0);
  });
});

describe("loadStatusMap", () => {
  it("returns empty statuses when no data exists", async () => {
    const loadData = vi.fn().mockResolvedValue(null);
    const map = await loadStatusMap(loadData);
    expect(map.calendar.lastSyncAt).toBeNull();
    expect(map.reminders.lastSyncAt).toBeNull();
    expect(map.notes.lastSyncAt).toBeNull();
    expect(map.contacts.lastSyncAt).toBeNull();
  });

  it("returns stored statuses when data exists", async () => {
    const stored = {
      "sync-status": {
        calendar: makeStatusSuccess(10),
      },
    };
    const loadData = vi.fn().mockResolvedValue(stored);
    const map = await loadStatusMap(loadData);
    expect(map.calendar.itemCount).toBe(10);
    expect(map.reminders.lastSyncAt).toBeNull(); // default
  });

  it("fills missing service keys with defaults", async () => {
    const stored = { "sync-status": {} };
    const loadData = vi.fn().mockResolvedValue(stored);
    const map = await loadStatusMap(loadData);
    for (const key of ["calendar", "reminders", "notes", "contacts"] as const) {
      expect(map[key].lastSyncAt).toBeNull();
      expect(map[key].lastError).toBeNull();
      expect(map[key].itemCount).toBeNull();
    }
  });
});

describe("saveServiceStatus", () => {
  it("persists status for a single service", async () => {
    const loadData = vi.fn().mockResolvedValue({});
    const saveData = vi.fn().mockResolvedValue(undefined);
    const status = makeStatusSuccess(5);

    await saveServiceStatus("calendar", status, loadData, saveData);

    expect(saveData).toHaveBeenCalledWith(
      expect.objectContaining({
        "sync-status": expect.objectContaining({
          calendar: status,
        }),
      })
    );
  });

  it("preserves existing service statuses when updating one", async () => {
    const existingCalendar = makeStatusSuccess(10);
    const loadData = vi.fn().mockResolvedValue({
      "sync-status": { calendar: existingCalendar },
    });
    const saveData = vi.fn().mockResolvedValue(undefined);
    const notesStatus = makeStatusSuccess(3);

    await saveServiceStatus("notes", notesStatus, loadData, saveData);

    const saved = saveData.mock.calls[0][0] as Record<string, unknown>;
    const statusMap = saved["sync-status"] as Record<string, unknown>;
    expect(statusMap.calendar).toEqual(existingCalendar);
    expect(statusMap.notes).toEqual(notesStatus);
  });

  it("handles null initial data", async () => {
    const loadData = vi.fn().mockResolvedValue(null);
    const saveData = vi.fn().mockResolvedValue(undefined);
    const status = makeStatusError(new Error("fail"));

    await saveServiceStatus("reminders", status, loadData, saveData);

    expect(saveData).toHaveBeenCalledWith(
      expect.objectContaining({
        "sync-status": { reminders: status },
      })
    );
  });
});

describe("relativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for <10 seconds ago", () => {
    const ts = new Date(Date.now() - 5_000).toISOString();
    expect(relativeTime(ts)).toBe("just now");
  });

  it("returns seconds for <60 seconds ago", () => {
    const ts = new Date(Date.now() - 30_000).toISOString();
    expect(relativeTime(ts)).toBe("30s ago");
  });

  it("returns minutes for <60 minutes ago", () => {
    const ts = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relativeTime(ts)).toBe("5 min ago");
  });

  it("returns hours for <24 hours ago", () => {
    const ts = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(relativeTime(ts)).toBe("3h ago");
  });

  it("returns days for >=24 hours ago", () => {
    const ts = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    expect(relativeTime(ts)).toBe("2d ago");
  });
});
