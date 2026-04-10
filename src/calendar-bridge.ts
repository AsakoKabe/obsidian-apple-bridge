import { execFile } from "child_process";

export interface CalendarEvent {
  id: string;
  calendarName: string;
  title: string;
  startDate: string; // ISO 8601
  endDate: string; // ISO 8601
  isAllDay: boolean;
  location: string;
  notes: string;
  url: string;
  calendarWritable: boolean;
  accountName: string;
  accountType: string; // "iCloud", "Exchange", "Google", "CalDAV", "Local", etc.
}

export interface CalendarInfo {
  name: string;
  id: string;
  writable: boolean;
  accountName: string;
  accountType: string;
}

function runJxa(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", script],
      { maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`JXA error: ${stderr || error.message}`));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

export async function listCalendars(): Promise<CalendarInfo[]> {
  const script = `
    const app = Application("Calendar");
    const cals = app.calendars();
    const result = cals.map(c => {
      let accountName = "";
      let accountType = "";
      try {
        const desc = c.description();
        if (desc && desc.includes("type:")) {
          const parts = desc.split("type:");
          accountType = (parts[1] || "").trim().split(/\\s/)[0];
        }
      } catch (_) {}
      return {
        name: c.name(),
        id: c.uid(),
        writable: c.writable(),
        accountName: accountName,
        accountType: accountType
      };
    });
    JSON.stringify(result);
  `;
  const raw = await runJxa(script);
  return JSON.parse(raw) as CalendarInfo[];
}

export async function fetchEvents(startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();

  const script = `
    const app = Application("Calendar");
    const startD = new Date("${startIso}");
    const endD = new Date("${endIso}");
    const results = [];
    const cals = app.calendars();
    for (const cal of cals) {
      const calWritable = cal.writable();
      let accountName = "";
      let accountType = "";
      try {
        const desc = cal.description();
        if (desc && desc.includes("type:")) {
          const parts = desc.split("type:");
          accountType = (parts[1] || "").trim().split(/\\s/)[0];
        }
      } catch (_) {}
      const events = cal.events.whose({
        _and: [
          { startDate: { _greaterThan: startD } },
          { endDate: { _lessThan: endD } }
        ]
      })();
      for (const ev of events) {
        results.push({
          id: ev.uid(),
          calendarName: cal.name(),
          title: ev.summary(),
          startDate: ev.startDate().toISOString(),
          endDate: ev.endDate().toISOString(),
          isAllDay: ev.alldayEvent(),
          location: ev.location() || "",
          notes: ev.description() || "",
          url: ev.url() || "",
          calendarWritable: calWritable,
          accountName: accountName,
          accountType: accountType
        });
      }
    }
    JSON.stringify(results);
  `;
  const raw = await runJxa(script);
  return JSON.parse(raw) as CalendarEvent[];
}

export async function createEvent(
  calendarName: string,
  title: string,
  startDate: Date,
  endDate: Date,
  options: { isAllDay?: boolean; location?: string; notes?: string } = {}
): Promise<string> {
  const safeStr = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `
    const app = Application("Calendar");
    const cal = app.calendars.whose({ name: "${safeStr(calendarName)}" })[0];
    const ev = app.Event({
      summary: "${safeStr(title)}",
      startDate: new Date("${startDate.toISOString()}"),
      endDate: new Date("${endDate.toISOString()}"),
      alldayEvent: ${options.isAllDay ?? false},
      location: "${safeStr(options.location ?? "")}",
      description: "${safeStr(options.notes ?? "")}"
    });
    cal.events.push(ev);
    ev.uid();
  `;
  return await runJxa(script);
}

export async function updateEvent(
  eventId: string,
  updates: Partial<
    Pick<CalendarEvent, "title" | "startDate" | "endDate" | "location" | "notes" | "isAllDay">
  >
): Promise<void> {
  const safeStr = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const setParts: string[] = [];
  if (updates.title !== undefined) setParts.push(`ev.summary = "${safeStr(updates.title)}";`);
  if (updates.startDate !== undefined)
    setParts.push(`ev.startDate = new Date("${updates.startDate}");`);
  if (updates.endDate !== undefined) setParts.push(`ev.endDate = new Date("${updates.endDate}");`);
  if (updates.location !== undefined)
    setParts.push(`ev.location = "${safeStr(updates.location)}";`);
  if (updates.notes !== undefined) setParts.push(`ev.description = "${safeStr(updates.notes)}";`);
  if (updates.isAllDay !== undefined) setParts.push(`ev.alldayEvent = ${updates.isAllDay};`);

  if (setParts.length === 0) return;

  const script = `
    const app = Application("Calendar");
    const cals = app.calendars();
    let found = false;
    for (const cal of cals) {
      const matches = cal.events.whose({ uid: "${safeStr(eventId)}" })();
      if (matches.length > 0) {
        const ev = matches[0];
        ${setParts.join("\n        ")}
        found = true;
        break;
      }
    }
    if (!found) throw new Error("Event not found: ${safeStr(eventId)}");
    "ok";
  `;
  await runJxa(script);
}

export async function deleteEvent(eventId: string): Promise<void> {
  const safeStr = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `
    const app = Application("Calendar");
    const cals = app.calendars();
    for (const cal of cals) {
      const matches = cal.events.whose({ uid: "${safeStr(eventId)}" })();
      if (matches.length > 0) {
        app.delete(matches[0]);
        break;
      }
    }
    "ok";
  `;
  await runJxa(script);
}
