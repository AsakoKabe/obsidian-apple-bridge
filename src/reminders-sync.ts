import { Notice, TFile, Vault } from "obsidian";
import { Reminder, fetchReminders, createReminder, updateReminder } from "./reminders-bridge";
import {
  checkRemindersPermission,
  PermissionDeniedError,
  isPermissionDenied,
  showPermissionDeniedNotice,
} from "./permissions";
import { dailyNotePath, toDateKey, buildDateRange, ensureDailyNote } from "./vault-utils";
import { filterByName } from "./sync-filter";
import type AppleBridgePlugin from "./main";

interface SyncedReminder {
  appleId: string;
  title: string;
  isCompleted: boolean;
  dueDate: string | null;
  notes: string;
  lastSyncedAt: string;
}

interface ReminderSyncState {
  reminders: Record<string, SyncedReminder>; // keyed by appleId
}

const SYNC_STATE_KEY = "reminders-sync-state";
const REMINDERS_SECTION_HEADER = "## Reminders";
const REMINDER_REGEX =
  /^- \[(?<done>[ x])\]\s+(?<title>.+?)(?:\s*📅\s*(?<due>\d{4}-\d{2}-\d{2}))?(?:\s*\[rid:(?<id>[^\]]+)\])?$/;

function formatReminderLine(r: Reminder): string {
  const check = r.isCompleted ? "x" : " ";
  const due = r.dueDate ? ` 📅 ${r.dueDate.slice(0, 10)}` : "";
  return `- [${check}] ${r.title}${due} [rid:${r.id}]`;
}

function parseReminderLine(line: string): {
  title: string;
  id: string | null;
  isCompleted: boolean;
  dueStr: string | null;
} | null {
  const match = line.match(REMINDER_REGEX);
  if (!match?.groups) return null;
  return {
    title: match.groups.title.trim(),
    id: match.groups.id ?? null,
    isCompleted: match.groups.done === "x",
    dueStr: match.groups.due ?? null,
  };
}

async function loadSyncState(plugin: AppleBridgePlugin): Promise<ReminderSyncState> {
  const data = await plugin.loadData();
  return data?.[SYNC_STATE_KEY] ?? { reminders: {} };
}

async function saveSyncState(plugin: AppleBridgePlugin, state: ReminderSyncState): Promise<void> {
  const data = (await plugin.loadData()) ?? {};
  await plugin.saveData({ ...data, [SYNC_STATE_KEY]: state });
}

function toSyncedReminder(r: Reminder): SyncedReminder {
  return {
    appleId: r.id,
    title: r.title,
    isCompleted: r.isCompleted,
    dueDate: r.dueDate,
    notes: r.notes,
    lastSyncedAt: new Date().toISOString(),
  };
}

function hasReminderChanged(remote: Reminder, synced: SyncedReminder): boolean {
  return (
    remote.title !== synced.title ||
    remote.isCompleted !== synced.isCompleted ||
    remote.dueDate !== synced.dueDate ||
    remote.notes !== synced.notes
  );
}

function parseRemindersFromNote(content: string): Array<{
  title: string;
  id: string | null;
  isCompleted: boolean;
  dueStr: string | null;
  line: string;
}> {
  const lines = content.split("\n");
  const sectionIdx = lines.findIndex((l) => l.trim() === REMINDERS_SECTION_HEADER);
  if (sectionIdx < 0) return [];

  const results: Array<{
    title: string;
    id: string | null;
    isCompleted: boolean;
    dueStr: string | null;
    line: string;
  }> = [];

  for (let i = sectionIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    const parsed = parseReminderLine(lines[i]);
    if (parsed) {
      results.push({ ...parsed, line: lines[i] });
    }
  }
  return results;
}

async function writeRemindersToNote(
  vault: Vault,
  file: TFile,
  reminders: Reminder[]
): Promise<void> {
  const content = await vault.read(file);
  const lines = content.split("\n");

  const sectionIdx = lines.findIndex((l) => l.trim() === REMINDERS_SECTION_HEADER);

  // Incomplete first, then completed
  const sorted = [...reminders].sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
    return a.title.localeCompare(b.title);
  });
  const reminderLines = sorted.map(formatReminderLine);

  if (sectionIdx >= 0) {
    let endIdx = sectionIdx + 1;
    while (endIdx < lines.length && !lines[endIdx].startsWith("## ")) {
      endIdx++;
    }

    // Preserve user-created lines (no rid)
    const existingLocal: string[] = [];
    for (let i = sectionIdx + 1; i < endIdx; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parsed = parseReminderLine(line);
      if (parsed && !parsed.id) {
        existingLocal.push(lines[i]);
      }
    }

    const newSection = [REMINDERS_SECTION_HEADER, "", ...reminderLines, ...existingLocal, ""];
    const updated = [...lines.slice(0, sectionIdx), ...newSection, ...lines.slice(endIdx)];
    await vault.modify(file, updated.join("\n"));
  } else {
    const section = `\n${REMINDERS_SECTION_HEADER}\n\n${reminderLines.join("\n")}\n`;
    await vault.modify(file, content + section);
  }
}

async function syncRemindersForDate(
  plugin: AppleBridgePlugin,
  date: Date,
  dayReminders: Reminder[],
  state: ReminderSyncState
): Promise<Reminder[]> {
  const vault = plugin.app.vault;
  const remindersFolder = plugin.settings.remindersFolder ?? "";
  const defaultList = plugin.settings.defaultReminderList ?? "Reminders";
  const resolution = plugin.settings.conflictResolution ?? "remote-wins";
  const notePath = dailyNotePath(date, remindersFolder);

  const file = await ensureDailyNote(vault, notePath);
  const noteContent = await vault.read(file);
  const noteReminders = parseRemindersFromNote(noteContent);

  // Push local-only reminders for this day to Apple Reminders
  for (const noteR of noteReminders) {
    if (noteR.id) continue;

    const dueDate = noteR.dueStr ? new Date(noteR.dueStr) : undefined;
    const newId = await createReminder(defaultList, noteR.title, { dueDate });

    state.reminders[newId] = {
      appleId: newId,
      title: noteR.title,
      isCompleted: noteR.isCompleted,
      dueDate: dueDate?.toISOString() ?? null,
      notes: "",
      lastSyncedAt: new Date().toISOString(),
    };
  }

  // Build local change map for conflict detection
  const localChanges = new Map<string, Partial<Reminder>>();
  for (const noteR of noteReminders) {
    if (!noteR.id) continue;
    const prev = state.reminders[noteR.id];
    if (!prev) continue;

    const changes: Partial<Reminder> = {};
    if (noteR.title !== prev.title) changes.title = noteR.title;
    if (noteR.isCompleted !== prev.isCompleted) {
      changes.isCompleted = noteR.isCompleted;
    }
    if (noteR.dueStr) {
      const newDue = new Date(noteR.dueStr).toISOString();
      if (newDue !== prev.dueDate) changes.dueDate = newDue;
    }
    if (Object.keys(changes).length > 0) {
      localChanges.set(noteR.id, changes);
    }
  }

  // Merge remote changes with conflict resolution
  const mergedReminders: Reminder[] = [];
  for (const r of dayReminders) {
    const prev = state.reminders[r.id];
    const remoteChanged = prev ? hasReminderChanged(r, prev) : false;
    const localChanged = localChanges.has(r.id);

    if (remoteChanged && localChanged) {
      if (resolution === "local-wins") {
        const changes = localChanges.get(r.id)!;
        await updateReminder(r.id, changes);
        state.reminders[r.id] = {
          ...toSyncedReminder(r),
          ...changes,
          lastSyncedAt: new Date().toISOString(),
        } as SyncedReminder;
        localChanges.delete(r.id);
      } else if (resolution === "most-recent") {
        const localSyncTime = prev ? new Date(prev.lastSyncedAt).getTime() : 0;
        const remoteTime = r.dueDate ? new Date(r.dueDate).getTime() : Date.now();
        if (remoteTime > localSyncTime) {
          state.reminders[r.id] = toSyncedReminder(r);
          localChanges.delete(r.id);
        } else {
          const changes = localChanges.get(r.id)!;
          await updateReminder(r.id, changes);
          state.reminders[r.id] = {
            ...toSyncedReminder(r),
            ...changes,
            lastSyncedAt: new Date().toISOString(),
          } as SyncedReminder;
          localChanges.delete(r.id);
        }
      } else {
        // remote-wins (default)
        state.reminders[r.id] = toSyncedReminder(r);
        localChanges.delete(r.id);
      }
    } else if (remoteChanged) {
      state.reminders[r.id] = toSyncedReminder(r);
    } else if (!prev) {
      state.reminders[r.id] = toSyncedReminder(r);
    }

    mergedReminders.push(r);
  }

  // Push remaining local-only edits (no remote conflict)
  for (const [id, changes] of localChanges) {
    const prev = state.reminders[id];
    if (!prev) continue;
    await updateReminder(id, changes);
    state.reminders[id] = {
      ...prev,
      ...changes,
      lastSyncedAt: new Date().toISOString(),
    } as SyncedReminder;
  }

  // Write merged reminders back to note
  await writeRemindersToNote(vault, file, mergedReminders);

  return mergedReminders;
}

export async function syncReminders(plugin: AppleBridgePlugin): Promise<number> {
  if (!plugin.settings.syncReminders) return 0;

  // Pre-flight: verify macOS has granted Reminders access before doing any work.
  try {
    await checkRemindersPermission();
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
  const remindersFolder = plugin.settings.remindersFolder ?? "";
  const todayKey = toDateKey(today);

  try {
    // Fetch all incomplete reminders, then apply list filter
    const allReminders = await fetchReminders(undefined, false);
    const appleReminders = filterByName(
      allReminders,
      (r) => r.listName,
      plugin.settings.reminderListFilter
    );
    const state = await loadSyncState(plugin);

    // Group reminders by due date key. Reminders with no due date or a due date
    // outside the sync range are placed in today's bucket so they always appear.
    const rangeKeys = new Set(buildDateRange(today, pastDays, futureDays).map(toDateKey));

    const remindersByDate = new Map<string, Reminder[]>();
    for (const r of appleReminders) {
      const dueDateKey = r.dueDate ? toDateKey(new Date(r.dueDate)) : null;
      const bucket = dueDateKey && rangeKeys.has(dueDateKey) ? dueDateKey : todayKey;
      const list = remindersByDate.get(bucket) ?? [];
      remindersByDate.set(bucket, [...list, r]);
    }

    const dates = buildDateRange(today, pastDays, futureDays);
    let totalReminders = 0;

    for (const date of dates) {
      const dateKey = toDateKey(date);
      const dayReminders = remindersByDate.get(dateKey) ?? [];

      // Always process today. For other days, only process if there are reminders
      // due that day or an existing daily note to update.
      if (dateKey !== todayKey && dayReminders.length === 0) {
        const notePath = dailyNotePath(date, remindersFolder);
        const existingFile = plugin.app.vault.getAbstractFileByPath(notePath);
        if (!(existingFile instanceof TFile)) continue;
      }

      const written = await syncRemindersForDate(plugin, date, dayReminders, state);
      totalReminders += written.length;
    }

    // Persist sync state
    await saveSyncState(plugin, state);

    return totalReminders;
  } catch (err: unknown) {
    if (err instanceof PermissionDeniedError || isPermissionDenied(err)) {
      showPermissionDeniedNotice("Reminders");
      return 0;
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    new Notice(`Reminders sync failed: ${msg}`);
    throw err;
  }
}
