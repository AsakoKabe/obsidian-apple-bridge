import { execFile } from "child_process";

export interface Reminder {
  id: string;
  listName: string;
  title: string;
  isCompleted: boolean;
  dueDate: string | null; // ISO 8601 or null
  priority: number; // 0 = none, 1 = high, 5 = medium, 9 = low
  notes: string;
  completionDate: string | null;
  modificationDate: string | null; // ISO 8601 or null
}

export interface ReminderList {
  name: string;
  id: string;
}

function runJxa(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", script],
      { maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`JXA error: ${stderr || error.message}`));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

const safeStr = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export async function listReminderLists(): Promise<ReminderList[]> {
  const script = `
    const app = Application("Reminders");
    const lists = app.lists();
    const result = lists.map(l => ({
      name: l.name(),
      id: l.id()
    }));
    JSON.stringify(result);
  `;
  const raw = await runJxa(script);
  return JSON.parse(raw) as ReminderList[];
}

export async function fetchReminders(
  listName?: string,
  includeCompleted = false
): Promise<Reminder[]> {
  const listFilter = listName
    ? `const lists = [app.lists.whose({ name: "${safeStr(listName)}" })[0]];`
    : `const lists = app.lists();`;

  const completedFilter = includeCompleted ? "" : `if (r.completed()) continue;`;

  const script = `
    const app = Application("Reminders");
    ${listFilter}
    const results = [];
    for (const list of lists) {
      if (!list) continue;
      const reminders = list.reminders();
      for (const r of reminders) {
        ${completedFilter}
        const dueDate = r.dueDate();
        const compDate = r.completionDate();
        results.push({
          id: r.id(),
          listName: list.name(),
          title: r.name(),
          isCompleted: r.completed(),
          dueDate: dueDate ? dueDate.toISOString() : null,
          priority: r.priority(),
          notes: r.body() || "",
          completionDate: compDate ? compDate.toISOString() : null,
          modificationDate: (() => { try { const m = r.modificationDate(); return m ? m.toISOString() : null; } catch(_) { return null; } })()
        });
      }
    }
    JSON.stringify(results);
  `;
  const raw = await runJxa(script);
  return JSON.parse(raw) as Reminder[];
}

export async function createReminder(
  listName: string,
  title: string,
  options: {
    dueDate?: Date;
    notes?: string;
    priority?: number;
  } = {}
): Promise<string> {
  const dueLine = options.dueDate
    ? `r.dueDate = new Date("${options.dueDate.toISOString()}");`
    : "";
  const notesLine = options.notes ? `r.body = "${safeStr(options.notes)}";` : "";
  const priorityLine = options.priority !== undefined ? `r.priority = ${options.priority};` : "";

  const script = `
    const app = Application("Reminders");
    const list = app.lists.whose({ name: "${safeStr(listName)}" })[0];
    const r = app.Reminder({
      name: "${safeStr(title)}",
      completed: false
    });
    list.reminders.push(r);
    ${dueLine}
    ${notesLine}
    ${priorityLine}
    r.id();
  `;
  return await runJxa(script);
}

export async function updateReminder(
  reminderId: string,
  updates: Partial<Pick<Reminder, "title" | "isCompleted" | "dueDate" | "notes" | "priority">>
): Promise<void> {
  const setParts: string[] = [];
  if (updates.title !== undefined) setParts.push(`r.name = "${safeStr(updates.title)}";`);
  if (updates.isCompleted !== undefined) setParts.push(`r.completed = ${updates.isCompleted};`);
  if (updates.dueDate !== undefined) {
    setParts.push(
      updates.dueDate ? `r.dueDate = new Date("${updates.dueDate}");` : `r.dueDate = null;`
    );
  }
  if (updates.notes !== undefined) setParts.push(`r.body = "${safeStr(updates.notes)}";`);
  if (updates.priority !== undefined) setParts.push(`r.priority = ${updates.priority};`);

  if (setParts.length === 0) return;

  const script = `
    const app = Application("Reminders");
    const lists = app.lists();
    let found = false;
    for (const list of lists) {
      const matches = list.reminders.whose({ id: "${safeStr(reminderId)}" })();
      if (matches.length > 0) {
        const r = matches[0];
        ${setParts.join("\n        ")}
        found = true;
        break;
      }
    }
    if (!found) throw new Error("Reminder not found: ${safeStr(reminderId)}");
    "ok";
  `;
  await runJxa(script);
}

export async function deleteReminder(reminderId: string): Promise<void> {
  const script = `
    const app = Application("Reminders");
    const lists = app.lists();
    for (const list of lists) {
      const matches = list.reminders.whose({ id: "${safeStr(reminderId)}" })();
      if (matches.length > 0) {
        app.delete(matches[0]);
        break;
      }
    }
    "ok";
  `;
  await runJxa(script);
}
