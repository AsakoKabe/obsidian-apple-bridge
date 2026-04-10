import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { TFile, TFolder } from "../__mocks__/obsidian";

vi.mock("../reminders-bridge", () => ({
  fetchReminders: vi.fn(),
  createReminder: vi.fn(),
  updateReminder: vi.fn(),
  deleteReminder: vi.fn(),
  listReminderLists: vi.fn(),
}));

import { fetchReminders, createReminder, updateReminder } from "../reminders-bridge";
import { syncReminders } from "../reminders-sync";
import type { Reminder } from "../reminders-bridge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "rem-1",
    listName: "Reminders",
    title: "Buy groceries",
    isCompleted: false,
    dueDate: null,
    priority: 0,
    notes: "",
    completionDate: null,
    modificationDate: null,
    ...overrides,
  };
}

function createMockVault(initialFiles: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initialFiles));
  return {
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
      syncCalendar: false,
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
  vi.mocked(fetchReminders).mockResolvedValue([]);
  vi.mocked(createReminder).mockResolvedValue("new-rem-id");
  vi.mocked(updateReminder).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("syncReminders", () => {
  it("does nothing when syncReminders is disabled", async () => {
    const plugin = createMockPlugin({}, { syncReminders: false });
    await syncReminders(plugin as never);
    expect(fetchReminders).not.toHaveBeenCalled();
    expect(plugin.loadData).not.toHaveBeenCalled();
  });

  it("fetches incomplete reminders from Apple", async () => {
    const plugin = createMockPlugin();
    await syncReminders(plugin as never);
    expect(fetchReminders).toHaveBeenCalledWith(undefined, false);
  });

  it("creates daily note when it does not exist", async () => {
    const plugin = createMockPlugin();
    await syncReminders(plugin as never);
    expect(plugin.app.vault.create).toHaveBeenCalledWith(
      NOTE_PATH,
      expect.stringContaining("2026-04-10")
    );
  });

  it("writes Apple reminders to daily note", async () => {
    vi.mocked(fetchReminders).mockResolvedValue([
      makeReminder({ id: "rem-1", title: "Buy groceries" }),
    ]);
    const plugin = createMockPlugin();
    await syncReminders(plugin as never);

    expect(plugin.app.vault.modify).toHaveBeenCalled();
    const written = vi.mocked(plugin.app.vault.modify).mock.calls[0][1] as string;
    expect(written).toContain("Buy groceries");
    expect(written).toContain("[rid:rem-1]");
    expect(written).toContain("## Reminders");
  });

  it("marks completed reminders with [x]", async () => {
    vi.mocked(fetchReminders).mockResolvedValue([
      makeReminder({ id: "rem-done", title: "Done task", isCompleted: true }),
    ]);
    const plugin = createMockPlugin();
    await syncReminders(plugin as never);

    const written = vi.mocked(plugin.app.vault.modify).mock.calls[0][1] as string;
    expect(written).toContain("- [x] Done task");
  });

  it("includes due date emoji when reminder has due date", async () => {
    vi.mocked(fetchReminders).mockResolvedValue([
      makeReminder({ id: "rem-due", title: "File taxes", dueDate: "2026-04-15T00:00:00.000Z" }),
    ]);
    const plugin = createMockPlugin();
    await syncReminders(plugin as never);

    const written = vi.mocked(plugin.app.vault.modify).mock.calls[0][1] as string;
    expect(written).toContain("📅 2026-04-15");
  });

  it("sorts incomplete reminders before completed", async () => {
    vi.mocked(fetchReminders).mockResolvedValue([
      makeReminder({ id: "rem-done", title: "Z Done", isCompleted: true }),
      makeReminder({ id: "rem-todo", title: "A Todo", isCompleted: false }),
    ]);
    const plugin = createMockPlugin();
    await syncReminders(plugin as never);

    const written = vi.mocked(plugin.app.vault.modify).mock.calls[0][1] as string;
    expect(written.indexOf("A Todo")).toBeLessThan(written.indexOf("Z Done"));
  });

  it("pushes local-only reminders (no rid) to Apple Reminders", async () => {
    const noteContent = [`# ${FIXED_DATE}`, "", "## Reminders", "", "- [ ] Call dentist", ""].join(
      "\n"
    );

    const plugin = createMockPlugin({ [NOTE_PATH]: noteContent });
    await syncReminders(plugin as never);

    expect(createReminder).toHaveBeenCalledWith(
      "Reminders",
      "Call dentist",
      expect.objectContaining({})
    );
  });

  it("pushes local reminder with due date parsed from note", async () => {
    const noteContent = [
      `# ${FIXED_DATE}`,
      "",
      "## Reminders",
      "",
      "- [ ] File taxes 📅 2026-04-15",
      "",
    ].join("\n");

    const plugin = createMockPlugin({ [NOTE_PATH]: noteContent });
    await syncReminders(plugin as never);

    expect(createReminder).toHaveBeenCalledWith(
      "Reminders",
      "File taxes",
      expect.objectContaining({ dueDate: expect.any(Date) })
    );
  });

  it("saves sync state after syncing", async () => {
    vi.mocked(fetchReminders).mockResolvedValue([makeReminder()]);
    const plugin = createMockPlugin();
    await syncReminders(plugin as never);

    expect(plugin.saveData).toHaveBeenCalled();
    const saved = vi.mocked(plugin.saveData).mock.calls[0][0] as Record<string, unknown>;
    expect(saved).toHaveProperty("reminders-sync-state");
  });

  it("conflict remote-wins: Apple change overwrites local change", async () => {
    const prevState = {
      "reminders-sync-state": {
        reminders: {
          "rem-1": {
            appleId: "rem-1",
            title: "Original Title",
            isCompleted: false,
            dueDate: null,
            notes: "",
            lastSyncedAt: "2026-04-10T08:00:00.000Z",
          },
        },
      },
    };

    const noteContent = [
      `# ${FIXED_DATE}`,
      "",
      "## Reminders",
      "",
      "- [ ] Local Title [rid:rem-1]",
      "",
    ].join("\n");

    vi.mocked(fetchReminders).mockResolvedValue([
      makeReminder({ id: "rem-1", title: "Remote Title" }),
    ]);

    const plugin = createMockPlugin(
      { [NOTE_PATH]: noteContent },
      { conflictResolution: "remote-wins" },
      prevState
    );
    await syncReminders(plugin as never);

    expect(updateReminder).not.toHaveBeenCalled();
    const written = vi.mocked(plugin.app.vault.modify).mock.calls[0][1] as string;
    expect(written).toContain("Remote Title");
  });

  it("conflict local-wins: local change is pushed to Apple", async () => {
    const prevState = {
      "reminders-sync-state": {
        reminders: {
          "rem-1": {
            appleId: "rem-1",
            title: "Original Title",
            isCompleted: false,
            dueDate: null,
            notes: "",
            lastSyncedAt: "2026-04-10T08:00:00.000Z",
          },
        },
      },
    };

    const noteContent = [
      `# ${FIXED_DATE}`,
      "",
      "## Reminders",
      "",
      "- [ ] Local Title [rid:rem-1]",
      "",
    ].join("\n");

    vi.mocked(fetchReminders).mockResolvedValue([
      makeReminder({ id: "rem-1", title: "Remote Title" }),
    ]);

    const plugin = createMockPlugin(
      { [NOTE_PATH]: noteContent },
      { conflictResolution: "local-wins" },
      prevState
    );
    await syncReminders(plugin as never);

    expect(updateReminder).toHaveBeenCalledWith(
      "rem-1",
      expect.objectContaining({ title: "Local Title" })
    );
  });

  it("pushes local edits when no remote conflict", async () => {
    const prevState = {
      "reminders-sync-state": {
        reminders: {
          "rem-1": {
            appleId: "rem-1",
            title: "Original",
            isCompleted: false,
            dueDate: null,
            notes: "",
            lastSyncedAt: "2026-04-10T08:00:00.000Z",
          },
        },
      },
    };

    const noteContent = [
      `# ${FIXED_DATE}`,
      "",
      "## Reminders",
      "",
      "- [x] Original [rid:rem-1]", // completion changed locally
      "",
    ].join("\n");

    vi.mocked(fetchReminders).mockResolvedValue([
      makeReminder({ id: "rem-1", title: "Original", isCompleted: false }),
    ]);

    const plugin = createMockPlugin({ [NOTE_PATH]: noteContent }, {}, prevState);
    await syncReminders(plugin as never);

    expect(updateReminder).toHaveBeenCalledWith(
      "rem-1",
      expect.objectContaining({ isCompleted: true })
    );
  });

  it("preserves local note lines without rid", async () => {
    vi.mocked(fetchReminders).mockResolvedValue([
      makeReminder({ id: "rem-1", title: "Apple Reminder" }),
    ]);

    const noteContent = [
      `# ${FIXED_DATE}`,
      "",
      "## Reminders",
      "",
      "- [ ] Apple Reminder [rid:rem-1]",
      "- [ ] My Personal Note",
      "",
    ].join("\n");

    const prevState = {
      "reminders-sync-state": {
        reminders: {
          "rem-1": {
            appleId: "rem-1",
            title: "Apple Reminder",
            isCompleted: false,
            dueDate: null,
            notes: "",
            lastSyncedAt: "2026-04-10T08:00:00.000Z",
          },
        },
      },
    };

    const plugin = createMockPlugin({ [NOTE_PATH]: noteContent }, {}, prevState);
    await syncReminders(plugin as never);

    const written = vi.mocked(plugin.app.vault.modify).mock.calls[0][1] as string;
    expect(written).toContain("My Personal Note");
  });

  it("uses defaultReminderList when creating local-only reminder", async () => {
    const noteContent = [`# ${FIXED_DATE}`, "", "## Reminders", "", "- [ ] New task", ""].join(
      "\n"
    );

    const plugin = createMockPlugin({ [NOTE_PATH]: noteContent }, { defaultReminderList: "Work" });
    await syncReminders(plugin as never);

    expect(createReminder).toHaveBeenCalledWith("Work", "New task", expect.any(Object));
  });

  it("creates daily note in remindersFolder subdirectory", async () => {
    const plugin = createMockPlugin({}, { remindersFolder: "Daily" });
    await syncReminders(plugin as never);
    expect(plugin.app.vault.create).toHaveBeenCalledWith(`Daily/${NOTE_PATH}`, expect.any(String));
  });

  // ---------------------------------------------------------------------------
  // Multi-day sync range tests
  // ---------------------------------------------------------------------------

  it("writes reminder with due date within range to its due-date note", async () => {
    vi.mocked(fetchReminders).mockResolvedValue([
      makeReminder({ id: "rem-future", title: "Future Task", dueDate: "2026-04-12T00:00:00.000Z" }),
    ]);

    // Range covers today + 3 future days (so April 12 is in range)
    const plugin = createMockPlugin({}, { syncRangePastDays: 0, syncRangeFutureDays: 3 });
    await syncReminders(plugin as never);

    const modifyCalls = vi.mocked(plugin.app.vault.modify).mock.calls;
    const writtenPaths = modifyCalls.map((call) => (call[0] as TFile).path);
    expect(writtenPaths).toContain("2026-04-12.md");

    const futureWrite = modifyCalls.find(
      (call) => (call[0] as TFile).path === "2026-04-12.md"
    )![1] as string;
    expect(futureWrite).toContain("Future Task");
  });

  it("writes reminder with due date outside range to today's note", async () => {
    vi.mocked(fetchReminders).mockResolvedValue([
      makeReminder({
        id: "rem-far",
        title: "Far Future Task",
        dueDate: "2026-04-20T00:00:00.000Z",
      }),
    ]);

    // Range only covers today (range 0/0), April 20 is outside
    const plugin = createMockPlugin({}, { syncRangePastDays: 0, syncRangeFutureDays: 0 });
    await syncReminders(plugin as never);

    const modifyCalls = vi.mocked(plugin.app.vault.modify).mock.calls;
    const writtenPaths = modifyCalls.map((call) => (call[0] as TFile).path);
    // Should be in today's note, not a future note
    expect(writtenPaths).toContain(NOTE_PATH);
    expect(writtenPaths).not.toContain("2026-04-20.md");

    const todayWrite = modifyCalls.find(
      (call) => (call[0] as TFile).path === NOTE_PATH
    )![1] as string;
    expect(todayWrite).toContain("Far Future Task");
  });

  it("writes reminders without due date to today's note even with wide range", async () => {
    vi.mocked(fetchReminders).mockResolvedValue([
      makeReminder({ id: "rem-nodue", title: "No Due Date Task", dueDate: null }),
    ]);

    const plugin = createMockPlugin({}, { syncRangePastDays: 7, syncRangeFutureDays: 14 });
    await syncReminders(plugin as never);

    const modifyCalls = vi.mocked(plugin.app.vault.modify).mock.calls;
    const todayWrite = modifyCalls.find(
      (call) => (call[0] as TFile).path === NOTE_PATH
    )?.[1] as string;
    expect(todayWrite).toContain("No Due Date Task");
  });

  it("skips creating notes for days with no reminders and no existing note", async () => {
    vi.mocked(fetchReminders).mockResolvedValue([
      makeReminder({ id: "rem-today", title: "Today Task", dueDate: null }),
    ]);

    const plugin = createMockPlugin({}, { syncRangePastDays: 1, syncRangeFutureDays: 1 });
    await syncReminders(plugin as never);

    const createCalls = vi.mocked(plugin.app.vault.create).mock.calls.map((c) => c[0]);
    expect(createCalls).not.toContain("2026-04-09.md");
    expect(createCalls).not.toContain("2026-04-11.md");
    expect(createCalls).toContain(NOTE_PATH);
  });

  describe("completed reminder archiving", () => {
    it("does not archive when setting is disabled", async () => {
      vi.mocked(fetchReminders).mockResolvedValue([
        makeReminder({ id: "rem-1", isCompleted: true, dueDate: `${FIXED_DATE}T12:00:00Z` }),
      ]);

      const plugin = createMockPlugin({}, { archiveCompletedReminders: false });
      await syncReminders(plugin as never);

      const files = plugin.app.vault._files;
      expect(files.has("Completed Reminders.md")).toBe(false);
      // Completed reminder stays in daily note
      const note = files.get(NOTE_PATH) ?? "";
      expect(note).toContain("[x]");
    });

    it("moves completed reminders to archive when enabled", async () => {
      vi.mocked(fetchReminders).mockResolvedValue([
        makeReminder({
          id: "rem-done",
          title: "Done task",
          isCompleted: true,
          dueDate: `${FIXED_DATE}T10:00:00Z`,
        }),
        makeReminder({
          id: "rem-open",
          title: "Open task",
          isCompleted: false,
          dueDate: `${FIXED_DATE}T14:00:00Z`,
        }),
      ]);

      const plugin = createMockPlugin({}, { archiveCompletedReminders: true });
      await syncReminders(plugin as never);

      const files = plugin.app.vault._files;

      // Archive file should contain the completed reminder
      const archive = files.get("Completed Reminders.md") ?? "";
      expect(archive).toContain("Done task");
      expect(archive).toContain("[rid:rem-done]");
      expect(archive).toContain(`## ${FIXED_DATE}`);

      // Daily note should only have the incomplete reminder
      const note = files.get(NOTE_PATH) ?? "";
      expect(note).toContain("Open task");
      expect(note).not.toContain("Done task");
    });

    it("uses custom archive file path from settings", async () => {
      vi.mocked(fetchReminders).mockResolvedValue([
        makeReminder({
          id: "rem-1",
          isCompleted: true,
          dueDate: `${FIXED_DATE}T10:00:00Z`,
        }),
      ]);

      const plugin = createMockPlugin(
        {},
        { archiveCompletedReminders: true, archiveFilePath: "Archive/Done.md" }
      );
      await syncReminders(plugin as never);

      const files = plugin.app.vault._files;
      expect(files.has("Archive/Done.md")).toBe(true);
      expect(files.has("Completed Reminders.md")).toBe(false);
    });

    it("preserves existing archive entries when archiving new ones", async () => {
      const existingArchive = [
        "# Completed Reminders",
        "",
        "## 2026-04-09",
        "",
        "- [x] Old task [rid:rem-old]",
        "",
      ].join("\n");

      vi.mocked(fetchReminders).mockResolvedValue([
        makeReminder({
          id: "rem-new",
          title: "New done",
          isCompleted: true,
          dueDate: `${FIXED_DATE}T10:00:00Z`,
        }),
      ]);

      const plugin = createMockPlugin(
        { "Completed Reminders.md": existingArchive },
        { archiveCompletedReminders: true }
      );
      await syncReminders(plugin as never);

      const files = plugin.app.vault._files;
      const archive = files.get("Completed Reminders.md") ?? "";
      expect(archive).toContain("Old task");
      expect(archive).toContain("New done");
      expect(archive).toContain("## 2026-04-09");
      expect(archive).toContain(`## ${FIXED_DATE}`);
    });
  });
});
