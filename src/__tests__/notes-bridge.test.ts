import { describe, it, expect, vi, beforeEach } from "vitest";
import { htmlToMarkdown, listNoteFolders, fetchNotes, fetchNoteById } from "../notes-bridge";
import { execFile } from "child_process";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);

describe("htmlToMarkdown", () => {
  it("converts h1 headings", () => {
    expect(htmlToMarkdown("<h1>Title</h1>")).toContain("# Title");
  });

  it("converts h2 headings", () => {
    expect(htmlToMarkdown("<h2>Section</h2>")).toContain("## Section");
  });

  it("converts h3 headings", () => {
    expect(htmlToMarkdown("<h3>Sub</h3>")).toContain("### Sub");
  });

  it("converts bold with <b> tag", () => {
    expect(htmlToMarkdown("<b>bold text</b>")).toContain("**bold text**");
  });

  it("converts bold with <strong> tag", () => {
    expect(htmlToMarkdown("<strong>important</strong>")).toContain("**important**");
  });

  it("converts italic with <i> tag", () => {
    expect(htmlToMarkdown("<i>italic</i>")).toContain("*italic*");
  });

  it("converts italic with <em> tag", () => {
    expect(htmlToMarkdown("<em>emphasis</em>")).toContain("*emphasis*");
  });

  it("converts strikethrough with <strike>", () => {
    expect(htmlToMarkdown("<strike>old</strike>")).toContain("~~old~~");
  });

  it("converts strikethrough with <s>", () => {
    expect(htmlToMarkdown("<s>removed</s>")).toContain("~~removed~~");
  });

  it("strips <u> tags without marker", () => {
    const result = htmlToMarkdown("<u>underline</u>");
    expect(result).toContain("underline");
    expect(result).not.toContain("<u>");
  });

  it("converts anchor links", () => {
    expect(htmlToMarkdown('<a href="https://example.com">link text</a>')).toContain(
      "[link text](https://example.com)"
    );
  });

  it("converts images with alt", () => {
    expect(htmlToMarkdown('<img src="img.png" alt="photo"/>')).toContain("![photo](img.png)");
  });

  it("converts images without alt", () => {
    expect(htmlToMarkdown('<img src="img.png"/>')).toContain("![](img.png)");
  });

  it("converts unordered list items", () => {
    const result = htmlToMarkdown("<ul><li>Item one</li><li>Item two</li></ul>");
    expect(result).toContain("- Item one");
    expect(result).toContain("- Item two");
  });

  it("converts checked list items", () => {
    const result = htmlToMarkdown('<li class="checked">Done task</li>');
    expect(result).toContain("- [x] Done task");
  });

  it("converts line breaks", () => {
    const result = htmlToMarkdown("line one<br/>line two");
    expect(result).toContain("line one");
    expect(result).toContain("line two");
  });

  it("converts div separators to newlines", () => {
    const result = htmlToMarkdown("<div>first</div><div>second</div>");
    expect(result).toContain("first");
    expect(result).toContain("second");
  });

  it("converts code inline", () => {
    expect(htmlToMarkdown("<code>const x = 1</code>")).toContain("`const x = 1`");
  });

  it("converts pre blocks", () => {
    const result = htmlToMarkdown("<pre>function foo() {}</pre>");
    expect(result).toContain("```");
    expect(result).toContain("function foo() {}");
  });

  it("converts blockquotes", () => {
    expect(htmlToMarkdown("<blockquote>quoted text</blockquote>")).toContain("> quoted text");
  });

  it("converts horizontal rules", () => {
    expect(htmlToMarkdown("<hr/>")).toContain("---");
  });

  it("decodes &amp;", () => {
    expect(htmlToMarkdown("cats &amp; dogs")).toContain("cats & dogs");
  });

  it("decodes &lt; and &gt;", () => {
    const result = htmlToMarkdown("&lt;tag&gt;");
    expect(result).toContain("<tag>");
  });

  it("decodes &quot;", () => {
    expect(htmlToMarkdown("say &quot;hello&quot;")).toContain('say "hello"');
  });

  it("decodes &#39;", () => {
    expect(htmlToMarkdown("it&#39;s")).toContain("it's");
  });

  it("decodes &nbsp;", () => {
    expect(htmlToMarkdown("hello&nbsp;world")).toContain("hello world");
  });

  it("strips remaining unknown HTML tags", () => {
    const result = htmlToMarkdown('<span class="foo">text</span>');
    expect(result).toContain("text");
    expect(result).not.toContain("<span");
  });

  it("removes XML declarations", () => {
    const result = htmlToMarkdown('<?xml version="1.0"?><p>content</p>');
    expect(result).not.toContain("<?xml");
    expect(result).toContain("content");
  });

  it("removes head section", () => {
    const result = htmlToMarkdown("<head><title>Page</title></head><body>Body</body>");
    expect(result).not.toContain("Page");
    expect(result).toContain("Body");
  });

  it("collapses excessive newlines", () => {
    const result = htmlToMarkdown("one<br/><br/><br/><br/>two");
    expect(result).not.toMatch(/\n{3,}/);
  });

  it("trims surrounding whitespace", () => {
    const result = htmlToMarkdown("  <p>text</p>  ");
    expect(result).not.toMatch(/^\s/);
    expect(result).not.toMatch(/\s$/);
  });

  it("converts a simple table", () => {
    const html =
      "<table><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr></table>";
    const result = htmlToMarkdown(html);
    expect(result).toContain("Name");
    expect(result).toContain("Age");
    expect(result).toContain("Alice");
    expect(result).toContain("---");
  });

  it("handles empty input", () => {
    expect(htmlToMarkdown("")).toBe("");
  });

  it("handles plain text with no tags", () => {
    expect(htmlToMarkdown("just plain text")).toBe("just plain text");
  });

  it("returns empty string for table with no rows", () => {
    const result = htmlToMarkdown("<table></table>");
    expect(result).toBe("");
  });
});

// ─── JXA bridge function tests ────────────────────────────────────────────

function simulateExecFile(stdout: string) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    (callback as Function)(null, stdout, "");
    return undefined as any;
  });
}

function simulateExecFileError(message: string, stderr = "") {
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    const error = new Error(message);
    (callback as Function)(error, "", stderr);
    return undefined as any;
  });
}

describe("listNoteFolders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed folder list from JXA output", async () => {
    const folders = [
      { name: "Notes", id: "folder-1", path: "Notes" },
      { name: "Work", id: "folder-2", path: "Work" },
    ];
    simulateExecFile(JSON.stringify(folders));

    const result = await listNoteFolders();

    expect(result).toEqual(folders);
    expect(mockExecFile).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", expect.any(String)],
      { maxBuffer: 50 * 1024 * 1024 },
      expect.any(Function)
    );
  });

  it("returns empty array when no folders", async () => {
    simulateExecFile("[]");
    const result = await listNoteFolders();
    expect(result).toEqual([]);
  });

  it("rejects when JXA fails with stderr", async () => {
    simulateExecFileError("exit code 1", "permission denied");
    await expect(listNoteFolders()).rejects.toThrow("JXA error: permission denied");
  });

  it("rejects with error message when stderr is empty", async () => {
    simulateExecFileError("something went wrong");
    await expect(listNoteFolders()).rejects.toThrow("JXA error: something went wrong");
  });
});

describe("fetchNotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleNotes = [
    {
      id: "note-1",
      title: "My Note",
      body: "<p>Hello</p>",
      folderName: "Notes",
      folderPath: "Notes",
      creationDate: "2026-01-01T00:00:00.000Z",
      modificationDate: "2026-01-02T00:00:00.000Z",
    },
  ];

  it("fetches all notes when no folder specified", async () => {
    simulateExecFile(JSON.stringify(sampleNotes));

    const result = await fetchNotes();

    expect(result).toEqual(sampleNotes);
    const scriptArg = (mockExecFile.mock.calls[0][1] as string[])[3];
    expect(scriptArg).toContain("const folders = app.folders()");
  });

  it("fetches notes for a specific folder", async () => {
    simulateExecFile(JSON.stringify(sampleNotes));

    await fetchNotes("Work");

    const scriptArg = (mockExecFile.mock.calls[0][1] as string[])[3];
    expect(scriptArg).toContain('app.folders.whose({ name: "Work" })');
  });

  it("escapes special characters in folder name", async () => {
    simulateExecFile("[]");

    await fetchNotes('My "Folder"');

    const scriptArg = (mockExecFile.mock.calls[0][1] as string[])[3];
    expect(scriptArg).toContain('My \\"Folder\\"');
  });

  it("returns empty array when no notes found", async () => {
    simulateExecFile("[]");
    const result = await fetchNotes();
    expect(result).toEqual([]);
  });

  it("rejects on JXA error", async () => {
    simulateExecFileError("script error", "Notes app not running");
    await expect(fetchNotes()).rejects.toThrow("JXA error: Notes app not running");
  });
});

describe("fetchNoteById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a note when found", async () => {
    const note = {
      id: "note-42",
      title: "Found Note",
      body: "<p>Content</p>",
      folderName: "Notes",
      folderPath: "Notes",
      creationDate: "2026-03-01T00:00:00.000Z",
      modificationDate: "2026-03-02T00:00:00.000Z",
    };
    simulateExecFile(JSON.stringify(note));

    const result = await fetchNoteById("note-42");

    expect(result).toEqual(note);
    const scriptArg = (mockExecFile.mock.calls[0][1] as string[])[3];
    expect(scriptArg).toContain('"note-42"');
  });

  it("returns null when note is not found", async () => {
    simulateExecFile("null");

    const result = await fetchNoteById("nonexistent");

    expect(result).toBeNull();
  });

  it("escapes special characters in note ID", async () => {
    simulateExecFile("null");

    await fetchNoteById('id-with-"quotes"');

    const scriptArg = (mockExecFile.mock.calls[0][1] as string[])[3];
    expect(scriptArg).toContain('id-with-\\"quotes\\"');
  });

  it("rejects on JXA error", async () => {
    simulateExecFileError("failed", "access denied");
    await expect(fetchNoteById("note-1")).rejects.toThrow("JXA error: access denied");
  });
});
