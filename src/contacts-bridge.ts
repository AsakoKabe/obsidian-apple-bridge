import { execFile } from "child_process";

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string;
  organization: string;
  jobTitle: string;
  emails: Array<{ label: string; value: string }>;
  phones: Array<{ label: string; value: string }>;
  addresses: Array<{
    label: string;
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  }>;
  birthday: string | null; // ISO 8601 or null
  note: string;
  urls: Array<{ label: string; value: string }>;
  socialProfiles: Array<{ label: string; value: string }>;
  modificationDate: string; // ISO 8601
}

export interface ContactGroup {
  name: string;
  id: string;
}

function runJxa(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", script],
      { maxBuffer: 50 * 1024 * 1024 },
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

const safeStr = (s: string): string =>
  s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export async function listGroups(): Promise<ContactGroup[]> {
  const script = `
    const app = Application("Contacts");
    const groups = app.groups();
    const result = groups.map(g => ({
      name: g.name(),
      id: g.id()
    }));
    JSON.stringify(result);
  `;
  const raw = await runJxa(script);
  return JSON.parse(raw) as ContactGroup[];
}

export async function fetchContacts(
  groupName?: string
): Promise<Contact[]> {
  const contactsSource = groupName
    ? `const group = app.groups.whose({ name: "${safeStr(groupName)}" })[0];
       const people = group.people();`
    : `const people = app.people();`;

  const script = `
    const app = Application("Contacts");
    ${contactsSource}
    const results = [];
    for (const p of people) {
      const emails = p.emails().map(e => ({
        label: e.label() || "other",
        value: e.value()
      }));
      const phones = p.phones().map(ph => ({
        label: ph.label() || "other",
        value: ph.value()
      }));
      const addresses = p.addresses().map(a => ({
        label: a.label() || "other",
        street: a.street() || "",
        city: a.city() || "",
        state: a.state() || "",
        postalCode: a.zip() || "",
        country: a.country() || ""
      }));
      const urls = p.urls().map(u => ({
        label: u.label() || "other",
        value: u.value()
      }));
      const socialProfiles = p.socialProfiles().map(s => ({
        label: s.serviceName() || "other",
        value: s.userName() || s.url() || ""
      }));
      const bday = p.birthDate();
      results.push({
        id: p.id(),
        firstName: p.firstName() || "",
        lastName: p.lastName() || "",
        nickname: p.nickname() || "",
        organization: p.organization() || "",
        jobTitle: p.jobTitle() || "",
        emails: emails,
        phones: phones,
        addresses: addresses,
        birthday: bday ? bday.toISOString() : null,
        note: p.note() || "",
        urls: urls,
        socialProfiles: socialProfiles,
        modificationDate: p.modificationDate().toISOString()
      });
    }
    JSON.stringify(results);
  `;
  const raw = await runJxa(script);
  return JSON.parse(raw) as Contact[];
}

export async function fetchContactById(
  contactId: string
): Promise<Contact | null> {
  const script = `
    const app = Application("Contacts");
    const matches = app.people.whose({ id: "${safeStr(contactId)}" })();
    if (matches.length === 0) {
      JSON.stringify(null);
    } else {
      const p = matches[0];
      const emails = p.emails().map(e => ({
        label: e.label() || "other",
        value: e.value()
      }));
      const phones = p.phones().map(ph => ({
        label: ph.label() || "other",
        value: ph.value()
      }));
      const addresses = p.addresses().map(a => ({
        label: a.label() || "other",
        street: a.street() || "",
        city: a.city() || "",
        state: a.state() || "",
        postalCode: a.zip() || "",
        country: a.country() || ""
      }));
      const urls = p.urls().map(u => ({
        label: u.label() || "other",
        value: u.value()
      }));
      const socialProfiles = p.socialProfiles().map(s => ({
        label: s.serviceName() || "other",
        value: s.userName() || s.url() || ""
      }));
      const bday = p.birthDate();
      JSON.stringify({
        id: p.id(),
        firstName: p.firstName() || "",
        lastName: p.lastName() || "",
        nickname: p.nickname() || "",
        organization: p.organization() || "",
        jobTitle: p.jobTitle() || "",
        emails: emails,
        phones: phones,
        addresses: addresses,
        birthday: bday ? bday.toISOString() : null,
        note: p.note() || "",
        urls: urls,
        socialProfiles: socialProfiles,
        modificationDate: p.modificationDate().toISOString()
      });
    }
  `;
  const raw = await runJxa(script);
  return JSON.parse(raw) as Contact | null;
}

export async function createContact(
  firstName: string,
  lastName: string,
  options: {
    email?: string;
    phone?: string;
    organization?: string;
    jobTitle?: string;
    note?: string;
  } = {}
): Promise<string> {
  const emailLine = options.email
    ? `const email = app.Email({ label: "work", value: "${safeStr(options.email)}" });
       p.emails.push(email);`
    : "";
  const phoneLine = options.phone
    ? `const phone = app.Phone({ label: "mobile", value: "${safeStr(options.phone)}" });
       p.phones.push(phone);`
    : "";

  const script = `
    const app = Application("Contacts");
    const p = app.Person({
      firstName: "${safeStr(firstName)}",
      lastName: "${safeStr(lastName)}"
    });
    app.people.push(p);
    ${options.organization ? `p.organization = "${safeStr(options.organization)}";` : ""}
    ${options.jobTitle ? `p.jobTitle = "${safeStr(options.jobTitle)}";` : ""}
    ${options.note ? `p.note = "${safeStr(options.note)}";` : ""}
    ${emailLine}
    ${phoneLine}
    app.save();
    p.id();
  `;
  return await runJxa(script);
}

export async function updateContact(
  contactId: string,
  updates: Partial<Pick<Contact, "firstName" | "lastName" | "nickname" | "organization" | "jobTitle" | "note">>
): Promise<void> {
  const setParts: string[] = [];
  if (updates.firstName !== undefined)
    setParts.push(`p.firstName = "${safeStr(updates.firstName)}";`);
  if (updates.lastName !== undefined)
    setParts.push(`p.lastName = "${safeStr(updates.lastName)}";`);
  if (updates.nickname !== undefined)
    setParts.push(`p.nickname = "${safeStr(updates.nickname)}";`);
  if (updates.organization !== undefined)
    setParts.push(`p.organization = "${safeStr(updates.organization)}";`);
  if (updates.jobTitle !== undefined)
    setParts.push(`p.jobTitle = "${safeStr(updates.jobTitle)}";`);
  if (updates.note !== undefined)
    setParts.push(`p.note = "${safeStr(updates.note)}";`);

  if (setParts.length === 0) return;

  const script = `
    const app = Application("Contacts");
    const matches = app.people.whose({ id: "${safeStr(contactId)}" })();
    if (matches.length === 0) throw new Error("Contact not found: ${safeStr(contactId)}");
    const p = matches[0];
    ${setParts.join("\n    ")}
    app.save();
    "ok";
  `;
  await runJxa(script);
}

export async function deleteContact(contactId: string): Promise<void> {
  const script = `
    const app = Application("Contacts");
    const matches = app.people.whose({ id: "${safeStr(contactId)}" })();
    if (matches.length > 0) {
      app.delete(matches[0]);
      app.save();
    }
    "ok";
  `;
  await runJxa(script);
}
