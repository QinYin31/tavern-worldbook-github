import { describe, expect, it } from "vitest";
import { assembleInspirationPrompt, parseInspirationOptions } from "./prompt";
import { demoBook, demoSession } from "./data";

describe("AI inspiration", () => {
  it("uses the current chapter and the next chapter as story anchors", () => {
    const book = {
      ...demoBook,
      id: "book_inspiration_test",
      chapters: [
        {
          id: "chapter_1",
          order: 1,
          title: "Chapter 1",
          content: "The ledger is hidden in the clock tower.",
          openingExcerpt: "A bell rings in the fog.",
          closingExcerpt: "A locked door opens below the tower.",
          characterIds: ["char_shenyan"],
          locationIds: [],
          itemIds: [],
          keywords: ["ledger"],
        },
        {
          id: "chapter_2",
          order: 2,
          title: "Chapter 2",
          content: "The black sail arrives at the south dock.",
          openingExcerpt: "A black sail appears at the south dock.",
          closingExcerpt: "",
          characterIds: ["char_luwei"],
          locationIds: [],
          itemIds: [],
          keywords: ["dock"],
        },
      ],
    };
    const session = {
      ...demoSession,
      bookId: book.id,
      chapter: "Chapter 1",
      scene: { ...demoSession.scene, chapter: "Chapter 1" },
      entryPoint: { ...demoSession.entryPoint!, chapterId: "chapter_1", chapterOrder: 1 },
    };
    const messages = assembleInspirationPrompt(book, session, []);
    expect(messages[0].content).toContain("Chapter 1");
    expect(messages[0].content).toContain("Chapter 2");
    expect(messages.at(-1)?.content).toBe("请给出下一步行动选项。");
  });

  it("parses JSON, fenced JSON, and line-based fallback options", () => {
    expect(parseInspirationOptions('["inspect the ledger", "question the guard"]')).toEqual(["inspect the ledger", "question the guard"]);
    expect(parseInspirationOptions("```json\n[\"check the scene\"]\n```")[0]).toBe("check the scene");
    expect(parseInspirationOptions("- inspect the lock\n2. question the visitor")).toEqual(["inspect the lock", "question the visitor"]);
  });
});
