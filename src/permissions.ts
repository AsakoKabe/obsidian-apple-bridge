import { Notice } from "obsidian";
import { execFile } from "child_process";

/**
 * Thrown when macOS denies Automation/Privacy access to an Apple app.
 * Callers should catch this and show a user-friendly notice rather than
 * surfacing the raw JXA error.
 */
export class PermissionDeniedError extends Error {
  constructor(public readonly appName: string) {
    super(`macOS permission denied for ${appName}`);
    this.name = "PermissionDeniedError";
  }
}

/** Patterns that appear in osascript stderr/message when access is denied. */
const PERMISSION_PATTERNS = [
  "not authorized to send apple events",
  "erraeventnotpermitted",
  "-1743",
  "user didn't allow",
  "access to data is not permitted",
  "not permitted to send apple events",
  "authorization required",
];

export function isPermissionDenied(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return PERMISSION_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Show an Obsidian Notice that explains the permission denial and tells the
 * user exactly where to go in System Settings to fix it.
 */
export function showPermissionDeniedNotice(appName: string): void {
  new Notice(
    `Apple Bridge — ${appName} access denied.\n\n` +
      `Grant access in:\nSystem Settings → Privacy & Security → Automation\n` +
      `Enable Obsidian → ${appName}.`,
    12000
  );
}

/**
 * Run a minimal JXA script to verify that osascript can talk to the given
 * Apple app.  Throws PermissionDeniedError if macOS blocks the call, or a
 * plain Error for any other osascript failure.
 */
function runPermissionCheck(appName: string): Promise<void> {
  const script = `Application("${appName}").name()`;
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", script],
      { maxBuffer: 1024 },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        const combined = stderr || error.message;
        const wrapped = new Error(combined);
        if (isPermissionDenied(wrapped)) {
          reject(new PermissionDeniedError(appName));
        } else {
          reject(new Error(`JXA preflight failed for ${appName}: ${combined}`));
        }
      }
    );
  });
}

export function checkCalendarPermission(): Promise<void> {
  return runPermissionCheck("Calendar");
}

export function checkRemindersPermission(): Promise<void> {
  return runPermissionCheck("Reminders");
}

export function checkNotesPermission(): Promise<void> {
  return runPermissionCheck("Notes");
}

export function checkContactsPermission(): Promise<void> {
  return runPermissionCheck("Contacts");
}
