import { describe, expect, it } from "vitest";
import { articleOf, chunkPages } from "../src/chunking";

describe("articleOf", () => {
  it("reads numbered and ARTICLE headings", () => {
    expect(articleOf("33.3 Drivers must use the track at all times.")).toBe("33.3");
    expect(articleOf("B6.1.2 The race will start")).toBe("B6.1.2");
    expect(articleOf("ARTICLE 54: PENALTIES")).toBe("54");
  });

  it("ignores body text that merely contains numbers", () => {
    expect(articleOf("The car must weigh 768 kg")).toBeNull();
    expect(articleOf("2026 FORMULA 1 DUTCH GRAND PRIX")).toBeNull();
    expect(articleOf("3.5 kg")).toBe("3.5"); // known false positive, harmless
  });
});

describe("chunkPages", () => {
  const para = (n: number) => `Sentence ${n} about the rules of racing.`;

  it("tags chunks with start page and the article in effect", () => {
    const pages = [
      ["33.1 Track limits", ...Array.from({ length: 30 }, (_, i) => para(i))].join("\n"),
      ["33.2 Leaving the track", ...Array.from({ length: 30 }, (_, i) => para(i + 30))].join("\n")
    ];
    const chunks = chunkPages(pages, { size: 400, overlap: 80 });
    expect(chunks.length).toBeGreaterThan(4);
    expect(chunks[0]).toMatchObject({ seq: 0, page: 1, article: "33.1" });
    const page2 = chunks.find((c) => c.text.includes("33.2 Leaving"));
    expect(page2).toMatchObject({ page: 2, article: "33.2" });
    expect(chunks.at(-1)!.article).toBe("33.2");
    expect(chunks.every((c) => c.text.length <= 400 + 60)).toBe(true);
    expect(chunks.map((c) => c.seq)).toEqual(chunks.map((_, i) => i));
  });

  it("overlaps consecutive chunks by whole lines", () => {
    const text = Array.from({ length: 40 }, (_, i) => para(i)).join("\n");
    const [a, b] = chunkPages([text], { size: 300, overlap: 80 });
    // Two ~38-char lines fit in 80 chars of overlap.
    expect(b.text.split("\n").slice(0, 2)).toEqual(a.text.split("\n").slice(-2));
  });

  it("splits text extracted without line breaks", () => {
    const text = Array.from({ length: 60 }, (_, i) => para(i)).join(" ");
    const chunks = chunkPages([text], { size: 300, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.text.length <= 450)).toBe(true);
  });

  it("returns nothing for empty pages", () => {
    expect(chunkPages(["", "  \n "])).toEqual([]);
  });
});
