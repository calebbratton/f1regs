import { describe, expect, it } from "vitest";
import { buildFtsQuery, reciprocalRankFusion } from "../src/ranking";

describe("buildFtsQuery", () => {
  it("quotes terms so FTS5 syntax characters are literal", () => {
    expect(buildFtsQuery("What is Article 33.3?")).toBe('"article" OR "33.3"');
    expect(buildFtsQuery("MGU-K mass")).toBe('"mgu-k" OR "mass"');
    expect(buildFtsQuery('car 12 "NEAR" OR *')).toBe('"car" OR "12" OR "near"');
  });

  it("drops stopwords and returns null when nothing is left", () => {
    expect(buildFtsQuery("should he have been")).toBe('"been"');
    expect(buildFtsQuery("what is the")).toBeNull();
  });
});

describe("reciprocalRankFusion", () => {
  it("ranks ids found by both searches first", () => {
    expect(reciprocalRankFusion([["a", "b", "c"], ["c", "d"]])).toEqual(["c", "a", "b", "d"]);
  });
});
