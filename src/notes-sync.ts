import { Notice, TFile, Vault } from "obsidian";
import {
  AppleNote,
  fetchNotes,
  htmlToMarkdown,
  markdownToHtml,
  updateNoteBody,
  createNote,
} from "./notes-bridge";
import {
  checkNotesPermission,
  PermissionDeniedError,
  isPermissionDenied,
  showPermissionDeniedNotice,
} from "./permissions";
import { ensureFolder, sanitizeFileName } from "./vault-utils";
import type AppleBridgePlugin from "./main";

interface SyncedNote {
  appleId: string;
  title: string;
  folderPath: string;
  modificationDate: string;
  vaultPath: string;
  lastSyncedAt: string;
  bodyHash: string; // hash of the markdown body at last sync
}

interface NotesSyncState {
  notes: Record<string, SyncedNote>; // keyed by appleId
}

type ConflictResolution = "remote-wins" | "local-wins" | "most-recent";

const SYNC_STATE_KEY = "notes-sync-state";
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n/;
const APPLE_NOTE_ID_REGEX = /^apple_note_id:\s*"([^"]+)"/m;
const FOLDER_REGEX = /^folder:\s*"([^"]+)"/m;

function buildVaultPath(notesRoot: string, folderPath: string, title: string): string {
  const safeFolderPath = folderPath.split("/").map(sanitizeFileName).join("/");
  const safeTitle = sanitizeFileName(title);
  return `${notesRoot}/${safeFolderPath}/${safeTitle}.md`;
}

function buildNoteFrontmatter(note: AppleNote): string {
  return [
    "---",
    `apple_note_id: "${note.id}"`,
    `created: ${note.creationDate}`,
    `modified: ${note.modificationDate}`,
    `folder: "${note.folderPath}"`,
    "---",
    "",
  ].join("\n");
}

/** Simple string hash for change detection (not cryptographic). */
function hashBody(body: string): string {
  let hash = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return hash.toString(36);
}

/** Extract the markdown body from a vault file (strips frontmatter). */
function extractBody(content: string): string {
  const match = content.match(FRONTMATTER_REGEX);
  if (match) {
    return content.slice(match[0].length).trim();
  }
  return content.trim();
}

/** Extract the apple_note_id from a vault file's frontmatter. */
function extractAppleNoteId(content: string): string | null {
  const fmMatch = content.match(FRONTMATTER_REGEX);
  if (!fmMatch) return null;
  const idMatch = fmMatch[1].match(APPLE_NOTE_ID_REGEX);
  return idMatch ? idMatch[1] : null;
}

/** Extract the folder path from a vault file's frontmatter. */
function extractFolder(content: string): string {
  const fmMatch = content.match(FRONTMATTER_REGEX);
  if (!fmMatch) return "Notes";
  const folderMatch = fmMatch[1].match(FOLDER_REGEX);
  return folderMatch ? folderMatch[1] : "Notes";
}

async function loadSyncState(plugin: AppleBridgePlugin): Promise<NotesSyncState> {
  const data = await plugin.loadData();
  return data?.[SYNC_STATE_KEY] ?? { notes: {} };
}

async function saveSyncState(plugin: AppleBridgePlugin, state: NotesSyncState): Promise<void> {
  const data = (await plugin.loadData()) ?? {};
  await plugin.saveData({ ...data, [SYNC_STATE_KEY]: state });
}

function toSyncedNote(note: AppleNote, vaultPath: string, markdownBody: string): SyncedNote {
  return {
    appleId: note.id,
    title: note.title,
    folderPath: note.folderPath,
    modificationDate: note.modificationDate,
    vaultPath,
    lastSyncedAt: new Date().toISOString(),
    bodyHash: hashBody(markdownBody),
  };
}

async function writeNoteToVault(vault: Vault, vaultPath: string, note: AppleNote): Promise<string> {
  const folderPath = vaultPath.substring(0, vaultPath.lastIndexOf("/"));
  await ensureFolder(vault, folderPath);

  const frontmatter = buildNoteFrontmatter(note);
  const markdownBody = htmlToMarkdown(note.body);
  const content = `${frontmatter}${markdownBody}\n`;

  const existing = vault.getAbstractFileByPath(vaultPath);
  if (existing instanceof TFile) {
    await vault.modify(existing, content);
  } else {
    await vault.create(vaultPath, content);
  }

  return markdownBody;
}

export async function syncNotes(plugin: AppleBridgePlugin): Promise<number> {
  if (!plugin.settings.syncNotes) return 0;

  // Pre-flight: verify macOS has granted Notes access before doing any work.
  try {
    await checkNotesPermission();
  } catch (err: unknown) {
    if (err instanceof PermissionDeniedError) {
      showPermissionDeniedNotice(err.appName);
      return 0;
    }
    // Non-permission preflight failure — fall through and let the real call fail.
  }

  const vault = plugin.app.vault;

  try {
    // 1. Fetch all notes from Apple Notes
    const appleNotes = await fetchNotes();
    const state = await loadSyncState(plugin);
    const resolution = (plugin.settings.conflictResolution ?? "remote-wins") as ConflictResolution;

    let imported = 0;
    let updated = 0;
    let unchanged = 0;
    let pushedToApple = 0;

    // Track which apple IDs were processed from the remote side
    const processedAppleIds = new Set<string>();

    // 2. Process each remote note (Apple → Vault)
    const notesRoot = plugin.settings.notesFolder || "Apple Notes";
    for (const note of appleNotes) {
      processedAppleIds.add(note.id);
      const vaultPath = buildVaultPath(notesRoot, note.folderPath, note.title);
      const prev = state.notes[note.id];

      const remoteChanged = !prev || prev.modificationDate !== note.modificationDate;

      // Detect local changes if we have prior state
      let localChanged = false;
      if (prev) {
        const file = vault.getAbstractFileByPath(prev.vaultPath);
        if (file instanceof TFile) {
          const content = await vault.read(file);
          const currentBody = extractBody(content);
          localChanged = hashBody(currentBody) !== prev.bodyHash;
        }
      }

      if (remoteChanged && localChanged) {
        // Both sides changed — apply conflict resolution
        if (resolution === "local-wins") {
          // Push local content to Apple
          const file = vault.getAbstractFileByPath(prev.vaultPath);
          if (file instanceof TFile) {
            const content = await vault.read(file);
            const localBody = extractBody(content);
            const html = markdownToHtml(localBody);
            await updateNoteBody(note.id, html);
            state.notes[note.id] = {
              ...toSyncedNote(note, prev.vaultPath, localBody),
              modificationDate: note.modificationDate,
            };
            pushedToApple++;
          }
        } else if (resolution === "most-recent") {
          const remoteTime = new Date(note.modificationDate).getTime();
          const localSyncTime = new Date(prev.lastSyncedAt).getTime();
          if (remoteTime > localSyncTime) {
            // Remote is newer — overwrite vault
            const mdBody = await writeNoteToVault(vault, vaultPath, note);
            state.notes[note.id] = toSyncedNote(note, vaultPath, mdBody);
            if (prev.vaultPath !== vaultPath) {
              const oldFile = vault.getAbstractFileByPath(prev.vaultPath);
              if (oldFile instanceof TFile) await plugin.app.fileManager.trashFile(oldFile);
            }
            updated++;
          } else {
            // Local is newer — push to Apple
            const file = vault.getAbstractFileByPath(prev.vaultPath);
            if (file instanceof TFile) {
              const content = await vault.read(file);
              const localBody = extractBody(content);
              const html = markdownToHtml(localBody);
              await updateNoteBody(note.id, html);
              state.notes[note.id] = {
                ...toSyncedNote(note, prev.vaultPath, localBody),
                modificationDate: note.modificationDate,
              };
              pushedToApple++;
            }
          }
        } else {
          // remote-wins (default) — overwrite vault with remote
          const mdBody = await writeNoteToVault(vault, vaultPath, note);
          state.notes[note.id] = toSyncedNote(note, vaultPath, mdBody);
          if (prev && prev.vaultPath !== vaultPath) {
            const oldFile = vault.getAbstractFileByPath(prev.vaultPath);
            if (oldFile instanceof TFile) await plugin.app.fileManager.trashFile(oldFile);
          }
          updated++;
        }
      } else if (remoteChanged) {
        // Only remote changed — write to vault
        const mdBody = await writeNoteToVault(vault, vaultPath, note);
        state.notes[note.id] = toSyncedNote(note, vaultPath, mdBody);

        if (prev) {
          if (prev.vaultPath !== vaultPath) {
            const oldFile = vault.getAbstractFileByPath(prev.vaultPath);
            if (oldFile instanceof TFile) await plugin.app.fileManager.trashFile(oldFile);
          }
          updated++;
        } else {
          imported++;
        }
      } else if (localChanged && prev) {
        // Only local changed — push to Apple
        const file = vault.getAbstractFileByPath(prev.vaultPath);
        if (file instanceof TFile) {
          const content = await vault.read(file);
          const localBody = extractBody(content);
          const html = markdownToHtml(localBody);
          await updateNoteBody(note.id, html);
          state.notes[note.id] = {
            ...toSyncedNote(note, prev.vaultPath, localBody),
            modificationDate: note.modificationDate,
          };
          pushedToApple++;
        }
      } else {
        // Neither side changed
        unchanged++;
      }
    }

    // 3. Scan vault files for notes not in Apple (vault-only, created locally)
    const allVaultFiles = vault.getMarkdownFiles();
    const notesPrefix = notesRoot + "/";
    const trackedVaultPaths = new Set(Object.values(state.notes).map((n) => n.vaultPath));

    for (const file of allVaultFiles) {
      if (!file.path.startsWith(notesPrefix)) continue;
      if (trackedVaultPaths.has(file.path)) continue;

      const content = await vault.read(file);
      const existingAppleId = extractAppleNoteId(content);

      // Skip if this file already has an apple ID we already processed
      if (existingAppleId && processedAppleIds.has(existingAppleId)) continue;

      // This is a vault-only note — create in Apple Notes
      const body = extractBody(content);
      if (!body) continue;

      const folderName = extractFolder(content);
      const title = file.path.slice(file.path.lastIndexOf("/") + 1).replace(/\.md$/, "");

      const html = markdownToHtml(body);
      const newAppleId = await createNote(folderName, title, html);

      // Update the vault file with the new apple_note_id in frontmatter
      const now = new Date().toISOString();
      const newFrontmatter = [
        "---",
        `apple_note_id: "${newAppleId}"`,
        `created: ${now}`,
        `modified: ${now}`,
        `folder: "${folderName}"`,
        "---",
        "",
      ].join("\n");

      await vault.modify(file, `${newFrontmatter}${body}\n`);

      state.notes[newAppleId] = {
        appleId: newAppleId,
        title,
        folderPath: folderName,
        modificationDate: now,
        vaultPath: file.path,
        lastSyncedAt: now,
        bodyHash: hashBody(body),
      };

      pushedToApple++;
    }

    // 4. Detect deleted notes — remove from vault if Apple Note no longer exists
    const currentAppleIds = new Set(appleNotes.map((n) => n.id));
    for (const [appleId, synced] of Object.entries(state.notes)) {
      if (!currentAppleIds.has(appleId)) {
        const file = vault.getAbstractFileByPath(synced.vaultPath);
        if (file instanceof TFile) {
          await plugin.app.fileManager.trashFile(file);
        }
        const { [appleId]: _, ...rest } = state.notes;
        state.notes = rest;
      }
    }

    // 5. Persist sync state
    await saveSyncState(plugin, state);

    return imported + updated + unchanged + pushedToApple;
  } catch (err: unknown) {
    if (err instanceof PermissionDeniedError || isPermissionDenied(err)) {
      showPermissionDeniedNotice("Notes");
      return 0;
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    new Notice(`Notes sync failed: ${msg}`);
    throw err;
  }
}
