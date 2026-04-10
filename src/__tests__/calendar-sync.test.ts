import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { TFile, TFolder } from "../__mocks__/obsidian";

vi.mock("../calendar-bridge", () => ({
  fetchEvents: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  listCalendars: vi.fn(),
}));

import { fetchEvents, createEvent, updateEvent } from "../calendar-bridge";
import { syncCalendar } from "../calendar-sync";
import type { CalendarEvent } from "../calendar-bridge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt-1",
    calendarName: "Calendar",
    title: "Stand-up",
    startDate: "2026-04-10T09:00:00.000Z",
    endDate: "2026-04-10T09:30:00.000Z",
    isAllDay: false,
    location: "",
    notes: "",
    url: "",
    ...overrides,
  };
}

function createMockVault(initialFiles: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initialFiles));
  const vault = {
    getAbstractFileByPath: vi.fn((path: string) => {
      if (files.has(path)) return new TFile(path);
      return null;
    }),
    read: vi.fn(async (file: TFile) => files.get(file.path) ?? ""),
    modify: vi.fn(async (file: TFile, content: string) => {
      files.set(file.path, content);
    }),
    create: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
      return new TFile(path);
    }),
    createFolder: vi.fn(async (path: string) => new TFolder(path)),
    delete: vi.fn(async () => {}),
    _files: files,
  };
  return vault;
}

function createMockPlugin(
  vaultFiles: Record<string, string> = {},
  settingsOverrides: Record<string, unknown> = {},
  initialData: Record<string, unknown> | null = null
) {
  const vault = createMockVault(vaultFiles);
  let pluginData: Record<string, unknown> | null = initialData;
  return {
    settings: {
      syncCalendar: true,
      syncReminders: true,
      syncNotes: false,
      syncContacts: false,
      syncIntervalMinutes: 15,
      defaultCalendarName: "Calendar",
      defaultReminderList: "Reminders",
      conflictResolution: "remote-wins",
      calendarFolder: "",
      remindersFolder: "",
      notesFolder: "Apple Notes",
      contactsFolder: "People",
      // Default to today-only range so existing tests remain unchanged
      syncRangePastDays: 0,
      syncRangeFutureDays: 0,
      ...settingsOverrides,
    },
    app: { vault },
    loadData: vi.fn(async () => pluginData),
    saveData: vi.fn(async (d: Record<string, unknown>) => {
      pluginData = d;
    }),
  };
}

const FIXED_DATE = "2026-04-10";
const NOTE_PATH = "2026-04-10.md";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${FIXED_DATE}T12:00:00.000Z`));
  vi.mocked(fetchEvents).mockResolvedValue([]);
  vi.mocked(createEvent).mockResolvedValue("new-evt-id");
  vi.mocked(updateEvent).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("syncCalendar", () => {
  it("does nothing when syncCalendar is disabled", async () => {
    const plugin = createMockPlugin({}, { syncCalendar: false });
    await syncCalendar(plugin as never);
    expect(fetchEvents).not.toHaveBeenCalled();
    expect(plugin.loadData).not.toHaveBeenCalled();
  });

  it("fetches events for today's date range", async () => {
    const plugin = createMockPlugin();
    await syncCalendar(plugin as never);
    expect(fetchEvents).toHaveBeenCalledOnce();
    const [startArg, endArg] = vi.mocked(fetchEvents).mock.calls[0];
    expect(startArg.toDateString()).toBe(new Date(FIXED_DATE).toDateString());
    expect(endArg.toDateString()).toBe(new Date(FIXED_DATE).toDateString());
  });

  it("creates daily note when it does not exist", async () => {
    const plugin = createMockPlugin();
    await syncCalendar(plugin as never);
    expect(plugin.app.vault.create).toHaveBeenCalledWith(
      NOTE_PATH,
      expect.stringContaining("2026-04-10")
    );
  });

  it("reuses existing daily note", async () => {
    const existingContent = `# ${FIXED_DATE}\n\n`;
    const plugin = createMockPlugin({ [NOTE_PATH]: existingContent });
    await syncCalendar(plugin as never);
    expect(plugin.app.vault.create).not.toHaveBeenCalled();
  });

  it("writes Apple events into daily note", async () => {
    const event = makeEvent({ id: "evt-1", title: "Team Sync" });
    vi.mocked(fetchEvents).mockResolvedValue([event]);
    const plugin = createMockPlugin();
    await syncCalendar(plugin as never);

    expect(plugin.app.vault.modify).toHaveBeenCalled();
    const written = vi.mocked(plugin.app.vault.modify).mock.calls[0][1] as string;
    expect(written).toContain("Team Sync");
    expect(written).toContain("[id:evt-1]");
    expect(written).toContain("## Calendar Events");
  });

  it("saves sync state after writing events", async () => {
    vi.mocked(fetchEvents).mockResolvedValue([makeEvent()]);
    const plugin = createMockPlugin();
    await syncCalendar(plugin as never);
    expect(plugin.saveData).toHaveBeenCalled();
    const saved = vi.mocked(plugin.saveData).mock.calls[0][0] as Record<string, unknown>;
    expect(saved).toHaveProperty("calendar-sync-state");
  });

  it("sorts events by start time in note", async () => {
    const events = [
      makeEvent({
        id: "evt-late",
        title: "Late Meeting",
        startDate: "2026-04-10T14:00:00.000Z",
        endDate: "2026-04-10T15:00:00.000Z",
      }),
      makeEvent({
        id: "evt-early",
        title: "Morning Stand-up",
        startDate: "2026-04-10T09:00:00.000Z",
        endDate: "2026-04-10T09:30:00.000Z",
      }),
    ];
    vi.mocked(fetchEvents).mockResolvedValue(events);
    const plugin = createMockPlugin();
    await syncCalendar(plugin as never);

    const written = vi.mocked(plugin.app.vault.modify).mock.calls[0][1] as string;
    const earlyIdx = written.indexOf("Morning Stand-up");
    const lateIdx = written.indexOf("Late Meeting");
    expect(earlyIdx).toBeLessThan(lateIdx);
  });

  it("formats all-day events with 'all-day' label", async () => {
    vi.mocked(fetchEvents).mockResolvedValue([
      makeEvent({ id: "evt-allday", title: "Conference", isAllDay: true }),
    ]);
    const plugin = createMockPlugin();
    await syncCalendar(plugin as never);

    const written = vi.mocked(plugin.app.vault.modify).mock.calls[0][1] as string;
    expect(written).toContain("all-day Conference");
  });

  it("includes location emoji when event has location", async () => {
    vi.mocked(fetchEvents).mockResolvedValue([
      makeEvent({ id: "evt-loc", title: "Offsite", location: "HQ" }),
    ]);
    const plugin = createMockPlugin();
    await syncCalendar(plugin as never);

    const written = vi.mocked(plugin.app.vault.modify).mock.calls[0][1] as string;
    expect(written).toContain("📍 HQ");
  });

  it("creates folders when calendarFolder is set", async () => {
    const plugin = createMockPlugin({}, { calendarFolder: "Calendar" });
    await syncCalendar(plugin as never);
    expect(plugin.app.vault.createFolder).toHaveBeenCalledWith("Calendar");
  });

  it("pushes local-only events (no id) to Apple Calendar", async () => {
    // Note already has a local event without an Apple id
    const noteContent = [
      `# ${FIXED_DATE}`,
      "",
      "## Calendar Events",
      "",
      "- [ ] 10:00 - 11:00 Local Only Event",
      "",
    ].join("\n");

    const plugin = createMockPlugin({ [NOTE_PATH]: noteContent });
    await syncCalendar(plugin as never);

    expect(createEvent).toHaveBeenCalledWith(
      "Calendar",
      "Local Only Event",
      expect.any(Date),
      expect.any(Date),
      expect.objectContaining({})
    );
  });

  it("skips local-only event creation when no time string is present", async () => {
    const noteContent = [
      `# ${FIXED_DATE}`,
      "",
      "## Calendar Events",
      "",
      "- [ ] My Task Without Time",
      "",
    ].join("\n");

    const plugin = createMockPlugin({ [NOTE_PATH]: noteContent });
    await syncCalendar(plugin as never);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("conflict remote-wins: Apple change overwrites local change", async () => {
    const prevState = {
      "calendar-sync-state": {
        events: {
          "evt-1": {
            appleId: "evt-1",
            title: "Original Title",
            startDate: "2026-04-10T09:00:00.000Z",
            endDate: "2026-04-10T09:30:00.000Z",
            isAllDay: false,
            location: "",
            notes: "",
            lastSyncedAt: "2026-04-10T08:00:00.000Z",
          },
        },
      },
    };

    // Note shows local title change
    const noteContent = [
      `# ${FIXED_DATE}`,
      "",
      "## Calendar Events",
      "",
      "- [ ] 09:00 - 09:30 Local Title [id:evt-1]",
      "",
    ].join("\n");

    // Apple returns different title
    vi.mocked(fetchEvents).mockResolvedValue([makeEvent({ id: "evt-1", title: "Remote Title" })]);

    const plugin = createMockPlugin(
      { [NOTE_PATH]: noteContent },
      { conflictResolution: "remote-wins" },
      prevState
    );
    await syncCalendar(plugin as never);

    // remote-wins: updateEvent should NOT be called (we keep Apple's version)
    expect(updateEvent).not.toHaveBeenCalled();

    const written = vi.mocked(plugin.app.vault.modify).mock.calls[0][1] as string;
    expect(written).toContain("Remote Title");
  });

  it("conflict local-wins: local change is pushed to Apple Calendar", async () => {
    const prevState = {
      "calendar-sync-state": {
        events: {
          "evt-1": {
            appleId: "evt-1",
            title: "Original Title",
            startDate: "2026-04-10T09:00:00.000Z",
            endDate: "2026-04-10T09:30:00.000Z",
            isAllDay: false,
            location: "",
            notes: "",
            lastSyncedAt: "2026-04-10T08:00:00.000Z",
          },
        },
      },
    };

    const noteContent = [
      `# ${FIXED_DATE}`,
      "",
      "## Calendar Events",
      "",
      "- [ ] 09:00 - 09:30 Local Title [id:evt-1]",
      "",
    ].join("\n");

    vi.mocked(fetchEvents).mockResolvedValue([makeEvent({ id: "evt-1", title: "Remote Title" })]);

    const plugin = createMockPlugin(
      { [NOTE_PATH]: noteContent },
      { conflictResolution: "local-wins" },
      prevState
    );
    await syncCalendar(plugin as never);

    // local-wins: updateEvent should be called with local change
    expect(updateEvent).toHaveBeenCalledWith(
      "evt-1",
      expect.objectContaining({ title: "Local Title" })
    );
  });

  it("conflict most-recent: remote wins when remote is newer", async () => {
    const prevState = {
      "calendar-sync-state": {
        events: {
          "evt-1": {
            appleId: "evt-1",
            title: "Original",
            startDate: "2026-04-10T09:00:00.000Z",
            endDate: "2026-04-10T09:30:00.000Z",
            isAllDay: false,
            location: "",
            notes: "",
            lastSyncedAt: "2026-04-09T08:00:00.000Z", // synced yesterday
          },
        },
      },
    };

    const noteContent = [
      `# ${FIXED_DATE}`,
      "",
      "## Calendar Events",
      "",
      "- [ ] 09:00 - 09:30 Local Title [id:evt-1]",
      "",
    ].join("\n");

    // Remote event start is "later" than lastSyncedAt
    vi.mocked(fetchEvents).mockResolvedValue([
      makeEvent({ id: "evt-1", title: "Remote Title", startDate: "2026-04-10T09:00:00.000Z" }),
    ]);

    const plugin = createMockPlugin(
      { [NOTE_PATH]: noteContent },
      { conflictResolution: "most-recent" },
      prevState
    );
    await syncCalendar(plugin as never);

    // remote time > lastSyncedAt → remote wins → no updateEvent
    expect(updateEvent).not.toHaveBeenCalled();
    const written = vi.mocked(plugin.app.vault.modify).mock.calls[0][1] as string;
    expect(written).toContain("Remote Title");
  });

  it("pushes local edits to Apple when no remote conflict exists", async () => {
    const prevState = {
      "calendar-sync-state": {
        events: {
          "evt-1": {
            appleId: "evt-1",
            title: "Original Title",
            startDate: "2026-04-10T09:00:00.000Z",
            endDate: "2026-04-10T09:30:00.000Z",
            isAllDay: false,
            location: "",
            notes: "",
            lastSyncedAt: "2026-04-10T08:00:00.000Z",
          },
        },
      },
    };

    const noteContent = [
      `# ${FIXED_DATE}`,
      "",
      "## Calendar Events",
      "",
      "- [ ] 09:00 - 09:30 Edited Title [id:evt-1]",
      "",
    ].join("\n");

    // Apple returns the ORIGINAL title (no remote change)
    vi.mocked(fetchEvents).mockResolvedValue([makeEvent({ id: "evt-1", title: "Original Title" })]);

    const plugin = createMockPlugin({ [NOTE_PATH]: noteContent }, {}, prevState);
    await syncCalendar(plugin as never);

    // Local edit should be pushed to Apple
    expect(updateEvent).toHaveBeenCalledWith(
      "evt-1",
      expect.objectContaining({ title: "Edited Title" })
    );
  });

  it("preserves local note lines without Apple id across writes", async () => {
    const event = makeEvent({ id: "evt-1", title: "Apple Event" });
    vi.mocked(fetchEvents).mockResolvedValue([event]);

    const noteContent = [
      `# ${FIXED_DATE}`,
      "",
      "## Calendar Events",
      "",
      "- [x] 09:00 - 09:30 Apple Event [id:evt-1]",
      "- [ ] 14:00 - 15:00 My Personal Task",
      "",
    ].join("\n");

    const prevState = {
      "calendar-sync-state": {
        events: {
          "evt-1": {
            appleId: "evt-1",
            title: "Apple Event",
            startDate: "2026-04-10T09:00:00.000Z",
            endDate: "2026-04-10T09:30:00.000Z",
            isAllDay: false,
            location: "",
            notes: "",
            lastSyncedAt: "2026-04-10T08:00:00.000Z",
          },
        },
      },
    };

    const plugin = createMockPlugin({ [NOTE_PATH]: noteContent }, {}, prevState);
    await syncCalendar(plugin as never);

    const written = vi.mocked(plugin.app.vault.modify).mock.calls[0][1] as string;
    // The local personal task (no id) should still appear
    expect(written).toContain("My Personal Task");
  });

  it("loads prior sync state from plugin data", async () => {
    const prevState = {
      "calendar-sync-state": { events: { "old-evt": { appleId: "old-evt", title: "Old" } } },
    };
    const plugin = createMockPlugin({}, {}, prevState);
    await syncCalendar(plugin as never);
    expect(plugin.loadData).toHaveBeenCalled();
  });

  it("creates daily note in calendarFolder subdirectory", async () => {
    const plugin = createMockPlugin({}, { calendarFolder: "Daily" });
    await syncCalendar(plugin as never);
    expect(plugin.app.vault.create).toHaveBeenCalledWith(`Daily/${NOTE_PATH}`, expect.any(String));
  });

  // ---------------------------------------------------------------------------
  // Multi-day sync range tests
  // ---------------------------------------------------------------------------

  it("fetches events for full date range when past/future days are set", async () => {
    const plugin = createMockPlugin({}, { syncRangePastDays: 3, syncRangeFutureDays: 5 });
    await syncCalendar(plugin as never);

    const [startArg, endArg] = vi.mocked(fetchEvents).mock.calls[0];
    // startArg should be 3 days before today
    const expectedStart = new Date("2026-04-07T00:00:00.000");
    const expectedEnd = new Date("2026-04-15T23:59:59.999");
    expect(startArg.toDateString()).toBe(expectedStart.toDateString());
    expect(endArg.toDateString()).toBe(expectedEnd.toDateString());
  });

  it("writes events to their respective daily notes across the range", async () => {
    const todayEvent = makeEvent({
      id: "evt-today",
      title: "Today Meeting",
      startDate: "2026-04-10T10:00:00.000Z",
      endDate: "2026-04-10T11:00:00.000Z",
    });
    const tomorrowEvent = makeEvent({
      id: "evt-tomorrow",
      title: "Tomorrow Meeting",
      startDate: "2026-04-11T10:00:00.000Z",
      endDate: "2026-04-11T11:00:00.000Z",
    });
    vi.mocked(fetchEvents).mockResolvedValue([todayEvent, tomorrowEvent]);

    const plugin = createMockPlugin({}, { syncRangePastDays: 0, syncRangeFutureDays: 1 });
    await syncCalendar(plugin as never);

    // Two notes should be written: today and tomorrow
    const modifyCalls = vi.mocked(plugin.app.vault.modify).mock.calls;
    const writtenPaths = modifyCalls.map((call) => (call[0] as TFile).path);
    expect(writtenPaths).toContain("2026-04-10.md");
    expect(writtenPaths).toContain("2026-04-11.md");

    // Each note should only contain its own events
    const todayWrite = modifyCalls.find(
      (call) => (call[0] as TFile).path === "2026-04-10.md"
    )![1] as string;
    const tomorrowWrite = modifyCalls.find(
      (call) => (call[0] as TFile).path === "2026-04-11.md"
    )![1] as string;
    expect(todayWrite).toContain("Today Meeting");
    expect(todayWrite).not.toContain("Tomorrow Meeting");
    expect(tomorrowWrite).toContain("Tomorrow Meeting");
    expect(tomorrowWrite).not.toContain("Today Meeting");
  });

  it("skips creating past/future notes when no events exist for those days", async () => {
    // Only today has events; range includes yesterday and tomorrow
    vi.mocked(fetchEvents).mockResolvedValue([makeEvent({ id: "evt-today", title: "Today Only" })]);

    const plugin = createMockPlugin({}, { syncRangePastDays: 1, syncRangeFutureDays: 1 });
    await syncCalendar(plugin as never);

    const createCalls = vi.mocked(plugin.app.vault.create).mock.calls.map((c) => c[0]);
    // Yesterday and tomorrow notes should not be created (no events, no existing file)
    expect(createCalls).not.toContain("2026-04-09.md");
    expect(createCalls).not.toContain("2026-04-11.md");
    // Today's note should be created (always processed)
    expect(createCalls).toContain("2026-04-10.md");
  });

  it("updates an existing past daily note when it already exists", async () => {
    const pastNote = "2026-04-09.md";
    const existingContent = `# 2026-04-09\n\n`;
    const pastEvent = makeEvent({
      id: "evt-past",
      title: "Past Meeting",
      startDate: "2026-04-09T10:00:00.000Z",
      endDate: "2026-04-09T11:00:00.000Z",
    });
    vi.mocked(fetchEvents).mockResolvedValue([pastEvent]);

    const plugin = createMockPlugin(
      { [pastNote]: existingContent },
      { syncRangePastDays: 1, syncRangeFutureDays: 0 }
    );
    await syncCalendar(plugin as never);

    const modifyCalls = vi.mocked(plugin.app.vault.modify).mock.calls;
    const pastWrite = modifyCalls.find(
      (call) => (call[0] as TFile).path === pastNote
    )?.[1] as string;
    expect(pastWrite).toContain("Past Meeting");
  });
});
