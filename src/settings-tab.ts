import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { CreateEventModal } from "./create-event-modal";
import { OnboardingModal } from "./onboarding-modal";
import { DEFAULT_EVENT_TEMPLATE } from "./event-template";
import { type ServiceKey, type SyncStatus, loadStatusMap, relativeTime } from "./sync-status";
import type AppleBridgePlugin from "./main";

export class AppleBridgeSettingTab extends PluginSettingTab {
  plugin: AppleBridgePlugin;

  constructor(app: App, plugin: AppleBridgePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private renderCalendarTemplateSetting(container: HTMLElement, calName: string): void {
    const setting = new Setting(container)
      .setName(calName)
      .addText((text) =>
        text
          .setPlaceholder("Calendar name")
          .setValue(calName)
          .onChange(async (newName) => {
            const trimmed = newName.trim();
            if (!trimmed || trimmed === calName) return;
            const templates = { ...this.plugin.settings.eventTemplates };
            templates[trimmed] = templates[calName] ?? "";
            delete templates[calName];
            this.plugin.settings.eventTemplates = templates;
            await this.plugin.saveSettings();
            await this.display();
          })
      )
      .addTextArea((ta) =>
        ta
          .setPlaceholder(DEFAULT_EVENT_TEMPLATE)
          .setValue(this.plugin.settings.eventTemplates[calName] ?? "")
          .onChange(async (value) => {
            const templates = { ...this.plugin.settings.eventTemplates };
            templates[calName] = value;
            this.plugin.settings.eventTemplates = templates;
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn.setIcon("trash").onClick(async () => {
          const templates = { ...this.plugin.settings.eventTemplates };
          delete templates[calName];
          this.plugin.settings.eventTemplates = templates;
          await this.plugin.saveSettings();
          await this.display();
        })
      );
    setting.settingEl.addClass("apple-bridge-template-setting");
  }

  private renderFilterSetting(
    container: HTMLElement,
    label: string,
    filterKey: "calendarFilter" | "reminderListFilter"
  ): void {
    const current = this.plugin.settings[filterKey];

    new Setting(container)
      .setName(`${label} filter mode`)
      .setDesc("Include: only sync listed names. Exclude: sync everything except listed names.")
      .addDropdown((dd) =>
        dd
          .addOption("none", "No filter (sync all)")
          .addOption("include", "Include only…")
          .addOption("exclude", "Exclude…")
          .setValue(current?.mode ?? "none")
          .onChange(async (value) => {
            if (value === "none") {
              this.plugin.settings[filterKey] = undefined;
            } else {
              this.plugin.settings[filterKey] = {
                mode: value as "include" | "exclude",
                names: current?.names ?? [],
              };
            }
            await this.plugin.saveSettings();
            await this.display();
          })
      );

    if (current) {
      new Setting(container)
        .setName(`${label} names`)
        .setDesc("Comma-separated list of names to include or exclude")
        .addText((text) =>
          text
            .setPlaceholder("e.g. Work, Personal")
            .setValue(current.names.join(", "))
            .onChange(async (value) => {
              const names = value
                .split(",")
                .map((n) => n.trim())
                .filter(Boolean);
              this.plugin.settings[filterKey] = {
                ...current,
                names,
              };
              await this.plugin.saveSettings();
            })
        );
    }
  }

  private renderServiceSection(
    parent: HTMLElement,
    opts: {
      service: ServiceKey;
      label: string;
      icon: string;
      iconClass: string;
      toggleDesc: string;
      enabled: boolean;
      status: SyncStatus;
      onToggle: (value: boolean) => Promise<void>;
      onRetry: () => void;
    }
  ): HTMLElement {
    const section = parent.createDiv({ cls: "apple-bridge-section" });
    const title = section.createDiv({ cls: "apple-bridge-section-title" });
    title.createSpan({
      cls: `apple-bridge-icon apple-bridge-icon--${opts.iconClass}`,
      text: opts.icon,
    });
    title.createSpan({ text: opts.label });
    appendStatusDot(title, opts.status, opts.enabled);

    appendSyncMeta(section, opts.status);
    appendErrorBanner(section, opts.status, opts.onRetry);

    new Setting(section)
      .setName(`Sync ${opts.label}`)
      .setDesc(opts.toggleDesc)
      .addToggle((toggle) => toggle.setValue(opts.enabled).onChange(opts.onToggle));

    return section;
  }

  private renderEventTemplatesSubsection(section: HTMLElement): void {
    const tmplHeading = section.createDiv({ cls: "apple-bridge-subsection-title" });
    tmplHeading.createEl("h4", { text: "Event templates" });
    tmplHeading.createEl("p", {
      cls: "setting-item-description",
      text: `Per-calendar templates control how events appear in daily notes. Use {{title}}, {{time}}, {{start}}, {{end}}, {{location}}, {{calendar}}, {{notes}}, {{url}}, {{id}}. Wrap optional parts in {{#var}}...{{/var}}.`,
    });

    const defaultTmplSetting = new Setting(section)
      .setName("Default template")
      .setDesc("Used for calendars without a specific template")
      .addTextArea((ta) =>
        ta
          .setPlaceholder(DEFAULT_EVENT_TEMPLATE)
          .setValue(this.plugin.settings.eventTemplates["*"] ?? "")
          .onChange(async (value) => {
            const templates = { ...this.plugin.settings.eventTemplates };
            if (value.trim()) {
              templates["*"] = value.trim();
            } else {
              delete templates["*"];
            }
            this.plugin.settings.eventTemplates = templates;
            await this.plugin.saveSettings();
          })
      );
    defaultTmplSetting.settingEl.addClass("apple-bridge-template-setting");

    const calendarNames = Object.keys(this.plugin.settings.eventTemplates).filter((k) => k !== "*");
    for (const calName of calendarNames) {
      this.renderCalendarTemplateSetting(section, calName);
    }

    new Setting(section).setName("Add calendar template").addButton((btn) =>
      btn.setButtonText("+ Add").onClick(async () => {
        const name = "New Calendar";
        const templates = { ...this.plugin.settings.eventTemplates };
        if (!templates[name]) {
          templates[name] = "";
          this.plugin.settings.eventTemplates = templates;
          await this.plugin.saveSettings();
          await this.display();
        }
      })
    );
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("apple-bridge-settings");

    const statusMap = await loadStatusMap(() => this.plugin.loadData());
    const retry = () => {
      this.plugin.syncAll();
      void this.display();
    };

    // --- Header banner ---
    const header = containerEl.createDiv({ cls: "apple-bridge-header" });
    header.createSpan({ cls: "apple-bridge-header-logo", text: "\uD83C\uDF4E" });
    const headerText = header.createDiv({ cls: "apple-bridge-header-text" });
    headerText.createEl("h2", { text: "Apple Bridge" });
    headerText.createEl("p", {
      text: "Connect your Obsidian vault with Apple apps",
    });

    // --- Service sections ---
    const calSection = this.renderServiceSection(containerEl, {
      service: "calendar",
      label: "Calendar",
      icon: "\uD83D\uDCC5",
      iconClass: "calendar",
      toggleDesc: "Sync Apple Calendar events to your vault",
      enabled: this.plugin.settings.syncCalendar,
      status: statusMap.calendar,
      onToggle: async (value) => {
        this.plugin.settings.syncCalendar = value;
        await this.plugin.saveSettings();
      },
      onRetry: retry,
    });

    new Setting(calSection)
      .setName("Default calendar")
      .setDesc("Apple Calendar name to create new events in")
      .addText((text) =>
        text
          .setPlaceholder("Calendar")
          .setValue(this.plugin.settings.defaultCalendarName)
          .onChange(async (value) => {
            this.plugin.settings.defaultCalendarName = value || "Calendar";
            await this.plugin.saveSettings();
          })
      );

    new Setting(calSection)
      .setName("Vault folder")
      .setDesc("Vault folder for daily notes with calendar events (empty = vault root)")
      .addText((text) =>
        text
          .setPlaceholder("e.g. Calendar")
          .setValue(this.plugin.settings.calendarFolder)
          .onChange(async (value) => {
            this.plugin.settings.calendarFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    this.renderFilterSetting(calSection, "Calendar", "calendarFilter");
    this.renderEventTemplatesSubsection(calSection);

    appendEmptyState(calSection, statusMap.calendar, "calendar", () => {
      new CreateEventModal(this.plugin.app, this.plugin).open();
    });

    const remSection = this.renderServiceSection(containerEl, {
      service: "reminders",
      label: "Reminders",
      icon: "\u2705",
      iconClass: "reminders",
      toggleDesc: "Sync Apple Reminders to your vault",
      enabled: this.plugin.settings.syncReminders,
      status: statusMap.reminders,
      onToggle: async (value) => {
        this.plugin.settings.syncReminders = value;
        await this.plugin.saveSettings();
      },
      onRetry: retry,
    });

    new Setting(remSection)
      .setName("Default list")
      .setDesc("Apple Reminders list to create new reminders in")
      .addText((text) =>
        text
          .setPlaceholder("Reminders")
          .setValue(this.plugin.settings.defaultReminderList)
          .onChange(async (value) => {
            this.plugin.settings.defaultReminderList = value || "Reminders";
            await this.plugin.saveSettings();
          })
      );

    new Setting(remSection)
      .setName("Vault folder")
      .setDesc("Vault folder for daily notes with reminders (empty = vault root)")
      .addText((text) =>
        text
          .setPlaceholder("e.g. Reminders")
          .setValue(this.plugin.settings.remindersFolder)
          .onChange(async (value) => {
            this.plugin.settings.remindersFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    this.renderFilterSetting(remSection, "Reminder list", "reminderListFilter");

    new Setting(remSection)
      .setName("Archive completed reminders")
      .setDesc("Move completed reminders from daily notes to a separate archive note")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.archiveCompletedReminders).onChange(async (value) => {
          this.plugin.settings.archiveCompletedReminders = value;
          await this.plugin.saveSettings();
          await this.display();
        })
      );

    if (this.plugin.settings.archiveCompletedReminders) {
      new Setting(remSection)
        .setName("Archive file")
        .setDesc("Path to the archive note for completed reminders (relative to vault root)")
        .addText((text) =>
          text
            .setPlaceholder("Completed Reminders.md")
            .setValue(this.plugin.settings.archiveFilePath)
            .onChange(async (value) => {
              this.plugin.settings.archiveFilePath = value.trim() || "Completed Reminders.md";
              await this.plugin.saveSettings();
            })
        );
    }

    appendEmptyState(remSection, statusMap.reminders, "reminders", null);

    const conSection = this.renderServiceSection(containerEl, {
      service: "contacts",
      label: "Contacts",
      icon: "\uD83D\uDC64",
      iconClass: "contacts",
      toggleDesc: "Import Apple Contacts as notes",
      enabled: this.plugin.settings.syncContacts,
      status: statusMap.contacts,
      onToggle: async (value) => {
        this.plugin.settings.syncContacts = value;
        await this.plugin.saveSettings();
      },
      onRetry: retry,
    });

    new Setting(conSection)
      .setName("Vault folder")
      .setDesc("Vault folder for imported Apple Contacts")
      .addText((text) =>
        text
          .setPlaceholder("People")
          .setValue(this.plugin.settings.contactsFolder)
          .onChange(async (value) => {
            this.plugin.settings.contactsFolder = value.trim() || "People";
            await this.plugin.saveSettings();
          })
      );

    appendEmptyState(conSection, statusMap.contacts, "contacts", null);

    const notSection = this.renderServiceSection(containerEl, {
      service: "notes",
      label: "Notes",
      icon: "\uD83D\uDCDD",
      iconClass: "notes",
      toggleDesc: "Import Apple Notes into your vault",
      enabled: this.plugin.settings.syncNotes,
      status: statusMap.notes,
      onToggle: async (value) => {
        this.plugin.settings.syncNotes = value;
        await this.plugin.saveSettings();
      },
      onRetry: retry,
    });

    new Setting(notSection)
      .setName("Vault folder")
      .setDesc("Vault folder for imported Apple Notes")
      .addText((text) =>
        text
          .setPlaceholder("Apple Notes")
          .setValue(this.plugin.settings.notesFolder)
          .onChange(async (value) => {
            this.plugin.settings.notesFolder = value.trim() || "Apple Notes";
            await this.plugin.saveSettings();
          })
      );

    appendEmptyState(notSection, statusMap.notes, "notes", null);

    // --- General settings section ---
    const genSection = containerEl.createDiv({
      cls: "apple-bridge-section apple-bridge-section--advanced",
    });
    const genTitle = genSection.createDiv({ cls: "apple-bridge-section-title" });
    genTitle.createSpan({ text: "General" });

    new Setting(genSection)
      .setName("Sync interval")
      .setDesc("How often to auto-sync, in minutes (0 = manual only)")
      .addText((text) =>
        text
          .setPlaceholder("15")
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed >= 0) {
              this.plugin.settings.syncIntervalMinutes = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(genSection)
      .setName("Sync range: past days")
      .setDesc("How many days back to include in each sync (0 = today only)")
      .addText((text) =>
        text
          .setPlaceholder("7")
          .setValue(String(this.plugin.settings.syncRangePastDays))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed >= 0) {
              this.plugin.settings.syncRangePastDays = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(genSection)
      .setName("Sync range: future days")
      .setDesc("How many days ahead to include in each sync (0 = today only)")
      .addText((text) =>
        text
          .setPlaceholder("14")
          .setValue(String(this.plugin.settings.syncRangeFutureDays))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed >= 0) {
              this.plugin.settings.syncRangeFutureDays = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(genSection)
      .setName("Conflict resolution")
      .setDesc("How to resolve conflicts when both local and remote change between syncs")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("remote-wins", "Remote wins (Apple overrides local)")
          .addOption("local-wins", "Local wins (vault overrides Apple)")
          .addOption("most-recent", "Most recent change wins")
          .setValue(this.plugin.settings.conflictResolution)
          .onChange(async (value) => {
            this.plugin.settings.conflictResolution = value as
              | "remote-wins"
              | "local-wins"
              | "most-recent";
            await this.plugin.saveSettings();
          })
      );

    new Setting(genSection)
      .setName("Dataview metadata")
      .setDesc(
        "Add frontmatter fields (apple_events, apple_reminders, apple_calendars, etc.) to daily notes for Dataview queries"
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.dataviewMetadata).onChange(async (value) => {
          this.plugin.settings.dataviewMetadata = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(genSection)
      .setName("Restart setup wizard")
      .setDesc("Re-run the first-run onboarding to test permissions again")
      .addButton((btn) =>
        btn.setButtonText("Open Wizard").onClick(() => {
          new OnboardingModal(this.plugin.app, this.plugin).open();
        })
      );
  }
}

// ─── Settings tab helper renderers ────────────────────────────────────────

function appendStatusDot(titleEl: HTMLElement, status: SyncStatus, enabled: boolean) {
  let cls = "apple-bridge-status-dot ";
  if (!enabled) {
    cls += "apple-bridge-status-dot--disabled";
  } else if (status.lastSyncAt === null) {
    cls += "apple-bridge-status-dot--idle";
  } else if (status.lastError) {
    cls += "apple-bridge-status-dot--error";
  } else {
    cls += "apple-bridge-status-dot--ok";
  }
  titleEl.createSpan({ cls });
}

function appendSyncMeta(container: HTMLElement, status: SyncStatus) {
  if (!status.lastSyncAt) return;
  const meta = container.createDiv({ cls: "apple-bridge-sync-meta" });
  if (status.lastError) {
    meta.textContent = `Last sync failed \u00B7 ${relativeTime(status.lastSyncAt)}`;
  } else {
    const count = status.itemCount ?? 0;
    meta.textContent = `Last synced ${relativeTime(status.lastSyncAt)} \u00B7 ${count} item${count !== 1 ? "s" : ""}`;
  }
}

function appendErrorBanner(container: HTMLElement, status: SyncStatus, onRetry: () => void) {
  if (!status.lastError) return;
  const kind = status.errorKind ?? "general";

  const banner = container.createDiv({
    cls: `apple-bridge-error-banner apple-bridge-error-banner--${kind}`,
  });

  const titleEl = banner.createDiv({ cls: "apple-bridge-error-banner-title" });
  titleEl.createSpan({
    text:
      kind === "permission"
        ? "\u26D4 Permission denied"
        : kind === "unavailable"
          ? "\u26A0\uFE0F App unavailable"
          : "\u274C Sync failed",
  });

  const body = banner.createDiv({ cls: "apple-bridge-error-banner-body" });
  if (kind === "permission") {
    body.textContent =
      "Obsidian needs Automation access. Go to System Settings \u2192 Privacy & Security \u2192 Automation \u2192 Obsidian.";
  } else if (kind === "unavailable") {
    body.textContent =
      "Could not reach the Apple app. Make sure it is installed and Automation is enabled in System Settings.";
  } else {
    body.textContent = status.lastError;
  }

  const actions = banner.createDiv({ cls: "apple-bridge-error-banner-actions" });

  if (kind === "permission") {
    const settingsBtn = actions.createEl("button", {
      text: "Open System Settings",
    });
    settingsBtn.addEventListener("click", () => {
      new Notice("System Settings \u2192 Privacy & Security \u2192 Automation \u2192 Obsidian");
    });
  }

  const retryBtn = actions.createEl("button", { text: "Retry" });
  retryBtn.addEventListener("click", onRetry);
}

const EMPTY_STATE_COPY: Record<
  ServiceKey,
  { icon: string; title: string; desc: string; actionLabel?: string }
> = {
  calendar: {
    icon: "\uD83D\uDCC5",
    title: "No events today",
    desc: "Your calendar is clear. Enjoy the quiet!",
    actionLabel: "+ Create Event",
  },
  reminders: {
    icon: "\u2705",
    title: "No reminders due today",
    desc: "All clear! Reminders will appear here when synced.",
  },
  contacts: {
    icon: "\uD83D\uDC64",
    title: "No contacts imported yet",
    desc: "Enable Contacts sync to import your Apple Contacts as Obsidian notes.",
  },
  notes: {
    icon: "\uD83D\uDCDD",
    title: "No notes found",
    desc: "Apple Notes sync is enabled but no notes were returned. Try adding notes in the Apple Notes app.",
  },
};

function appendEmptyState(
  container: HTMLElement,
  status: SyncStatus,
  service: ServiceKey,
  onAction: (() => void) | null
) {
  // Only show after a successful sync that returned 0 items
  if (status.lastError !== null || status.itemCount === null || status.itemCount > 0) {
    return;
  }

  const copy = EMPTY_STATE_COPY[service];
  const el = container.createDiv({ cls: "apple-bridge-empty-state" });
  el.createSpan({ cls: "apple-bridge-empty-state-icon", text: copy.icon });
  el.createDiv({ cls: "apple-bridge-empty-state-title", text: copy.title });
  el.createDiv({ cls: "apple-bridge-empty-state-desc", text: copy.desc });

  if (copy.actionLabel && onAction) {
    const btn = el.createEl("button", {
      cls: "mod-cta apple-bridge-empty-state-action",
      text: copy.actionLabel,
    });
    btn.addEventListener("click", onAction);
  }
}
