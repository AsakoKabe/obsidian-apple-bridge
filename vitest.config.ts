import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "src/calendar-sync.ts",
        "src/reminders-sync.ts",
        "src/notes-sync.ts",
        "src/contacts-sync.ts",
        "src/notes-bridge.ts",
        "src/vault-utils.ts",
        "src/sync-status.ts",
        "src/status-bar.ts",
        "src/quick-reminder.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, "src/__mocks__/obsidian.ts"),
    },
  },
});
