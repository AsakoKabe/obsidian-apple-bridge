import { Notice, TFile, TFolder, Vault } from "obsidian";
import {
  CalendarEvent,
  fetchEvents,
  createEvent,
  updateEvent,
} from "./calendar-bridge";
import {
  checkCalendarPermission,
  PermissionDeniedError,
  isPermissionDenied,
  showPermissionDeniedNotice,
} from "./permissions";
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

function dailyNotePath(date: Date, folder: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const name = `${y}-${m}-${d}.md`;
  return folder ? `${folder}/${name}` : name;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatEventLine(ev: CalendarEvent): string {
  const timeRange = ev.isAllDay
    ? "all-day"
    : `${formatTime(ev.startDate)} - ${formatTime(ev.endDate)}`;
  const loc = ev.location ? ` 📍 ${ev.location}` : "";
  return `- [ ] ${timeRange} ${ev.title}${loc} [id:${ev.id}]`;
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

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

async function loadSyncState(plugin: AppleBridgePlugin): Promise<SyncState> {
  const data = await plugin.loadData();
  return data?.[SYNC_STATE_KEY] ?? { events: {} };
}

async function saveSyncState(
  plugin: AppleBridgePlugin,
  state: SyncState
): Promise<void> {
  const data = (await plugin.loadData()) ?? {};
  await plugin.saveData({ ...data, [SYNC_STATE_KEY]: state });
}

function hasEventChanged(
  remote: CalendarEvent,
  synced: SyncedEvent
): boolean {
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

async function ensureFolder(vault: Vault, folderPath: string): Promise<void> {
  if (!folderPath) return;
  const parts = folderPath.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = vault.getAbstractFileByPath(current);
    if (!existing) {
      await vault.createFolder(current);
    } else if (!(existing instanceof TFolder)) {
      return;
    }
  }
}

async function ensureDailyNote(vault: Vault, path: string): Promise<TFile> {
  const existing = vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;
  const folderPath = path.substring(0, path.lastIndexOf("/"));
  if (folderPath) {
    await ensureFolder(vault, folderPath);
  }
  const title = path.replace(/^.*\//, "").replace(".md", "");
  return await vault.create(path, `# ${title}\n\n`);
}

async function writeEventsToNote(
  vault: Vault,
  file: TFile,
  events: CalendarEvent[]
): Promise<void> {
  const content = await vault.read(file);
  const lines = content.split("\n");

  // Find existing calendar section
  const sectionIdx = lines.findIndex((l) => l.trim() === EVENT_SECTION_HEADER);

  // Build sorted event lines
  const sorted = [...events].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );
  const eventLines = sorted.map(formatEventLine);

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

    const newSection = [
      EVENT_SECTION_HEADER,
      "",
      ...eventLines,
      ...existingLocal,
      "",
    ];
    const updated = [
      ...lines.slice(0, sectionIdx),
      ...newSection,
      ...lines.slice(endIdx),
    ];
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

export async function syncCalendar(plugin: AppleBridgePlugin): Promise<void> {
  if (!plugin.settings.syncCalendar) return;

  // Pre-flight: verify macOS has granted Calendar access before doing any work.
  try {
    await checkCalendarPermission();
  } catch (err: unknown) {
    if (err instanceof PermissionDeniedError) {
      showPermissionDeniedNotice(err.appName);
      return;
    }
    // Non-permission preflight failure — fall through and let the real call fail.
  }

  const today = new Date();
  const vault = plugin.app.vault;

  try {
    // 1. Fetch events from Apple Calendar for today
    const appleEvents = await fetchEvents(startOfDay(today), endOfDay(today));
    const state = await loadSyncState(plugin);

    // 2. Ensure daily note exists
    const calendarFolder = plugin.settings.calendarFolder ?? "";
    const notePath = dailyNotePath(today, calendarFolder);
    const file = await ensureDailyNote(vault, notePath);
    const noteContent = await vault.read(file);

    // 3. Parse events already in the note
    const noteEvents = parseEventsFromNote(noteContent);

    // 4. Detect local-only events (no apple id) → push to Apple Calendar
    const defaultCalendar = plugin.settings.defaultCalendarName ?? "Calendar";
    for (const noteEv of noteEvents) {
      if (noteEv.id) continue; // already synced
      if (!noteEv.timeStr) continue; // can't create without time

      const timeParts = noteEv.timeStr.split(/\s*-\s*/);
      const start = parseTimeToDate(today, timeParts[0]);
      const end = timeParts[1]
        ? parseTimeToDate(today, timeParts[1])
        : new Date(start.getTime() + 60 * 60 * 1000); // default 1h

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

    // 5. Build local change map for conflict detection
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
        const start = parseTimeToDate(today, timeParts[0]);
        if (start.toISOString() !== prev.startDate) {
          changes.startDate = start.toISOString();
        }
        if (timeParts[1]) {
          const end = parseTimeToDate(today, timeParts[1]);
          if (end.toISOString() !== prev.endDate) {
            changes.endDate = end.toISOString();
          }
        }
      }
      if (Object.keys(changes).length > 0) {
        localChanges.set(noteEv.id, changes);
      }
    }

    // 6. Merge remote changes with conflict resolution
    const resolution = plugin.settings.conflictResolution ?? "remote-wins";
    const updatedApple: CalendarEvent[] = [];
    for (const ev of appleEvents) {
      const prev = state.events[ev.id];
      const remoteChanged = prev ? hasEventChanged(ev, prev) : false;
      const localChanged = localChanges.has(ev.id);

      if (remoteChanged && localChanged) {
        // True conflict — apply resolution strategy
        if (resolution === "local-wins") {
          // Push local to Apple, keep local version
          const changes = localChanges.get(ev.id)!;
          await updateEvent(ev.id, changes);
          state.events[ev.id] = {
            ...toSyncedEvent(ev),
            ...changes,
            lastSyncedAt: new Date().toISOString(),
          } as SyncedEvent;
          localChanges.delete(ev.id);
        } else if (resolution === "most-recent") {
          // Compare timestamps — remote modDate vs local sync time
          const remoteTime = new Date(ev.startDate).getTime();
          const localSyncTime = prev
            ? new Date(prev.lastSyncedAt).getTime()
            : 0;
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

    // 7. Push remaining local-only edits (no remote conflict)
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

    // 8. Write merged events back to note
    await writeEventsToNote(vault, file, updatedApple);

    // 9. Persist sync state
    await saveSyncState(plugin, state);

    new Notice(`Calendar synced: ${updatedApple.length} events`);
  } catch (err: unknown) {
    if (err instanceof PermissionDeniedError || isPermissionDenied(err)) {
      showPermissionDeniedNotice("Calendar");
      return;
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    new Notice(`Calendar sync failed: ${msg}`);
    throw err;
  }
}
