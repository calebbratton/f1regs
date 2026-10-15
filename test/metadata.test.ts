import { describe, expect, it } from "vitest";
import { pdfLinks } from "../scripts/fetch-fia";
import { parseDocDate, parseEventName, parseSeason, titleFromFilename } from "../scripts/metadata";

describe("metadata", () => {
  it("parses event names from FIA titles and filenames", () => {
    expect(parseEventName("2026_dutch_grand_prix_-_decision_-_car_12.pdf")).toBe(
      "2026 Dutch Grand Prix"
    );
    expect(parseEventName("2026 Mexico City Grand Prix - Infringement - Car 81")).toBe(
      "2026 Mexico City Grand Prix"
    );
    expect(parseEventName("2026 F1 Sporting Regulations")).toBeNull();
  });

  it("parses the first written date", () => {
    expect(parseDocDate("Date\n31 August 2026\nTime 16:02")).toBe("2026-08-31");
    expect(parseDocDate("1st March 2026")).toBe("2026-03-01");
    expect(parseDocDate("no date")).toBeNull();
  });

  it("derives season and title", () => {
    expect(parseSeason(null, "2026 Dutch Grand Prix")).toBe(2026);
    expect(titleFromFilename("2026_f1_sporting_regulations_-_issue_3.pdf")).toBe(
      "2026 F1 Sporting Regulations - Issue 3"
    );
  });
});

describe("pdfLinks", () => {
  it("collects absolute PDF links with their text, deduplicated", () => {
    const html = `
      <a href="/sites/default/files/decision-document/2026%20Dutch%20Grand%20Prix%20-%20Decision.pdf">
        <div class="title">2026 Dutch Grand Prix - Decision - Car 12</div></a>
      <a href="/page">not a pdf</a>
      <a href="/sites/default/files/decision-document/2026%20Dutch%20Grand%20Prix%20-%20Decision.pdf">dup</a>
      <a href="https://cdn.example/x.pdf?v=2"></a>`;
    expect(pdfLinks(html, "https://www.fia.com/documents/x")).toEqual([
      {
        url: "https://www.fia.com/sites/default/files/decision-document/2026%20Dutch%20Grand%20Prix%20-%20Decision.pdf",
        text: "dup"
      },
      { url: "https://cdn.example/x.pdf?v=2", text: "x.pdf" }
    ]);
  });
});
