import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { syncCalendar } from "./calendar-sync";
import { syncReminders } from "./reminders-sync";
import { syncNotes } from "./notes-sync";

interface AppleBridgeSettings {
  syncReminders: boolean;
  syncCalendar: boolean;
  syncContacts: boolean;
  syncNotes: boolean;
  syncIntervalMinutes: number;
  defaultCalendarName: string;
  defaultReminderList: string;
}

const DEFAULT_SETTINGS: AppleBridgeSettings = {
  syncReminders: true,
  syncCalendar: true,
  syncContacts: false,
  syncNotes: false,
  syncIntervalMinutes: 15,
  defaultCalendarName: "Calendar",
  defaultReminderList: "Reminders",
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

    this.addRibbonIcon("refresh-cw", "Sync Apple Apps", () => {
      this.syncAll();
    });

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

    containerEl.createEl("h2", { text: "Apple Bridge Settings" });

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("Default Calendar")
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

    new Setting(containerEl)
      .setName("Default Reminder List")
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

    new Setting(containerEl)
      .setName("Sync Interval")
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
  }
}
