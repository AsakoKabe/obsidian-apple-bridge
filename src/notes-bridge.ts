import { execFile } from "child_process";

export interface AppleNote {
  id: string;
  title: string;
  body: string; // HTML content from Apple Notes
  folderName: string;
  folderPath: string; // e.g. "Notes/Subfolder"
  creationDate: string; // ISO 8601
  modificationDate: string; // ISO 8601
}

export interface NoteFolder {
  name: string;
  id: string;
  path: string;
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

export async function listNoteFolders(): Promise<NoteFolder[]> {
  const script = `
    const app = Application("Notes");
    const folders = app.folders();
    const result = folders.map(f => ({
      name: f.name(),
      id: f.id(),
      path: f.name()
    }));
    JSON.stringify(result);
  `;
  const raw = await runJxa(script);
  return JSON.parse(raw) as NoteFolder[];
}

export async function fetchNotes(folderName?: string): Promise<AppleNote[]> {
  const safeStr = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const folderFilter = folderName
    ? `const folders = [app.folders.whose({ name: "${safeStr(folderName)}" })[0]];`
    : `const folders = app.folders();`;

  const script = `
    const app = Application("Notes");
    ${folderFilter}
    const results = [];
    for (const folder of folders) {
      if (!folder) continue;
      const folderName = folder.name();
      const notes = folder.notes();
      for (const note of notes) {
        results.push({
          id: note.id(),
          title: note.name(),
          body: note.body(),
          folderName: folderName,
          folderPath: folderName,
          creationDate: note.creationDate().toISOString(),
          modificationDate: note.modificationDate().toISOString()
        });
      }
    }
    JSON.stringify(results);
  `;
  const raw = await runJxa(script);
  return JSON.parse(raw) as AppleNote[];
}

export async function fetchNoteById(noteId: string): Promise<AppleNote | null> {
  const safeStr = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `
    const app = Application("Notes");
    const folders = app.folders();
    for (const folder of folders) {
      const matches = folder.notes.whose({ id: "${safeStr(noteId)}" })();
      if (matches.length > 0) {
        const note = matches[0];
        const result = {
          id: note.id(),
          title: note.name(),
          body: note.body(),
          folderName: folder.name(),
          folderPath: folder.name(),
          creationDate: note.creationDate().toISOString(),
          modificationDate: note.modificationDate().toISOString()
        };
        JSON.stringify(result);
        break;
      }
    }
    JSON.stringify(null);
  `;
  const raw = await runJxa(script);
  const parsed = JSON.parse(raw);
  return parsed as AppleNote | null;
}

/**
 * Convert Apple Notes HTML body to Markdown.
 * Apple Notes uses a subset of HTML: divs, br, b/strong, i/em,
 * ul/ol/li, h1-h6, a, img, and checklist items.
 */
export function htmlToMarkdown(html: string): string {
  let md = html;

  // Remove XML/DOCTYPE declarations
  md = md.replace(/<\?xml[^>]*\?>/gi, "");
  md = md.replace(/<!DOCTYPE[^>]*>/gi, "");
  md = md.replace(/<html[^>]*>/gi, "");
  md = md.replace(/<\/html>/gi, "");
  md = md.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");
  md = md.replace(/<body[^>]*>/gi, "");
  md = md.replace(/<\/body>/gi, "");

  // Headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "#### $1\n");
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "##### $1\n");
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "###### $1\n");

  // Bold and italic
  md = md.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  md = md.replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  md = md.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, "$1");
  md = md.replace(/<strike[^>]*>([\s\S]*?)<\/strike>/gi, "~~$1~~");
  md = md.replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, "~~$1~~");

  // Links
  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Images — extract as attachment references
  md = md.replace(/<img[^>]+src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)");
  md = md.replace(/<img[^>]+src="([^"]*)"[^>]*\/?>/gi, "![]($1)");

  // Apple Notes checklists: <ul class="...checklist..."><li>
  // Checked items have a specific attribute or class
  md = md.replace(/<li[^>]*class="[^"]*checked[^"]*"[^>]*>([\s\S]*?)<\/li>/gi, "- [x] $1\n");

  // Unordered lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  md = md.replace(/<\/?ul[^>]*>/gi, "\n");
  md = md.replace(/<\/?ol[^>]*>/gi, "\n");

  // Code blocks (must come before paragraph/div processing so <pre> is not
  // accidentally consumed by the /<p[^>]*>/ pattern which also matches <pre>)
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "```\n$1\n```\n");
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // Line breaks and divs
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<\/div>\s*<div[^>]*>/gi, "\n");
  md = md.replace(/<div[^>]*>/gi, "\n");
  md = md.replace(/<\/div>/gi, "");
  md = md.replace(/<\/p>\s*<p[^>]*>/gi, "\n\n");
  md = md.replace(/<p[^>]*>/gi, "");
  md = md.replace(/<\/p>/gi, "\n");

  // Blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "> $1\n");

  // Horizontal rules
  md = md.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Tables
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_match, inner: string) => {
    const rows: string[] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(inner)) !== null) {
      const cells: string[] = [];
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cells.push(cellMatch[1].trim());
      }
      rows.push("| " + cells.join(" | ") + " |");
    }
    if (rows.length > 0) {
      const headerSep =
        "| " +
        rows[0]
          .split("|")
          .filter((c) => c.trim())
          .map(() => "---")
          .join(" | ") +
        " |";
      return [rows[0], headerSep, ...rows.slice(1), ""].join("\n");
    }
    return "";
  });

  // Strip remaining HTML tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  md = md.replace(/&amp;/g, "&");
  md = md.replace(/&lt;/g, "<");
  md = md.replace(/&gt;/g, ">");
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, " ");

  // Clean up excessive whitespace
  md = md.replace(/\n{3,}/g, "\n\n");
  md = md.trim();

  return md;
}

/**
 * Convert Markdown back to HTML suitable for Apple Notes.
 * This is the reverse of htmlToMarkdown — it handles the subset of
 * markdown that htmlToMarkdown produces.
 */
export function markdownToHtml(md: string): string {
  if (!md) return "";

  const lines = md.split("\n");
  const htmlLines: string[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block toggle
    if (line.match(/^```/)) {
      if (!inCodeBlock) {
        if (inList) {
          htmlLines.push("</ul>");
          inList = false;
        }
        inCodeBlock = true;
        codeBlockContent = [];
        continue;
      } else {
        htmlLines.push(`<pre>${codeBlockContent.join("\n")}</pre>`);
        inCodeBlock = false;
        continue;
      }
    }

    if (inCodeBlock) {
      codeBlockContent.push(escapeHtml(line));
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      if (inList) {
        htmlLines.push("</ul>");
        inList = false;
      }
      htmlLines.push("<hr/>");
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (inList) {
        htmlLines.push("</ul>");
        inList = false;
      }
      const level = headingMatch[1].length;
      const text = processInline(escapeHtml(headingMatch[2]));
      htmlLines.push(`<h${level}>${text}</h${level}>`);
      continue;
    }

    // Blockquote
    const bqMatch = line.match(/^>\s?(.*)$/);
    if (bqMatch) {
      if (inList) {
        htmlLines.push("</ul>");
        inList = false;
      }
      const text = processInline(escapeHtml(bqMatch[1]));
      htmlLines.push(`<blockquote>${text}</blockquote>`);
      continue;
    }

    // Checklist: - [x] or - [ ]
    const checkMatch = line.match(/^- \[([ x])\]\s+(.+)$/);
    if (checkMatch) {
      if (!inList) {
        htmlLines.push("<ul>");
        inList = true;
      }
      const checked = checkMatch[1] === "x";
      const text = processInline(escapeHtml(checkMatch[2]));
      htmlLines.push(checked ? `<li class="checked">${text}</li>` : `<li>${text}</li>`);
      continue;
    }

    // Unordered list item: - text
    const liMatch = line.match(/^- (.+)$/);
    if (liMatch) {
      if (!inList) {
        htmlLines.push("<ul>");
        inList = true;
      }
      const text = processInline(escapeHtml(liMatch[1]));
      htmlLines.push(`<li>${text}</li>`);
      continue;
    }

    // Close list if we hit a non-list line
    if (inList) {
      htmlLines.push("</ul>");
      inList = false;
    }

    // Empty line
    if (line.trim() === "") {
      continue;
    }

    // Regular line — treat as text with inline formatting
    htmlLines.push(processInline(escapeHtml(line)));
  }

  // Close unclosed list
  if (inList) {
    htmlLines.push("</ul>");
  }

  // Close unclosed code block
  if (inCodeBlock) {
    htmlLines.push(`<pre>${codeBlockContent.join("\n")}</pre>`);
  }

  return htmlLines.join("<br/>");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function processInline(text: string): string {
  let result = text;

  // Inline code (must come before bold/italic to avoid conflicts)
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Images: ![alt](src)
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1"/>');

  // Links: [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Bold: **text**
  result = result.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");

  // Italic: *text* (but not **)
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<i>$1</i>");

  // Strikethrough: ~~text~~
  result = result.replace(/~~([^~]+)~~/g, "<s>$1</s>");

  return result;
}

export async function updateNoteBody(noteId: string, htmlBody: string): Promise<void> {
  const safeStr = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const safeBody = safeStr(htmlBody);
  const script = `
    const app = Application("Notes");
    const folders = app.folders();
    for (const folder of folders) {
      const matches = folder.notes.whose({ id: "${safeStr(noteId)}" })();
      if (matches.length > 0) {
        matches[0].body = "${safeBody}";
        break;
      }
    }
  `;
  await runJxa(script);
}

export async function createNote(
  folderName: string,
  title: string,
  htmlBody: string
): Promise<string> {
  const safeStr = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `
    const app = Application("Notes");
    const folder = app.folders.whose({ name: "${safeStr(folderName)}" })[0];
    const note = app.Note({ name: "${safeStr(title)}", body: "${safeStr(htmlBody)}" });
    folder.notes.push(note);
    note.id();
  `;
  const raw = await runJxa(script);
  return raw.trim();
}
