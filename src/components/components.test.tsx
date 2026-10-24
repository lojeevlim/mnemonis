import { render, screen } from "@testing-library/react";
import { MarkdownView } from "./MarkdownView";
import { parseMarkdown, safeHref } from "./markdown";
import { STATUS_META } from "./memoryMeta";
import { StatusBadge } from "./StatusBadge";
import { DemoBadge } from "./DemoBadge";
import type { MemoryStatus } from "../domain";

describe("StatusBadge", () => {
  it("renders a label for every status with distinct colors", () => {
    const statuses = Object.keys(STATUS_META) as MemoryStatus[];
    expect(new Set(statuses.map((s) => STATUS_META[s].color)).size).toBe(statuses.length);
    render(
      <>
        {statuses.map((s) => (
          <StatusBadge key={s} status={s} />
        ))}
        <DemoBadge />
      </>,
    );
    for (const s of statuses) expect(screen.getByText(STATUS_META[s].label)).toBeInTheDocument();
    expect(screen.getByText("Demo")).toBeInTheDocument();
  });
});

describe("markdown", () => {
  it("parses headings, lists, tasks, code fences and quotes", () => {
    const blocks = parseMarkdown("# T\n\n- a\n- [x] b\n\n1. one\n\n```js\ncode\n```\n> q\n\npara\nline2");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "list", "list", "code", "quote", "paragraph"]);
    expect(blocks[1]).toMatchObject({ ordered: false, items: [{ text: "a", checked: null }, { text: "b", checked: true }] });
    expect(blocks[3]).toMatchObject({ lang: "js", text: "code" });
  });

  it("only allows http(s) and mailto links", () => {
    expect(safeHref("https://x.dev")).toBe("https://x.dev");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,hi")).toBeNull();
  });

  it("renders formatting but never injects untrusted HTML", () => {
    const evil = [
      "# Title **bold** and `code`",
      "<script>window.__pwned = 1</script>",
      "<img src=x onerror=\"window.__pwned = 2\">",
      "[bad](javascript:alert(1)) and [good](https://example.com)",
    ].join("\n\n");
    const { container } = render(<MarkdownView source={evil} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>window.__pwned = 1</script>");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    const anchors = [...container.querySelectorAll("a")];
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toHaveAttribute("href", "https://example.com");
    expect(anchors[0]).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect([...container.querySelectorAll("[href]")].every((a) => !/javascript:/i.test(a.getAttribute("href") ?? ""))).toBe(true);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("shows a placeholder for empty content", () => {
    render(<MarkdownView source="  " />);
    expect(screen.getByText("No content.")).toBeInTheDocument();
  });
});

describe("MarkdownView inline parsing", () => {
  it("renders 200k '[' on one line quickly (linear, bounded)", () => {
    const t0 = performance.now();
    const { container } = render(<MarkdownView source={"[".repeat(200_000)} />);
    expect(performance.now() - t0).toBeLessThan(250);
    expect(container.querySelector("a")).toBeNull();
  });

  it("stays fast on many unterminated openers within the line cap", () => {
    const t0 = performance.now();
    render(<MarkdownView source={"[a](".repeat(2_400) + "`" + "*_".repeat(2_000)} />);
    expect(performance.now() - t0).toBeLessThan(250);
  });

  it("keeps supported inline syntax", () => {
    const { container } = render(
      <MarkdownView source={"`c` **b** *i* _u_ [ok](https://example.com/x) snake_case_word **a _b_ c**"} />,
    );
    expect(container.querySelector("code")?.textContent).toBe("c");
    expect(container.querySelectorAll("strong")).toHaveLength(2);
    expect(container.querySelector("strong em")?.textContent).toBe("b");
    expect(Array.from(container.querySelectorAll("em")).map((e) => e.textContent)).toEqual(["i", "u", "b"]);
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://example.com/x");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(container.textContent).toContain("snake_case_word");
  });

  it("leaves javascript: links unlinked", () => {
    const { container } = render(<MarkdownView source="[x](javascript:alert(1)) and [y](data:text/html,hi)" />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("[x](javascript:alert(1))");
  });

  it("reveals the real host when link text looks like a different URL", () => {
    const { container } = render(<MarkdownView source="[https://bank.com](https://evil.tld/login)" />);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://evil.tld/login");
    expect(container.textContent).toContain("evil.tld");
  });

  it("does not add a host hint for matching hosts or ordinary link text", () => {
    const { container } = render(
      <MarkdownView source="[https://example.com](https://www.example.com/a) [read more](https://evil.tld)" />,
    );
    expect(container.textContent).not.toContain("links to");
  });

  it("still reveals the real host when the URL-like label is wrapped in emphasis or code", () => {
    for (const label of ["**paypal.com**", "`paypal.com`", "_paypal.com_", "*paypal.com*"]) {
      const { container, unmount } = render(<MarkdownView source={`[${label}](https://evil.example)`} />);
      expect(container.textContent).toContain("(links to evil.example)");
      unmount();
    }
    const { container } = render(<MarkdownView source="[**example.com**](https://example.com)" />);
    expect(container.textContent).not.toContain("links to");
  });
});

describe("markdown block parser performance", () => {
  const ws = " ".repeat(50_000);
  const cases: [string, string][] = [
    ["heading", "# a" + " ".repeat(5000) + "b"],
    ["heading trailing", "# a" + ws + "#" + ws + "x"],
    ["fence", "``` " + ws + "!"],
    ["closing fence", "```\n" + "``` " + ws + "x"],
    ["hr", "---" + ws + "x"],
    ["hr dashes", "- ".repeat(25_000) + "x"],
    ["ul", ws + "x"],
    ["ul marker", "-" + ws + "x"],
    ["ol", "1" + "0".repeat(50_000) + "x"],
    ["ol marker", "1." + ws],
    ["task", "- [x]" + ws + "y"],
    ["quote", ">" + ws + "x"],
    ["long line", "# " + "a".repeat(200_000)],
  ];
  for (const [name, src] of cases) {
    it(`parses ${name} pathological input in < 100ms`, () => {
      const t0 = performance.now();
      parseMarkdown(src);
      expect(performance.now() - t0).toBeLessThan(100);
    });
  }

  it("treats lines over the cap as plain paragraph text", () => {
    const long = "# " + "a".repeat(10_001);
    expect(parseMarkdown(long)).toEqual([{ type: "paragraph", text: long }]);
    expect(parseMarkdown("```\n" + long + "\n```")[0]).toMatchObject({ type: "code" });
  });

  it("keeps normal heading, fence, hr, list and task behaviour", () => {
    expect(parseMarkdown("## Title ##")).toEqual([{ type: "heading", level: 2, text: "Title" }]);
    expect(parseMarkdown("####### x")).toEqual([{ type: "paragraph", text: "####### x" }]);
    expect(parseMarkdown("#nospace")).toEqual([{ type: "paragraph", text: "#nospace" }]);
    expect(parseMarkdown("``` ts \nx\n```  ")).toEqual([{ type: "code", lang: "ts", text: "x" }]);
    expect(parseMarkdown("- - -\n___")).toEqual([{ type: "hr" }, { type: "hr" }]);
    expect(parseMarkdown("1) a\n2. b\n- [X] t")).toEqual([
      { type: "list", ordered: true, items: [{ text: "a", checked: null }, { text: "b", checked: null }] },
      { type: "list", ordered: false, items: [{ text: "t", checked: true }] },
    ]);
    expect(parseMarkdown("> a\n>b")).toEqual([{ type: "quote", text: "a\nb" }]);
  });
});
