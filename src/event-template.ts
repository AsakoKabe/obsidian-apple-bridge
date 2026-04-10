import type { CalendarEvent } from "./calendar-bridge";

export const DEFAULT_EVENT_TEMPLATE =
  "- [ ] {{time}} {{title}}{{#location}} 📍 {{location}}{{/location}} [id:{{id}}]";

export interface TemplateContext {
  title: string;
  time: string;
  start: string;
  end: string;
  location: string;
  calendar: string;
  notes: string;
  url: string;
  id: string;
  account: string;
  readonly: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function buildTemplateContext(event: CalendarEvent): TemplateContext {
  const timeRange = event.isAllDay
    ? "all-day"
    : `${formatTime(event.startDate)} - ${formatTime(event.endDate)}`;
  const start = event.isAllDay ? "all-day" : formatTime(event.startDate);
  const end = event.isAllDay ? "all-day" : formatTime(event.endDate);

  return {
    title: event.title,
    time: timeRange,
    start,
    end,
    location: event.location,
    calendar: event.calendarName,
    notes: event.notes,
    url: event.url,
    id: event.id,
    account: event.accountName ?? "",
    readonly: event.calendarWritable === false ? "🔒" : "",
  };
}

export function renderEventTemplate(template: string, event: CalendarEvent): string {
  const ctx = buildTemplateContext(event);

  let result = template;

  // Process conditional sections: {{#var}}...{{/var}}
  result = result.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_match, key: string, inner: string) => {
      const value = ctx[key as keyof TemplateContext] ?? "";
      return value ? inner : "";
    }
  );

  // Process variable interpolation: {{var}}
  result = result.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return ctx[key as keyof TemplateContext] ?? "";
  });

  return result;
}
