import { describe, expect, it } from "vitest";
import { createSceneFromChapter, findSessionChapter } from "./chapter";
import { demoBook, demoSession } from "./data";
import type { Book, ChapterProfile, SessionEntryPoint } from "./types";

const chapter: ChapterProfile = {
  id: "chapter_0001",
  order: 1,
  title: "第一章",
  content: "沈砚进入旧钟楼。",
  openingExcerpt: "雾气贴着旧钟楼的窗。",
  closingExcerpt: "门外响起脚步。",
  characterIds: ["char_shenyan"],
  locationIds: ["loc_clocktower"],
  itemIds: [],
  keywords: ["沈砚"],
};

const previous: ChapterProfile = {
  ...chapter,
  id: "chapter_0000",
  order: 0,
  title: "序章",
  closingExcerpt: "半页账册落在桌边。",
};

const book: Book = { ...demoBook, chapters: [previous, chapter] };
const entryPoint: SessionEntryPoint = {
  chapterId: chapter.id,
  chapterOrder: chapter.order,
  roleMode: "character",
  playerCharacterId: "char_luwei",
  playerName: "陆微",
  playerRole: "黑帆船长",
  playerAdult: true,
  canonMode: "strict",
  styleMode: "source",
};

describe("chapter entry", () => {
  it("builds a scene from chapter entities and the previous ending", () => {
    const scene = createSceneFromChapter(book, chapter, entryPoint);
    expect(scene.location).toBe("旧钟楼");
    expect(scene.activeCharacters).toEqual(["char_luwei", "char_shenyan"]);
    expect(scene.lastEvent).toContain("半页账册");
    expect(scene.objective).toContain("陆微");
  });

  it("resolves the selected chapter from the session entry point", () => {
    const session = { ...demoSession, bookId: book.id, entryPoint };
    expect(findSessionChapter(book, session)?.id).toBe(chapter.id);
  });
});
