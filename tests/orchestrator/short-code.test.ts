import { describe, expect, it } from "vitest";
import { generateShortCode } from "../../src/orchestrator/short-code.js";

const URL_SAFE_RE = /^[2-9a-kmnp-zA-HJ-NP-Z]+$/;

describe("generateShortCode", () => {
  it("returns the requested length (default 8)", () => {
    expect(generateShortCode().length).toBe(8);
    expect(generateShortCode(12).length).toBe(12);
    expect(generateShortCode(4).length).toBe(4);
  });

  it("uses only the documented unambiguous alphabet (no 0/O/1/I/l)", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateShortCode();
      expect(URL_SAFE_RE.test(code)).toBe(true);
    }
  });

  it("does not produce visibly ambiguous chars", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateShortCode();
      expect(code).not.toMatch(/[0O1Il]/);
    }
  });

  it("generates distinct codes (collision-free over a small sample)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generateShortCode());
    // 56^8 search space, 5000 samples — collisions essentially impossible.
    expect(seen.size).toBe(5000);
  });

  it("rejects non-positive lengths", () => {
    expect(() => generateShortCode(0)).toThrow();
    expect(() => generateShortCode(-1)).toThrow();
  });
});
