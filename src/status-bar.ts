/** Status bar widget for Apple Bridge — shows sync state and last sync time. */

import { Plugin } from "obsidian";
import { relativeTime } from "./sync-status";

export type StatusBarState = "idle" | "syncing" | "error";

export class StatusBarWidget {
  private readonly el: HTMLElement;
  private state: StatusBarState = "idle";
  private lastSyncAt: string | null = null;
  private updateTimer: number | null = null;

  constructor(plugin: Plugin, onTriggerSync: () => void) {
    this.el = plugin.addStatusBarItem();
    this.el.addClass("apple-bridge-status-bar");
    this.el.setAttribute("aria-label", "Apple Bridge — click to sync");
    this.el.style.cursor = "pointer";
    this.el.addEventListener("click", onTriggerSync);
    this.render();
  }

  setSyncing(): void {
    this.state = "syncing";
    this.stopTimer();
    this.render();
  }

  setSynced(atIso: string): void {
    this.state = "idle";
    this.lastSyncAt = atIso;
    this.render();
    this.startTimer();
  }

  setError(): void {
    this.state = "error";
    this.stopTimer();
    this.render();
  }

  destroy(): void {
    this.stopTimer();
    this.el.remove();
  }

  private render(): void {
    if (this.state === "syncing") {
      this.el.textContent = "Apple Bridge: syncing\u2026";
    } else if (this.state === "error") {
      this.el.textContent = "Apple Bridge: sync failed";
    } else if (this.lastSyncAt) {
      this.el.textContent = `Apple Bridge: synced ${relativeTime(this.lastSyncAt)}`;
    } else {
      this.el.textContent = "Apple Bridge";
    }
  }

  private startTimer(): void {
    this.stopTimer();
    // Refresh the relative-time label every 30 s so it stays accurate.
    this.updateTimer = setInterval(() => this.render(), 30_000) as unknown as number;
  }

  private stopTimer(): void {
    if (this.updateTimer !== null) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }
}
