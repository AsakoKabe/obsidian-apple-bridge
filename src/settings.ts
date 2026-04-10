import type { SyncFilter } from "./sync-filter";

export type ConflictResolution = "remote-wins" | "local-wins" | "most-recent";

export interface AppleBridgeSettings {
  syncReminders: boolean;
  syncCalendar: boolean;
  syncContacts: boolean;
  syncNotes: boolean;
  syncIntervalMinutes: number;
  defaultCalendarName: string;
  defaultReminderList: string;
  conflictResolution: ConflictResolution;
  calendarFolder: string;
  remindersFolder: string;
  notesFolder: string;
  contactsFolder: string;
  hasCompletedOnboarding: boolean;
  syncRangePastDays: number;
  syncRangeFutureDays: number;
  eventTemplates: Record<string, string>;
  calendarFilter?: SyncFilter;
  reminderListFilter?: SyncFilter;
}

export const DEFAULT_SETTINGS: AppleBridgeSettings = {
  syncReminders: true,
  syncCalendar: true,
  syncContacts: false,
  syncNotes: false,
  syncIntervalMinutes: 15,
  defaultCalendarName: "Calendar",
  defaultReminderList: "Reminders",
  conflictResolution: "remote-wins",
  calendarFolder: "",
  remindersFolder: "",
  notesFolder: "Apple Notes",
  contactsFolder: "People",
  hasCompletedOnboarding: false,
  syncRangePastDays: 7,
  syncRangeFutureDays: 14,
  eventTemplates: {},
};
