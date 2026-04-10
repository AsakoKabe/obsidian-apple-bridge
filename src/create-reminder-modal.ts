import { App, Modal, Notice, Setting } from "obsidian";
import { createReminder, listReminderLists } from "./reminders-bridge";
import type AppleBridgePlugin from "./main";

interface ReminderFormData {
  title: string;
  dueDate: string; // YYYY-MM-DD or empty
  dueTime: string; // HH:MM or empty
  listName: string;
  priority: number; // 0=none, 1=high, 5=medium, 9=low
  notes: string;
}

function todayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dailyNotePath(date: string, folder: string): string {
  const name = `${date}.md`;
  return folder ? `${folder}/${name}` : name;
}

export class CreateReminderModal extends Modal {
  private plugin: AppleBridgePlugin;
  private form: ReminderFormData;
  private listDropdownEl: HTMLSelectElement | null = null;

  constructor(app: App, plugin: AppleBridgePlugin) {
    super(app);
    this.plugin = plugin;
    this.form = {
      title: "",
      dueDate: todayString(),
      dueTime: "",
      listName: plugin.settings.defaultReminderList || "Reminders",
      priority: 0,
      notes: "",
    };
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("apple-bridge-modal");

    // Header with icon
    const header = contentEl.createDiv({ cls: "apple-bridge-modal-header" });
    header.createSpan({ cls: "apple-bridge-modal-icon", text: "\u2705" });
    header.createEl("h2", { text: "Create reminder" });

    new Setting(contentEl).setName("Title").addText((text) =>
      text
        .setPlaceholder("Reminder title")
        .setValue(this.form.title)
        .onChange((value) => {
          this.form.title = value;
        })
    );

    new Setting(contentEl).setName("Due date").addText((text) =>
      text
        .setPlaceholder("Yyyy-mm-dd")
        .setValue(this.form.dueDate)
        .onChange((value) => {
          this.form.dueDate = value;
        })
    );

    new Setting(contentEl).setName("Due time").addText((text) =>
      text
        .setPlaceholder("Hh:mm (optional)")
        .setValue(this.form.dueTime)
        .onChange((value) => {
          this.form.dueTime = value;
        })
    );

    // List dropdown — populated async
    const listSetting = new Setting(contentEl).setName("Reminder list").addDropdown((dropdown) => {
      dropdown.addOption(this.form.listName, this.form.listName);
      dropdown.setValue(this.form.listName);
      dropdown.onChange((value) => {
        this.form.listName = value;
      });
      this.listDropdownEl = dropdown.selectEl;
    });

    void this.loadReminderLists(listSetting);

    new Setting(contentEl).setName("Priority").addDropdown((dropdown) =>
      dropdown
        .addOption("0", "None")
        .addOption("1", "High")
        .addOption("5", "Medium")
        .addOption("9", "Low")
        .setValue(String(this.form.priority))
        .onChange((value) => {
          this.form.priority = Number(value);
        })
    );

    new Setting(contentEl).setName("Notes").addTextArea((area) =>
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
        .setButtonText("Create reminder")
        .setCta()
        .onClick(() => this.handleCreate())
    );
  }

  onClose() {
    this.contentEl.empty();
  }

  private async loadReminderLists(_listSetting: Setting): Promise<void> {
    try {
      const lists = await listReminderLists();
      if (!this.listDropdownEl) return;

      const select = this.listDropdownEl;
      // Clear existing options and repopulate
      while (select.options.length > 0) {
        select.remove(0);
      }

      const defaultList = this.plugin.settings.defaultReminderList || "Reminders";
      for (const list of lists) {
        const opt = document.createElement("option");
        opt.value = list.name;
        opt.text = list.name;
        select.add(opt);
      }

      // Set current value — fall back to first available list
      const available = lists.map((l) => l.name);
      const selectedList = available.includes(defaultList)
        ? defaultList
        : (available[0] ?? defaultList);

      select.value = selectedList;
      this.form.listName = selectedList;
    } catch {
      // Non-fatal: keep the default list name pre-populated
    }
  }

  private async handleCreate(): Promise<void> {
    const { form } = this;

    if (!form.title.trim()) {
      new Notice("Reminder title is required");
      return;
    }

    if (form.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.dueDate)) {
      new Notice("Due date must be in yyyy-mm-dd format");
      return;
    }

    if (form.dueTime && !/^\d{1,2}:\d{2}$/.test(form.dueTime)) {
      new Notice("Due time must be in hh:mm format");
      return;
    }

    try {
      let dueDate: Date | undefined;
      if (form.dueDate) {
        const [y, mo, d] = form.dueDate.split("-").map(Number);
        if (form.dueTime) {
          const [h, mi] = form.dueTime.split(":").map(Number);
          dueDate = new Date(y, mo - 1, d, h, mi, 0, 0);
        } else {
          dueDate = new Date(y, mo - 1, d, 0, 0, 0, 0);
        }
      }

      const reminderId = await createReminder(form.listName, form.title.trim(), {
        dueDate,
        notes: form.notes || undefined,
        priority: form.priority,
      });

      await this.writeReminderToNote(reminderId, dueDate);
      await this.updateSyncState(reminderId, dueDate);

      new Notice(`Reminder "${form.title.trim()}" created`);
      this.close();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      new Notice(`Failed to create reminder: ${msg}`);
    }
  }

  private async writeReminderToNote(reminderId: string, dueDate: Date | undefined): Promise<void> {
    const { form, plugin } = this;
    const vault = plugin.app.vault;
    const remindersFolder = plugin.settings.remindersFolder ?? "";
    const noteDate = form.dueDate || todayString();
    const notePath = dailyNotePath(noteDate, remindersFolder);

    // Ensure folder exists
    const folderPath = notePath.substring(0, notePath.lastIndexOf("/"));
    if (folderPath) {
      const parts = folderPath.split("/");
      let current = "";
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!vault.getAbstractFileByPath(current)) {
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
      file = await vault.create(notePath, `# ${noteDate}\n\n`);
    }

    if (!file || !("extension" in file)) return;

    const content = await vault.read(file as Parameters<typeof vault.read>[0]);
    const lines = content.split("\n");

    // Build reminder line: - [ ] title 📅 YYYY-MM-DD [rid:id]
    const duePart = dueDate ? ` \uD83D\uDCC5 ${noteDate}` : "";
    const reminderLine = `- [ ] ${form.title.trim()}${duePart} [rid:${reminderId}]`;

    const sectionHeader = "## Reminders";
    const sectionIdx = lines.findIndex((l) => l.trim() === sectionHeader);

    if (sectionIdx >= 0) {
      let endIdx = sectionIdx + 1;
      while (endIdx < lines.length && !lines[endIdx].startsWith("## ")) {
        endIdx++;
      }
      lines.splice(endIdx > sectionIdx + 1 ? endIdx : sectionIdx + 1, 0, reminderLine);
    } else {
      lines.push("", sectionHeader, "", reminderLine);
    }

    await vault.modify(file as Parameters<typeof vault.modify>[0], lines.join("\n"));
  }

  private async updateSyncState(reminderId: string, dueDate: Date | undefined): Promise<void> {
    const { form, plugin } = this;
    const data = (await plugin.loadData()) ?? {};
    const syncState = data["reminders-sync-state"] ?? { reminders: {} };

    syncState.reminders[reminderId] = {
      appleId: reminderId,
      title: form.title.trim(),
      isCompleted: false,
      dueDate: dueDate?.toISOString() ?? null,
      notes: form.notes || "",
      lastSyncedAt: new Date().toISOString(),
    };

    await plugin.saveData({
      ...data,
      "reminders-sync-state": syncState,
    });
  }
}
