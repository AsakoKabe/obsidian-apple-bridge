type FrontmatterValue = string | number | boolean | null | FrontmatterValue[];
type FrontmatterFields = Record<string, FrontmatterValue>;

interface ParsedNote {
  fields: FrontmatterFields;
  body: string;
}

// ---------------------------------------------------------------------------
// YAML parser (minimal, covers the subset we produce)
// ---------------------------------------------------------------------------

function parseYamlValue(raw: string): FrontmatterValue {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "") return null;

  // Inline array: ["a", "b"]
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1);
    if (!inner.trim()) return [];
    return inner.split(",").map((v) => parseYamlValue(v));
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  // Quoted string
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseYamlBlock(yaml: string): FrontmatterFields {
  const fields: FrontmatterFields = {};
  const lines = yaml.split("\n");
  let currentKey: string | null = null;
  let currentArray: FrontmatterValue[] | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    // Array item: "  - value"
    const arrayMatch = line.match(/^\s+-\s+(.*)/);
    if (arrayMatch && currentKey) {
      if (!currentArray) currentArray = [];
      currentArray.push(parseYamlValue(arrayMatch[1]));
      fields[currentKey] = currentArray;
      continue;
    }

    // Key-value: "key: value"
    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)/);
    if (kvMatch) {
      // Flush any pending array
      currentKey = kvMatch[1];
      currentArray = null;
      const valueStr = kvMatch[2].trim();
      if (valueStr === "") {
        // Could be start of an array block — set to null, will be overwritten
        fields[currentKey] = null;
      } else {
        fields[currentKey] = parseYamlValue(valueStr);
      }
    }
  }

  return fields;
}

// ---------------------------------------------------------------------------
// YAML serializer (minimal)
// ---------------------------------------------------------------------------

function serializeYamlValue(value: FrontmatterValue): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return `"${value.replace(/"/g, '\\"')}"`;
  return "null";
}

function serializeYamlFields(fields: FrontmatterFields): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${serializeYamlValue(item)}`);
      }
    } else {
      lines.push(`${key}: ${serializeYamlValue(value)}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseFrontmatter(content: string): ParsedNote {
  if (!content.startsWith("---\n")) {
    return { fields: {}, body: content };
  }

  const endIdx = content.indexOf("\n---\n", 3);
  if (endIdx < 0) {
    return { fields: {}, body: content };
  }

  const yamlBlock = content.slice(4, endIdx);
  const body = content.slice(endIdx + 5);
  const fields = parseYamlBlock(yamlBlock);

  return { fields, body };
}

export function serializeFrontmatter(fields: FrontmatterFields, body: string): string {
  // Filter out null/undefined entries
  const cleanFields: FrontmatterFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null && v !== undefined) {
      cleanFields[k] = v;
    }
  }

  if (Object.keys(cleanFields).length === 0) {
    return body;
  }

  const yaml = serializeYamlFields(cleanFields);
  return `---\n${yaml}\n---\n${body}`;
}

export function updateFrontmatter(content: string, updates: FrontmatterFields): string {
  const { fields, body } = parseFrontmatter(content);
  const merged = { ...fields, ...updates };
  return serializeFrontmatter(merged, body);
}

export interface DailyNoteMetadataInput {
  eventCount: number;
  reminderCount: number;
  calendarNames: string[];
  reminderListNames: string[];
  syncedAt: string;
}

export function buildDailyNoteMetadata(input: DailyNoteMetadataInput): FrontmatterFields {
  const meta: FrontmatterFields = {};

  if (input.eventCount > 0) {
    meta.apple_events = input.eventCount;
  }
  if (input.reminderCount > 0) {
    meta.apple_reminders = input.reminderCount;
  }

  const uniqueCalendars = [...new Set(input.calendarNames)].sort();
  if (uniqueCalendars.length > 0) {
    meta.apple_calendars = uniqueCalendars;
  }

  const uniqueLists = [...new Set(input.reminderListNames)].sort();
  if (uniqueLists.length > 0) {
    meta.apple_reminder_lists = uniqueLists;
  }

  meta.apple_last_sync = input.syncedAt;

  return meta;
}
