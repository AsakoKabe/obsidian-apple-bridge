import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockStatusBarEl } from "../__mocks__/obsidian";
import { StatusBarWidget } from "../status-bar";
import type { Plugin } from "obsidian";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlugin(): { plugin: Plugin; el: MockStatusBarEl } {
  const el = new MockStatusBarEl();
  const plugin = {
    addStatusBarItem: () => el,
  } as unknown as Plugin;
  return { plugin, el };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StatusBarWidget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders initial idle state with no sync time", () => {
    const { plugin, el } = makePlugin();
    new StatusBarWidget(plugin, vi.fn());
    expect(el.textContent).toBe("Apple Bridge");
  });

  it("renders syncing state", () => {
    const { plugin, el } = makePlugin();
    const widget = new StatusBarWidget(plugin, vi.fn());
    widget.setSyncing();
    expect(el.textContent).toBe("Apple Bridge: syncing\u2026");
  });

  it("renders error state", () => {
    const { plugin, el } = makePlugin();
    const widget = new StatusBarWidget(plugin, vi.fn());
    widget.setError();
    expect(el.textContent).toBe("Apple Bridge: sync failed");
  });

  it("renders synced state with relative time", () => {
    const { plugin, el } = makePlugin();
    const widget = new StatusBarWidget(plugin, vi.fn());
    const now = new Date().toISOString();
    widget.setSynced(now);
    // Synced just now — relativeTime returns "just now"
    expect(el.textContent).toBe("Apple Bridge: synced just now");
  });

  it("transitions: idle -> syncing -> synced", () => {
    const { plugin, el } = makePlugin();
    const widget = new StatusBarWidget(plugin, vi.fn());

    widget.setSyncing();
    expect(el.textContent).toBe("Apple Bridge: syncing\u2026");

    const ts = new Date().toISOString();
    widget.setSynced(ts);
    expect(el.textContent).toBe("Apple Bridge: synced just now");
  });

  it("transitions: idle -> syncing -> error", () => {
    const { plugin, el } = makePlugin();
    const widget = new StatusBarWidget(plugin, vi.fn());

    widget.setSyncing();
    widget.setError();
    expect(el.textContent).toBe("Apple Bridge: sync failed");
  });

  it("calls onTriggerSync when status bar item is clicked", () => {
    const { plugin, el } = makePlugin();
    const onSync = vi.fn();
    new StatusBarWidget(plugin, onSync);
    el.click();
    expect(onSync).toHaveBeenCalledOnce();
  });

  it("refreshes label after 30 s interval", () => {
    const { plugin, el } = makePlugin();
    const widget = new StatusBarWidget(plugin, vi.fn());

    // Synced 1 minute ago
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    widget.setSynced(oneMinuteAgo);
    expect(el.textContent).toBe("Apple Bridge: synced 1 min ago");

    // Advance by 30 s — timer fires, label re-renders (still "1 min ago")
    vi.advanceTimersByTime(30_000);
    expect(el.textContent).toBe("Apple Bridge: synced 1 min ago");
  });

  it("destroy cancels the refresh timer", () => {
    const { plugin, el } = makePlugin();
    const widget = new StatusBarWidget(plugin, vi.fn());
    const ts = new Date().toISOString();
    widget.setSynced(ts);

    widget.destroy();
    // Advance past the timer — no uncaught errors, label unchanged
    vi.advanceTimersByTime(60_000);
    expect(el.textContent).toBe("Apple Bridge: synced just now");
  });
});
