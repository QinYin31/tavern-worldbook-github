import { describe, expect, it } from "vitest";
import { isPackagedBookId, mergeRecords } from "./storage";

interface Item {
  id: string;
  value: string;
  updatedAt?: number;
}

describe("mergeRecords", () => {
  it("merges records with different ids", () => {
    const local: Item[] = [{ id: "a", value: "local-a", updatedAt: 1 }];
    const remote: Item[] = [{ id: "b", value: "remote-b", updatedAt: 2 }];
    const merged = mergeRecords(local, remote);
    expect(merged.map((item) => item.id).sort()).toEqual(["a", "b"]);
  });

  it("prefers the newer remote record", () => {
    const local: Item[] = [{ id: "x", value: "local-old", updatedAt: 10 }];
    const remote: Item[] = [{ id: "x", value: "remote-new", updatedAt: 20 }];
    const merged = mergeRecords(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe("remote-new");
  });

  it("prefers the newer local record", () => {
    const local: Item[] = [{ id: "x", value: "local-new", updatedAt: 30 }];
    const remote: Item[] = [{ id: "x", value: "remote-old", updatedAt: 20 }];
    const merged = mergeRecords(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe("local-new");
  });

  it("prefers local records when timestamps are absent", () => {
    const local: Item[] = [{ id: "m", value: "local" }];
    const remote: Item[] = [{ id: "m", value: "remote" }];
    const merged = mergeRecords(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe("local");
  });

  it("handles empty arrays", () => {
    expect(mergeRecords([], [])).toEqual([]);
    expect(mergeRecords([{ id: "a", value: "v", updatedAt: 1 }], [])).toHaveLength(1);
    expect(mergeRecords([], [{ id: "b", value: "w", updatedAt: 2 }])).toHaveLength(1);
  });
});

describe("isPackagedBookId", () => {
  it("recognizes the current and legacy packaged books", () => {
    expect(isPackagedBookId("book_demo_worldbook")).toBe(true);
    expect(isPackagedBookId("book_legacy_worldbook")).toBe(true);
  });

  it("does not classify custom books as packaged", () => {
    expect(isPackagedBookId("book_custom_1")).toBe(false);
    expect(isPackagedBookId("book_demo_mist-city")).toBe(false);
  });
});
