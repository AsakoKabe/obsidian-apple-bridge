import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { TFile, TFolder } from "../__mocks__/obsidian";

vi.mock("../contacts-bridge", () => ({
  fetchContacts: vi.fn(),
  fetchContactById: vi.fn(),
  listGroups: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
}));

import { fetchContacts } from "../contacts-bridge";
import { syncContacts } from "../contacts-sync";
import type { Contact } from "../contacts-bridge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "contact-1",
    firstName: "Alice",
    lastName: "Smith",
    nickname: "",
    organization: "",
    jobTitle: "",
    emails: [],
    phones: [],
    addresses: [],
    birthday: null,
    note: "",
    urls: [],
    socialProfiles: [],
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
      syncNotes: false,
      syncContacts: true,
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
  vi.mocked(fetchContacts).mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("syncContacts", () => {
  it("does nothing when syncContacts is disabled", async () => {
    const plugin = createMockPlugin({}, { syncContacts: false });
    await syncContacts(plugin as never);
    expect(fetchContacts).not.toHaveBeenCalled();
  });

  it("fetches all contacts from Apple Contacts", async () => {
    const plugin = createMockPlugin();
    await syncContacts(plugin as never);
    expect(fetchContacts).toHaveBeenCalledOnce();
  });

  it("imports a new contact as a vault note", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([makeContact()]);
    const plugin = createMockPlugin();
    await syncContacts(plugin as never);

    expect(plugin.app.vault.create).toHaveBeenCalled();
    const [path] = vi.mocked(plugin.app.vault.create).mock.calls[0];
    expect(path).toContain("Alice Smith.md");
    expect(path).toContain("People");
  });

  it("writes frontmatter with apple_contact_id", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([makeContact({ id: "contact-abc" })]);
    const plugin = createMockPlugin();
    await syncContacts(plugin as never);

    const content = vi.mocked(plugin.app.vault.create).mock.calls[0][1] as string;
    expect(content).toContain('apple_contact_id: "contact-abc"');
  });

  it("writes frontmatter with modification date", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([
      makeContact({ modificationDate: "2026-04-10T09:00:00.000Z" }),
    ]);
    const plugin = createMockPlugin();
    await syncContacts(plugin as never);

    const content = vi.mocked(plugin.app.vault.create).mock.calls[0][1] as string;
    expect(content).toContain("modified: 2026-04-10T09:00:00.000Z");
  });

  it("includes email addresses in frontmatter", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([
      makeContact({
        emails: [{ label: "work", value: "alice@example.com" }],
      }),
    ]);
    const plugin = createMockPlugin();
    await syncContacts(plugin as never);

    const content = vi.mocked(plugin.app.vault.create).mock.calls[0][1] as string;
    expect(content).toContain("alice@example.com");
  });

  it("includes phone numbers in frontmatter", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([
      makeContact({
        phones: [{ label: "mobile", value: "+1-555-0100" }],
      }),
    ]);
    const plugin = createMockPlugin();
    await syncContacts(plugin as never);

    const content = vi.mocked(plugin.app.vault.create).mock.calls[0][1] as string;
    expect(content).toContain("+1-555-0100");
  });

  it("includes birthday in frontmatter when present", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([
      makeContact({ birthday: "1990-03-15T00:00:00.000Z" }),
    ]);
    const plugin = createMockPlugin();
    await syncContacts(plugin as never);

    const content = vi.mocked(plugin.app.vault.create).mock.calls[0][1] as string;
    expect(content).toContain("birthday: 1990-03-15");
  });

  it("writes contact body with heading from name", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([
      makeContact({ firstName: "Bob", lastName: "Jones" }),
    ]);
    const plugin = createMockPlugin();
    await syncContacts(plugin as never);

    const content = vi.mocked(plugin.app.vault.create).mock.calls[0][1] as string;
    expect(content).toContain("# Bob Jones");
  });

  it("uses organization as display name when no personal name", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([
      makeContact({ firstName: "", lastName: "", organization: "Acme Corp" }),
    ]);
    const plugin = createMockPlugin();
    await syncContacts(plugin as never);

    const [path] = vi.mocked(plugin.app.vault.create).mock.calls[0];
    expect(path).toContain("Acme Corp.md");
  });

  it("uses nickname when no personal name or organization", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([
      makeContact({ firstName: "", lastName: "", organization: "", nickname: "Doc" }),
    ]);
    const plugin = createMockPlugin();
    await syncContacts(plugin as never);

    const [path] = vi.mocked(plugin.app.vault.create).mock.calls[0];
    expect(path).toContain("Doc.md");
  });

  it("uses 'Unknown Contact' when no identifying info", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([
      makeContact({ firstName: "", lastName: "", organization: "", nickname: "" }),
    ]);
    const plugin = createMockPlugin();
    await syncContacts(plugin as never);

    const [path] = vi.mocked(plugin.app.vault.create).mock.calls[0];
    expect(path).toContain("Unknown Contact.md");
  });

  it("skips contact that has not changed since last sync", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([
      makeContact({ modificationDate: "2026-04-10T09:00:00.000Z" }),
    ]);

    const prevState = {
      "contacts-sync-state": {
        contacts: {
          "contact-1": {
            appleId: "contact-1",
            firstName: "Alice",
            lastName: "Smith",
            modificationDate: "2026-04-10T09:00:00.000Z",
            vaultPath: "People/Alice Smith.md",
            lastSyncedAt: "2026-04-10T08:00:00.000Z",
          },
        },
      },
    };

    const plugin = createMockPlugin({}, {}, prevState);
    await syncContacts(plugin as never);

    expect(plugin.app.vault.create).not.toHaveBeenCalled();
    expect(plugin.app.vault.modify).not.toHaveBeenCalled();
  });

  it("updates contact when modification date changed", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([
      makeContact({ modificationDate: "2026-04-10T14:00:00.000Z" }),
    ]);

    const vaultPath = "People/Alice Smith.md";
    const prevState = {
      "contacts-sync-state": {
        contacts: {
          "contact-1": {
            appleId: "contact-1",
            firstName: "Alice",
            lastName: "Smith",
            modificationDate: "2026-04-10T09:00:00.000Z",
            vaultPath,
            lastSyncedAt: "2026-04-10T08:00:00.000Z",
          },
        },
      },
    };

    const plugin = createMockPlugin({ [vaultPath]: "old content" }, {}, prevState);
    await syncContacts(plugin as never);

    expect(plugin.app.vault.modify).toHaveBeenCalled();
  });

  it("removes old file when contact is renamed", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([
      makeContact({ firstName: "Alicia", lastName: "Smith" }),
    ]);

    const oldPath = "People/Alice Smith.md";
    const prevState = {
      "contacts-sync-state": {
        contacts: {
          "contact-1": {
            appleId: "contact-1",
            firstName: "Alice",
            lastName: "Smith",
            modificationDate: "2026-04-08T09:00:00.000Z",
            vaultPath: oldPath,
            lastSyncedAt: "2026-04-08T08:00:00.000Z",
          },
        },
      },
    };

    const plugin = createMockPlugin({ [oldPath]: "old content" }, {}, prevState);
    await syncContacts(plugin as never);

    expect(plugin.app.vault.delete).toHaveBeenCalled();
    const deletedFile = vi.mocked(plugin.app.vault.delete).mock.calls[0][0] as TFile;
    expect(deletedFile.path).toBe(oldPath);
  });

  it("removes vault file when Apple contact is deleted", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([]);

    const vaultPath = "People/Bob Jones.md";
    const prevState = {
      "contacts-sync-state": {
        contacts: {
          "contact-gone": {
            appleId: "contact-gone",
            firstName: "Bob",
            lastName: "Jones",
            modificationDate: "2026-04-01T09:00:00.000Z",
            vaultPath,
            lastSyncedAt: "2026-04-01T08:00:00.000Z",
          },
        },
      },
    };

    const plugin = createMockPlugin({ [vaultPath]: "stale content" }, {}, prevState);
    await syncContacts(plugin as never);

    expect(plugin.app.vault.delete).toHaveBeenCalled();
    const deletedFile = vi.mocked(plugin.app.vault.delete).mock.calls[0][0] as TFile;
    expect(deletedFile.path).toBe(vaultPath);
  });

  it("saves sync state after processing", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([makeContact()]);
    const plugin = createMockPlugin();
    await syncContacts(plugin as never);

    expect(plugin.saveData).toHaveBeenCalled();
    const saved = vi.mocked(plugin.saveData).mock.calls[0][0] as Record<string, unknown>;
    expect(saved).toHaveProperty("contacts-sync-state");
  });

  it("sanitizes contact name for safe file names", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([
      makeContact({ firstName: 'Alice "Q"', lastName: "Smith/Jr" }),
    ]);
    const plugin = createMockPlugin();
    await syncContacts(plugin as never);

    const [path] = vi.mocked(plugin.app.vault.create).mock.calls[0];
    expect(path).not.toContain('"');
    expect(path).not.toContain("/People/");
  });

  it("uses custom contactsFolder from settings", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([makeContact()]);
    const plugin = createMockPlugin({}, { contactsFolder: "Contacts" });
    await syncContacts(plugin as never);

    const [path] = vi.mocked(plugin.app.vault.create).mock.calls[0];
    expect(path).toMatch(/^Contacts\//);
  });

  it("writes organization and job title in body", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([
      makeContact({ jobTitle: "Engineer", organization: "Tech Corp" }),
    ]);
    const plugin = createMockPlugin();
    await syncContacts(plugin as never);

    const content = vi.mocked(plugin.app.vault.create).mock.calls[0][1] as string;
    expect(content).toContain("Engineer at Tech Corp");
  });

  it("writes addresses in body", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([
      makeContact({
        addresses: [
          { label: "home", street: "123 Main St", city: "Springfield", state: "IL", postalCode: "62701", country: "US" },
        ],
      }),
    ]);
    const plugin = createMockPlugin();
    await syncContacts(plugin as never);

    const content = vi.mocked(plugin.app.vault.create).mock.calls[0][1] as string;
    expect(content).toContain("## Addresses");
    expect(content).toContain("123 Main St");
  });

  it("writes note text in body", async () => {
    vi.mocked(fetchContacts).mockResolvedValue([
      makeContact({ note: "Met at conference 2025" }),
    ]);
    const plugin = createMockPlugin();
    await syncContacts(plugin as never);

    const content = vi.mocked(plugin.app.vault.create).mock.calls[0][1] as string;
    expect(content).toContain("## Notes");
    expect(content).toContain("Met at conference 2025");
  });
});
