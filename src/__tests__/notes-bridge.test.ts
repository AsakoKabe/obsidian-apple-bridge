import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "../notes-bridge";

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
    const html = "<table><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr></table>";
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
});
