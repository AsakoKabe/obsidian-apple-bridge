import { App, Modal, Notice, Setting } from "obsidian";
import { createEvent } from "./calendar-bridge";
import type AppleBridgePlugin from "./main";

interface EventFormData {
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  isAllDay: boolean;
  location: string;
  notes: string;
}

function todayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nowTimeString(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(Math.ceil(d.getMinutes() / 15) * 15)
    .padStart(2, "0")
    .replace("60", "00");
  return `${h}:${m}`;
}

function addOneHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const newH = (h + 1) % 24;
  return `${String(newH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseDateTime(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

function dailyNotePath(date: string, folder: string): string {
  const name = `${date}.md`;
  return folder ? `${folder}/${name}` : name;
}

export class CreateEventModal extends Modal {
  private plugin: AppleBridgePlugin;
  private form: EventFormData;

  constructor(app: App, plugin: AppleBridgePlugin) {
    super(app);
    this.plugin = plugin;
    const startTime = nowTimeString();
    this.form = {
      title: "",
      date: todayString(),
      startTime,
      endTime: addOneHour(startTime),
      isAllDay: false,
      location: "",
      notes: "",
    };
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("apple-bridge-modal");

    // Header with icon
    const header = contentEl.createDiv({ cls: "apple-bridge-modal-header" });
    header.createSpan({ cls: "apple-bridge-modal-icon", text: "\uD83D\uDCC5" });
    header.createEl("h2", { text: "Create Calendar Event" });

    new Setting(contentEl)
      .setName("Title")
      .addText((text) =>
        text
          .setPlaceholder("Event title")
          .setValue(this.form.title)
          .onChange((value) => {
            this.form.title = value;
          })
      );

    new Setting(contentEl)
      .setName("Date")
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM-DD")
          .setValue(this.form.date)
          .onChange((value) => {
            this.form.date = value;
          })
      );

    new Setting(contentEl)
      .setName("All-day event")
      .addToggle((toggle) =>
        toggle.setValue(this.form.isAllDay).onChange((value) => {
          this.form.isAllDay = value;
        })
      );

    // Time row — start and end side-by-side
    const timeRow = contentEl.createDiv({ cls: "apple-bridge-time-row" });

    new Setting(timeRow)
      .setName("Start time")
      .addText((text) =>
        text
          .setPlaceholder("HH:MM")
          .setValue(this.form.startTime)
          .onChange((value) => {
            this.form.startTime = value;
          })
      );

    new Setting(timeRow)
      .setName("End time")
      .addText((text) =>
        text
          .setPlaceholder("HH:MM")
          .setValue(this.form.endTime)
          .onChange((value) => {
            this.form.endTime = value;
          })
      );

    new Setting(contentEl)
      .setName("Location")
      .addText((text) =>
        text
          .setPlaceholder("Optional")
          .setValue(this.form.location)
          .onChange((value) => {
            this.form.location = value;
          })
      );

    new Setting(contentEl)
      .setName("Notes")
      .addTextArea((area) =>
        area
          .setPlaceholder("Optional")
          .setValue(this.form.notes)
          .onChange((value) => {
            this.form.notes = value;
          })
      );

    // Action buttons
    const actions = contentEl.createDiv({ cls: "apple-bridge-modal-actions" });
    new Setting(actions).addButton((btn) =>
      btn.setButtonText("Cancel").onClick(() => this.close())
    );
    new Setting(actions).addButton((btn) =>
      btn
        .setButtonText("Create Event")
        .setCta()
        .onClick(() => this.handleCreate())
    );
  }

  onClose() {
    this.contentEl.empty();
  }

  private async handleCreate(): Promise<void> {
    const { form, plugin } = this;

    if (!form.title.trim()) {
      new Notice("Event title is required");
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) {
      new Notice("Date must be in YYYY-MM-DD format");
      return;
    }

    if (!form.isAllDay && !/^\d{1,2}:\d{2}$/.test(form.startTime)) {
      new Notice("Start time must be in HH:MM format");
      return;
    }

    try {
      const calendarName =
        plugin.settings.defaultCalendarName || "Calendar";

      let startDate: Date;
      let endDate: Date;

      if (form.isAllDay) {
        startDate = parseDateTime(form.date, "00:00");
        endDate = parseDateTime(form.date, "23:59");
      } else {
        startDate = parseDateTime(form.date, form.startTime);
        endDate = parseDateTime(form.date, form.endTime);
      }

      // Create event in Apple Calendar
      const eventId = await createEvent(
        calendarName,
        form.title.trim(),
        startDate,
        endDate,
        {
          isAllDay: form.isAllDay,
          location: form.location || undefined,
          notes: form.notes || undefined,
        }
      );

      // Write event to daily note
      await this.writeEventToNote(eventId, startDate, endDate);

      // Update sync state so next sync recognizes this event
      await this.updateSyncState(eventId, startDate, endDate);

      new Notice(`Event "${form.title.trim()}" created`);
      this.close();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      new Notice(`Failed to create event: ${msg}`);
    }
  }

  private async writeEventToNote(
    eventId: string,
    startDate: Date,
    endDate: Date
  ): Promise<void> {
    const { form, plugin } = this;
    const vault = plugin.app.vault;
    const calendarFolder = plugin.settings.calendarFolder ?? "";
    const notePath = dailyNotePath(form.date, calendarFolder);

    // Ensure folder exists
    const folderPath = notePath.substring(0, notePath.lastIndexOf("/"));
    if (folderPath) {
      const parts = folderPath.split("/");
      let current = "";
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        const existing = vault.getAbstractFileByPath(current);
        if (!existing) {
          await vault.createFolder(current);
        }
      }
    }

    // Get or create daily note
    const existing = vault.getAbstractFileByPath(notePath);
    let file: ReturnType<typeof vault.getAbstractFileByPath>;
    if (existing) {
      file = existing;
    } else {
      const title = form.date;
      file = await vault.create(notePath, `# ${title}\n\n`);
    }

    if (!file || !("extension" in file)) return;

    const content = await vault.read(file as Parameters<typeof vault.read>[0]);
    const lines = content.split("\n");

    // Build event line
    const timeRange = form.isAllDay
      ? "all-day"
      : `${form.startTime} - ${form.endTime}`;
    const loc = form.location ? ` \u{1F4CD} ${form.location}` : "";
    const eventLine = `- [ ] ${timeRange} ${form.title.trim()}${loc} [id:${eventId}]`;

    // Find or create Calendar Events section
    const sectionHeader = "## Calendar Events";
    const sectionIdx = lines.findIndex((l) => l.trim() === sectionHeader);

    if (sectionIdx >= 0) {
      // Find section end
      let endIdx = sectionIdx + 1;
      while (endIdx < lines.length && !lines[endIdx].startsWith("## ")) {
        endIdx++;
      }
      // Insert before section end
      const insertIdx =
        endIdx > sectionIdx + 1 ? endIdx : sectionIdx + 1;
      lines.splice(insertIdx, 0, eventLine);
    } else {
      // Append new section
      lines.push("", sectionHeader, "", eventLine);
    }

    await vault.modify(
      file as Parameters<typeof vault.modify>[0],
      lines.join("\n")
    );
  }

  private async updateSyncState(
    eventId: string,
    startDate: Date,
    endDate: Date
  ): Promise<void> {
    const { form, plugin } = this;
    const data = (await plugin.loadData()) ?? {};
    const syncState = data["calendar-sync-state"] ?? { events: {} };

    syncState.events[eventId] = {
      appleId: eventId,
      title: form.title.trim(),
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      isAllDay: form.isAllDay,
      location: form.location || "",
      notes: form.notes || "",
      lastSyncedAt: new Date().toISOString(),
    };

    await plugin.saveData({
      ...data,
      "calendar-sync-state": syncState,
    });
  }
}
