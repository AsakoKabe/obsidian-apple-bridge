# Apple Bridge for Obsidian

Connect your Obsidian vault with Apple apps: Calendar, Reminders, Notes, and Contacts. Two-way sync for Calendar and Reminders, one-way import for Notes and Contacts.

**macOS only** — uses JXA (JavaScript for Automation) to communicate with Apple apps via `/usr/bin/osascript`.

## Features

- **Calendar** (two-way) — sync events into daily notes; create events from Obsidian via command or modal UI
- **Reminders** (two-way) — sync reminders into daily notes with completion status and due dates
- **Notes** (Apple -> Obsidian) — import Apple Notes as markdown files with frontmatter, preserving folder structure
- **Contacts** (Apple -> Obsidian) — import Apple Contacts as people notes with structured metadata

### Sync triggers

| Trigger | How |
|---------|-----|
| Automatic | Configurable interval (default 15 min) |
| Manual | Command palette: `Sync Apple Apps now` |
| Ribbon | Click the refresh icon in the sidebar |

### Conflict resolution

When both sides change between syncs (Calendar & Reminders):

| Strategy | Behavior |
|----------|----------|
| `remote-wins` | Apple overrides local (default) |
| `local-wins` | Vault overrides Apple |
| `most-recent` | Latest change wins |

## Installation

### From Obsidian Community Plugins (coming soon)

1. Open **Settings -> Community Plugins -> Browse**
2. Search for "Apple Bridge"
3. Click **Install**, then **Enable**

### Manual installation

1. Download `main.js`, `manifest.json` from the [latest release](https://github.com/AsakoKabe/obsidian-apple-bridge/releases/latest)
2. Create `<vault>/.obsidian/plugins/obsidian-apple-bridge/`
3. Copy `main.js` and `manifest.json` into that folder
4. Restart Obsidian and enable the plugin in **Settings -> Community Plugins**

## Configuration

Open **Settings -> Apple Bridge** to configure:

| Setting | Description | Default |
|---------|-------------|---------|
| Sync Reminders | Enable Reminders sync | On |
| Sync Calendar | Enable Calendar sync | On |
| Sync Contacts | Enable Contacts import | Off |
| Sync Notes | Enable Notes import | Off |
| Sync Interval | Auto-sync interval in minutes (0 = manual) | 15 |
| Default Calendar | Apple Calendar for new events | Calendar |
| Default Reminder List | Apple Reminders list for new reminders | Reminders |
| Conflict Resolution | How to handle two-way conflicts | remote-wins |
| Calendar folder | Vault folder for calendar daily notes | (vault root) |
| Reminders folder | Vault folder for reminders daily notes | (vault root) |
| Notes folder | Vault folder for imported Apple Notes | Apple Notes |
| Contacts folder | Vault folder for imported contacts | People |

## Usage

### Calendar events in daily notes

Events are written to daily notes (`YYYY-MM-DD.md`) under a `## Calendar Events` section:

```markdown
## Calendar Events

- [ ] 09:00 - 10:00 Standup [id:E1234]
- [ ] all-day Conference [id:E5678]
- [ ] 14:00 - 15:00 My local event
```

Lines without `[id:...]` are local events that will be created in Apple Calendar on next sync.

### Reminders in daily notes

Reminders appear under a `## Reminders` section:

```markdown
## Reminders

- [ ] Buy groceries [rid:R1234]
- [x] Send email [rid:R5678]
- [ ] Local reminder
```

### Creating calendar events

Use the command palette: `Create Calendar Event` to open a modal with fields for title, date, time, location, and notes.

## Requirements

- macOS (Apple apps are not available on other platforms)
- macOS may prompt for access permissions to Calendar, Reminders, Contacts, and Notes on first use

## Development

```bash
# Install dependencies
npm install

# Build (with type checking)
npm run build

# Development mode (watch)
npm run dev
```

## License

[MIT](LICENSE)
