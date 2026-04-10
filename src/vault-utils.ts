import { TFile, TFolder, Vault } from "obsidian";

/** Recursively creates folders for the given path if they don't exist. */
export async function ensureFolder(vault: Vault, folderPath: string): Promise<void> {
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

/** Returns the vault path for a daily note: `folder/YYYY-MM-DD.md`. */
export function dailyNotePath(date: Date, folder: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const name = `${y}-${m}-${d}.md`;
  return folder ? `${folder}/${name}` : name;
}

/** Returns `YYYY-MM-DD` string for a Date. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Returns a new Date offset by `n` days. */
export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Returns a new Date set to midnight (start of day). */
export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Returns a new Date set to 23:59:59.999 (end of day). */
export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Builds a range of dates from `pastDays` before `today` to `futureDays` after. */
export function buildDateRange(today: Date, pastDays: number, futureDays: number): Date[] {
  const dates: Date[] = [];
  for (let offset = -pastDays; offset <= futureDays; offset++) {
    dates.push(addDays(startOfDay(today), offset));
  }
  return dates;
}

/** Ensures a daily note file exists, creating it with a title heading if needed. */
export async function ensureDailyNote(vault: Vault, path: string): Promise<TFile> {
  const existing = vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;
  const folderPath = path.substring(0, path.lastIndexOf("/"));
  if (folderPath) {
    await ensureFolder(vault, folderPath);
  }
  const title = path.replace(/^.*\//, "").replace(".md", "");
  return await vault.create(path, `# ${title}\n\n`);
}

/** Replaces characters that are not valid in file names. */
export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim();
}
