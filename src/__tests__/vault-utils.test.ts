import { describe, it, expect, vi, beforeEach } from "vitest";
import { TFile, TFolder, Vault } from "obsidian";
import {
  dailyNotePath,
  toDateKey,
  addDays,
  startOfDay,
  endOfDay,
  buildDateRange,
  ensureFolder,
  ensureDailyNote,
  sanitizeFileName,
} from "../vault-utils";

describe("dailyNotePath", () => {
  it("returns YYYY-MM-DD.md in the given folder", () => {
    const date = new Date(2026, 3, 10); // April 10
    expect(dailyNotePath(date, "Calendar")).toBe("Calendar/2026-04-10.md");
  });

  it("returns just the filename when folder is empty", () => {
    const date = new Date(2026, 0, 5); // Jan 5
    expect(dailyNotePath(date, "")).toBe("2026-01-05.md");
  });

  it("zero-pads single-digit months and days", () => {
    const date = new Date(2026, 0, 1); // Jan 1
    expect(dailyNotePath(date, "Notes")).toBe("Notes/2026-01-01.md");
  });
});

describe("toDateKey", () => {
  it("returns YYYY-MM-DD string", () => {
    expect(toDateKey(new Date(2026, 11, 25))).toBe("2026-12-25");
  });

  it("zero-pads correctly", () => {
    expect(toDateKey(new Date(2026, 0, 3))).toBe("2026-01-03");
  });
});

describe("addDays", () => {
  it("adds positive days", () => {
    const base = new Date(2026, 3, 10);
    const result = addDays(base, 3);
    expect(result.getDate()).toBe(13);
  });

  it("subtracts with negative days", () => {
    const base = new Date(2026, 3, 10);
    const result = addDays(base, -5);
    expect(result.getDate()).toBe(5);
  });

  it("does not mutate the original date", () => {
    const base = new Date(2026, 3, 10);
    addDays(base, 5);
    expect(base.getDate()).toBe(10);
  });
});

describe("startOfDay", () => {
  it("sets time to midnight", () => {
    const date = new Date(2026, 3, 10, 14, 30, 45, 123);
    const result = startOfDay(date);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it("does not mutate the original date", () => {
    const date = new Date(2026, 3, 10, 14, 30);
    startOfDay(date);
    expect(date.getHours()).toBe(14);
  });
});

describe("endOfDay", () => {
  it("sets time to 23:59:59.999", () => {
    const date = new Date(2026, 3, 10, 8, 0, 0, 0);
    const result = endOfDay(date);
    expect(result.getHours()).toBe(23);
    expect(result.getMinutes()).toBe(59);
    expect(result.getSeconds()).toBe(59);
    expect(result.getMilliseconds()).toBe(999);
  });

  it("does not mutate the original date", () => {
    const date = new Date(2026, 3, 10, 8, 0);
    endOfDay(date);
    expect(date.getHours()).toBe(8);
  });
});

describe("buildDateRange", () => {
  it("builds a range from pastDays before to futureDays after today", () => {
    const today = new Date(2026, 3, 10, 14, 30);
    const range = buildDateRange(today, 2, 3);
    expect(range).toHaveLength(6); // -2, -1, 0, +1, +2, +3
    expect(toDateKey(range[0])).toBe("2026-04-08");
    expect(toDateKey(range[range.length - 1])).toBe("2026-04-13");
  });

  it("returns a single date when pastDays and futureDays are 0", () => {
    const today = new Date(2026, 3, 10);
    const range = buildDateRange(today, 0, 0);
    expect(range).toHaveLength(1);
    expect(toDateKey(range[0])).toBe("2026-04-10");
  });

  it("all dates are at midnight", () => {
    const range = buildDateRange(new Date(2026, 3, 10, 15, 45), 1, 1);
    for (const d of range) {
      expect(d.getHours()).toBe(0);
      expect(d.getMinutes()).toBe(0);
    }
  });
});

describe("sanitizeFileName", () => {
  it("replaces illegal filename characters with dashes", () => {
    expect(sanitizeFileName('My:File/Name*"test')).toBe("My-File-Name--test");
  });

  it("trims whitespace", () => {
    expect(sanitizeFileName("  hello  ")).toBe("hello");
  });

  it("returns safe names unchanged", () => {
    expect(sanitizeFileName("normal-file_name")).toBe("normal-file_name");
  });
});

describe("ensureFolder", () => {
  let vault: Vault & {
    getAbstractFileByPath: ReturnType<typeof vi.fn>;
    createFolder: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vault = new Vault() as typeof vault;
    vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
    vault.createFolder = vi.fn().mockResolvedValue(undefined);
  });

  it("creates nested folders that don't exist", async () => {
    await ensureFolder(vault, "a/b/c");
    expect(vault.createFolder).toHaveBeenCalledWith("a");
    expect(vault.createFolder).toHaveBeenCalledWith("a/b");
    expect(vault.createFolder).toHaveBeenCalledWith("a/b/c");
  });

  it("skips folders that already exist", async () => {
    vault.getAbstractFileByPath.mockImplementation((path: string) => {
      if (path === "a") return new TFolder("a");
      return null;
    });
    await ensureFolder(vault, "a/b");
    expect(vault.createFolder).not.toHaveBeenCalledWith("a");
    expect(vault.createFolder).toHaveBeenCalledWith("a/b");
  });

  it("does nothing for empty path", async () => {
    await ensureFolder(vault, "");
    expect(vault.createFolder).not.toHaveBeenCalled();
  });

  it("stops if a path segment is a file, not a folder", async () => {
    vault.getAbstractFileByPath.mockImplementation((path: string) => {
      if (path === "a") return new TFile("a");
      return null;
    });
    await ensureFolder(vault, "a/b");
    expect(vault.createFolder).not.toHaveBeenCalled();
  });
});

describe("ensureDailyNote", () => {
  let vault: Vault & {
    getAbstractFileByPath: ReturnType<typeof vi.fn>;
    createFolder: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vault = new Vault() as typeof vault;
    vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
    vault.createFolder = vi.fn().mockResolvedValue(undefined);
    vault.create = vi.fn().mockImplementation((path: string) => new TFile(path));
  });

  it("returns existing file if it exists", async () => {
    const existing = new TFile("Calendar/2026-04-10.md");
    vault.getAbstractFileByPath.mockReturnValue(existing);

    const result = await ensureDailyNote(vault, "Calendar/2026-04-10.md");
    expect(result).toBe(existing);
    expect(vault.create).not.toHaveBeenCalled();
  });

  it("creates a new file with title heading when it doesn't exist", async () => {
    const result = await ensureDailyNote(vault, "Calendar/2026-04-10.md");
    expect(vault.create).toHaveBeenCalledWith(
      "Calendar/2026-04-10.md",
      "# 2026-04-10\n\n"
    );
    expect(result).toBeInstanceOf(TFile);
  });

  it("creates parent folders before creating the file", async () => {
    await ensureDailyNote(vault, "Deep/Nested/2026-04-10.md");
    expect(vault.createFolder).toHaveBeenCalled();
    expect(vault.create).toHaveBeenCalled();
  });

  it("handles root-level paths without folder creation", async () => {
    await ensureDailyNote(vault, "2026-04-10.md");
    expect(vault.createFolder).not.toHaveBeenCalled();
    expect(vault.create).toHaveBeenCalledWith("2026-04-10.md", "# 2026-04-10\n\n");
  });
});
