# Apple Bridge for Obsidian

> Keep your Obsidian vault in sync with Apple Calendar, Reminders, Notes, and Contacts — automatically.

[![Release](https://img.shields.io/github/v/release/AsakoKabe/obsidian-apple-bridge?style=flat-square)](https://github.com/AsakoKabe/obsidian-apple-bridge/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)
[![macOS only](https://img.shields.io/badge/platform-macOS-lightgrey?style=flat-square&logo=apple)](https://github.com/AsakoKabe/obsidian-apple-bridge)

**Apple Bridge** is a community plugin for [Obsidian](https://obsidian.md) that bridges your vault with your Apple ecosystem. Events and reminders appear in your daily notes the moment they change. Create a calendar event without leaving Obsidian. Import all your Apple Notes and Contacts as structured markdown files — ready to link, tag, and search.

> **macOS only** — uses JXA (JavaScript for Automation) via `/usr/bin/osascript`.

---

## What it looks like

### First-time setup wizard

![Setup wizard — grant permissions and choose which modules to enable](docs/demos/setup-wizard.gif)

_Grant macOS permissions and configure your sync preferences in under a minute._

### Calendar and Reminders in your daily note

![Calendar and Reminders syncing into a daily note](docs/demos/sync-in-action.gif)

_Events and reminders appear in `YYYY-MM-DD.md` with two-way sync. Check off a reminder in Obsidian, it completes in Apple Reminders. Edit an event title in your daily note, it updates in Apple Calendar._

### Creating a calendar event from Obsidian

![Create Calendar Event modal](docs/demos/create-event.gif)

_Use `Create Calendar Event` from the command palette to open a modal with title, date, time, location, and notes. The event lands in Apple Calendar and your daily note simultaneously._

### Settings and sync configuration

![Settings panel](docs/demos/settings.gif)

_Enable or disable individual modules, set sync intervals, choose folders, and pick your conflict resolution strategy — all from one settings panel._

---

## Features

| Module        | Direction          | What syncs                                                    |
| ------------- | ------------------ | ------------------------------------------------------------- |
| **Calendar**  | ↔ Two-way          | Events ↔ daily note sections                                  |
| **Reminders** | ↔ Two-way          | Reminders + completion status ↔ daily note sections           |
| **Notes**     | ↔ Two-way          | Apple Notes ↔ structured `.md` files with conflict resolution |
| **Contacts**  | → Apple → Obsidian | Apple Contacts as people notes with metadata                  |

### Sync triggers

| Trigger         | How                                               |
| --------------- | ------------------------------------------------- |
| Automatic       | Configurable interval (default 15 min)            |
| Manual          | Command palette: `Sync Apple Apps now`            |
| Ribbon          | Click the refresh icon in the sidebar             |
| Force full sync | Command palette: `Force Full Sync (ignore cache)` |

### Conflict resolution (Calendar & Reminders)

When both Obsidian and Apple change the same item between syncs:

| Strategy      | Behavior                  |
| ------------- | ------------------------- |
| `remote-wins` | Apple data wins (default) |
| `local-wins`  | Vault data wins           |
| `most-recent` | Latest timestamp wins     |

---

## Installation

### Obsidian Community Plugins _(coming soon)_

1. Open **Settings → Community Plugins → Browse**
2. Search for **Apple Bridge**
3. Click **Install**, then **Enable**

### Manual

1. Download `main.js` and `manifest.json` from the [latest release](https://github.com/AsakoKabe/obsidian-apple-bridge/releases/latest)
2. Create `<vault>/.obsidian/plugins/obsidian-apple-bridge/`
3. Copy both files into that folder
4. Restart Obsidian and enable the plugin under **Settings → Community Plugins**

> macOS will prompt for access to Calendar, Reminders, Contacts, and Notes on first use. Grant permissions for the modules you want to use.

---

## Usage

### Calendar events in daily notes

Events are written to `YYYY-MM-DD.md` under a `## Calendar Events` section:

```markdown
## Calendar Events

- [ ] 09:00 - 10:00 Standup 📍 Zoom [id:E1234]
- [ ] all-day Conference Day [id:E5678]
- [ ] 14:00 - 15:00 My local event
```

- Lines **with** `[id:...]` are synced from Apple Calendar.
- Lines **without** `[id:...]` are local — they'll be created in Apple Calendar on the next sync.
- Edit any line (title, time, location) and the change pushes back to Apple on sync.

### Reminders in daily notes

Reminders appear under a `## Reminders` section:

```markdown
## Reminders

- [ ] Buy groceries 📅 2026-04-15 [rid:R1234]
- [x] Send email [rid:R5678]
- [ ] New local reminder
```

- Toggle `[x]` / `[ ]` to complete or reopen a reminder — the change syncs to Apple Reminders.
- Add `📅 YYYY-MM-DD` to set a due date on new local reminders.

### Completed reminder archiving

When enabled, completed reminders are automatically moved from daily notes to a dedicated archive file. This keeps your daily notes focused on what's still open.

The archive groups entries by date with the newest dates at the top:

```markdown
# Completed Reminders

## 2026-04-10

- [x] Buy groceries 📅 2026-04-10 [rid:R1234]
- [x] Send email [rid:R5678]

## 2026-04-09

- [x] Call dentist [rid:R9012]
```

Enable this in **Settings > Apple Bridge > Reminders > Archive completed reminders**. You can configure a custom archive file path (default: `Completed Reminders.md` in your reminders folder).

If the archive write fails, completed reminders stay in the daily note as a safe fallback — no data is lost.

### Quick Reminder from selection

Select any text in your vault and run **Create Reminder from Selection** from the command palette (`Cmd+P`). The selected text becomes the reminder title, a new reminder is created in Apple Reminders with today's due date, and a `[rid:...]` line is added to your daily note.

### Event templates

Customize how events appear in your daily notes with per-calendar templates. Open **Settings > Apple Bridge > Calendar > Event templates** to configure.

**Available variables:** `{{title}}`, `{{time}}`, `{{start}}`, `{{end}}`, `{{location}}`, `{{calendar}}`, `{{notes}}`, `{{url}}`, `{{id}}`

**Conditional blocks:** `{{#location}} 📍 {{location}}{{/location}}` — only renders when the value is non-empty.

**Default template:**

```
- [ ] {{time}} {{title}}{{#location}} 📍 {{location}}{{/location}} [id:{{id}}]
```

Set a **default template** (applies to all calendars) or add **per-calendar templates** (e.g. a "Birthdays" calendar template that omits the time):

```
- 🎂 {{title}}{{#notes}} — {{notes}}{{/notes}} [id:{{id}}]
```

### Calendar and Reminder list filtering

Control which calendars and reminder lists are synced. Open **Settings > Apple Bridge** and configure filters for each module:

| Mode              | Behavior                                          |
| ----------------- | ------------------------------------------------- |
| **No filter**     | Sync everything (default)                         |
| **Include only…** | Only sync the listed calendars/lists              |
| **Exclude…**      | Sync everything except the listed calendars/lists |

Enter calendar or list names as a comma-separated list (e.g. `Work, Personal`). Useful for excluding noisy calendars like "Birthdays" or "Holidays", or for focusing on a single project list.

### Creating a calendar event

Run **Create Calendar Event** from the command palette (`Cmd+P`). Fill in the title, date, start/end time, optional location, and notes — the event is created in Apple Calendar and inserted into your daily note at once.

### Apple Notes import

Imported notes are saved as markdown files preserving your Apple Notes folder structure:

```
Apple Notes/
  Projects/
    My Project.md
  Personal/
    Recipes.md
```

Each file includes frontmatter with `apple_note_id`, `created`, `modified`, and `folder`.

### Contacts import

Each contact becomes a people note in the configured folder (default: `People/`):

```markdown
---
apple_contact_id: "A1234"
emails:
  - label: work
    value: john@example.com
phones:
  - label: mobile
    value: "+1 555 000 1234"
birthday: 1990-05-15
---

# John Doe

Developer at Acme Corp
```

---

## Configuration

Open **Settings → Apple Bridge**:

| Setting               | Description                                         | Default                |
| --------------------- | --------------------------------------------------- | ---------------------- |
| Sync Calendar         | Enable Calendar two-way sync                        | On                     |
| Sync Reminders        | Enable Reminders two-way sync                       | On                     |
| Sync Notes            | Enable Apple Notes two-way sync                     | Off                    |
| Sync Contacts         | Enable Contacts import                              | Off                    |
| Sync Interval         | Auto-sync interval in minutes (0 = manual only)     | 15                     |
| Default Calendar      | Apple Calendar for new events created in Obsidian   | Calendar               |
| Default Reminder List | Apple Reminders list for new reminders              | Reminders              |
| Conflict Resolution   | How to handle two-way conflicts                     | remote-wins            |
| Calendar folder       | Vault folder for daily notes                        | _(vault root)_         |
| Reminders folder      | Vault folder for daily notes                        | _(vault root)_         |
| Notes folder          | Vault folder for imported Apple Notes               | Apple Notes            |
| Contacts folder       | Vault folder for imported contacts                  | People                 |
| Dataview metadata     | Add frontmatter fields for Dataview queries         | Off                    |
| Archive completed     | Move completed reminders to a separate archive note | Off                    |
| Archive file          | Path for the completed reminders archive            | Completed Reminders.md |

### Dataview metadata

When enabled, Apple Bridge writes frontmatter fields to each daily note after sync. These fields are designed for use with the [Dataview](https://blacksmithgu.github.io/obsidian-dataview/) plugin but work with any tool that reads YAML frontmatter.

**Fields added to daily notes:**

| Field                  | Type   | Description                             |
| ---------------------- | ------ | --------------------------------------- |
| `apple_events`         | number | Count of calendar events for the day    |
| `apple_reminders`      | number | Count of reminders for the day          |
| `apple_calendars`      | list   | Calendar names with events that day     |
| `apple_reminder_lists` | list   | Reminder list names with items that day |
| `apple_last_sync`      | string | ISO 8601 timestamp of the last sync     |

Fields with a zero count are omitted. Each sync module writes its own fields independently.

**Example frontmatter:**

```yaml
---
apple_events: 3
apple_calendars:
  - Personal
  - Work
apple_reminders: 2
apple_reminder_lists:
  - Reminders
apple_last_sync: "2026-04-10T14:30:00.000Z"
---
```

**Example Dataview queries:**

```dataview
TABLE apple_events AS "Events", apple_reminders AS "Reminders"
FROM "Calendar"
WHERE apple_events > 0
SORT file.name DESC
```

```dataview
LIST
FROM "Calendar"
WHERE contains(apple_calendars, "Work")
```

---

## Roadmap

### Phase 1 — Core sync ✅

- Two-way Calendar sync (events ↔ daily notes)
- Two-way Reminders sync (reminders ↔ daily notes)
- Apple Notes one-way import
- Apple Contacts one-way import
- Create Calendar Event modal
- Onboarding wizard

### Phase 2 — Quality & range ✅

- Multi-day sync range for Calendar and Reminders
- ESLint + Prettier code quality tooling
- Full unit test suite (vitest)

### Phase 3 — Deeper integration ✅

- Quick Reminder from selection ✅
- Status bar live indicator ✅
- Per-calendar event templates ✅
- Calendar & reminder list filtering ✅
- Bidirectional Notes sync with conflict resolution ✅
- iCloud Calendar support (read-only shared calendars) ✅

### Phase 4 — Polish & ecosystem _(in progress)_

- **Sync log** — persistent log of sync operations for troubleshooting ✅
- **Dataview metadata** — expose sync data as frontmatter fields for Dataview queries ✅
- **Incremental sync** — only fetch changes since last sync for better performance ✅
- **Completed reminder archiving** — auto-move completed reminders to an archive note ✅
- **Community plugin submission** — publish to the Obsidian community plugin directory

---

## Requirements

- macOS (Apple apps are not available on other platforms)
- Obsidian 1.0.0 or later

---

## Development

```bash
# Install dependencies
npm install

# Build (with type checking)
npm run build

# Development mode (watch)
npm run dev

# Run tests
npm test
```

---

## License

[MIT](LICENSE)
