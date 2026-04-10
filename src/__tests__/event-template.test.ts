import { describe, it, expect } from "vitest";
import {
  renderEventTemplate,
  DEFAULT_EVENT_TEMPLATE,
  buildTemplateContext,
} from "../event-template";
import type { CalendarEvent } from "../calendar-bridge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const START_ISO = "2026-04-10T09:00:00.000Z";
const END_ISO = "2026-04-10T09:30:00.000Z";

function localTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const LOCAL_START = localTime(START_ISO);
const LOCAL_END = localTime(END_ISO);
const LOCAL_RANGE = `${LOCAL_START} - ${LOCAL_END}`;

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt-1",
    calendarName: "Work",
    title: "Team standup",
    startDate: START_ISO,
    endDate: END_ISO,
    isAllDay: false,
    location: "Room 42",
    notes: "Weekly sync",
    url: "https://meet.example.com/standup",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildTemplateContext
// ---------------------------------------------------------------------------

describe("buildTemplateContext", () => {
  it("produces time range for a timed event", () => {
    const ctx = buildTemplateContext(makeEvent());
    expect(ctx.time).toBe(LOCAL_RANGE);
    expect(ctx.start).toBe(LOCAL_START);
    expect(ctx.end).toBe(LOCAL_END);
  });

  it("produces 'all-day' for all-day events", () => {
    const ctx = buildTemplateContext(makeEvent({ isAllDay: true }));
    expect(ctx.time).toBe("all-day");
    expect(ctx.start).toBe("all-day");
    expect(ctx.end).toBe("all-day");
  });

  it("includes all event fields", () => {
    const ctx = buildTemplateContext(makeEvent());
    expect(ctx.title).toBe("Team standup");
    expect(ctx.location).toBe("Room 42");
    expect(ctx.calendar).toBe("Work");
    expect(ctx.notes).toBe("Weekly sync");
    expect(ctx.url).toBe("https://meet.example.com/standup");
    expect(ctx.id).toBe("evt-1");
  });

  it("handles empty location", () => {
    const ctx = buildTemplateContext(makeEvent({ location: "" }));
    expect(ctx.location).toBe("");
  });
});

// ---------------------------------------------------------------------------
// renderEventTemplate — variable interpolation
// ---------------------------------------------------------------------------

describe("renderEventTemplate — interpolation", () => {
  it("replaces simple variables", () => {
    const result = renderEventTemplate("{{title}} at {{location}}", makeEvent());
    expect(result).toBe("Team standup at Room 42");
  });

  it("replaces time variables", () => {
    const result = renderEventTemplate("{{start}}-{{end}}", makeEvent());
    expect(result).toBe(`${LOCAL_START}-${LOCAL_END}`);
  });

  it("replaces {{time}} with full range", () => {
    const result = renderEventTemplate("{{time}}", makeEvent());
    expect(result).toBe(LOCAL_RANGE);
  });

  it("replaces {{calendar}}", () => {
    const result = renderEventTemplate("{{calendar}}", makeEvent());
    expect(result).toBe("Work");
  });

  it("replaces {{id}}", () => {
    const result = renderEventTemplate("[id:{{id}}]", makeEvent());
    expect(result).toBe("[id:evt-1]");
  });

  it("leaves unknown variables as empty string", () => {
    const result = renderEventTemplate("{{unknown}}", makeEvent());
    expect(result).toBe("");
  });

  it("handles multiple occurrences of the same variable", () => {
    const result = renderEventTemplate("{{title}} / {{title}}", makeEvent());
    expect(result).toBe("Team standup / Team standup");
  });
});

// ---------------------------------------------------------------------------
// renderEventTemplate — conditional sections
// ---------------------------------------------------------------------------

describe("renderEventTemplate — conditional sections", () => {
  it("renders conditional block when value is non-empty", () => {
    const result = renderEventTemplate(
      "{{title}}{{#location}} 📍 {{location}}{{/location}}",
      makeEvent()
    );
    expect(result).toBe("Team standup 📍 Room 42");
  });

  it("omits conditional block when value is empty", () => {
    const result = renderEventTemplate(
      "{{title}}{{#location}} 📍 {{location}}{{/location}}",
      makeEvent({ location: "" })
    );
    expect(result).toBe("Team standup");
  });

  it("supports multiple conditional blocks", () => {
    const tmpl = "{{title}}{{#location}} 📍 {{location}}{{/location}}{{#url}} 🔗 {{url}}{{/url}}";
    const result = renderEventTemplate(tmpl, makeEvent());
    expect(result).toBe("Team standup 📍 Room 42 🔗 https://meet.example.com/standup");
  });

  it("omits all empty conditional blocks", () => {
    const tmpl = "{{title}}{{#location}} 📍 {{location}}{{/location}}{{#url}} 🔗 {{url}}{{/url}}";
    const result = renderEventTemplate(tmpl, makeEvent({ location: "", url: "" }));
    expect(result).toBe("Team standup");
  });

  it("handles conditional block for notes", () => {
    const tmpl = "{{title}}{{#notes}} — {{notes}}{{/notes}}";
    expect(renderEventTemplate(tmpl, makeEvent())).toBe("Team standup — Weekly sync");
    expect(renderEventTemplate(tmpl, makeEvent({ notes: "" }))).toBe("Team standup");
  });

  it("handles conditional on time (always truthy for timed events)", () => {
    const tmpl = "{{#time}}{{time}} {{/time}}{{title}}";
    expect(renderEventTemplate(tmpl, makeEvent())).toBe(`${LOCAL_RANGE} Team standup`);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_EVENT_TEMPLATE
// ---------------------------------------------------------------------------

describe("DEFAULT_EVENT_TEMPLATE", () => {
  it("matches current formatEventLine output for timed event with location", () => {
    const result = renderEventTemplate(DEFAULT_EVENT_TEMPLATE, makeEvent());
    expect(result).toBe(`- [ ] ${LOCAL_RANGE} Team standup 📍 Room 42 [id:evt-1]`);
  });

  it("matches current formatEventLine output for timed event without location", () => {
    const result = renderEventTemplate(DEFAULT_EVENT_TEMPLATE, makeEvent({ location: "" }));
    expect(result).toBe(`- [ ] ${LOCAL_RANGE} Team standup [id:evt-1]`);
  });

  it("matches current formatEventLine output for all-day event", () => {
    const result = renderEventTemplate(
      DEFAULT_EVENT_TEMPLATE,
      makeEvent({ isAllDay: true, location: "" })
    );
    expect(result).toBe("- [ ] all-day Team standup [id:evt-1]");
  });

  it("matches current formatEventLine output for all-day event with location", () => {
    const result = renderEventTemplate(DEFAULT_EVENT_TEMPLATE, makeEvent({ isAllDay: true }));
    expect(result).toBe("- [ ] all-day Team standup 📍 Room 42 [id:evt-1]");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("renderEventTemplate — edge cases", () => {
  it("returns empty string for empty template", () => {
    expect(renderEventTemplate("", makeEvent())).toBe("");
  });

  it("returns static text if no variables used", () => {
    expect(renderEventTemplate("Hello world", makeEvent())).toBe("Hello world");
  });

  it("handles template with only conditional blocks", () => {
    const tmpl = "{{#location}}{{location}}{{/location}}";
    expect(renderEventTemplate(tmpl, makeEvent())).toBe("Room 42");
    expect(renderEventTemplate(tmpl, makeEvent({ location: "" }))).toBe("");
  });

  it("preserves whitespace in template", () => {
    const result = renderEventTemplate("  {{title}}  ", makeEvent());
    expect(result).toBe("  Team standup  ");
  });

  it("handles special regex characters in event data", () => {
    const result = renderEventTemplate("{{title}}", makeEvent({ title: "Meeting (1:1) — $100" }));
    expect(result).toBe("Meeting (1:1) — $100");
  });
});
