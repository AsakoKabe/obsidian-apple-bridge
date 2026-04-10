import { Notice, TFile, TFolder, Vault } from "obsidian";
import { AppleNote, fetchNotes, htmlToMarkdown } from "./notes-bridge";
import type AppleBridgePlugin from "./main";

interface SyncedNote {
  appleId: string;
  title: string;
  folderPath: string;
  modificationDate: string;
  vaultPath: string;
  lastSyncedAt: string;
}

interface NotesSyncState {
  notes: Record<string, SyncedNote>; // keyed by appleId
}

const SYNC_STATE_KEY = "notes-sync-state";
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim();
}

function buildVaultPath(
  notesRoot: string,
  folderPath: string,
  title: string
): string {
  const safeFolderPath = folderPath
    .split("/")
    .map(sanitizeFileName)
    .join("/");
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

async function loadSyncState(
  plugin: AppleBridgePlugin
): Promise<NotesSyncState> {
  const data = await plugin.loadData();
  return data?.[SYNC_STATE_KEY] ?? { notes: {} };
}

async function saveSyncState(
  plugin: AppleBridgePlugin,
  state: NotesSyncState
): Promise<void> {
  const data = (await plugin.loadData()) ?? {};
  await plugin.saveData({ ...data, [SYNC_STATE_KEY]: state });
}

function toSyncedNote(note: AppleNote, vaultPath: string): SyncedNote {
  return {
    appleId: note.id,
    title: note.title,
    folderPath: note.folderPath,
    modificationDate: note.modificationDate,
    vaultPath,
    lastSyncedAt: new Date().toISOString(),
  };
}

async function ensureFolder(vault: Vault, folderPath: string): Promise<void> {
  const parts = folderPath.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = vault.getAbstractFileByPath(current);
    if (!existing) {
      await vault.createFolder(current);
    } else if (!(existing instanceof TFolder)) {
      // Path exists as a file, not a folder — skip
      return;
    }
  }
}

async function writeNoteToVault(
  vault: Vault,
  vaultPath: string,
  note: AppleNote
): Promise<void> {
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
}

export async function syncNotes(plugin: AppleBridgePlugin): Promise<void> {
  if (!plugin.settings.syncNotes) return;

  const vault = plugin.app.vault;

  try {
    // 1. Fetch all notes from Apple Notes
    const appleNotes = await fetchNotes();
    const state = await loadSyncState(plugin);

    let imported = 0;
    let updated = 0;
    let unchanged = 0;

    // 2. Process each note
    const notesRoot = plugin.settings.notesFolder || "Apple Notes";
    for (const note of appleNotes) {
      const vaultPath = buildVaultPath(notesRoot, note.folderPath, note.title);
      const prev = state.notes[note.id];

      if (prev && prev.modificationDate === note.modificationDate) {
        // Note unchanged since last sync
        unchanged++;
        continue;
      }

      // New or modified note — write to vault
      await writeNoteToVault(vault, vaultPath, note);
      state.notes[note.id] = toSyncedNote(note, vaultPath);

      if (prev) {
        // If the note was renamed or moved, remove old file
        if (prev.vaultPath !== vaultPath) {
          const oldFile = vault.getAbstractFileByPath(prev.vaultPath);
          if (oldFile instanceof TFile) {
            await vault.delete(oldFile);
          }
        }
        updated++;
      } else {
        imported++;
      }
    }

    // 3. Detect deleted notes — remove from vault if Apple Note no longer exists
    const currentAppleIds = new Set(appleNotes.map((n) => n.id));
    for (const [appleId, synced] of Object.entries(state.notes)) {
      if (!currentAppleIds.has(appleId)) {
        const file = vault.getAbstractFileByPath(synced.vaultPath);
        if (file instanceof TFile) {
          await vault.delete(file);
        }
        const { [appleId]: _removed, ...rest } = state.notes;
        state.notes = rest;
      }
    }

    // 4. Persist sync state
    await saveSyncState(plugin, state);

    new Notice(
      `Notes synced: ${imported} imported, ${updated} updated, ${unchanged} unchanged`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    new Notice(`Notes sync failed: ${msg}`);
    throw err;
  }
}
