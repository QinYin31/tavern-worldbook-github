import type { Book, ChapterProfile, SceneState, Session, SessionEntryPoint } from "./types";

const compact = (value: string, maxLength: number) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
};

export function chapterLabel(chapter: ChapterProfile) {
  if (chapter.chapterNumber === 0) return `序章 · ${chapter.title.replace(/^序章[：:]?\s*/, "")}`;
  return chapter.title;
}

export function findSessionChapter(book: Book, session: Session): ChapterProfile | undefined {
  const chapters = book.chapters || [];
  const chapterId = session.entryPoint?.chapterId;
  if (chapterId) {
    const byId = chapters.find((chapter) => chapter.id === chapterId);
    if (byId) return byId;
  }
  const chapterOrder = session.entryPoint?.chapterOrder;
  if (typeof chapterOrder === "number") {
    const byOrder = chapters.find((chapter) => chapter.order === chapterOrder);
    if (byOrder) return byOrder;
  }
  return chapters.find((chapter) => chapter.title === session.chapter || chapter.title === session.scene.chapter);
}

export function createSceneFromChapter(book: Book, chapter: ChapterProfile, entryPoint: SessionEntryPoint): SceneState {
  const previous = book.chapters?.find((item) => item.order === chapter.order - 1);
  const location = chapter.locationIds
    .map((locationId) => book.locations.find((item) => item.id === locationId)?.name)
    .find(Boolean) || "原文章节现场";
  const activeCharacters = Array.from(new Set([
    ...(entryPoint.playerCharacterId ? [entryPoint.playerCharacterId] : []),
    ...chapter.characterIds,
  ])).slice(0, 8);
  const identity = entryPoint.roleMode === "character"
    ? `以原作角色“${entryPoint.playerName}”的身份进入本章`
    : `以“${entryPoint.playerName}”的身份进入本章`;

  return {
    chapter: chapterLabel(chapter),
    location,
    time: "原作时间线 · 本章开场",
    weather: "以原文描写为准",
    atmosphere: compact(chapter.openingExcerpt, 150) || "原文章节正在展开。",
    objective: `${identity}，在不预知后续情节的前提下行动。`,
    activeCharacters,
    lastEvent: previous
      ? compact(previous.closingExcerpt, 170)
      : "故事从原作序幕的既定事实开始。",
  };
}

function entityTerms(book: Book, input: string) {
  const normalized = input.toLowerCase();
  const candidates = [
    ...book.characters.flatMap((character) => [character.name, ...character.aliases]),
    ...book.locations.map((location) => location.name),
    ...book.items.map((item) => item.name),
    ...Object.keys(book.world.glossary),
  ];
  return Array.from(new Set(candidates.filter((term) => term.length >= 2 && normalized.includes(term.toLowerCase()))));
}

function passageAt(content: string, index: number, radius = 760) {
  const start = Math.max(0, index - radius);
  const end = Math.min(content.length, index + radius);
  return content.slice(start, end).trim();
}

export function chapterEvidence(book: Book, session: Session, input: string, maxLength = 6800) {
  const chapter = findSessionChapter(book, session);
  if (!chapter) return "本世界书没有逐章原文锚点。";

  const passages: string[] = [];
  const seenStarts = new Set<number>();
  const addPassage = (value: string) => {
    const text = value.trim();
    if (text && !passages.includes(text)) passages.push(text);
  };

  addPassage(chapter.openingExcerpt);
  for (const term of entityTerms(book, input).slice(0, 6)) {
    let cursor = chapter.content.indexOf(term);
    let matches = 0;
    while (cursor >= 0 && matches < 2) {
      const bucket = Math.floor(cursor / 500);
      if (!seenStarts.has(bucket)) {
        seenStarts.add(bucket);
        addPassage(passageAt(chapter.content, cursor));
        matches += 1;
      }
      cursor = chapter.content.indexOf(term, cursor + term.length);
    }
  }
  if (passages.length === 1) addPassage(chapter.content.slice(0, 2600));
  addPassage(chapter.closingExcerpt);

  let used = 0;
  const bounded = passages.flatMap((passage) => {
    const remaining = maxLength - used;
    if (remaining <= 0) return [];
    const next = passage.slice(0, remaining);
    used += next.length;
    return next ? [next] : [];
  });

  return `【${chapterLabel(chapter)} · 原文证据】\n${bounded.join("\n\n……\n\n")}`;
}

export function sessionPlayerLabel(session: Session) {
  return session.entryPoint?.playerName || "穿书者";
}
