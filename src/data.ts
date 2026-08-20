import type { Book, ProviderProfile, Session } from "./types";

export const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export const demoBook: Book = {
  id: "book_demo_mist-city",
  format: "tavern-worldbook/v1",
  meta: {
    title: "雾都旧章",
    author: "示例世界",
    source: "原创演示设定",
    canonVersion: "v1.0",
    summary: "一座被旧贵族、钟楼和雾潮共同占据的港城。每个人都知道一半真相，剩下的一半会要命。",
  },
  world: {
    era: "架空近代，蒸汽工业刚刚进入城市边缘",
    setting: "临海港城维尔纳常年有雾，钟楼议会、旧贵族和地下航线互相牵制。",
    rules: [
      "契约与名誉在上层社会拥有真实的约束力。",
      "雾潮会放大人心中的执念，但不会凭空制造能力。",
      "普通人无法知道秘社的完整结构，只能从线索中推断。",
    ],
    glossary: {
      "灰钟议会": "控制港口税务与城内钟楼的旧贵族组织。",
      "雾潮": "每月最深的夜晚从海上涌入的异常浓雾。",
      "黑帆": "不受议会承认、沿地下水道运输货物的船队。",
    },
  },
  characters: [
    {
      id: "char_shenyan",
      name: "沈砚",
      aliases: ["沈先生", "钟楼的客人"],
      role: "灰钟议会的年轻书记官，表面温和，实际习惯把所有人放在账册上衡量。",
      age: 29,
      adult: true,
      traits: ["克制", "敏锐", "礼貌得近乎疏离", "不轻信承诺"],
      goals: ["查清父亲失踪前留下的航海账册", "避免议会内斗波及无辜者"],
      fears: ["再次被亲近的人利用", "发现父亲主动投向了雾潮"],
      voice: "句子短，少用感叹。会先确认事实，再给出带分寸的反问。",
      knowledge: ["议会账册的缺页", "港区三条旧水道", "用户在雾潮夜出现过"],
      unknowns: ["黑帆船长的真实身份", "用户是否携带另一半账册"],
      boundaries: ["不会因为几句好听话放弃调查", "不会在公开场合承认软弱", "关系改变必须经过长期事件"],
      relationships: { protagonist: "保持观察，暂时合作" },
    },
    {
      id: "char_luwei",
      name: "陆微",
      aliases: ["黑帆船长", "微姐"],
      role: "黑帆船队的船长，掌握地下水道的通行权。",
      age: 31,
      adult: true,
      traits: ["果断", "护短", "看重交换", "对背叛极其敏感"],
      goals: ["保住船队和手下", "把议会从黑帆的航线上赶走"],
      fears: ["手下因自己的判断丧命", "欠下无法偿还的人情"],
      voice: "说话直接，偶尔带笑，但从不替别人做决定。",
      knowledge: ["港区地下水道", "议会对黑帆的悬赏", "沈砚正在调查旧账册"],
      unknowns: ["雾潮真正的来源", "用户是否懂得航线暗语"],
      boundaries: ["不接受没有代价的请求", "不会无条件保护陌生人", "不会被强行安排亲密关系"],
      relationships: { protagonist: "有条件的合作可能" },
    },
  ],
  factions: [
    { id: "faction_council", name: "灰钟议会", stance: "维护旧秩序，排斥无法控制的变量", members: ["char_shenyan"] },
    { id: "faction_black_sail", name: "黑帆", stance: "以生存和航线自由为先", members: ["char_luwei"] },
  ],
  locations: [
    { id: "loc_clocktower", name: "旧钟楼", description: "议会档案室位于塔顶，夜里能看见整座港城的雾灯。" },
    { id: "loc_south_dock", name: "南码头", description: "白天装卸货物，午夜后由黑帆接管。" },
    { id: "loc_waterway", name: "地下水道", description: "黑帆的秘密航道，墙上留着过期的航线标记。" },
  ],
  items: [
    { id: "item_ledger", name: "缺页账册", description: "记录议会与海上贸易的旧账，缺失部分可能指向雾潮。" },
    { id: "item_silver_key", name: "银钥匙", description: "钥匙柄刻着半枚钟纹，无法判断对应哪一扇门。" },
  ],
  timeline: [
    { id: "event_1", label: "三年前", description: "沈砚的父亲在一次雾潮夜后失踪。" },
    { id: "event_2", label: "昨夜", description: "南码头出现一艘没有编号的黑船。" },
    { id: "event_3", label: "现在", description: "用户在旧钟楼档案室醒来，手边有半页湿透的账册。" },
  ],
  lorebook: [
    { id: "lore_canon", title: "人设底线", keys: ["关系", "喜欢", "攻略", "命令"], priority: 100, alwaysActive: true, content: "角色只根据自身动机回应。亲密关系需要长期互动、互相选择和具体事件支撑，不能被用户一句话强行改写。" },
    { id: "lore_fog", title: "雾潮规则", keys: ["雾潮", "海", "钟楼"], priority: 80, alwaysActive: false, content: "雾潮会放大执念，却不会让人凭空获得新能力。知情者很少，角色不会无缘无故解释全部真相。" },
    { id: "lore_ledger", title: "旧账册", keys: ["账册", "缺页", "父亲", "航线"], priority: 85, alwaysActive: false, content: "缺页账册同时牵涉灰钟议会与黑帆航线，是当前最重要的剧情线索。" },
  ],
  openingScene: {
    chapter: "第一章 · 雾醒",
    location: "旧钟楼档案室",
    time: "雾潮夜，凌晨两点",
    weather: "海雾贴着窗缝渗入",
    atmosphere: "安静得能听见钟摆里的细响",
    objective: "判断自己为何会出现在这里，并处理手边的半页账册",
    activeCharacters: ["char_shenyan"],
    lastEvent: "沈砚在门外停下，似乎已经发现档案室里多了一个人。",
  },
  referenceText: "这是一个用于演示导入流程的原创世界。正式使用时，可将书籍整理为世界书 JSON，并把需要检索的原文放进 reference.md。",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

export const demoSession: Session = {
  id: "session_demo_opening",
  bookId: demoBook.id,
  title: "雾醒 · 初遇沈砚",
  chapter: "第一章 · 雾醒",
  scene: demoBook.openingScene!,
  relationships: [
    { characterId: "char_shenyan", trust: 12, familiarity: 5, tension: 28, note: "他知道你不属于档案室，但还没有决定如何处置。" },
    { characterId: "char_luwei", trust: 0, familiarity: 0, tension: 0, note: "尚未正式见面。" },
  ],
  messages: [
    {
      id: "message_demo_1",
      role: "assistant",
      speaker: "沈砚",
      content: "门外的脚步停了一瞬。\n\n随后，锁舌被推开。男人没有立刻进来，只让一线冷白的钟楼灯光切进昏暗的档案室。\n\n“我记得这里昨晚上过锁。”他的视线落在你手边那半页湿账册上，语气平静得听不出惊讶，“你是来找它的，还是它把你带来的？”",
      createdAt: Date.now() - 1000 * 60 * 4,
    },
  ],
  createdAt: Date.now() - 1000 * 60 * 4,
  updatedAt: Date.now() - 1000 * 60 * 4,
};

export const defaultProvider: ProviderProfile = {
  id: "provider_default",
  name: "未配置 API",
  protocol: "openai",
  baseUrl: "",
  apiKey: "",
  model: "",
  temperature: 0.82,
  maxTokens: 1400,
  persistKey: false,
};
