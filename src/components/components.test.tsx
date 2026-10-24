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
