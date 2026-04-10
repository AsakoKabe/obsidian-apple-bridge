import { App, Modal, Notice } from "obsidian";
import { listCalendars } from "./calendar-bridge";
import { fetchReminders } from "./reminders-bridge";
import { fetchNotes } from "./notes-bridge";
import { fetchContacts } from "./contacts-bridge";
import { classifyError } from "./sync-status";
import type AppleBridgePlugin from "./main";

type TestState = "idle" | "testing" | "ok" | "permission" | "unavailable" | "error";

interface ServiceStep {
  key: "calendar" | "reminders" | "notes" | "contacts";
  icon: string;
  label: string;
  description: string;
  testFn: () => Promise<void>;
}

const SERVICE_STEPS: ServiceStep[] = [
  {
    key: "calendar",
    icon: "\uD83D\uDCC5",
    label: "Calendar",
    description:
      "Sync today\u2019s calendar events into your daily note. Apple Calendar needs Automation permission.",
    testFn: async () => {
      await listCalendars();
    },
  },
  {
    key: "reminders",
    icon: "\u2705",
    label: "Reminders",
    description:
      "Import incomplete reminders into your vault. Apple Reminders needs Automation permission.",
    testFn: async () => {
      await fetchReminders();
    },
  },
  {
    key: "notes",
    icon: "\uD83D\uDCDD",
    label: "Notes",
    description:
      "Copy Apple Notes into a vault folder as Markdown files. Apple Notes needs Automation permission.",
    testFn: async () => {
      await fetchNotes();
    },
  },
  {
    key: "contacts",
    icon: "\uD83D\uDC64",
    label: "Contacts",
    description: "Create one note per Apple Contact. Apple Contacts needs Automation permission.",
    testFn: async () => {
      await fetchContacts();
    },
  },
];

export class OnboardingModal extends Modal {
  private plugin: AppleBridgePlugin;
  /** 0 = welcome, 1–4 = services, 5 = done */
  private step = 0;
  private testStates: Map<string, TestState> = new Map();
  private skipped: Set<string> = new Set();

  constructor(app: App, plugin: AppleBridgePlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    this.modalEl.addClass("apple-bridge-onboarding-modal");
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();

    if (this.step === 0) {
      this.renderWelcome();
    } else if (this.step <= SERVICE_STEPS.length) {
      this.renderServiceStep(SERVICE_STEPS[this.step - 1]);
    } else {
      this.renderSummary();
    }
  }

  // ─── Welcome ─────────────────────────────────────────────────────────────

  private renderWelcome() {
    const { contentEl } = this;

    const hero = contentEl.createDiv({ cls: "ob-onboard-hero" });
    hero.createSpan({ cls: "ob-onboard-logo", text: "\uD83C\uDF4E" });
    hero.createEl("h2", { text: "Welcome to Apple Bridge" });
    hero.createEl("p", {
      text: "This plugin connects your Obsidian vault with Apple Calendar, Reminders, Notes, and Contacts so everything lives alongside your notes.",
    });
    hero.createEl("p", {
      cls: "ob-onboard-subtitle",
      text: "The next steps will help you enable each service. You can skip any you don\u2019t need.",
    });

    this.renderFooter({ showBack: false, nextLabel: "Get Started \u2192" });
  }

  // ─── Per-service step ────────────────────────────────────────────────────

  private renderServiceStep(step: ServiceStep) {
    const { contentEl } = this;

    // Progress dots
    this.renderProgressDots();

    // Header
    const header = contentEl.createDiv({ cls: "ob-onboard-step-header" });
    header.createSpan({ cls: "ob-onboard-step-icon", text: step.icon });
    const headingWrap = header.createDiv();
    headingWrap.createEl("h2", { text: step.label });
    headingWrap.createEl("p", {
      cls: "ob-onboard-step-meta",
      text: `Step ${this.step} of ${SERVICE_STEPS.length}`,
    });

    // Description
    contentEl.createEl("p", {
      cls: "ob-onboard-step-desc",
      text: step.description,
    });

    // Permission hint box
    const hint = contentEl.createDiv({ cls: "ob-onboard-hint" });
    hint.createEl("strong", { text: "How to grant access:" });
    hint.createEl("p", {
      text: `System Settings \u2192 Privacy & Security \u2192 Automation \u2192 Obsidian \u2192 ${step.label}`,
    });

    // Test row
    const testRow = contentEl.createDiv({ cls: "ob-onboard-test-row" });
    const testBtn = testRow.createEl("button", {
      cls: "mod-cta ob-onboard-test-btn",
      text: "Test Connection",
    });
    const statusEl = testRow.createDiv({ cls: "ob-onboard-test-status" });
    this.updateTestStatusEl(statusEl, this.testStates.get(step.key) ?? "idle");

    testBtn.addEventListener("click", async () => {
      this.testStates.set(step.key, "testing");
      this.updateTestStatusEl(statusEl, "testing");
      testBtn.disabled = true;
      try {
        await step.testFn();
        this.testStates.set(step.key, "ok");
        this.updateTestStatusEl(statusEl, "ok");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const kind = classifyError(msg);
        const state: TestState =
          kind === "permission" ? "permission" : kind === "unavailable" ? "unavailable" : "error";
        this.testStates.set(step.key, state);
        this.updateTestStatusEl(statusEl, state, msg);
      } finally {
        testBtn.disabled = false;
      }
    });

    // Footer
    this.renderFooter({
      showBack: true,
      nextLabel: this.step < SERVICE_STEPS.length ? "Continue \u2192" : "Finish \u2192",
      showSkip: true,
      onSkip: () => {
        this.skipped.add(step.key);
        this.step++;
        this.render();
      },
    });
  }

  private updateTestStatusEl(el: HTMLElement, state: TestState, errorMsg?: string) {
    el.empty();
    el.className = `ob-onboard-test-status ob-onboard-test-status--${state}`;

    switch (state) {
      case "idle":
        el.createSpan({ text: "\u25CB Not tested yet" });
        break;
      case "testing":
        el.createSpan({ cls: "apple-bridge-spinner" });
        el.createSpan({ text: " Testing\u2026" });
        break;
      case "ok":
        el.createSpan({ text: "\u2705 Connected" });
        break;
      case "permission": {
        el.createSpan({ text: "\u26D4 Permission denied \u2014 " });
        const link = el.createEl("a", {
          text: "Open System Settings",
          href: "#",
        });
        link.addEventListener("click", (e) => {
          e.preventDefault();
          // Open macOS System Settings via shell is not directly possible in Obsidian
          // best we can do is show the path to the user
          new Notice(
            "Go to System Settings \u2192 Privacy & Security \u2192 Automation \u2192 Obsidian"
          );
        });
        break;
      }
      case "unavailable":
        el.createSpan({
          text: "\u26A0\uFE0F App unavailable \u2014 make sure the Apple app is installed",
        });
        break;
      case "error":
        el.createSpan({
          text: `\u274C Error\u2003${errorMsg ?? "Unknown error"}`,
        });
        break;
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────────────

  private renderSummary() {
    const { contentEl } = this;

    const hero = contentEl.createDiv({ cls: "ob-onboard-hero ob-onboard-hero--done" });
    hero.createSpan({ cls: "ob-onboard-logo", text: "\u2705" });
    hero.createEl("h2", { text: "Setup complete!" });

    const list = contentEl.createDiv({ cls: "ob-onboard-summary-list" });
    for (const svc of SERVICE_STEPS) {
      const state = this.testStates.get(svc.key) ?? "idle";
      const skipped = this.skipped.has(svc.key);
      const row = list.createDiv({ cls: "ob-onboard-summary-row" });
      row.createSpan({
        cls: "ob-onboard-summary-icon",
        text: this.summaryIcon(state, skipped),
      });
      row.createSpan({
        cls: "ob-onboard-summary-label",
        text: svc.label,
      });
      row.createSpan({
        cls: `ob-onboard-summary-status ob-onboard-summary-status--${this.summaryVariant(state, skipped)}`,
        text: this.summaryText(state, skipped),
      });
    }

    contentEl.createEl("p", {
      cls: "ob-onboard-footer-hint",
      text: "You can revisit these settings any time in Settings \u2192 Apple Bridge.",
    });

    const actions = contentEl.createDiv({ cls: "ob-onboard-actions" });
    const settingsBtn = actions.createEl("button", { text: "Open Settings" });
    settingsBtn.addEventListener("click", () => {
      this.close();
      (
        this.app as App & { setting?: { open: () => void; openTabById: (id: string) => void } }
      ).setting?.openTabById("apple-bridge");
    });

    const syncBtn = actions.createEl("button", {
      cls: "mod-cta",
      text: "Start Syncing",
    });
    syncBtn.addEventListener("click", () => {
      this.close();
      this.plugin.syncAll();
      new Notice("Apple Bridge sync started");
    });
  }

  private summaryIcon(state: TestState, skipped: boolean): string {
    if (skipped) return "\u23ED\uFE0F";
    switch (state) {
      case "ok":
        return "\u2705";
      case "permission":
      case "unavailable":
      case "error":
        return "\u274C";
      default:
        return "\u25CB";
    }
  }

  private summaryText(state: TestState, skipped: boolean): string {
    if (skipped) return "skipped";
    switch (state) {
      case "ok":
        return "connected";
      case "permission":
        return "permission denied";
      case "unavailable":
        return "app unavailable";
      case "error":
        return "error";
      default:
        return "not tested";
    }
  }

  private summaryVariant(state: TestState, skipped: boolean): string {
    if (skipped) return "skipped";
    switch (state) {
      case "ok":
        return "ok";
      case "permission":
      case "unavailable":
      case "error":
        return "error";
      default:
        return "idle";
    }
  }

  // ─── Shared footer ───────────────────────────────────────────────────────

  private renderFooter(opts: {
    showBack: boolean;
    nextLabel: string;
    showSkip?: boolean;
    onSkip?: () => void;
  }) {
    const { contentEl } = this;
    const footer = contentEl.createDiv({ cls: "ob-onboard-footer" });

    const left = footer.createDiv({ cls: "ob-onboard-footer-left" });
    if (opts.showSkip) {
      const skipBtn = left.createEl("button", {
        cls: "ob-onboard-skip-btn",
        text: "Skip",
      });
      skipBtn.addEventListener("click", () => opts.onSkip?.());
    }

    const right = footer.createDiv({ cls: "ob-onboard-footer-right" });

    if (opts.showBack) {
      const backBtn = right.createEl("button", { text: "\u2190 Back" });
      backBtn.addEventListener("click", () => {
        this.step = Math.max(0, this.step - 1);
        this.render();
      });
    }

    const nextBtn = right.createEl("button", {
      cls: "mod-cta",
      text: opts.nextLabel,
    });
    nextBtn.addEventListener("click", () => {
      if (this.step > SERVICE_STEPS.length) {
        // Already on summary — finish
        this.finishOnboarding();
      } else {
        this.step++;
        this.render();
      }
    });

    // On the summary step the footer is replaced by action buttons above;
    // swap next to finish behaviour
    if (this.step > SERVICE_STEPS.length) {
      nextBtn.textContent = "Done";
      nextBtn.onclick = () => this.finishOnboarding();
    }
  }

  private renderProgressDots() {
    const { contentEl } = this;
    const dots = contentEl.createDiv({ cls: "ob-onboard-progress" });
    for (let i = 1; i <= SERVICE_STEPS.length; i++) {
      dots.createDiv({
        cls: `ob-onboard-dot${i === this.step ? " ob-onboard-dot--active" : ""}`,
      });
    }
  }

  private async finishOnboarding() {
    this.plugin.settings.hasCompletedOnboarding = true;
    await this.plugin.saveSettings();
    this.close();
  }
}
