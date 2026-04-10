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

*Grant macOS permissions and configure your sync preferences in under a minute.*

### Calendar and Reminders in your daily note

![Calendar and Reminders syncing into a daily note](docs/demos/sync-in-action.gif)

*Events and reminders appear in `YYYY-MM-DD.md` with two-way sync. Check off a reminder in Obsidian, it completes in Apple Reminders. Edit an event title in your daily note, it updates in Apple Calendar.*

### Creating a calendar event from Obsidian

![Create Calendar Event modal](docs/demos/create-event.gif)

*Use `Create Calendar Event` from the command palette to open a modal with title, date, time, location, and notes. The event lands in Apple Calendar and your daily note simultaneously.*

### Settings and sync configuration

![Settings panel](docs/demos/settings.gif)

*Enable or disable individual modules, set sync intervals, choose folders, and pick your conflict resolution strategy — all from one settings panel.*

---

## Features

| Module | Direction | What syncs |
|--------|-----------|------------|
| **Calendar** | ↔ Two-way | Events ↔ daily note sections |
| **Reminders** | ↔ Two-way | Reminders + completion status ↔ daily note sections |
| **Notes** | → Apple → Obsidian | Apple Notes as structured `.md` files |
| **Contacts** | → Apple → Obsidian | Apple Contacts as people notes with metadata |

### Sync triggers

| Trigger | How |
|---------|-----|
| Automatic | Configurable interval (default 15 min) |
| Manual | Command palette: `Sync Apple Apps now` |
| Ribbon | Click the refresh icon in the sidebar |

### Conflict resolution (Calendar & Reminders)

When both Obsidian and Apple change the same item between syncs:

| Strategy | Behavior |
|----------|----------|
| `remote-wins` | Apple data wins (default) |
| `local-wins` | Vault data wins |
| `most-recent` | Latest timestamp wins |

---

## Installation

### Obsidian Community Plugins *(coming soon)*

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

| Setting | Description | Default |
|---------|-------------|---------|
| Sync Calendar | Enable Calendar two-way sync | On |
| Sync Reminders | Enable Reminders two-way sync | On |
| Sync Notes | Enable Apple Notes import | Off |
| Sync Contacts | Enable Contacts import | Off |
| Sync Interval | Auto-sync interval in minutes (0 = manual only) | 15 |
| Default Calendar | Apple Calendar for new events created in Obsidian | Calendar |
| Default Reminder List | Apple Reminders list for new reminders | Reminders |
| Conflict Resolution | How to handle two-way conflicts | remote-wins |
| Calendar folder | Vault folder for daily notes | *(vault root)* |
| Reminders folder | Vault folder for daily notes | *(vault root)* |
| Notes folder | Vault folder for imported Apple Notes | Apple Notes |
| Contacts folder | Vault folder for imported contacts | People |

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

### Phase 3 — Deeper integration *(in progress)*
- **Quick Reminder from selection** — create a reminder from selected vault text ✅
- **Status bar live indicator** — see last sync time and module health at a glance ✅
- **Event templates** — per-calendar note templates for imported events ✅
- **Bidirectional Notes sync** — push Obsidian markdown edits back to Apple Notes
- **Tag-based filtering** — only sync events/reminders matching specific tags or lists
- **iCloud Calendar support** — read-only support for shared iCloud calendars

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
