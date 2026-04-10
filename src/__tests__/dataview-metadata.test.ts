import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  serializeFrontmatter,
  updateFrontmatter,
  buildDailyNoteMetadata,
} from "../dataview-metadata";

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe("parseFrontmatter", () => {
  it("parses frontmatter from a note with existing frontmatter", () => {
    const content = `---\ntitle: "Test"\ncount: 5\n---\n\n# Hello`;
    const result = parseFrontmatter(content);
    expect(result.fields).toEqual({ title: "Test", count: 5 });
    expect(result.body).toBe("\n# Hello");
  });

  it("returns empty fields when no frontmatter exists", () => {
    const content = "# Hello\n\nSome text.";
    const result = parseFrontmatter(content);
    expect(result.fields).toEqual({});
    expect(result.body).toBe("# Hello\n\nSome text.");
  });

  it("handles empty content", () => {
    const result = parseFrontmatter("");
    expect(result.fields).toEqual({});
    expect(result.body).toBe("");
  });

  it("handles frontmatter with array values", () => {
    const content = `---\ntags:\n  - work\n  - meeting\n---\n\nBody`;
    const result = parseFrontmatter(content);
    expect(result.fields.tags).toEqual(["work", "meeting"]);
    expect(result.body).toBe("\nBody");
  });

  it("handles frontmatter with only delimiters", () => {
    const content = "---\n---\n\nBody text";
    const result = parseFrontmatter(content);
    expect(result.fields).toEqual({});
    expect(result.body).toBe("\nBody text");
  });

  it("does not parse if first line is not ---", () => {
    const content = "# Title\n---\nkey: value\n---\n";
    const result = parseFrontmatter(content);
    expect(result.fields).toEqual({});
    expect(result.body).toBe("# Title\n---\nkey: value\n---\n");
  });

  it("handles inline array syntax", () => {
    const content = `---\ncalendars: ["Work", "Personal"]\n---\n\nBody`;
    const result = parseFrontmatter(content);
    expect(result.fields.calendars).toEqual(["Work", "Personal"]);
  });
});

// ---------------------------------------------------------------------------
// serializeFrontmatter
// ---------------------------------------------------------------------------

describe("serializeFrontmatter", () => {
  it("serializes fields and body into a note", () => {
    const result = serializeFrontmatter({ title: "Test", count: 5 }, "\n# Hello");
    expect(result).toBe('---\ntitle: "Test"\ncount: 5\n---\n\n# Hello');
  });

  it("serializes arrays as YAML lists", () => {
    const result = serializeFrontmatter({ tags: ["a", "b"] }, "\nBody");
    expect(result).toContain("tags:");
    expect(result).toContain('  - "a"');
    expect(result).toContain('  - "b"');
  });

  it("returns just body when fields are empty", () => {
    const result = serializeFrontmatter({}, "# Hello\n\nText");
    expect(result).toBe("# Hello\n\nText");
  });

  it("handles boolean values", () => {
    const result = serializeFrontmatter({ draft: true }, "\nBody");
    expect(result).toContain("draft: true");
  });

  it("handles null values by omitting them", () => {
    const result = serializeFrontmatter({ key: null, other: "val" }, "\nBody");
    expect(result).not.toContain("key:");
    expect(result).toContain('other: "val"');
  });
});

// ---------------------------------------------------------------------------
// updateFrontmatter
// ---------------------------------------------------------------------------

describe("updateFrontmatter", () => {
  it("adds frontmatter to a note without any", () => {
    const content = "# 2026-04-10\n\n## Calendar Events\n";
    const result = updateFrontmatter(content, { apple_events: 3 });
    expect(result).toMatch(/^---\n/);
    expect(result).toContain("apple_events: 3");
    expect(result).toContain("# 2026-04-10");
  });

  it("merges new fields into existing frontmatter", () => {
    const content = '---\ntitle: "My Note"\n---\n\n# Hello';
    const result = updateFrontmatter(content, { apple_events: 5 });
    expect(result).toContain('title: "My Note"');
    expect(result).toContain("apple_events: 5");
    expect(result).toContain("# Hello");
  });

  it("overwrites existing fields with new values", () => {
    const content = "---\napple_events: 2\n---\n\n# Hello";
    const result = updateFrontmatter(content, { apple_events: 7 });
    expect(result).toContain("apple_events: 7");
    // Should not contain old value
    const matches = result.match(/apple_events/g);
    expect(matches).toHaveLength(1);
  });

  it("preserves non-apple fields when updating", () => {
    const content = "---\ntags:\n  - daily\ncustom: value\n---\n\nBody";
    const result = updateFrontmatter(content, { apple_events: 1 });
    expect(result).toContain('custom: "value"');
    expect(result).toContain("apple_events: 1");
  });

  it("handles empty update (no-op)", () => {
    const content = '---\ntitle: "Keep"\n---\n\nBody';
    const result = updateFrontmatter(content, {});
    expect(result).toContain('title: "Keep"');
    expect(result).toContain("Body");
  });
});

// ---------------------------------------------------------------------------
// buildDailyNoteMetadata
// ---------------------------------------------------------------------------

describe("buildDailyNoteMetadata", () => {
  it("builds metadata from event and reminder counts", () => {
    const meta = buildDailyNoteMetadata({
      eventCount: 5,
      reminderCount: 3,
      calendarNames: ["Work", "Personal"],
      reminderListNames: ["Shopping"],
      syncedAt: "2026-04-10T12:00:00.000Z",
    });

    expect(meta.apple_events).toBe(5);
    expect(meta.apple_reminders).toBe(3);
    expect(meta.apple_calendars).toEqual(["Personal", "Work"]);
    expect(meta.apple_reminder_lists).toEqual(["Shopping"]);
    expect(meta.apple_last_sync).toBe("2026-04-10T12:00:00.000Z");
  });

  it("omits zero counts", () => {
    const meta = buildDailyNoteMetadata({
      eventCount: 0,
      reminderCount: 3,
      calendarNames: [],
      reminderListNames: ["Todo"],
      syncedAt: "2026-04-10T12:00:00.000Z",
    });

    expect(meta.apple_events).toBeUndefined();
    expect(meta.apple_reminders).toBe(3);
    expect(meta.apple_calendars).toBeUndefined();
    expect(meta.apple_reminder_lists).toEqual(["Todo"]);
  });

  it("omits empty arrays", () => {
    const meta = buildDailyNoteMetadata({
      eventCount: 2,
      reminderCount: 0,
      calendarNames: ["Work"],
      reminderListNames: [],
      syncedAt: "2026-04-10T12:00:00.000Z",
    });

    expect(meta.apple_reminder_lists).toBeUndefined();
    expect(meta.apple_reminders).toBeUndefined();
  });

  it("deduplicates calendar names", () => {
    const meta = buildDailyNoteMetadata({
      eventCount: 3,
      reminderCount: 0,
      calendarNames: ["Work", "Work", "Personal"],
      reminderListNames: [],
      syncedAt: "2026-04-10T12:00:00.000Z",
    });

    expect(meta.apple_calendars).toEqual(["Personal", "Work"]);
  });

  it("sorts calendar and list names alphabetically", () => {
    const meta = buildDailyNoteMetadata({
      eventCount: 2,
      reminderCount: 2,
      calendarNames: ["Zebra", "Alpha"],
      reminderListNames: ["Zoo", "Abc"],
      syncedAt: "2026-04-10T12:00:00.000Z",
    });

    expect(meta.apple_calendars).toEqual(["Alpha", "Zebra"]);
    expect(meta.apple_reminder_lists).toEqual(["Abc", "Zoo"]);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: parse → update → serialize preserves structure
// ---------------------------------------------------------------------------

describe("round-trip", () => {
  it("preserves content through parse and serialize", () => {
    const original =
      '---\ntitle: "Daily"\n---\n\n# 2026-04-10\n\n## Calendar Events\n\n- Event 1\n';
    const { fields, body } = parseFrontmatter(original);
    // body is everything after the closing "---\n": "\n# 2026-04-10\n\n..."
    expect(body).toBe("\n# 2026-04-10\n\n## Calendar Events\n\n- Event 1\n");
    const roundTripped = serializeFrontmatter(fields, body);
    expect(roundTripped).toBe(original);
  });

  it("adds metadata then can parse it back", () => {
    const original = "# 2026-04-10\n\n## Calendar Events\n";
    const updated = updateFrontmatter(original, {
      apple_events: 3,
      apple_calendars: ["Work"],
    });
    const { fields } = parseFrontmatter(updated);
    expect(fields.apple_events).toBe(3);
    expect(fields.apple_calendars).toEqual(["Work"]);
  });
});
