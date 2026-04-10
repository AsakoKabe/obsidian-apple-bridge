import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveArchivePath,
  parseArchiveNote,
  buildArchiveContent,
  insertIntoArchive,
  archiveCompletedReminders,
} from "../reminder-archive";
import { TFile, Vault } from "obsidian";

describe("resolveArchivePath", () => {
  it("joins folder and filename", () => {
    expect(resolveArchivePath("Reminders", "Completed Reminders.md")).toBe(
      "Reminders/Completed Reminders.md"
    );
  });

  it("returns filename alone when folder is empty", () => {
    expect(resolveArchivePath("", "Completed Reminders.md")).toBe("Completed Reminders.md");
  });

  it("uses path as-is when it contains a separator", () => {
    expect(resolveArchivePath("Reminders", "Archive/Done.md")).toBe("Archive/Done.md");
  });
});

describe("parseArchiveNote", () => {
  it("returns empty map for empty string", () => {
    expect(parseArchiveNote("")).toEqual(new Map());
  });

  it("returns empty map for content with no date headings", () => {
    const content = "# Completed Reminders\n\nSome text\n";
    expect(parseArchiveNote(content)).toEqual(new Map());
  });

  it("parses a single date group", () => {
    const content = [
      "# Completed Reminders",
      "",
      "## 2026-04-10",
      "",
      "- [x] Buy milk [rid:R1]",
      "- [x] Call dentist [rid:R2]",
      "",
    ].join("\n");

    const result = parseArchiveNote(content);
    expect(result.size).toBe(1);
    expect(result.get("2026-04-10")).toEqual([
      "- [x] Buy milk [rid:R1]",
      "- [x] Call dentist [rid:R2]",
    ]);
  });

  it("parses multiple date groups", () => {
    const content = [
      "# Completed Reminders",
      "",
      "## 2026-04-10",
      "",
      "- [x] Task A [rid:R1]",
      "",
      "## 2026-04-09",
      "",
      "- [x] Task B [rid:R2]",
      "- [x] Task C [rid:R3]",
      "",
    ].join("\n");

    const result = parseArchiveNote(content);
    expect(result.size).toBe(2);
    expect(result.get("2026-04-10")).toEqual(["- [x] Task A [rid:R1]"]);
    expect(result.get("2026-04-09")).toEqual(["- [x] Task B [rid:R2]", "- [x] Task C [rid:R3]"]);
  });

  it("ignores non-date headings", () => {
    const content = [
      "# Completed Reminders",
      "",
      "## Notes",
      "",
      "Some notes here",
      "",
      "## 2026-04-10",
      "",
      "- [x] Task A [rid:R1]",
      "",
    ].join("\n");

    const result = parseArchiveNote(content);
    expect(result.size).toBe(1);
    expect(result.get("2026-04-10")).toEqual(["- [x] Task A [rid:R1]"]);
  });
});

describe("buildArchiveContent", () => {
  it("produces title only for empty map", () => {
    expect(buildArchiveContent(new Map())).toBe("# Completed Reminders\n");
  });

  it("sorts dates newest first", () => {
    const groups = new Map([
      ["2026-04-08", ["- [x] Old [rid:R1]"]],
      ["2026-04-10", ["- [x] New [rid:R2]"]],
      ["2026-04-09", ["- [x] Middle [rid:R3]"]],
    ]);

    const result = buildArchiveContent(groups);
    const lines = result.split("\n");
    const headings = lines.filter((l) => l.startsWith("## "));
    expect(headings).toEqual(["## 2026-04-10", "## 2026-04-09", "## 2026-04-08"]);
  });

  it("preserves lines within each group", () => {
    const groups = new Map([["2026-04-10", ["- [x] Task A [rid:R1]", "- [x] Task B [rid:R2]"]]]);

    const result = buildArchiveContent(groups);
    expect(result).toContain("- [x] Task A [rid:R1]");
    expect(result).toContain("- [x] Task B [rid:R2]");
  });
});

describe("insertIntoArchive", () => {
  it("inserts into empty file", () => {
    const result = insertIntoArchive("", "2026-04-10", ["- [x] Task A [rid:R1]"]);
    expect(result).toContain("# Completed Reminders");
    expect(result).toContain("## 2026-04-10");
    expect(result).toContain("- [x] Task A [rid:R1]");
  });

  it("appends to existing date group", () => {
    const existing = [
      "# Completed Reminders",
      "",
      "## 2026-04-10",
      "",
      "- [x] Task A [rid:R1]",
      "",
    ].join("\n");

    const result = insertIntoArchive(existing, "2026-04-10", ["- [x] Task B [rid:R2]"]);
    const parsed = parseArchiveNote(result);
    expect(parsed.get("2026-04-10")).toEqual(["- [x] Task A [rid:R1]", "- [x] Task B [rid:R2]"]);
  });

  it("creates new date group", () => {
    const existing = [
      "# Completed Reminders",
      "",
      "## 2026-04-09",
      "",
      "- [x] Task A [rid:R1]",
      "",
    ].join("\n");

    const result = insertIntoArchive(existing, "2026-04-10", ["- [x] Task B [rid:R2]"]);
    const parsed = parseArchiveNote(result);
    expect(parsed.size).toBe(2);
    expect(parsed.get("2026-04-10")).toEqual(["- [x] Task B [rid:R2]"]);

    // Newest first
    const lines = result.split("\n");
    const headings = lines.filter((l) => l.startsWith("## "));
    expect(headings).toEqual(["## 2026-04-10", "## 2026-04-09"]);
  });

  it("deduplicates by rid", () => {
    const existing = [
      "# Completed Reminders",
      "",
      "## 2026-04-10",
      "",
      "- [x] Task A [rid:R1]",
      "",
    ].join("\n");

    const result = insertIntoArchive(existing, "2026-04-10", [
      "- [x] Task A (updated) [rid:R1]",
      "- [x] Task B [rid:R2]",
    ]);

    const parsed = parseArchiveNote(result);
    const lines = parsed.get("2026-04-10")!;
    expect(lines).toHaveLength(2);
    // Existing entry kept, not replaced
    expect(lines[0]).toBe("- [x] Task A [rid:R1]");
    expect(lines[1]).toBe("- [x] Task B [rid:R2]");
  });
});

describe("archiveCompletedReminders", () => {
  let mockVault: {
    getAbstractFileByPath: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    modify: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    createFolder: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockVault = {
      getAbstractFileByPath: vi.fn(),
      read: vi.fn(),
      modify: vi.fn(),
      create: vi.fn(),
      createFolder: vi.fn(),
    };
  });

  it("creates a new archive file if none exists", async () => {
    mockVault.getAbstractFileByPath.mockReturnValue(null);
    const createdFile = new TFile("Completed Reminders.md");
    mockVault.create.mockResolvedValue(createdFile);

    await archiveCompletedReminders(
      mockVault as unknown as Vault,
      "Completed Reminders.md",
      "2026-04-10",
      ["- [x] Buy milk [rid:R1]"]
    );

    expect(mockVault.create).toHaveBeenCalledWith(
      "Completed Reminders.md",
      expect.stringContaining("- [x] Buy milk [rid:R1]")
    );
  });

  it("appends to existing archive file", async () => {
    const existingFile = new TFile("Completed Reminders.md");
    mockVault.getAbstractFileByPath.mockReturnValue(existingFile);
    mockVault.read.mockResolvedValue(
      "# Completed Reminders\n\n## 2026-04-09\n\n- [x] Old task [rid:R0]\n"
    );

    await archiveCompletedReminders(
      mockVault as unknown as Vault,
      "Completed Reminders.md",
      "2026-04-10",
      ["- [x] New task [rid:R1]"]
    );

    expect(mockVault.modify).toHaveBeenCalled();
    const writtenContent = mockVault.modify.mock.calls[0][1] as string;
    expect(writtenContent).toContain("## 2026-04-10");
    expect(writtenContent).toContain("- [x] New task [rid:R1]");
    expect(writtenContent).toContain("- [x] Old task [rid:R0]");
  });

  it("creates parent folders for nested archive path", async () => {
    mockVault.getAbstractFileByPath.mockReturnValue(null);
    const createdFile = new TFile("Reminders/Archive/Done.md");
    mockVault.create.mockResolvedValue(createdFile);

    await archiveCompletedReminders(
      mockVault as unknown as Vault,
      "Reminders/Archive/Done.md",
      "2026-04-10",
      ["- [x] Task [rid:R1]"]
    );

    // Should have ensured parent folders
    expect(mockVault.getAbstractFileByPath).toHaveBeenCalled();
    expect(mockVault.create).toHaveBeenCalled();
  });
});
