import { Editor, MarkdownView, Notice, Plugin } from "obsidian";
import { syncCalendar } from "./calendar-sync";
import { syncReminders } from "./reminders-sync";
import { syncNotes } from "./notes-sync";
import { syncContacts } from "./contacts-sync";
import { CreateEventModal } from "./create-event-modal";
import { CreateReminderModal } from "./create-reminder-modal";
import { OnboardingModal } from "./onboarding-modal";
import { StatusBarWidget } from "./status-bar";
import { createQuickReminder } from "./quick-reminder";
import { AppleBridgeSettingTab } from "./settings-tab";
import { type AppleBridgeSettings, DEFAULT_SETTINGS } from "./settings";
import {
  type ServiceKey,
  makeStatusError,
  makeStatusSuccess,
  saveServiceStatus,
} from "./sync-status";
import {
  appendSyncLogEntry,
  createSuccessEntry,
  createErrorEntry,
  formatSyncLog,
  loadSyncLog,
} from "./sync-log";

export default class AppleBridgePlugin extends Plugin {
  settings: AppleBridgeSettings;
  private statusBar: StatusBarWidget;

  async onload() {
    await this.loadSettings();

    this.statusBar = new StatusBarWidget(this, () => {
      void this.syncAll();
    });

    this.addSettingTab(new AppleBridgeSettingTab(this.app, this));

    this.addCommand({
      id: "sync-apple-apps",
      name: "Sync Apple apps now",
      callback: () => {
        void this.syncAll();
      },
    });

    this.addCommand({
      id: "create-calendar-event",
      name: "Create calendar event",
      callback: () => {
        new CreateEventModal(this.app, this).open();
      },
    });

    this.addCommand({
      id: "create-reminder",
      name: "Create reminder",
      callback: () => {
        new CreateReminderModal(this.app, this).open();
      },
    });

    this.addCommand({
      id: "quick-reminder-from-selection",
      name: "Create reminder from selection",
      editorCallback: (editor: Editor, _ctx: MarkdownView) => {
        void createQuickReminder(this, editor);
      },
    });

    this.addCommand({
      id: "force-full-sync",
      name: "Force full sync (ignore cache)",
      callback: () => {
        void this.syncAll({ forceFullSync: true });
      },
    });

    this.addCommand({
      id: "view-sync-log",
      name: "View sync log",
      callback: async () => {
        const entries = await loadSyncLog(() => this.loadData());
        const text = formatSyncLog(entries);
        new Notice(text.slice(0, 2000), 15000);
      },
    });

    const ribbonEl = this.addRibbonIcon("refresh-cw", "Sync Apple apps", () => {
      void this.syncAll();
    });
    ribbonEl.addClass("apple-bridge-ribbon-icon");

    if (this.settings.syncIntervalMinutes > 0) {
      this.registerInterval(
        window.setInterval(
          () => {
            void this.syncAll();
          },
          this.settings.syncIntervalMinutes * 60 * 1000
        )
      );
    }

    // Show onboarding wizard on first load
    if (!this.settings.hasCompletedOnboarding) {
      window.setTimeout(() => {
        new OnboardingModal(this.app, this).open();
      }, 500);
    }
  }

  onunload() {
    this.statusBar.destroy();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async syncAll(options: { forceFullSync?: boolean } = {}) {
    this.statusBar.setSyncing();
    const syncOpts = { forceFullSync: options.forceFullSync };
    const results = await Promise.allSettled([
      this.runSync("calendar", () => syncCalendar(this, syncOpts)),
      this.runSync("reminders", () => syncReminders(this, syncOpts)),
      this.runSync("notes", () => syncNotes(this)),
      this.runSync("contacts", () => syncContacts(this)),
    ]);
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) {
      this.statusBar.setSynced(new Date().toISOString());
      new Notice("Apple Bridge sync complete");
    } else {
      this.statusBar.setError();
      new Notice(`Apple Bridge sync finished with ${failed} error(s)`);
    }
  }

  private async runSync(service: ServiceKey, fn: () => Promise<number>): Promise<void> {
    const start = Date.now();
    try {
      const count = await fn();
      const durationMs = Date.now() - start;
      const status = makeStatusSuccess(count);
      await saveServiceStatus(
        service,
        status,
        () => this.loadData(),
        (d) => this.saveData(d)
      );
      await appendSyncLogEntry(
        createSuccessEntry(service, count, durationMs),
        () => this.loadData(),
        (d) => this.saveData(d)
      );
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const status = makeStatusError(err);
      await saveServiceStatus(
        service,
        status,
        () => this.loadData(),
        (d) => this.saveData(d)
      );
      await appendSyncLogEntry(
        createErrorEntry(service, err, durationMs),
        () => this.loadData(),
        (d) => this.saveData(d)
      );
      throw err;
    }
  }
}
