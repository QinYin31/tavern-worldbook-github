import type { Book, ChatMessage, MemoryRecord, ModelMessage, NarrativePreset, RelationshipState, SceneState, Session, StatePatch } from "./types";
import { chapterEvidence, findSessionChapter, sessionPlayerLabel } from "./chapter";
import { narrativePresetPrompt } from "./presets";

const canonRules = `你是一个沉浸式世界发展叙事引擎。你负责让整个世界在用户行动后继续运转，而不是只替某一个角色回复。你必须遵守以下不可协商的规则：
1. 角色、势力和环境都要根据原作设定、当前处境、已知信息、自身目标和可用资源行动，不因为用户要求就改变立场。
2. 每轮先对用户意图做条件判定：检查地点、时间、资源、能力、已知信息、人物或势力立场，以及必要的前置事件。条件已满足才允许行动顺利发生；条件不足时要表现为失败、延迟、代价、误会或新的阻力；未知条件不能当作已经满足。
3. 用户的行动拥有自由，但世界和角色会产生合理的阻力、误会、拒绝与后果。不要替用户决定尚未做出的重要行动。
4. 处理完用户行动后，至少推动一个可见的世界变化：在场人物的行动、未在场势力的反应、地点状态、资源流动、信息传播或新的因果压力。没有直接变化时，也要说明局势为何暂时不变。
5. 不替角色降智，不让角色无缘无故爱上用户、主动攻略用户或泄露自己不知道的信息。亲密关系只能通过持续互动、具体事件和双方选择逐步变化。
6. 角色拒绝或条件不成立时，保持角色语气并继续推动场景，不跳出故事说教。角色的台词必须贴合原作语气：沿用该角色在原文与人物设定中的自称、称呼方式、句式与措辞习惯（例如妖皇狱离自称“孤”、语调冰冷淡漠、俯视众生），严禁改用现代口语、网络用语或与身份不符的随意腔调；用户或剧情偏离时，角色仍按原设定回应，不跟随用户改变人设。成人内容只允许发生在世界书明确标记为成年、且明确同意的角色之间；未成年或年龄不明角色不得进入色情情节。用户关闭成人内容时，不主动生成相关内容。
7. 使用自然的第三人称小说式世界叙述，必要时嵌入多名角色的行动和对话。不要把回复写成单角色客服答复、选项菜单、规则说明或冗长的判定表。
8. 逐章原文是事实证据，不是要求逐句续写的脚本。保持事实、人物和因果一致，但用户行动造成合理分支后，应继续推演新的结果。

回复格式：先输出正常的世界发展叙述，再在自然需要的位置呈现对话、行动结果和后续压力。对明确的条件判定，用简短的因果叙述体现结果，不输出隐藏推理。回复结尾可以附加机器可读区块：
<state_patch>{"scene":{},"relationships":[{"characterId":"角色id","trust":0,"familiarity":0,"tension":0,"note":"简述"}],"memories":[{"kind":"fact","content":"..."}]}</state_patch>
relationships 必须使用 characterId 字段（角色的 id，不是名字），trust/familiarity/tension 为 0-100 的整数；memories 的 kind 只能是 fact、scene、relationship、preference。
只能填写本轮明确发生或高度确定的变化，不能凭空创造事实。`;

function sceneBlock(scene: SceneState, book: Book) {
  const activeCharacters = scene.activeCharacters.map((characterId) => book.characters.find((character) => character.id === characterId)?.name || characterId);
  return `当前场景：
- 章节：${scene.chapter}
- 地点：${scene.location}
- 时间：${scene.time}
- 天气：${scene.weather}
- 氛围：${scene.atmosphere}
- 当前目标：${scene.objective}
- 在场人物：${activeCharacters.join("、") || "无"}
- 最近事件：${scene.lastEvent}`;
}

function relationshipBlock(relationships: RelationshipState[], book: Book) {
  return relationships.map((relationship) => {
    const character = book.characters.find((item) => item.id === relationship.characterId);
    return `${character?.name || relationship.characterId}：信任 ${relationship.trust}/100，熟悉 ${relationship.familiarity}/100，紧张 ${relationship.tension}/100；${relationship.note}`;
  }).join("\n") || "暂无已建立的关系。";
}

function compactText(value: string, maxLength = 140) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function worldDevelopmentBlock(book: Book, session: Session) {
  const chapter = findSessionChapter(book, session);
  const activeCharacterNames = new Set(session.scene.activeCharacters.map((characterId) => book.characters.find((character) => character.id === characterId)?.name).filter(Boolean));
  const factions = book.factions
    .filter((faction) => !faction.members?.length || faction.members.some((member) => activeCharacterNames.has(member) || session.scene.activeCharacters.includes(member)))
    .slice(0, 6)
    .map((faction) => `${faction.name}：${compactText(faction.stance)}`).join("\n") || "本章暂未触发明确势力。";
  const locations = (chapter?.locationIds.length
    ? chapter.locationIds.map((id) => book.locations.find((location) => location.id === id)).filter(Boolean)
    : book.locations.filter((location) => session.scene.location.includes(location.name)))
    .slice(0, 6)
    .map((location) => `${location!.name}：${compactText(location!.description)}`).join("\n") || `${session.scene.location}：以当前场景和原文证据为准。`;
  const items = (chapter?.itemIds || [])
    .map((id) => book.items.find((item) => item.id === id)).filter(Boolean)
    .slice(0, 6)
    .map((item) => `${item!.name}：${compactText(item!.description)}`).join("\n") || "本章暂未触发关键物品。";
  const timeline = chapter
    ? book.timeline.filter((event) => typeof event.chapterOrder === "number" && event.chapterOrder <= chapter.order).slice(-4)
    : book.timeline.slice(-4);
  const timelineText = timeline.map((event) => `${event.label}：${compactText(event.description)}`).join("\n") || "暂无已登记时间线。";
  return `世界发展所需实体：
势力：
${factions}
地点：
${locations}
关键物品：
${items}
时间线：
${timelineText}`;
}

function relevantLore(book: Book, session: Session, input: string) {
  const normalized = input.toLowerCase();
  const chapterOrder = findSessionChapter(book, session)?.order;
  return book.lorebook
    .filter((entry) => {
      if (typeof chapterOrder === "number" && typeof entry.chapterStart === "number" && entry.chapterStart > chapterOrder) return false;
      return entry.alwaysActive || entry.keys.some((key) => normalized.includes(key.toLowerCase()));
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 8)
    .map((entry) => `【${entry.title}】${entry.content}`)
    .join("\n");
}

function relevantCharacters(book: Book, session: Session, input: string) {
  const chapter = findSessionChapter(book, session);
  const normalized = input.toLowerCase();
  const mentioned = book.characters
    .filter((character) => [character.name, ...character.aliases].some((name) => normalized.includes(name.toLowerCase())))
    .map((character) => character.id);
  const ids = Array.from(new Set([
    ...(session.entryPoint?.playerCharacterId ? [session.entryPoint.playerCharacterId] : []),
    ...session.scene.activeCharacters,
    ...(chapter?.characterIds || []),
    ...mentioned,
  ])).slice(0, 14);
  return ids.length ? ids.map((id) => book.characters.find((character) => character.id === id)).filter(Boolean) : book.characters.slice(0, 10);
}

function playerBlock(book: Book, session: Session) {
  const entry = session.entryPoint;
  if (!entry) return "用户身份：穿书者。不要替用户决定尚未声明的关键行动。";
  const character = entry.playerCharacterId ? book.characters.find((item) => item.id === entry.playerCharacterId) : undefined;
  const roleRule = entry.roleMode === "character"
    ? `用户代入原作角色【${character?.name || entry.playerName}】。继承该角色截至本章的身份、能力、关系和已知信息，但该角色的关键行动、台词和内心选择由用户决定。`
    : `用户扮演原创穿书者【${entry.playerName}】，身份是“${entry.playerRole}”。除这项身份外，不得凭空赋予原作人物关系、超出设定的能力或未来知识。`;
  return `用户代入身份：
- 名称：${entry.playerName}
- 身份：${entry.playerRole}
- 模式：${entry.roleMode === "character" ? "代入原作角色" : "原创穿书者"}
- 成年状态：${entry.playerAdult ? "已明确成年" : "未成年或未明确成年"}
- 控制边界：${roleRule}`;
}

function sourceStyleBlock(book: Book, session: Session, adultContent: boolean) {
  if (!book.styleGuide || session.entryPoint?.styleMode === "custom") return "";
  const adultStyle = adultContent && book.styleGuide.adultSummary
    ? `\n原文成人叙事特征（仅限明确成年且明确同意的角色）：
${book.styleGuide.adultSummary}
${(book.styleGuide.adultTraits || []).map((trait) => `- ${trait}`).join("\n")}
成人叙事禁区：
${(book.styleGuide.adultAvoid || []).map((rule) => `- ${rule}`).join("\n")}`
    : "";
  return `原文叙事特征：
${book.styleGuide.summary}
${book.styleGuide.traits.map((trait) => `- ${trait}`).join("\n")}
避免：
${book.styleGuide.avoid.map((rule) => `- ${rule}`).join("\n")}${adultStyle}`;
}

export function assemblePrompt(book: Book, session: Session, memories: MemoryRecord[], input: string, options: { narrativePreset?: NarrativePreset; adultContent?: boolean; customStyle?: string } = {}): ModelMessage[] {
  const characters = relevantCharacters(book, session, input).map((character) => `【${character!.name}】（角色ID：${character!.id}）
身份：${character!.role}
成年：${character!.adult ? "是" : "否或未明确"}
性格：${character!.traits.join("、")}
目标：${character!.goals.join("；")}
恐惧：${character!.fears.join("；")}
说话方式：${character!.voice}
台词纪律：台词严格沿用原文语气与自称（如妖皇自称“孤”），不得使用现代口语、网络梗或与身份不符的腔调
知道：${character!.knowledge.join("；")}
不知道：${character!.unknowns.join("；")}
边界：${character!.boundaries.join("；")}`).join("\n\n");
  const confirmedMemories = memories.filter((memory) => memory.status === "confirmed").map((memory) => `- ${memory.content}`).join("\n") || "暂无用户确认的长期记忆。";
  const lore = relevantLore(book, session, input) || "本轮没有额外触发的世界书条目。";
  const customStyle = options.customStyle?.trim().slice(0, 1200);
  const styleBlock = customStyle
    ? `自定义文风补充：\n${customStyle}\n- 只调整语言、节奏和视角，不覆盖原文事实、人物设定、条件判定或安全边界。`
    : "";
  const allowAdultContent = Boolean(options.adultContent && session.entryPoint?.playerAdult !== false);
  const system = `${canonRules}

${narrativePresetPrompt(options.narrativePreset || "none", allowAdultContent)}
${sourceStyleBlock(book, session, allowAdultContent)}
${styleBlock}

原作世界：${book.meta.title}
作品摘要：${book.meta.summary || "无"}
时代与地点：${book.world.era}；${book.world.setting}
世界规则：${book.world.rules.join("；")}
术语：${Object.entries(book.world.glossary).map(([key, value]) => `${key}=${value}`).join("；")}

${playerBlock(book, session)}

人物设定：
${characters}

${sceneBlock(session.scene, book)}

${worldDevelopmentBlock(book, session)}

当前关系状态：
${relationshipBlock(session.relationships, book)}

用户确认的长期记忆：
${confirmedMemories}

本轮相关世界书：
${lore}

当前章节原文锚点：
${chapterEvidence(book, session, input)}

叙述时称呼用户为“${sessionPlayerLabel(session)}”，但不要替用户补写未声明的台词、决定或内心结论。`;
  const history = session.messages.at(-1)?.role === "user" && session.messages.at(-1)?.content === input
    ? session.messages.slice(0, -1)
    : session.messages;
  const recent = history.slice(-18).map((message) => ({ role: message.role, content: message.content }));
  return [{ role: "system", content: system }, ...recent, { role: "user", content: input }];
}

function nextChapterEvidence(book: Book, session: Session) {
  const current = findSessionChapter(book, session);
  if (!current) return "暂无后续章节锚点";
  const next = (book.chapters || [])
    .filter((chapter) => chapter.order > current.order)
    .sort((left, right) => left.order - right.order)[0];
  if (!next) return "当前已是原著章节末段，请根据世界书和当前局势提出合理分支";
  return `后续章节锚点：${next.title}
开场线索：${next.openingExcerpt}
涉及人物：${next.characterIds.map((id) => book.characters.find((character) => character.id === id)?.name || id).join("、")}
关键词：${next.keywords.join("、")}`;
}

export function assembleInspirationPrompt(book: Book, session: Session, memories: MemoryRecord[], options: { adultContent?: boolean } = {}): ModelMessage[] {
  const confirmedMemories = memories
    .filter((memory) => memory.status === "confirmed")
    .slice(-8)
    .map((memory) => `- ${memory.content}`)
    .join("\n") || "暂无已确认的长期记忆";
  const recent = session.messages
    .slice(-12)
    .map((message) => ({ role: message.role, content: message.content }));
  const system = `你是“AI灵感”，负责帮助用户决定下一步行动。你不是故事正文生成器，也不要替用户执行行动。

请根据当前场景、人物目标、关系、世界书和原著章节锚点，给出 3 到 4 个可以直接输入聊天框的行动选项。选项必须：
1. 是用户可以主动做出的具体行动，使用简短的第一人称表达；
2. 推动当前局势，彼此有明显差异，至少包含一个调查/获取信息方向和一个与在场人物或势力互动方向；
3. 优先贴合当前章节及后续原著锚点，但不要强行复刻原著、替用户决定关键选择，也不要承诺一定发生的结果；
4. 不要输出解释、标题、编号、Markdown 或剧情正文，只输出合法 JSON 数组，例如：["我检查桌上的账册", "我向在场人物追问昨夜的异常"]；
5. 遵守世界书中的年龄和内容边界。成人内容关闭时，不要生成露骨或性相关行动。

当前世界：${book.meta.title}
${sceneBlock(session.scene, book)}

${worldDevelopmentBlock(book, session)}

当前关系：
${relationshipBlock(session.relationships, book)}

已确认记忆：
${confirmedMemories}

当前章节原著锚点：
${chapterEvidence(book, session, "", 4200)}

${nextChapterEvidence(book, session)}

成人内容状态：${options.adultContent ? "已开启，但仍须遵守角色明确成年与同意边界" : "已关闭"}`;
  return [{ role: "system", content: system }, ...recent, { role: "user", content: "请给出下一步行动选项。" }];
}

export function parseInspirationOptions(content: string): string[] {
  const normalized = content.replace(/<state_patch>[\s\S]*?<\/state_patch>/gi, "").trim();
  const cleanOption = (value: unknown) => {
    if (typeof value !== "string") return "";
    return value.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, "").replace(/\s+/g, " ").trim().slice(0, 160);
  };
  const unique = (values: unknown[]) => Array.from(new Set(values.map(cleanOption).filter(Boolean))).slice(0, 4);
  const candidates = [normalized, normalized.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()];
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object"
        ? ((parsed as { options?: unknown[]; suggestions?: unknown[]; actions?: unknown[] }).options
          || (parsed as { suggestions?: unknown[] }).suggestions
          || (parsed as { actions?: unknown[] }).actions
          || [])
        : [];
      const result = unique(values);
      if (result.length) return result;
    } catch {
      // 模型偶尔会在 JSON 外附带一句话，继续尝试提取数组或分行选项。
    }
  }
  const start = normalized.indexOf("[");
  const end = normalized.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const result = unique(JSON.parse(normalized.slice(start, end + 1)) as unknown[]);
      if (result.length) return result;
    } catch {
      // 退回到分行解析。
    }
  }
  return unique(normalized.split(/\r?\n/).filter((line) => line.trim().length >= 4));
}

export function parseModelEnvelope(content: string): { text: string; patch?: StatePatch } {
  const match = content.match(/<state_patch>([\s\S]*?)<\/state_patch>/i);
  if (!match) return { text: content.trim() };
  let patch: StatePatch | undefined;
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed && typeof parsed === "object") patch = parsed as StatePatch;
  } catch {
    patch = undefined;
  }
  return { text: content.replace(match[0], "").trim(), patch };
}

export function applyStatePatch(session: Session, patch?: StatePatch): Session {
  if (!patch) return session;
  const scene = patch.scene ? { ...session.scene, ...patch.scene } : session.scene;
  const relationships = session.relationships.map((current) => {
    const changed = patch.relationships?.find((item) => item.characterId === current.characterId);
    if (!changed) return current;
    const bounded = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value)
      ? Math.min(100, Math.max(0, Math.round(value)))
      : fallback;
    return {
      ...current,
      trust: bounded(changed.trust, current.trust),
      familiarity: bounded(changed.familiarity, current.familiarity),
      tension: bounded(changed.tension, current.tension),
      note: typeof changed.note === "string" ? changed.note : current.note,
    };
  });
  return { ...session, scene, relationships };
}

export function toChatMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map(({ role, content }) => ({ role, content }));
}
