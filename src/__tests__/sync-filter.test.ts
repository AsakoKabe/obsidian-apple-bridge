import { describe, it, expect } from "vitest";
import { filterByName, type SyncFilter } from "../sync-filter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Item {
  name: string;
  value: number;
}

function items(...names: string[]): Item[] {
  return names.map((name, i) => ({ name, value: i }));
}

function nameOf(item: Item): string {
  return item.name;
}

// ---------------------------------------------------------------------------
// filterByName — include mode
// ---------------------------------------------------------------------------

describe("filterByName — include mode", () => {
  it("keeps only items matching the include list", () => {
    const filter: SyncFilter = { mode: "include", names: ["Work", "Personal"] };
    const result = filterByName(items("Work", "Birthdays", "Personal"), nameOf, filter);
    expect(result.map((i) => i.name)).toEqual(["Work", "Personal"]);
  });

  it("returns empty array when no items match", () => {
    const filter: SyncFilter = { mode: "include", names: ["Nonexistent"] };
    const result = filterByName(items("Work", "Personal"), nameOf, filter);
    expect(result).toEqual([]);
  });

  it("is case-sensitive", () => {
    const filter: SyncFilter = { mode: "include", names: ["work"] };
    const result = filterByName(items("Work", "Personal"), nameOf, filter);
    expect(result).toEqual([]);
  });

  it("handles empty include list (returns nothing)", () => {
    const filter: SyncFilter = { mode: "include", names: [] };
    const result = filterByName(items("Work", "Personal"), nameOf, filter);
    expect(result).toEqual([]);
  });

  it("handles duplicate names in include list", () => {
    const filter: SyncFilter = { mode: "include", names: ["Work", "Work"] };
    const result = filterByName(items("Work", "Personal"), nameOf, filter);
    expect(result.map((i) => i.name)).toEqual(["Work"]);
  });
});

// ---------------------------------------------------------------------------
// filterByName — exclude mode
// ---------------------------------------------------------------------------

describe("filterByName — exclude mode", () => {
  it("removes items matching the exclude list", () => {
    const filter: SyncFilter = { mode: "exclude", names: ["Birthdays"] };
    const result = filterByName(items("Work", "Birthdays", "Personal"), nameOf, filter);
    expect(result.map((i) => i.name)).toEqual(["Work", "Personal"]);
  });

  it("returns all items when none match the exclude list", () => {
    const filter: SyncFilter = { mode: "exclude", names: ["Nonexistent"] };
    const result = filterByName(items("Work", "Personal"), nameOf, filter);
    expect(result.map((i) => i.name)).toEqual(["Work", "Personal"]);
  });

  it("returns empty array when all items are excluded", () => {
    const filter: SyncFilter = { mode: "exclude", names: ["Work", "Personal"] };
    const result = filterByName(items("Work", "Personal"), nameOf, filter);
    expect(result).toEqual([]);
  });

  it("handles empty exclude list (returns everything)", () => {
    const filter: SyncFilter = { mode: "exclude", names: [] };
    const result = filterByName(items("Work", "Personal"), nameOf, filter);
    expect(result.map((i) => i.name)).toEqual(["Work", "Personal"]);
  });
});

// ---------------------------------------------------------------------------
// filterByName — no filter (passthrough)
// ---------------------------------------------------------------------------

describe("filterByName — no filter", () => {
  it("returns all items when filter is undefined", () => {
    const result = filterByName(items("Work", "Personal"), nameOf, undefined);
    expect(result.map((i) => i.name)).toEqual(["Work", "Personal"]);
  });

  it("returns all items when filter has empty names and include mode", () => {
    const filter: SyncFilter = { mode: "include", names: [] };
    const result = filterByName(items("A", "B"), nameOf, filter);
    // Empty include means nothing passes — this is intentional
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// filterByName — edge cases
// ---------------------------------------------------------------------------

describe("filterByName — edge cases", () => {
  it("works with empty input array", () => {
    const filter: SyncFilter = { mode: "include", names: ["Work"] };
    expect(filterByName([], nameOf, filter)).toEqual([]);
  });

  it("preserves item order", () => {
    const filter: SyncFilter = { mode: "include", names: ["C", "A"] };
    const result = filterByName(items("A", "B", "C"), nameOf, filter);
    expect(result.map((i) => i.name)).toEqual(["A", "C"]);
  });

  it("handles names with special characters", () => {
    const filter: SyncFilter = { mode: "include", names: ["My \"Special\" List"] };
    const result = filterByName(items('My "Special" List', "Other"), nameOf, filter);
    expect(result.map((i) => i.name)).toEqual(['My "Special" List']);
  });
});
