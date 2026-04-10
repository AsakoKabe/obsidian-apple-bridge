import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { TFile, TFolder } from "../__mocks__/obsidian";

vi.mock("../notes-bridge", () => ({
  fetchNotes: vi.fn(),
  fetchNoteById: vi.fn(),
  listNoteFolders: vi.fn(),
  htmlToMarkdown: vi.fn((html: string) => html.replace(/<[^>]+>/g, "")),
}));

import { fetchNotes, htmlToMarkdown } from "../notes-bridge";
import { syncNotes } from "../notes-sync";
import type { AppleNote } from "../notes-bridge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNote(overrides: Partial<AppleNote> = {}): AppleNote {
  return {
    id: "note-1",
    title: "My Note",
    body: "<p>Hello world</p>",
    folderName: "Notes",
    folderPath: "Notes",
    creationDate: "2026-04-01T10:00:00.000Z",
    modificationDate: "2026-04-10T09:00:00.000Z",
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
    delete: vi.fn(async (file: TFile) => {
      files.delete(file.path);
    }),
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
      syncReminders: false,
      syncNotes: true,
      syncContacts: false,
      syncIntervalMinutes: 15,
      defaultCalendarName: "Calendar",
      defaultReminderList: "Reminders",
      conflictResolution: "remote-wins",
      calendarFolder: "",
      remindersFolder: "",
      notesFolder: "Apple Notes",
      contactsFolder: "People",
      ...settingsOverrides,
    },
    app: { vault },
    loadData: vi.fn(async () => pluginData),
    saveData: vi.fn(async (d: Record<string, unknown>) => {
      pluginData = d;
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(fetchNotes).mockResolvedValue([]);
  vi.mocked(htmlToMarkdown).mockImplementation((html: string) => html.replace(/<[^>]+>/g, ""));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("syncNotes", () => {
  it("does nothing when syncNotes is disabled", async () => {
    const plugin = createMockPlugin({}, { syncNotes: false });
    await syncNotes(plugin as never);
    expect(fetchNotes).not.toHaveBeenCalled();
  });

  it("fetches all notes from Apple Notes", async () => {
    const plugin = createMockPlugin();
    await syncNotes(plugin as never);
    expect(fetchNotes).toHaveBeenCalledOnce();
  });

  it("imports a new note to vault", async () => {
    vi.mocked(fetchNotes).mockResolvedValue([makeNote()]);
    const plugin = createMockPlugin();
    await syncNotes(plugin as never);

    expect(plugin.app.vault.create).toHaveBeenCalled();
    const [path] = vi.mocked(plugin.app.vault.create).mock.calls[0];
    expect(path).toContain("My Note.md");
    expect(path).toContain("Apple Notes");
  });

  it("writes frontmatter with apple_note_id", async () => {
    vi.mocked(fetchNotes).mockResolvedValue([makeNote({ id: "note-abc" })]);
    const plugin = createMockPlugin();
    await syncNotes(plugin as never);

    const content = vi.mocked(plugin.app.vault.create).mock.calls[0][1] as string;
    expect(content).toContain('apple_note_id: "note-abc"');
  });

  it("writes frontmatter with creation and modification dates", async () => {
    vi.mocked(fetchNotes).mockResolvedValue([
      makeNote({
        creationDate: "2026-01-01T10:00:00.000Z",
        modificationDate: "2026-04-10T09:00:00.000Z",
      }),
    ]);
    const plugin = createMockPlugin();
    await syncNotes(plugin as never);

    const content = vi.mocked(plugin.app.vault.create).mock.calls[0][1] as string;
    expect(content).toContain("created: 2026-01-01T10:00:00.000Z");
    expect(content).toContain("modified: 2026-04-10T09:00:00.000Z");
  });

  it("converts HTML body using htmlToMarkdown", async () => {
    vi.mocked(fetchNotes).mockResolvedValue([makeNote({ body: "<p>converted</p>" })]);
    const plugin = createMockPlugin();
    await syncNotes(plugin as never);

    expect(htmlToMarkdown).toHaveBeenCalledWith("<p>converted</p>");
  });

  it("skips note that has not changed since last sync", async () => {
    const note = makeNote({ modificationDate: "2026-04-10T09:00:00.000Z" });
    vi.mocked(fetchNotes).mockResolvedValue([note]);

    const prevState = {
      "notes-sync-state": {
        notes: {
          "note-1": {
            appleId: "note-1",
            title: "My Note",
            folderPath: "Notes",
            modificationDate: "2026-04-10T09:00:00.000Z",
            vaultPath: "Apple Notes/Notes/My Note.md",
            lastSyncedAt: "2026-04-10T08:00:00.000Z",
          },
        },
      },
    };

    const plugin = createMockPlugin({}, {}, prevState);
    await syncNotes(plugin as never);

    // Note is unchanged → no write
    expect(plugin.app.vault.create).not.toHaveBeenCalled();
    expect(plugin.app.vault.modify).not.toHaveBeenCalled();
  });

  it("updates existing note when modification date changed", async () => {
    const note = makeNote({ modificationDate: "2026-04-10T12:00:00.000Z" });
    vi.mocked(fetchNotes).mockResolvedValue([note]);

    const vaultPath = "Apple Notes/Notes/My Note.md";
    const prevState = {
      "notes-sync-state": {
        notes: {
          "note-1": {
            appleId: "note-1",
            title: "My Note",
            folderPath: "Notes",
            modificationDate: "2026-04-10T09:00:00.000Z", // older date
            vaultPath,
            lastSyncedAt: "2026-04-10T08:00:00.000Z",
          },
        },
      },
    };

    const plugin = createMockPlugin({ [vaultPath]: "old content" }, {}, prevState);
    await syncNotes(plugin as never);

    // File exists → vault.modify should be called
    expect(plugin.app.vault.modify).toHaveBeenCalled();
  });

  it("removes old vault file when note is renamed", async () => {
    const note = makeNote({ title: "New Title" });
    vi.mocked(fetchNotes).mockResolvedValue([note]);

    const oldPath = "Apple Notes/Notes/My Note.md";
    const prevState = {
      "notes-sync-state": {
        notes: {
          "note-1": {
            appleId: "note-1",
            title: "My Note",
            folderPath: "Notes",
            modificationDate: "2026-04-08T09:00:00.000Z",
            vaultPath: oldPath,
            lastSyncedAt: "2026-04-08T08:00:00.000Z",
          },
        },
      },
    };

    const plugin = createMockPlugin({ [oldPath]: "old content" }, {}, prevState);
    await syncNotes(plugin as never);

    // Old file should be deleted
    expect(plugin.app.vault.delete).toHaveBeenCalled();
    const deletedFile = vi.mocked(plugin.app.vault.delete).mock.calls[0][0] as TFile;
    expect(deletedFile.path).toBe(oldPath);
  });

  it("removes vault file when Apple note is deleted", async () => {
    // Apple returns no notes (empty)
    vi.mocked(fetchNotes).mockResolvedValue([]);

    const vaultPath = "Apple Notes/Notes/Deleted Note.md";
    const prevState = {
      "notes-sync-state": {
        notes: {
          "note-deleted": {
            appleId: "note-deleted",
            title: "Deleted Note",
            folderPath: "Notes",
            modificationDate: "2026-04-01T09:00:00.000Z",
            vaultPath,
            lastSyncedAt: "2026-04-01T08:00:00.000Z",
          },
        },
      },
    };

    const plugin = createMockPlugin({ [vaultPath]: "stale content" }, {}, prevState);
    await syncNotes(plugin as never);

    expect(plugin.app.vault.delete).toHaveBeenCalled();
    const deletedFile = vi.mocked(plugin.app.vault.delete).mock.calls[0][0] as TFile;
    expect(deletedFile.path).toBe(vaultPath);
  });

  it("saves sync state after processing", async () => {
    vi.mocked(fetchNotes).mockResolvedValue([makeNote()]);
    const plugin = createMockPlugin();
    await syncNotes(plugin as never);

    expect(plugin.saveData).toHaveBeenCalled();
    const saved = vi.mocked(plugin.saveData).mock.calls[0][0] as Record<string, unknown>;
    expect(saved).toHaveProperty("notes-sync-state");
  });

  it("sanitizes note title to create safe file names", async () => {
    vi.mocked(fetchNotes).mockResolvedValue([makeNote({ title: "Note: With / Special * Chars" })]);
    const plugin = createMockPlugin();
    await syncNotes(plugin as never);

    const [path] = vi.mocked(plugin.app.vault.create).mock.calls[0];
    // Path should not contain the raw special characters
    expect(path).not.toContain(":");
    expect(path).not.toContain("*");
    expect(path).not.toContain('"');
  });

  it("creates folder hierarchy based on notesFolder setting", async () => {
    vi.mocked(fetchNotes).mockResolvedValue([makeNote({ folderPath: "Work/Projects" })]);
    const plugin = createMockPlugin({}, { notesFolder: "MyNotes" });
    await syncNotes(plugin as never);

    const [path] = vi.mocked(plugin.app.vault.create).mock.calls[0];
    expect(path).toMatch(/^MyNotes\//);
  });

  it("uses default 'Apple Notes' folder when notesFolder not set", async () => {
    vi.mocked(fetchNotes).mockResolvedValue([makeNote()]);
    const plugin = createMockPlugin({}, { notesFolder: "" });
    await syncNotes(plugin as never);

    const [path] = vi.mocked(plugin.app.vault.create).mock.calls[0];
    expect(path).toMatch(/^Apple Notes\//);
  });
});
