import { Notice, TFile, Vault } from "obsidian";
import { CalendarEvent, fetchEvents, createEvent, updateEvent } from "./calendar-bridge";
import {
  checkCalendarPermission,
  PermissionDeniedError,
  isPermissionDenied,
  showPermissionDeniedNotice,
} from "./permissions";
import {
  dailyNotePath,
  toDateKey,
  addDays,
  startOfDay,
  endOfDay,
  buildDateRange,
  ensureDailyNote,
} from "./vault-utils";
import { renderEventTemplate, DEFAULT_EVENT_TEMPLATE } from "./event-template";
import { filterByName } from "./sync-filter";
import type AppleBridgePlugin from "./main";

interface SyncedEvent {
  appleId: string;
  title: string;
  startDate: string;
  endDate: string;
  isAllDay: boolean;
  location: string;
  notes: string;
  lastSyncedAt: string;
}

interface SyncState {
  events: Record<string, SyncedEvent>; // keyed by appleId
}

const SYNC_STATE_KEY = "calendar-sync-state";
const EVENT_SECTION_HEADER = "## Calendar Events";
const EVENT_REGEX =
  /^- \[(?<done>[ x])\] (?<time>\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?)?\s*(?<title>.+?)(?:\s*📍\s*(?<location>.+?))?(?:\s*\[id:(?<id>[^\]]+)\])?$/;

function resolveTemplate(
  ev: CalendarEvent,
  templates: Record<string, string>
): string {
  return templates[ev.calendarName] || templates["*"] || DEFAULT_EVENT_TEMPLATE;
}

function formatEventLine(ev: CalendarEvent, templates: Record<string, string>): string {
  const template = resolveTemplate(ev, templates);
  return renderEventTemplate(template, ev);
}

function parseEventLine(
  line: string
): { title: string; id: string | null; timeStr: string | null; location: string | null } | null {
  const match = line.match(EVENT_REGEX);
  if (!match?.groups) return null;
  return {
    title: match.groups.title.trim(),
    id: match.groups.id ?? null,
    timeStr: match.groups.time ?? null,
    location: match.groups.location ?? null,
  };
}

async function loadSyncState(plugin: AppleBridgePlugin): Promise<SyncState> {
  const data = await plugin.loadData();
  return data?.[SYNC_STATE_KEY] ?? { events: {} };
}

async function saveSyncState(plugin: AppleBridgePlugin, state: SyncState): Promise<void> {
  const data = (await plugin.loadData()) ?? {};
  await plugin.saveData({ ...data, [SYNC_STATE_KEY]: state });
}

function hasEventChanged(remote: CalendarEvent, synced: SyncedEvent): boolean {
  return (
    remote.title !== synced.title ||
    remote.startDate !== synced.startDate ||
    remote.endDate !== synced.endDate ||
    remote.location !== synced.location ||
    remote.notes !== synced.notes ||
    remote.isAllDay !== synced.isAllDay
  );
}

function toSyncedEvent(ev: CalendarEvent): SyncedEvent {
  return {
    appleId: ev.id,
    title: ev.title,
    startDate: ev.startDate,
    endDate: ev.endDate,
    isAllDay: ev.isAllDay,
    location: ev.location,
    notes: ev.notes,
    lastSyncedAt: new Date().toISOString(),
  };
}

async function writeEventsToNote(
  vault: Vault,
  file: TFile,
  events: CalendarEvent[],
  templates: Record<string, string>
): Promise<void> {
  const content = await vault.read(file);
  const lines = content.split("\n");

  // Find existing calendar section
  const sectionIdx = lines.findIndex((l) => l.trim() === EVENT_SECTION_HEADER);

  // Build sorted event lines
  const sorted = [...events].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );
  const eventLines = sorted.map((ev) => formatEventLine(ev, templates));

  if (sectionIdx >= 0) {
    // Find section end (next heading or EOF)
    let endIdx = sectionIdx + 1;
    while (endIdx < lines.length && !lines[endIdx].startsWith("## ")) {
      endIdx++;
    }

    // Merge: keep local lines that have no apple id (user-created), update ones that do
    const existingLocal: string[] = [];
    for (let i = sectionIdx + 1; i < endIdx; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parsed = parseEventLine(line);
      if (parsed && !parsed.id) {
        existingLocal.push(lines[i]);
      }
    }

    const newSection = [EVENT_SECTION_HEADER, "", ...eventLines, ...existingLocal, ""];
    const updated = [...lines.slice(0, sectionIdx), ...newSection, ...lines.slice(endIdx)];
    await vault.modify(file, updated.join("\n"));
  } else {
    // Append section
    const section = `\n${EVENT_SECTION_HEADER}\n\n${eventLines.join("\n")}\n`;
    await vault.modify(file, content + section);
  }
}

function parseEventsFromNote(content: string): Array<{
  title: string;
  id: string | null;
  timeStr: string | null;
  location: string | null;
  line: string;
}> {
  const lines = content.split("\n");
  const sectionIdx = lines.findIndex((l) => l.trim() === EVENT_SECTION_HEADER);
  if (sectionIdx < 0) return [];

  const results: Array<{
    title: string;
    id: string | null;
    timeStr: string | null;
    location: string | null;
    line: string;
  }> = [];

  for (let i = sectionIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    const parsed = parseEventLine(lines[i]);
    if (parsed) {
      results.push({ ...parsed, line: lines[i] });
    }
  }
  return results;
}

function parseTimeToDate(date: Date, timeStr: string): Date {
  const parts = timeStr.split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

async function syncCalendarForDate(
  plugin: AppleBridgePlugin,
  date: Date,
  dayEvents: CalendarEvent[],
  state: SyncState
): Promise<CalendarEvent[]> {
  const vault = plugin.app.vault;
  const calendarFolder = plugin.settings.calendarFolder ?? "";
  const defaultCalendar = plugin.settings.defaultCalendarName ?? "Calendar";
  const resolution = plugin.settings.conflictResolution ?? "remote-wins";
  const templates = plugin.settings.eventTemplates ?? {};
  const notePath = dailyNotePath(date, calendarFolder);

  const file = await ensureDailyNote(vault, notePath);
  const noteContent = await vault.read(file);
  const noteEvents = parseEventsFromNote(noteContent);

  // Push local-only events for this day to Apple Calendar
  for (const noteEv of noteEvents) {
    if (noteEv.id) continue;
    if (!noteEv.timeStr) continue;

    const timeParts = noteEv.timeStr.split(/\s*-\s*/);
    const start = parseTimeToDate(date, timeParts[0]);
    const end = timeParts[1]
      ? parseTimeToDate(date, timeParts[1])
      : new Date(start.getTime() + 60 * 60 * 1000);

    const newId = await createEvent(defaultCalendar, noteEv.title, start, end, {
      location: noteEv.location ?? undefined,
    });
    state.events[newId] = {
      appleId: newId,
      title: noteEv.title,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      isAllDay: false,
      location: noteEv.location ?? "",
      notes: "",
      lastSyncedAt: new Date().toISOString(),
    };
  }

  // Build local change map for conflict detection
  const localChanges = new Map<string, Partial<CalendarEvent>>();
  for (const noteEv of noteEvents) {
    if (!noteEv.id) continue;
    const prev = state.events[noteEv.id];
    if (!prev) continue;

    const changes: Partial<CalendarEvent> = {};
    if (noteEv.title !== prev.title) changes.title = noteEv.title;
    if (noteEv.location && noteEv.location !== prev.location) {
      changes.location = noteEv.location;
    }
    if (noteEv.timeStr) {
      const timeParts = noteEv.timeStr.split(/\s*-\s*/);
      const start = parseTimeToDate(date, timeParts[0]);
      if (start.toISOString() !== prev.startDate) {
        changes.startDate = start.toISOString();
      }
      if (timeParts[1]) {
        const end = parseTimeToDate(date, timeParts[1]);
        if (end.toISOString() !== prev.endDate) {
          changes.endDate = end.toISOString();
        }
      }
    }
    if (Object.keys(changes).length > 0) {
      localChanges.set(noteEv.id, changes);
    }
  }

  // Merge remote changes with conflict resolution
  const updatedApple: CalendarEvent[] = [];
  for (const ev of dayEvents) {
    const prev = state.events[ev.id];
    const remoteChanged = prev ? hasEventChanged(ev, prev) : false;
    const localChanged = localChanges.has(ev.id);

    if (remoteChanged && localChanged) {
      if (resolution === "local-wins") {
        const changes = localChanges.get(ev.id)!;
        await updateEvent(ev.id, changes);
        state.events[ev.id] = {
          ...toSyncedEvent(ev),
          ...changes,
          lastSyncedAt: new Date().toISOString(),
        } as SyncedEvent;
        localChanges.delete(ev.id);
      } else if (resolution === "most-recent") {
        const remoteTime = new Date(ev.startDate).getTime();
        const localSyncTime = prev ? new Date(prev.lastSyncedAt).getTime() : 0;
        if (remoteTime > localSyncTime) {
          state.events[ev.id] = toSyncedEvent(ev);
          localChanges.delete(ev.id);
        } else {
          const changes = localChanges.get(ev.id)!;
          await updateEvent(ev.id, changes);
          state.events[ev.id] = {
            ...toSyncedEvent(ev),
            ...changes,
            lastSyncedAt: new Date().toISOString(),
          } as SyncedEvent;
          localChanges.delete(ev.id);
        }
      } else {
        // remote-wins (default)
        state.events[ev.id] = toSyncedEvent(ev);
        localChanges.delete(ev.id);
      }
    } else if (remoteChanged) {
      state.events[ev.id] = toSyncedEvent(ev);
    } else if (!prev) {
      state.events[ev.id] = toSyncedEvent(ev);
    }

    updatedApple.push(ev);
  }

  // Push remaining local-only edits (no remote conflict)
  for (const [id, changes] of localChanges) {
    const prev = state.events[id];
    if (!prev) continue;
    await updateEvent(id, changes);
    state.events[id] = {
      ...prev,
      ...changes,
      lastSyncedAt: new Date().toISOString(),
    } as SyncedEvent;
  }

  // Write merged events back to note
  await writeEventsToNote(vault, file, updatedApple, templates);

  return updatedApple;
}

export async function syncCalendar(plugin: AppleBridgePlugin): Promise<number> {
  if (!plugin.settings.syncCalendar) return 0;

  // Pre-flight: verify macOS has granted Calendar access before doing any work.
  try {
    await checkCalendarPermission();
  } catch (err: unknown) {
    if (err instanceof PermissionDeniedError) {
      showPermissionDeniedNotice(err.appName);
      return 0;
    }
    // Non-permission preflight failure — fall through and let the real call fail.
  }

  const today = new Date();
  const pastDays = plugin.settings.syncRangePastDays;
  const futureDays = plugin.settings.syncRangeFutureDays;
  const calendarFolder = plugin.settings.calendarFolder ?? "";

  const rangeStart = startOfDay(addDays(today, -pastDays));
  const rangeEnd = endOfDay(addDays(today, futureDays));

  try {
    // Fetch all events for the entire range, then apply calendar filter
    const allEvents = await fetchEvents(rangeStart, rangeEnd);
    const appleEvents = filterByName(
      allEvents,
      (ev) => ev.calendarName,
      plugin.settings.calendarFilter
    );
    const state = await loadSyncState(plugin);

    // Group events by date key (YYYY-MM-DD based on startDate)
    const eventsByDate = new Map<string, CalendarEvent[]>();
    for (const ev of appleEvents) {
      const key = toDateKey(new Date(ev.startDate));
      const list = eventsByDate.get(key) ?? [];
      eventsByDate.set(key, [...list, ev]);
    }

    const dates = buildDateRange(today, pastDays, futureDays);
    const todayKey = toDateKey(today);
    let totalEvents = 0;

    for (const date of dates) {
      const dateKey = toDateKey(date);
      const dayEvents = eventsByDate.get(dateKey) ?? [];

      // Always process today. For other days, only process if there are Apple
      // events for that day or an existing daily note to update.
      if (dateKey !== todayKey && dayEvents.length === 0) {
        const notePath = dailyNotePath(date, calendarFolder);
        const existingFile = plugin.app.vault.getAbstractFileByPath(notePath);
        if (!(existingFile instanceof TFile)) continue;
      }

      const written = await syncCalendarForDate(plugin, date, dayEvents, state);
      totalEvents += written.length;
    }

    // Persist sync state
    await saveSyncState(plugin, state);

    return totalEvents;
  } catch (err: unknown) {
    if (err instanceof PermissionDeniedError || isPermissionDenied(err)) {
      showPermissionDeniedNotice("Calendar");
      return 0;
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    new Notice(`Calendar sync failed: ${msg}`);
    throw err;
  }
}
