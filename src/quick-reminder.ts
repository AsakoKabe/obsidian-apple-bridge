import { Editor, Notice } from "obsidian";
import { createReminder } from "./reminders-bridge";
import { dailyNotePath, ensureDailyNote, toDateKey } from "./vault-utils";
import type AppleBridgePlugin from "./main";

const REMINDERS_SECTION_HEADER = "## Reminders";

function todayDateKey(): string {
  return toDateKey(new Date());
}

function formatReminderLine(title: string, reminderId: string, dateKey: string): string {
  return `- [ ] ${title} \uD83D\uDCC5 ${dateKey} [rid:${reminderId}]`;
}

export async function createQuickReminder(
  plugin: AppleBridgePlugin,
  editor: Editor
): Promise<void> {
  const selection = editor.getSelection().trim();
  if (!selection) {
    new Notice("Select some text to create a reminder");
    return;
  }

  // Use first line only as the title (multi-line selection → first line)
  const title = selection.split("\n")[0].trim();
  if (!title) {
    new Notice("Select some text to create a reminder");
    return;
  }

  const listName = plugin.settings.defaultReminderList || "Reminders";
  const dateKey = todayDateKey();

  try {
    const reminderId = await createReminder(listName, title, {
      dueDate: new Date(),
    });

    await writeReminderToDailyNote(plugin, title, reminderId, dateKey);
    await updateSyncState(plugin, title, reminderId);

    new Notice(`Reminder created: "${title}"`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    new Notice(`Failed to create reminder: ${msg}`);
  }
}

async function writeReminderToDailyNote(
  plugin: AppleBridgePlugin,
  title: string,
  reminderId: string,
  dateKey: string
): Promise<void> {
  const vault = plugin.app.vault;
  const remindersFolder = plugin.settings.remindersFolder ?? "";
  const notePath = dailyNotePath(new Date(), remindersFolder);

  const file = await ensureDailyNote(vault, notePath);
  const content = await vault.read(file);
  const lines = content.split("\n");
  const reminderLine = formatReminderLine(title, reminderId, dateKey);

  const sectionIdx = lines.findIndex((l) => l.trim() === REMINDERS_SECTION_HEADER);
  if (sectionIdx >= 0) {
    let endIdx = sectionIdx + 1;
    while (endIdx < lines.length && !lines[endIdx].startsWith("## ")) {
      endIdx++;
    }
    lines.splice(endIdx, 0, reminderLine);
  } else {
    lines.push("", REMINDERS_SECTION_HEADER, "", reminderLine);
  }

  await vault.modify(file, lines.join("\n"));
}

async function updateSyncState(
  plugin: AppleBridgePlugin,
  title: string,
  reminderId: string
): Promise<void> {
  const data = (await plugin.loadData()) ?? {};
  const syncState = data["reminders-sync-state"] ?? { reminders: {} };

  syncState.reminders[reminderId] = {
    appleId: reminderId,
    title,
    isCompleted: false,
    dueDate: new Date().toISOString(),
    notes: "",
    lastSyncedAt: new Date().toISOString(),
  };

  await plugin.saveData({
    ...data,
    "reminders-sync-state": syncState,
  });
}
