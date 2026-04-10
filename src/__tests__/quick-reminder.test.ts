import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { TFile, TFolder } from "../__mocks__/obsidian";

vi.mock("../reminders-bridge", () => ({
  createReminder: vi.fn(),
  fetchReminders: vi.fn(),
  listReminderLists: vi.fn(),
  updateReminder: vi.fn(),
  deleteReminder: vi.fn(),
}));

import { createReminder } from "../reminders-bridge";
import { createQuickReminder } from "../quick-reminder";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      syncReminders: true,
      defaultReminderList: "Reminders",
      remindersFolder: "",
      ...settingsOverrides,
    },
    app: { vault },
    loadData: vi.fn(async () => pluginData),
    saveData: vi.fn(async (d: Record<string, unknown>) => {
      pluginData = d;
    }),
  };
}

function createMockEditor(selection: string) {
  return {
    getSelection: vi.fn(() => selection),
    replaceSelection: vi.fn(),
    getCursor: vi.fn(() => ({ line: 0, ch: 0 })),
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
  vi.mocked(createReminder).mockResolvedValue("quick-rem-1");
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("createQuickReminder", () => {
  it("creates a reminder from selected text", async () => {
    const plugin = createMockPlugin();
    const editor = createMockEditor("Buy milk");

    await createQuickReminder(plugin as any, editor as any);

    expect(createReminder).toHaveBeenCalledWith("Reminders", "Buy milk", {
      dueDate: expect.any(Date),
    });
  });

  it("shows notice when no text is selected", async () => {
    const plugin = createMockPlugin();
    const editor = createMockEditor("");

    await createQuickReminder(plugin as any, editor as any);

    expect(createReminder).not.toHaveBeenCalled();
  });

  it("shows notice when selection is only whitespace", async () => {
    const plugin = createMockPlugin();
    const editor = createMockEditor("   \n  ");

    await createQuickReminder(plugin as any, editor as any);

    expect(createReminder).not.toHaveBeenCalled();
  });

  it("uses first line of multi-line selection as title", async () => {
    const plugin = createMockPlugin();
    const editor = createMockEditor("First line\nSecond line\nThird line");

    await createQuickReminder(plugin as any, editor as any);

    expect(createReminder).toHaveBeenCalledWith("Reminders", "First line", {
      dueDate: expect.any(Date),
    });
  });

  it("uses configured default reminder list", async () => {
    const plugin = createMockPlugin({}, { defaultReminderList: "Shopping" });
    const editor = createMockEditor("Get groceries");

    await createQuickReminder(plugin as any, editor as any);

    expect(createReminder).toHaveBeenCalledWith("Shopping", "Get groceries", {
      dueDate: expect.any(Date),
    });
  });

  it("falls back to 'Reminders' when default list is empty", async () => {
    const plugin = createMockPlugin({}, { defaultReminderList: "" });
    const editor = createMockEditor("Do something");

    await createQuickReminder(plugin as any, editor as any);

    expect(createReminder).toHaveBeenCalledWith("Reminders", "Do something", {
      dueDate: expect.any(Date),
    });
  });

  it("writes reminder to daily note with Reminders section", async () => {
    const plugin = createMockPlugin({
      [NOTE_PATH]: `# ${FIXED_DATE}\n\n## Reminders\n\n- [ ] Existing task [rid:old-1]\n`,
    });
    const editor = createMockEditor("New task");

    await createQuickReminder(plugin as any, editor as any);

    const vault = plugin.app.vault;
    expect(vault.modify).toHaveBeenCalled();
    const written = vault._files.get(NOTE_PATH)!;
    expect(written).toContain("[rid:quick-rem-1]");
    expect(written).toContain("New task");
    expect(written).toContain("Existing task");
  });

  it("creates Reminders section if not present", async () => {
    const plugin = createMockPlugin({
      [NOTE_PATH]: `# ${FIXED_DATE}\n\nSome notes.\n`,
    });
    const editor = createMockEditor("Add this");

    await createQuickReminder(plugin as any, editor as any);

    const written = plugin.app.vault._files.get(NOTE_PATH)!;
    expect(written).toContain("## Reminders");
    expect(written).toContain("[rid:quick-rem-1]");
  });

  it("creates daily note if it does not exist", async () => {
    const plugin = createMockPlugin();
    const editor = createMockEditor("A new task");

    await createQuickReminder(plugin as any, editor as any);

    expect(plugin.app.vault.create).toHaveBeenCalled();
    const written = plugin.app.vault._files.get(NOTE_PATH)!;
    expect(written).toContain("## Reminders");
    expect(written).toContain("A new task");
  });

  it("saves sync state for the new reminder", async () => {
    const plugin = createMockPlugin();
    const editor = createMockEditor("Track this");

    await createQuickReminder(plugin as any, editor as any);

    expect(plugin.saveData).toHaveBeenCalled();
    const saved = (plugin.saveData as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const syncState = saved["reminders-sync-state"];
    expect(syncState.reminders["quick-rem-1"]).toMatchObject({
      appleId: "quick-rem-1",
      title: "Track this",
      isCompleted: false,
    });
  });

  it("preserves existing sync state when saving", async () => {
    const plugin = createMockPlugin(
      {},
      {},
      {
        "reminders-sync-state": {
          reminders: {
            "existing-1": {
              appleId: "existing-1",
              title: "Old reminder",
              isCompleted: false,
              dueDate: null,
              notes: "",
              lastSyncedAt: "2026-04-09T00:00:00.000Z",
            },
          },
        },
      }
    );
    const editor = createMockEditor("New one");

    await createQuickReminder(plugin as any, editor as any);

    const saved = (plugin.saveData as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const syncState = saved["reminders-sync-state"];
    expect(syncState.reminders["existing-1"]).toBeDefined();
    expect(syncState.reminders["quick-rem-1"]).toBeDefined();
  });

  it("writes reminder to configured folder", async () => {
    const folderNotePath = "MyReminders/2026-04-10.md";
    const plugin = createMockPlugin(
      { [folderNotePath]: `# ${FIXED_DATE}\n\n` },
      { remindersFolder: "MyReminders" }
    );
    const editor = createMockEditor("Folder task");

    await createQuickReminder(plugin as any, editor as any);

    const written = plugin.app.vault._files.get(folderNotePath)!;
    expect(written).toContain("Folder task");
    expect(written).toContain("[rid:quick-rem-1]");
  });

  it("handles bridge error gracefully", async () => {
    vi.mocked(createReminder).mockRejectedValue(new Error("JXA error: access denied"));
    const plugin = createMockPlugin();
    const editor = createMockEditor("Will fail");

    // Should not throw
    await createQuickReminder(plugin as any, editor as any);

    expect(plugin.app.vault.modify).not.toHaveBeenCalled();
    expect(plugin.saveData).not.toHaveBeenCalled();
  });

  it("trims selected text before using as title", async () => {
    const plugin = createMockPlugin();
    const editor = createMockEditor("  padded text  ");

    await createQuickReminder(plugin as any, editor as any);

    expect(createReminder).toHaveBeenCalledWith("Reminders", "padded text", {
      dueDate: expect.any(Date),
    });
  });

  it("includes date emoji and rid tag in the reminder line", async () => {
    const plugin = createMockPlugin({
      [NOTE_PATH]: `# ${FIXED_DATE}\n\n## Reminders\n\n`,
    });
    const editor = createMockEditor("Check format");

    await createQuickReminder(plugin as any, editor as any);

    const written = plugin.app.vault._files.get(NOTE_PATH)!;
    expect(written).toContain(`- [ ] Check format \uD83D\uDCC5 ${FIXED_DATE} [rid:quick-rem-1]`);
  });
});
