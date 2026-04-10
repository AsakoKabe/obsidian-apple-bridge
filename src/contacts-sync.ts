import { Notice, TFile, TFolder, Vault } from "obsidian";
import { Contact, fetchContacts } from "./contacts-bridge";
import {
  checkContactsPermission,
  PermissionDeniedError,
  isPermissionDenied,
  showPermissionDeniedNotice,
} from "./permissions";
import type AppleBridgePlugin from "./main";

interface SyncedContact {
  appleId: string;
  firstName: string;
  lastName: string;
  modificationDate: string;
  vaultPath: string;
  lastSyncedAt: string;
}

interface ContactsSyncState {
  contacts: Record<string, SyncedContact>; // keyed by appleId
}

const SYNC_STATE_KEY = "contacts-sync-state";
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim();
}

function displayName(contact: Contact): string {
  const parts = [contact.firstName, contact.lastName].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  if (contact.organization) return contact.organization;
  if (contact.nickname) return contact.nickname;
  return "Unknown Contact";
}

function buildVaultPath(contactsRoot: string, contact: Contact): string {
  const name = sanitizeFileName(displayName(contact));
  return `${contactsRoot}/${name}.md`;
}

function formatAddress(addr: {
  label: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}): string {
  const parts = [addr.street, addr.city, addr.state, addr.postalCode, addr.country].filter(Boolean);
  return parts.join(", ");
}

function buildContactFrontmatter(contact: Contact): string {
  const lines = [
    "---",
    `apple_contact_id: "${contact.id}"`,
    `modified: ${contact.modificationDate}`,
  ];

  if (contact.birthday) {
    lines.push(`birthday: ${contact.birthday.split("T")[0]}`);
  }

  if (contact.emails.length > 0) {
    lines.push("emails:");
    for (const e of contact.emails) {
      lines.push(`  - label: "${e.label}"`);
      lines.push(`    value: "${e.value}"`);
    }
  }

  if (contact.phones.length > 0) {
    lines.push("phones:");
    for (const p of contact.phones) {
      lines.push(`  - label: "${p.label}"`);
      lines.push(`    value: "${p.value}"`);
    }
  }

  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

function buildContactBody(contact: Contact): string {
  const sections: string[] = [];

  // Title
  sections.push(`# ${displayName(contact)}`);
  sections.push("");

  // Organization / Job
  if (contact.organization || contact.jobTitle) {
    const orgParts = [contact.jobTitle, contact.organization].filter(Boolean);
    sections.push(orgParts.join(" at "));
    sections.push("");
  }

  // Nickname
  if (contact.nickname) {
    sections.push(`**Nickname:** ${contact.nickname}`);
    sections.push("");
  }

  // Contact info
  if (contact.emails.length > 0 || contact.phones.length > 0) {
    sections.push("## Contact");
    sections.push("");
    for (const email of contact.emails) {
      sections.push(`- ${email.label}: ${email.value}`);
    }
    for (const phone of contact.phones) {
      sections.push(`- ${phone.label}: ${phone.value}`);
    }
    sections.push("");
  }

  // Addresses
  if (contact.addresses.length > 0) {
    sections.push("## Addresses");
    sections.push("");
    for (const addr of contact.addresses) {
      const formatted = formatAddress(addr);
      if (formatted) {
        sections.push(`- ${addr.label}: ${formatted}`);
      }
    }
    sections.push("");
  }

  // URLs
  if (contact.urls.length > 0) {
    sections.push("## Links");
    sections.push("");
    for (const url of contact.urls) {
      sections.push(`- ${url.label}: ${url.value}`);
    }
    sections.push("");
  }

  // Social profiles
  if (contact.socialProfiles.length > 0) {
    sections.push("## Social");
    sections.push("");
    for (const sp of contact.socialProfiles) {
      sections.push(`- ${sp.label}: ${sp.value}`);
    }
    sections.push("");
  }

  // Birthday
  if (contact.birthday) {
    sections.push(`**Birthday:** ${contact.birthday.split("T")[0]}`);
    sections.push("");
  }

  // Notes
  if (contact.note) {
    sections.push("## Notes");
    sections.push("");
    sections.push(contact.note);
    sections.push("");
  }

  return sections.join("\n");
}

async function loadSyncState(plugin: AppleBridgePlugin): Promise<ContactsSyncState> {
  const data = await plugin.loadData();
  return data?.[SYNC_STATE_KEY] ?? { contacts: {} };
}

async function saveSyncState(plugin: AppleBridgePlugin, state: ContactsSyncState): Promise<void> {
  const data = (await plugin.loadData()) ?? {};
  await plugin.saveData({ ...data, [SYNC_STATE_KEY]: state });
}

function toSyncedContact(contact: Contact, vaultPath: string): SyncedContact {
  return {
    appleId: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    modificationDate: contact.modificationDate,
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
      return;
    }
  }
}

async function writeContactToVault(
  vault: Vault,
  vaultPath: string,
  contact: Contact
): Promise<void> {
  const folderPath = vaultPath.substring(0, vaultPath.lastIndexOf("/"));
  await ensureFolder(vault, folderPath);

  const frontmatter = buildContactFrontmatter(contact);
  const body = buildContactBody(contact);
  const content = `${frontmatter}${body}`;

  const existing = vault.getAbstractFileByPath(vaultPath);
  if (existing instanceof TFile) {
    await vault.modify(existing, content);
  } else {
    await vault.create(vaultPath, content);
  }
}

export async function syncContacts(plugin: AppleBridgePlugin): Promise<void> {
  if (!plugin.settings.syncContacts) return;

  // Pre-flight: verify macOS has granted Contacts access before doing any work.
  try {
    await checkContactsPermission();
  } catch (err: unknown) {
    if (err instanceof PermissionDeniedError) {
      showPermissionDeniedNotice(err.appName);
      return;
    }
    // Non-permission preflight failure — fall through and let the real call fail.
  }

  const vault = plugin.app.vault;

  try {
    // 1. Fetch all contacts from Apple Contacts
    const appleContacts = await fetchContacts();
    const state = await loadSyncState(plugin);

    let imported = 0;
    let updated = 0;
    let unchanged = 0;

    // 2. Process each contact
    const contactsRoot = plugin.settings.contactsFolder || "People";
    for (const contact of appleContacts) {
      const vaultPath = buildVaultPath(contactsRoot, contact);
      const prev = state.contacts[contact.id];

      if (prev && prev.modificationDate === contact.modificationDate) {
        unchanged++;
        continue;
      }

      // New or modified contact — write to vault
      await writeContactToVault(vault, vaultPath, contact);
      state.contacts[contact.id] = toSyncedContact(contact, vaultPath);

      if (prev) {
        // If the contact was renamed, remove old file
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

    // 3. Detect deleted contacts — remove from vault
    const currentAppleIds = new Set(appleContacts.map((c) => c.id));
    for (const [appleId, synced] of Object.entries(state.contacts)) {
      if (!currentAppleIds.has(appleId)) {
        const file = vault.getAbstractFileByPath(synced.vaultPath);
        if (file instanceof TFile) {
          await vault.delete(file);
        }
        const { [appleId]: _removed, ...rest } = state.contacts;
        state.contacts = rest;
      }
    }

    // 4. Persist sync state
    await saveSyncState(plugin, state);

    new Notice(`Contacts synced: ${imported} imported, ${updated} updated, ${unchanged} unchanged`);
  } catch (err: unknown) {
    if (err instanceof PermissionDeniedError || isPermissionDenied(err)) {
      showPermissionDeniedNotice("Contacts");
      return;
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    new Notice(`Contacts sync failed: ${msg}`);
    throw err;
  }
}
