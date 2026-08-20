import { describe, expect, it } from "vitest";
import { demoBook, demoSession } from "./data";
import { applyStatePatch, assemblePrompt, parseModelEnvelope } from "./prompt";
import type { Book, Session } from "./types";

const chapterBook: Book = {
  ...demoBook,
  id: "book_chapter_test",
  styleGuide: {
    summary: "环境起笔，动作与对白交替。",
    traits: ["短段推进", "情绪通过动作外显"],
    avoid: ["不使用现代网络梗"],
    adultSummary: "成人场景采用连续动作与即时反馈。",
    adultTraits: ["保持动作、反馈、对话连续"],
    adultAvoid: ["只限明确成年且同意的角色"],
  },
  chapters: [
    {
      id: "chapter_0000",
      order: 0,
      chapterNumber: 0,
      title: "序章：雾起",
      content: "旧钟楼的门在雾里开启。沈砚站在门外，手里握着缺页账册。",
      openingExcerpt: "旧钟楼的门在雾里开启。",
      closingExcerpt: "沈砚握紧了缺页账册。",
      characterIds: ["char_shenyan"],
      locationIds: ["loc_clocktower"],
      itemIds: ["item_ledger"],
      keywords: ["沈砚", "旧钟楼", "账册"],
    },
  ],
};

const chapterSession: Session = {
  ...demoSession,
  id: "session_chapter_test",
  bookId: chapterBook.id,
  chapter: "序章：雾起",
  scene: { ...demoSession.scene, chapter: "序章 · 雾起" },
  entryPoint: {
    chapterId: "chapter_0000",
    chapterOrder: 0,
    roleMode: "traveler",
    playerName: "林舟",
    playerRole: "误入钟楼的成年旅人",
    playerAdult: true,
    canonMode: "strict",
    styleMode: "source",
  },
};

describe("prompt assembly", () => {
  it("keeps canon rules, scene state and relevant lore in the system message", () => {
    const messages = assemblePrompt(demoBook, demoSession, [], "我翻看账册，问沈砚黑帆是什么");
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("不让角色无缘无故爱上用户、主动攻略用户或泄露自己不知道的信息");
    expect(messages[0].content).toContain("旧账册");
    expect(messages[0].content).toContain("旧钟楼档案室");
  });

  it("frames each turn as world development with compact condition context", () => {
    const messages = assemblePrompt(demoBook, demoSession, [], "我想把缺页账簿交给南码头的黑帆");
    expect(messages[0].content).toContain("世界发展叙事引擎");
    expect(messages[0].content).toContain("条件判定");
    expect(messages[0].content).toContain("灰钟议会");
    expect(messages[0].content).toContain("南码头");
    expect(messages[0].content).toContain("缺页账册");
    expect(messages[0].content).toContain("当前场景");
  });

  it("adds a bounded custom writing style without overriding canon", () => {
    const messages = assemblePrompt(demoBook, demoSession, [], "观察雾中的动静", { customStyle: "冷峻克制，短句为主。" });
    expect(messages[0].content).toContain("自定义文风补充：\n冷峻克制，短句为主。");
    expect(messages[0].content).toContain("不覆盖原文事实、人物设定、条件判定或安全边界");
  });

  it("adds the reusable cultivation and conquest preset without changing canon", () => {
    const messages = assemblePrompt(demoBook, demoSession, [], "我观察沈砚的反应", { narrativePreset: "cultivation-conquest", adultContent: true });
    expect(messages[0].content).toContain("修仙 · 权谋 · 征服感 · 成人氛围");
    expect(messages[0].content).toContain("不等于让角色失去意志");
    expect(messages[0].content).toContain("允许在剧情自然发展时出现");
  });

  it("injects the selected chapter, player identity and source style", () => {
    const messages = assemblePrompt(chapterBook, chapterSession, [], "我问沈砚账册从哪里来");
    expect(messages[0].content).toContain("用户扮演原创穿书者【林舟】");
    expect(messages[0].content).toContain("原文叙事特征：\n环境起笔，动作与对白交替。");
    expect(messages[0].content).toContain("【序章 · 雾起 · 原文证据】");
    expect(messages[0].content).toContain("沈砚站在门外");
  });

  it("adds the adult source style only for an explicitly adult player", () => {
    const adultMessages = assemblePrompt(chapterBook, chapterSession, [], "继续", { adultContent: true });
    expect(adultMessages[0].content).toContain("原文成人叙事特征");
    const minorSession = { ...chapterSession, entryPoint: { ...chapterSession.entryPoint!, playerAdult: false } };
    const minorMessages = assemblePrompt(chapterBook, minorSession, [], "继续", { adultContent: true });
    expect(minorMessages[0].content).not.toContain("原文成人叙事特征");
  });

  it("does not duplicate the latest user input in message history", () => {
    const input = "我走近旧钟楼";
    const session = { ...chapterSession, messages: [...chapterSession.messages, { id: "latest", role: "user" as const, content: input, createdAt: Date.now() }] };
    const messages = assemblePrompt(chapterBook, session, [], input);
    expect(messages.filter((message) => message.role === "user" && message.content === input)).toHaveLength(1);
  });
});

describe("model state envelope", () => {
  it("removes a valid state patch from visible dialogue", () => {
    const result = parseModelEnvelope('沈砚抬眼。<state_patch>{"scene":{"location":"门厅"}}</state_patch>');
    expect(result.text).toBe("沈砚抬眼。");
    expect(result.patch?.scene?.location).toBe("门厅");
  });

  it("keeps visible text and ignores malformed patches", () => {
    const result = parseModelEnvelope("正常对白<state_patch>{坏 JSON}</state_patch>");
    expect(result.text).toBe("正常对白");
    expect(result.patch).toBeUndefined();
  });

  it("applies only declared scene and relationship changes", () => {
    const next = applyStatePatch(demoSession, {
      scene: { location: "门厅" },
      relationships: [{ characterId: "char_shenyan", trust: 24 }],
    });
    expect(next.scene.location).toBe("门厅");
    expect(next.scene.time).toBe(demoSession.scene.time);
    expect(next.relationships.find((item) => item.characterId === "char_shenyan")?.trust).toBe(24);
  });

  it("bounds relationship changes returned by the model", () => {
    const next = applyStatePatch(demoSession, {
      relationships: [{ characterId: "char_shenyan", trust: 240, familiarity: -4, tension: "high" as unknown as number }],
    });
    const relationship = next.relationships.find((item) => item.characterId === "char_shenyan");
    expect(relationship?.trust).toBe(100);
    expect(relationship?.familiarity).toBe(0);
    expect(relationship?.tension).toBe(28);
  });
});
