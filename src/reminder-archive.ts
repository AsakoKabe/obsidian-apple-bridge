import { TFile, Vault } from "obsidian";
import { ensureFolder } from "./vault-utils";

const ARCHIVE_TITLE = "# Completed Reminders";
const DATE_HEADING_REGEX = /^## (\d{4}-\d{2}-\d{2})$/;
const RID_REGEX = /\[rid:([^\]]+)\]/;

export function resolveArchivePath(remindersFolder: string, archiveFilePath: string): string {
  if (archiveFilePath.includes("/")) {
    return archiveFilePath;
  }
  return remindersFolder ? `${remindersFolder}/${archiveFilePath}` : archiveFilePath;
}

export function parseArchiveNote(content: string): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  if (!content.trim()) return groups;

  const lines = content.split("\n");
  let currentDate: string | null = null;

  for (const line of lines) {
    const match = line.match(DATE_HEADING_REGEX);
    if (match) {
      currentDate = match[1];
      groups.set(currentDate, []);
      continue;
    }
    if (currentDate && line.trim() && !line.startsWith("# ")) {
      groups.get(currentDate)!.push(line);
    }
  }

  return groups;
}

export function buildArchiveContent(groups: Map<string, string[]>): string {
  if (groups.size === 0) {
    return `${ARCHIVE_TITLE}\n`;
  }

  const sortedDates = [...groups.keys()].sort().reverse();
  const sections = sortedDates.map((date) => {
    const lines = groups.get(date)!;
    return `## ${date}\n\n${lines.join("\n")}\n`;
  });

  return `${ARCHIVE_TITLE}\n\n${sections.join("\n")}`;
}

function extractRid(line: string): string | null {
  const match = line.match(RID_REGEX);
  return match ? match[1] : null;
}

export function insertIntoArchive(
  existingContent: string,
  dateKey: string,
  lines: string[]
): string {
  const groups = parseArchiveNote(existingContent);
  const existing = groups.get(dateKey) ?? [];
  const existingRids = new Set(existing.map(extractRid).filter(Boolean));

  const newLines = lines.filter((line) => {
    const rid = extractRid(line);
    return !rid || !existingRids.has(rid);
  });

  groups.set(dateKey, [...existing, ...newLines]);
  return buildArchiveContent(groups);
}

export async function archiveCompletedReminders(
  vault: Vault,
  archivePath: string,
  dateKey: string,
  completedLines: string[]
): Promise<void> {
  if (completedLines.length === 0) return;

  const existing = vault.getAbstractFileByPath(archivePath);

  if (existing instanceof TFile) {
    const content = await vault.read(existing);
    const updated = insertIntoArchive(content, dateKey, completedLines);
    await vault.modify(existing, updated);
  } else {
    // Ensure parent folders exist
    const folderPath = archivePath.includes("/")
      ? archivePath.slice(0, archivePath.lastIndexOf("/"))
      : "";
    if (folderPath) {
      await ensureFolder(vault, folderPath);
    }

    const content = insertIntoArchive("", dateKey, completedLines);
    await vault.create(archivePath, content);
  }
}
