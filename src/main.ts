import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { syncCalendar } from "./calendar-sync";
import { syncReminders } from "./reminders-sync";
import { syncNotes } from "./notes-sync";
import { syncContacts } from "./contacts-sync";
import { CreateEventModal } from "./create-event-modal";

type ConflictResolution = "remote-wins" | "local-wins" | "most-recent";

interface AppleBridgeSettings {
  syncReminders: boolean;
  syncCalendar: boolean;
  syncContacts: boolean;
  syncNotes: boolean;
  syncIntervalMinutes: number;
  defaultCalendarName: string;
  defaultReminderList: string;
  conflictResolution: ConflictResolution;
  calendarFolder: string;
  remindersFolder: string;
  notesFolder: string;
  contactsFolder: string;
}

const DEFAULT_SETTINGS: AppleBridgeSettings = {
  syncReminders: true,
  syncCalendar: true,
  syncContacts: false,
  syncNotes: false,
  syncIntervalMinutes: 15,
  defaultCalendarName: "Calendar",
  defaultReminderList: "Reminders",
  conflictResolution: "remote-wins",
  calendarFolder: "",
  remindersFolder: "",
  notesFolder: "Apple Notes",
  contactsFolder: "People",
};

export default class AppleBridgePlugin extends Plugin {
  settings: AppleBridgeSettings;

  async onload() {
    await this.loadSettings();

    this.addSettingTab(new AppleBridgeSettingTab(this.app, this));

    this.addCommand({
      id: "sync-apple-apps",
      name: "Sync Apple Apps now",
      callback: () => {
        this.syncAll();
      },
    });

    this.addCommand({
      id: "create-calendar-event",
      name: "Create Calendar Event",
      callback: () => {
        new CreateEventModal(this.app, this).open();
      },
    });

    const ribbonEl = this.addRibbonIcon("refresh-cw", "Sync Apple Apps", () => {
      this.syncAll();
    });
    ribbonEl.addClass("apple-bridge-ribbon-icon");

    if (this.settings.syncIntervalMinutes > 0) {
      this.registerInterval(
        window.setInterval(
          () => this.syncAll(),
          this.settings.syncIntervalMinutes * 60 * 1000
        )
      );
    }
  }

  onunload() {
    // cleanup handled by Obsidian's registerInterval
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async syncAll() {
    await Promise.all([
      syncCalendar(this),
      syncReminders(this),
      syncNotes(this),
      syncContacts(this),
    ]);
  }
}

class AppleBridgeSettingTab extends PluginSettingTab {
  plugin: AppleBridgePlugin;

  constructor(app: App, plugin: AppleBridgePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("apple-bridge-settings");

    // --- Header banner ---
    const header = containerEl.createDiv({ cls: "apple-bridge-header" });
    header.createSpan({ cls: "apple-bridge-header-logo", text: "\uD83C\uDF4E" });
    const headerText = header.createDiv({ cls: "apple-bridge-header-text" });
    headerText.createEl("h2", { text: "Apple Bridge" });
    headerText.createEl("p", {
      text: "Connect your Obsidian vault with Apple apps",
    });

    // --- Calendar section ---
    const calSection = containerEl.createDiv({ cls: "apple-bridge-section" });
    const calTitle = calSection.createDiv({ cls: "apple-bridge-section-title" });
    calTitle.createSpan({
      cls: "apple-bridge-icon apple-bridge-icon--calendar",
      text: "\uD83D\uDCC5",
    });
    calTitle.createSpan({ text: "Calendar" });

    new Setting(calSection)
      .setName("Sync Calendar")
      .setDesc("Sync Apple Calendar events to your vault")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncCalendar)
          .onChange(async (value) => {
            this.plugin.settings.syncCalendar = value;
            await this.plugin.saveSettings();
          })
      );

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
      .setDesc(
        "Vault folder for daily notes with calendar events (empty = vault root)"
      )
      .addText((text) =>
        text
          .setPlaceholder("e.g. Calendar")
          .setValue(this.plugin.settings.calendarFolder)
          .onChange(async (value) => {
            this.plugin.settings.calendarFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // --- Reminders section ---
    const remSection = containerEl.createDiv({ cls: "apple-bridge-section" });
    const remTitle = remSection.createDiv({ cls: "apple-bridge-section-title" });
    remTitle.createSpan({
      cls: "apple-bridge-icon apple-bridge-icon--reminders",
      text: "\u2705",
    });
    remTitle.createSpan({ text: "Reminders" });

    new Setting(remSection)
      .setName("Sync Reminders")
      .setDesc("Sync Apple Reminders to your vault")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncReminders)
          .onChange(async (value) => {
            this.plugin.settings.syncReminders = value;
            await this.plugin.saveSettings();
          })
      );

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
      .setDesc(
        "Vault folder for daily notes with reminders (empty = vault root)"
      )
      .addText((text) =>
        text
          .setPlaceholder("e.g. Reminders")
          .setValue(this.plugin.settings.remindersFolder)
          .onChange(async (value) => {
            this.plugin.settings.remindersFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // --- Contacts section ---
    const conSection = containerEl.createDiv({ cls: "apple-bridge-section" });
    const conTitle = conSection.createDiv({ cls: "apple-bridge-section-title" });
    conTitle.createSpan({
      cls: "apple-bridge-icon apple-bridge-icon--contacts",
      text: "\uD83D\uDC64",
    });
    conTitle.createSpan({ text: "Contacts" });

    new Setting(conSection)
      .setName("Sync Contacts")
      .setDesc("Import Apple Contacts as notes")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncContacts)
          .onChange(async (value) => {
            this.plugin.settings.syncContacts = value;
            await this.plugin.saveSettings();
          })
      );

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

    // --- Notes section ---
    const notSection = containerEl.createDiv({ cls: "apple-bridge-section" });
    const notTitle = notSection.createDiv({ cls: "apple-bridge-section-title" });
    notTitle.createSpan({
      cls: "apple-bridge-icon apple-bridge-icon--notes",
      text: "\uD83D\uDCDD",
    });
    notTitle.createSpan({ text: "Notes" });

    new Setting(notSection)
      .setName("Sync Notes")
      .setDesc("Import Apple Notes into your vault")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncNotes)
          .onChange(async (value) => {
            this.plugin.settings.syncNotes = value;
            await this.plugin.saveSettings();
          })
      );

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
      .setName("Conflict resolution")
      .setDesc(
        "How to resolve conflicts when both local and remote change between syncs"
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("remote-wins", "Remote wins (Apple overrides local)")
          .addOption("local-wins", "Local wins (vault overrides Apple)")
          .addOption("most-recent", "Most recent change wins")
          .setValue(this.plugin.settings.conflictResolution)
          .onChange(async (value) => {
            this.plugin.settings.conflictResolution =
              value as ConflictResolution;
            await this.plugin.saveSettings();
          })
      );
  }
}
