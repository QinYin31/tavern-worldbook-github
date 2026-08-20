import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BookMarked,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Compass,
  Download,
  Feather,
  FileJson,
  GitBranch,
  KeyRound,
  Lightbulb,
  Map,
  Menu,
  MessageCircle,
  MoreHorizontal,
  PanelRight,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  TestTube2,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { fetchModels, streamChat, testProvider } from "./api";
import { chapterLabel, createSceneFromChapter, findSessionChapter, sessionPlayerLabel } from "./chapter";
import { id } from "./data";
import { applyStatePatch, assembleInspirationPrompt, assemblePrompt, parseInspirationOptions, parseModelEnvelope } from "./prompt";
import { narrativePresetLabels } from "./presets";
import { db, loadAppData } from "./storage";
import type {
  AppSettings,
  Book,
  ChapterProfile,
  ChatMessage,
  MemoryRecord,
  ProviderProfile,
  RelationshipState,
  SceneState,
  Session,
  SessionEntryPoint,
  WorldbookPack,
} from "./types";

type AppData = Awaited<ReturnType<typeof loadAppData>>;
type Toast = { id: string; tone: "info" | "success" | "error"; message: string };
type RightPanel = AppSettings["rightPanel"];

const blankScene: SceneState = {
  chapter: "序章",
  location: "未设定",
  time: "未知",
  weather: "未知",
  atmosphere: "",
  objective: "",
  activeCharacters: [],
  lastEvent: "",
};

const worldNarrator = "世界叙述";
const timeLabel = (time: number) => new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(time);
const dateLabel = (time: number) => new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(time);
const compactText = (value: string, maxLength = 180) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
};

function normalizeProvider(raw: unknown): ProviderProfile {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const nested = (source.provider && typeof source.provider === "object" ? source.provider : source) as Record<string, unknown>;
  const providers = Array.isArray(source.providers) ? source.providers : [];
  const candidate = providers.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
  const value = candidate || nested;
  let settingsConfig: Record<string, unknown> = {};
  const settingsText = value.settings_config || value.settingsConfig;
  if (typeof settingsText === "string") {
    try {
      settingsConfig = JSON.parse(settingsText) as Record<string, unknown>;
    } catch {
      settingsConfig = {};
    }
  }
  const env = [value.env, value.environment, value.environmentVariables, settingsConfig.env]
    .find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
  const read = (...keys: string[]) => keys.map((key) => value[key] ?? env?.[key] ?? settingsConfig[key])
    .find((item) => item !== undefined && item !== null && item !== "");
  const explicitProtocol = String(value.protocol || value.type || "").toLowerCase();
  const baseUrl = String(read("baseUrl", "base_url", "GOOGLE_GEMINI_BASE_URL", "ANTHROPIC_BASE_URL", "OPENAI_BASE_URL") || "");
  let isPokeApi = false;
  try {
    isPokeApi = /(?:^|\.)poke2api\.com$/i.test(new URL(baseUrl).hostname);
  } catch {
    isPokeApi = false;
  }
  const isGemini = explicitProtocol.includes("gemini") || (!isPokeApi && Boolean(read("GOOGLE_GEMINI_BASE_URL", "GEMINI_API_KEY", "GEMINI_MODEL")));
  const isAnthropic = explicitProtocol.includes("anthropic") || Boolean(read("ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"));
  const protocol: ProviderProfile["protocol"] = isGemini ? "gemini" : isAnthropic ? "anthropic" : "openai";
  return {
    id: id("provider"),
    name: String(value.name || value.label || "导入的中转站"),
    protocol,
    baseUrl,
    apiKey: String(read("apiKey", "api_key", "GEMINI_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY") || ""),
    model: String(read("model", "modelName", "GEMINI_MODEL", "ANTHROPIC_MODEL", "OPENAI_MODEL") || ""),
    temperature: Number(value.temperature ?? 0.82),
    maxTokens: Number(value.maxTokens || value.max_tokens || 1400),
    persistKey: false,
  };
}

function normalizeBook(raw: unknown, referenceText = ""): WorldbookPack {
  const source = ((raw && typeof raw === "object" && "book" in raw ? (raw as { book: unknown }).book : raw) || {}) as Partial<WorldbookPack>;
  if (source.format !== "tavern-worldbook/v1") throw new Error("不支持的世界书格式，需要 tavern-worldbook/v1");
  if (!source.meta?.title) throw new Error("世界书缺少 meta.title");
  if (!Array.isArray(source.characters) || source.characters.length === 0) throw new Error("世界书至少需要一个人物");
  return {
    format: "tavern-worldbook/v1",
    meta: source.meta,
    world: source.world || { era: "", setting: "", rules: [], glossary: {} },
    characters: source.characters,
    factions: source.factions || [],
    locations: source.locations || [],
    items: source.items || [],
    timeline: source.timeline || [],
    lorebook: source.lorebook || [],
    chapters: source.chapters || [],
    styleGuide: source.styleGuide,
    openingScene: source.openingScene || { ...blankScene, activeCharacters: source.characters.slice(0, 1).map((character) => character.id) },
    ...(referenceText ? { referenceText } : {}),
  };
}

function defaultRelationships(book: Book): RelationshipState[] {
  return book.characters.map((character) => ({
    characterId: character.id,
    trust: 0,
    familiarity: 0,
    tension: 0,
    note: "尚未建立关系。",
  }));
}

function makeInitialSession(book: Book, chapter?: ChapterProfile): Session {
  const entryPoint: SessionEntryPoint = {
    chapterId: chapter?.id,
    chapterOrder: chapter?.order,
    roleMode: "traveler",
    playerName: "???",
    playerRole: "??????????????",
    playerAdult: true,
    canonMode: "strict",
    styleMode: "source",
  };
  const scene = chapter ? createSceneFromChapter(book, chapter, entryPoint) : book.openingScene || blankScene;
  return {
    id: id("session"),
    bookId: book.id,
    title: `${chapter ? chapterLabel(chapter) : scene.chapter} ? ${entryPoint.playerName}`,
    chapter: chapter?.title || scene.chapter,
    messages: [],
    scene,
    relationships: defaultRelationships(book),
    entryPoint,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function IconButton({ label, onClick, children, active = false, disabled = false }: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button className={`icon-button ${active ? "is-active" : ""}`} type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function BookCover({ book, size = "small" }: { book: Book; size?: "small" | "large" }) {
  return (
    <span className={`book-cover book-cover-${size}`}>
      {book.meta.cover ? <img src={book.meta.cover} alt="" /> : <span>{book.meta.title.slice(0, 1)}</span>}
    </span>
  );
}

export default function ReaderApp() {
  const [data, setData] = useState<AppData | null>(null);
  const [loadingError, setLoadingError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSessionSetup, setShowSessionSetup] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showMobileInspector, setShowMobileInspector] = useState(false);
  const [configText, setConfigText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [search, setSearch] = useState("");
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [inspirationOptions, setInspirationOptions] = useState<string[]>([]);
  const [inspirationLoading, setInspirationLoading] = useState(false);
  const bookImportRef = useRef<HTMLInputElement>(null);
  const configImportRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadAppData().then(setData).catch((error) => setLoadingError(error instanceof Error ? error.message : "无法打开本地存储"));
  }, []);

  // 监听存储/同步失败，让所有设备上的写操作问题可见（而不是静默失败）。
  useEffect(() => {
    const onSyncError = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      pushToast(detail || "数据保存失败", "error");
    };
    window.addEventListener("app-sync-error", onSyncError);
    return () => window.removeEventListener("app-sync-error", onSyncError);
  }, []);

  // 检测服务端是否可达（手机端修改数据依赖电脑上的服务）。
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then((response) => { if (!cancelled) setServerOnline(response.ok); })
      .catch(() => { if (!cancelled) setServerOnline(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.sessions, streamingText]);

  // iPhone 上键盘弹出/地址栏收起会改变 visualViewport 高度,动态撑满可视区域,避免底部输入框被遮挡。
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const shell = document.querySelector<HTMLElement>(".app-shell");
    if (!shell) return;
    const applyHeight = () => {
      shell.style.height = `${viewport.height}px`;
    };
    viewport.addEventListener("resize", applyHeight);
    viewport.addEventListener("scroll", applyHeight);
    applyHeight();
    return () => {
      viewport.removeEventListener("resize", applyHeight);
      viewport.removeEventListener("scroll", applyHeight);
    };
  }, [data]);

  const books = data?.books || [];
  const sessions = data?.sessions || [];
  const memories = data?.memories || [];
  const providers = data?.providers || [];
  const settings = data?.settings;
  const activeBook = books.find((book) => book.id === settings?.activeBookId) || books[0];
  const activeSession = sessions.find((session) => session.id === settings?.activeSessionId)
    || sessions.find((session) => session.bookId === activeBook?.id);
  const activeProvider = providers.find((provider) => provider.id === settings?.activeProviderId) || providers[0];
  const bookMemories = memories.filter((memory) => memory.bookId === activeBook?.id && memory.sessionId === activeSession?.id);
  const filteredBooks = books.filter((book) => book.meta.title.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    setInspirationOptions([]);
  }, [activeSession?.id]);

  const pushToast = (message: string, tone: Toast["tone"] = "info") => {
    const toast = { id: id("toast"), message, tone };
    setToasts((current) => [...current, toast]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== toast.id)), 3800);
  };

  const updateSettings = (changes: Partial<AppSettings>) => {
    if (!data?.settings) return;
    const next = { ...data.settings, ...changes };
    setData((current) => current ? { ...current, settings: next } : current);
    void db.putSettings(next);
  };

  const saveProvider = (next: ProviderProfile) => {
    const saved = { ...next, updatedAt: Date.now() };
    setData((current) => current ? {
      ...current,
      providers: current.providers.some((provider) => provider.id === saved.id)
        ? current.providers.map((provider) => provider.id === saved.id ? saved : provider)
        : [...current.providers, saved],
    } : current);
    void db.putProvider(saved.persistKey ? saved : { ...saved, apiKey: "" });
    if (data?.settings && data.settings.activeProviderId !== saved.id) {
      updateSettings({ activeProviderId: saved.id });
    }
  };

  const saveSession = (next: Session) => {
    setData((current) => current ? {
      ...current,
      sessions: current.sessions.some((session) => session.id === next.id)
        ? current.sessions.map((session) => session.id === next.id ? next : session)
        : [...current.sessions, next],
    } : current);
    void db.putSession(next);
  };

  const selectBook = (book: Book) => {
    const nextSession = sessions.find((session) => session.bookId === book.id);
    updateSettings({ activeBookId: book.id, activeSessionId: nextSession?.id || "" });
    setShowMobileMenu(false);
  };

  const createSession = (entryPoint: SessionEntryPoint, chapter?: ChapterProfile) => {
    if (!activeBook) return;
    const scene = chapter ? createSceneFromChapter(activeBook, chapter, entryPoint) : { ...(activeBook.openingScene || blankScene) };
    const session: Session = {
      id: id("session"),
      bookId: activeBook.id,
      title: `${chapter ? chapterLabel(chapter) : scene.chapter} · ${entryPoint.playerName}`,
      chapter: chapter ? chapter.title : scene.chapter,
      messages: [],
      scene,
      relationships: defaultRelationships(activeBook),
      entryPoint,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveSession(session);
    updateSettings({ activeSessionId: session.id });
    setShowSessionSetup(false);
    setShowMobileMenu(false);
    pushToast(`已从“${session.scene.chapter}”进入世界`, "success");
  };

  const branchSession = () => {
    if (!activeSession) return;
    const branched: Session = {
      ...activeSession,
      id: id("session"),
      title: `${activeSession.title} · 分支`,
      messages: [...activeSession.messages],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveSession(branched);
    updateSettings({ activeSessionId: branched.id });
    pushToast("已从当前节点创建分支", "success");
  };

  const deleteSession = (target: Session) => {
    if (!data) return;
    const remaining = sessions.filter((session) => session.bookId === target.bookId && session.id !== target.id)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    setData((current) => current ? {
      ...current,
      sessions: current.sessions.filter((session) => session.id !== target.id),
      memories: current.memories.filter((memory) => memory.sessionId !== target.id),
    } : current);
    void db.deleteSession(target.id);
    void db.deleteMemoriesBySession(target.id);
    if (settings?.activeSessionId === target.id) {
      if (remaining.length) {
        updateSettings({ activeSessionId: remaining[0].id });
      } else if (activeBook) {
        const fallback = makeInitialSession(activeBook);
        saveSession(fallback);
        updateSettings({ activeSessionId: fallback.id });
      } else {
        updateSettings({ activeSessionId: "" });
      }
    }
    pushToast(`“已删除节点“${target.title}”`, "success");
  };

  const persistMemories = (session: Session, contents: { kind: MemoryRecord["kind"]; content: string; reason?: string }[]) => {
    if (!contents.length || !activeBook) return;
    contents.forEach((item) => {
      const memory: MemoryRecord = {
        id: id("memory"),
        bookId: activeBook.id,
        sessionId: session.id,
        kind: item.kind,
        content: item.content,
        source: item.reason || "模型从本轮对话提出",
        status: "pending",
        createdAt: Date.now(),
      };
      setData((current) => current ? { ...current, memories: [...current.memories, memory] } : current);
      void db.putMemory(memory);
    });
  };

  const runTurn = async (input: string, baseSession: Session) => {
    if (!activeBook || !activeProvider?.baseUrl || !activeProvider.apiKey || !activeProvider.model) {
      pushToast("请先填写中转站 Base URL、API Key 和模型", "error");
      return;
    }
    const assistantId = id("message");
    const placeholder: ChatMessage = { id: assistantId, role: "assistant", speaker: worldNarrator, content: "", createdAt: Date.now() };
    const withPlaceholder = { ...baseSession, messages: [...baseSession.messages, placeholder], updatedAt: Date.now() };
    saveSession(withPlaceholder);
    setSending(true);
    setStreamingText("");
    const abortController = new AbortController();
    abortRef.current = abortController;
    try {
      const prompt = assemblePrompt(activeBook, baseSession, bookMemories, input, {
        narrativePreset: settings?.narrativePreset,
        adultContent: settings?.adultContent,
        customStyle: settings?.customStyle,
      });
      let raw = "";
      await streamChat(activeProvider, prompt, (delta) => {
        raw += delta;
        setStreamingText(raw);
      }, abortController.signal);
      const envelope = parseModelEnvelope(raw);
      const patched = applyStatePatch(withPlaceholder, envelope.patch);
      const finalSession: Session = {
        ...patched,
        messages: patched.messages.map((message) => message.id === assistantId
          ? { ...message, content: envelope.text || "（模型没有返回文字）", statePatch: envelope.patch }
          : message),
        updatedAt: Date.now(),
      };
      saveSession(finalSession);
      persistMemories(finalSession, envelope.patch?.memories || []);
    } catch (error) {
      if ((error as Error).name !== "AbortError") pushToast(error instanceof Error ? error.message : "生成失败", "error");
      setData((current) => current ? {
        ...current,
        sessions: current.sessions.map((session) => session.id === withPlaceholder.id
          ? { ...session, messages: session.messages.filter((message) => message.id !== assistantId) }
          : session),
      } : current);
    } finally {
      setSending(false);
      setStreamingText("");
      abortRef.current = null;
    }
  };

  const sendMessage = async () => {
    const input = draft.trim();
    if (!input || !activeSession) return;
    const message: ChatMessage = {
      id: id("message"),
      role: "user",
      speaker: sessionPlayerLabel(activeSession),
      content: input,
      createdAt: Date.now(),
    };
    const next = { ...activeSession, messages: [...activeSession.messages, message], updatedAt: Date.now() };
    saveSession(next);
    setDraft("");
    setInspirationOptions([]);
    await runTurn(input, next);
  };

  const requestInspiration = async () => {
    if (!activeBook || !activeSession || inspirationLoading || sending) return;
    if (!activeProvider?.baseUrl || !activeProvider.apiKey || !activeProvider.model) {
      pushToast("请先填写中转站 Base URL、API Key 和模型", "error");
      return;
    }
    setInspirationLoading(true);
    const controller = new AbortController();
    try {
      let raw = "";
      await streamChat(activeProvider, assembleInspirationPrompt(activeBook, activeSession, bookMemories, {
        adultContent: settings?.adultContent,
      }), (delta) => {
        raw += delta;
      }, controller.signal);
      const options = parseInspirationOptions(raw);
      if (!options.length) throw new Error("模型没有返回可用的灵感选项");
      setInspirationOptions(options);
    } catch (error) {
      if ((error as Error).name !== "AbortError") pushToast(error instanceof Error ? error.message : "AI 灵感生成失败", "error");
    } finally {
      setInspirationLoading(false);
    }
  };

  const regenerate = async () => {
    if (!activeSession || sending) return;
    const lastUser = [...activeSession.messages].reverse().find((message) => message.role === "user");
    if (!lastUser) return;
    const lastMessage = activeSession.messages.at(-1);
    const messages = lastMessage?.role === "assistant" ? activeSession.messages.slice(0, -1) : activeSession.messages;
    const next = { ...activeSession, messages, updatedAt: Date.now() };
    saveSession(next);
    await runTurn(lastUser.content, next);
  };

  const undoTurn = () => {
    if (!activeSession || sending) return;
    const messages = [...activeSession.messages];
    while (messages.length && messages.at(-1)?.role === "assistant") messages.pop();
    if (messages.at(-1)?.role === "user") messages.pop();
    saveSession({ ...activeSession, messages, updatedAt: Date.now() });
    pushToast("已撤回上一轮", "info");
  };

  const importBookFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setImportBusy(true);
    try {
      let rawBook: unknown;
      let referenceText = "";
      for (const file of Array.from(files)) {
        const text = await file.text();
        if (file.name.toLowerCase().endsWith(".json")) rawBook = JSON.parse(text);
        else if (/\.(txt|md|markdown)$/i.test(file.name)) referenceText = text;
      }
      if (!rawBook) throw new Error("请选择 worldbook.json");
      const normalized = normalizeBook(rawBook, referenceText);
      const book: Book = { ...normalized, id: id("book"), createdAt: Date.now(), updatedAt: Date.now() };
      const defaultChapter = book.chapters?.[0];
      const entryPoint: SessionEntryPoint = {
        chapterId: defaultChapter?.id,
        chapterOrder: defaultChapter?.order,
        roleMode: "traveler",
        playerName: "穿书者",
        playerRole: "身份与来历尚未公开的异世来客",
        playerAdult: true,
        canonMode: "strict",
        styleMode: "source",
      };
      const scene = defaultChapter ? createSceneFromChapter(book, defaultChapter, entryPoint) : book.openingScene || blankScene;
      const session: Session = {
        id: id("session"),
        bookId: book.id,
        title: `${scene.chapter} · 穿书者`,
        chapter: defaultChapter?.title || scene.chapter,
        messages: [],
        scene,
        relationships: defaultRelationships(book),
        entryPoint,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const nextSettings = { ...data!.settings, activeBookId: book.id, activeSessionId: session.id };
      setData((current) => current ? {
        ...current,
        books: [...current.books, book],
        sessions: [...current.sessions, session],
        settings: nextSettings,
      } : current);
      await Promise.all([db.putBook(book), db.putSession(session), db.putSettings(nextSettings)]);
      pushToast(`已导入《${book.meta.title}》`, "success");
      setShowSettings(false);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "世界书导入失败", "error");
    } finally {
      setImportBusy(false);
      if (bookImportRef.current) bookImportRef.current.value = "";
    }
  };

  const importConfig = () => {
    if (!configText.trim()) {
      pushToast("请先粘贴配置 JSON", "error");
      return;
    }
    try {
      const provider = normalizeProvider(JSON.parse(configText));
      saveProvider(provider);
      updateSettings({ activeProviderId: provider.id });
      setConfigText("");
      pushToast("中转站配置已导入", "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "配置 JSON 无效", "error");
    }
  };

  const importConfigFile = async (file: File | undefined) => {
    if (!file) return;
    setConfigText(await file.text());
    if (configImportRef.current) configImportRef.current.value = "";
  };

  const downloadJson = (payload: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportConfig = () => {
    if (!activeProvider) return;
    downloadJson({ ...activeProvider, apiKey: activeProvider.persistKey ? activeProvider.apiKey : "" }, "tavern-provider-config.json");
    pushToast(activeProvider.persistKey ? "配置已导出" : "已导出不含 API Key 的配置", "success");
  };

  const exportBook = () => {
    if (!activeBook) return;
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...worldbook } = activeBook;
    downloadJson(worldbook, `${activeBook.meta.title}.worldbook.json`);
    pushToast("世界书已导出", "success");
  };

  const updateMemory = (memory: MemoryRecord, status: MemoryRecord["status"]) => {
    const next = { ...memory, status };
    setData((current) => current ? {
      ...current,
      memories: current.memories.map((item) => item.id === memory.id ? next : item),
    } : current);
    void db.putMemory(next);
  };

  if (loadingError) return <div className="fatal-state"><AlertCircle size={22} />{loadingError}</div>;
  if (!data || !activeBook || !activeSession || !activeProvider || !settings) {
    return <div className="loading-state"><Sparkles size={20} /><strong>正在索引原文章节</strong><span>首次载入会读取本地世界书。</span></div>;
  }

  const pendingMemories = bookMemories.filter((memory) => memory.status === "pending");
  const confirmedMemories = bookMemories.filter((memory) => memory.status === "confirmed");
  const playerCanUseAdultContent = activeSession.entryPoint?.playerAdult !== false;
  const currentChapter = findSessionChapter(activeBook, activeSession);

  return (
    <div className={`app-shell ${settings.compactMode ? "is-compact" : ""}`}>
      <aside className={`sidebar ${showMobileMenu ? "mobile-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><BookOpen size={18} /></div>
          <div><strong>书页驿站</strong><span>原文锚定穿书</span></div>
          <IconButton label="关闭书库" onClick={() => setShowMobileMenu(false)}><X size={17} /></IconButton>
        </div>

        <div className="library-heading"><span>书库</span><IconButton label="导入世界书" onClick={() => setShowSettings(true)}><Plus size={17} /></IconButton></div>
        <div className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索作品" /></div>
        <div className="book-list">
          {filteredBooks.map((book) => (
            <button className={`book-item ${book.id === activeBook.id ? "is-selected" : ""}`} type="button" key={book.id} onClick={() => selectBook(book)}>
              <BookCover book={book} />
              <span className="book-copy"><strong>{book.meta.title}</strong><small>{book.chapters?.length || 0} 章 · {book.characters.length} 人物</small></span>
              <MoreHorizontal size={16} />
            </button>
          ))}
        </div>

        <div className="library-heading session-heading">
          <span>剧情分支</span>
          <IconButton label="选择章节新建会话" onClick={() => setShowSessionSetup(true)}><Plus size={17} /></IconButton>
        </div>
        <div className="session-list">
          {sessions.filter((session) => session.bookId === activeBook.id).map((session) => (
            <div className={`session-item ${session.id === activeSession.id ? "is-selected" : ""}`} key={session.id}>
              <button className="session-item-main" type="button" onClick={() => {
                updateSettings({ activeSessionId: session.id });
                setShowMobileMenu(false);
              }}>
                <MessageCircle size={15} />
                <span><strong>{session.title}</strong><small>{dateLabel(session.updatedAt)} · {session.messages.length} 条消息</small></span>
              </button>
              <button
                className="session-delete"
                type="button"
                title="删除该节点"
                aria-label={`删除节点 ${session.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (window.confirm(`确定删除节点“${session.title}”？该节点的对话与记忆将一并清除。`)) {
                    deleteSession(session);
                  }
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-bottom">
          <button className="quiet-button" type="button" onClick={() => setShowSettings(true)}><Settings2 size={16} />设置与导入</button>
          <div className="storage-note"><ShieldCheck size={14} /><span>{serverOnline === null ? "连接检测中…" : serverOnline ? "服务已连接 · 数据自动同步" : "服务未连接 · 仅本机存储"}</span></div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <IconButton label="打开书库" onClick={() => setShowMobileMenu(true)}><Menu size={19} /></IconButton>
          <div className="topbar-title">
            <BookCover book={activeBook} />
            <div><span className="eyebrow">{sessionPlayerLabel(activeSession)} · 严格原作线</span><h1>{activeBook.meta.title}</h1></div>
            <span className="canon-badge"><BookMarked size={13} />{activeBook.chapters?.length || 0} 章原文</span>
          </div>
          <div className="topbar-actions">
            <span className={`connection-state ${activeProvider.apiKey && activeProvider.baseUrl ? "is-ready" : ""}`}>
              <span className="status-dot" />{activeProvider.apiKey && activeProvider.baseUrl ? activeProvider.model || "已配置" : "未配置接口"}
            </span>
            <IconButton label="打开设置" onClick={() => setShowSettings(true)}><Settings2 size={18} /></IconButton>
            <IconButton label="打开世界面板" onClick={() => setShowMobileInspector(true)}><PanelRight size={18} /></IconButton>
          </div>
        </header>

        <section className="story-strip">
          <button className="chapter-block" type="button" onClick={() => setShowSessionSetup(true)}>
            <Clock3 size={16} /><span>{activeSession.scene.chapter}</span><ChevronDown size={14} />
          </button>
          <div className="story-location"><Map size={14} />{activeSession.scene.location}<span className="separator">·</span>{activeSession.scene.time}</div>
          <div className="story-actions">
            <IconButton label="撤回上一轮" onClick={undoTurn} disabled={sending}><RotateCcw size={16} /></IconButton>
            <IconButton label="创建剧情分支" onClick={branchSession} disabled={sending}><GitBranch size={16} /></IconButton>
            <IconButton label="重新生成" onClick={regenerate} disabled={sending}><RefreshCw size={16} /></IconButton>
          </div>
        </section>

        <section className="chat-scroll">
          <div className="scene-intro"><span className="scene-line" /><span>{activeSession.scene.atmosphere || "场景正在展开"}</span><span className="scene-line" /></div>
          {activeSession.messages.length === 0 && (
            <EntryStage book={activeBook} session={activeSession} chapter={currentChapter} onAdjust={() => setShowSessionSetup(true)} />
          )}
          {activeSession.messages.filter((message) => message.role !== "assistant" || message.content).map((message) => (
            <ChatBubble key={message.id} message={message} narrator={worldNarrator} player={sessionPlayerLabel(activeSession)} />
          ))}
          {sending && streamingText && (
            <ChatBubble message={{ id: "streaming", role: "assistant", speaker: worldNarrator, content: streamingText, createdAt: Date.now() }} narrator={worldNarrator} player={sessionPlayerLabel(activeSession)} isStreaming />
          )}
          <div ref={bottomRef} />
        </section>

        <footer className="composer-wrap">
          <div className="composer-meta">
            <span><Feather size={14} />{activeSession.entryPoint?.styleMode === "source" ? "原文叙事特征" : "自定义文风"}</span>
            <button
              className={`adult-toggle ${settings.adultContent && playerCanUseAdultContent ? "is-on" : ""}`}
              type="button"
              onClick={() => playerCanUseAdultContent && updateSettings({ adultContent: !settings.adultContent })}
              disabled={!playerCanUseAdultContent}
              title={playerCanUseAdultContent ? "切换成人内容" : "当前代入角色未明确成年"}
            >
              <span className="toggle-dot" />成人内容 {settings.adultContent && playerCanUseAdultContent ? "已开" : "已关"}
            </button>
          </div>
          <div className="composer">
            {inspirationOptions.length > 0 && (
              <div className="inspiration-panel">
                <div className="inspiration-head"><span><Lightbulb size={14} />AI 灵感</span><small>基于当前章节与场景</small></div>
                <div className="inspiration-options">
                  {inspirationOptions.map((option) => (
                    <button type="button" key={option} onClick={() => setDraft(option)}>
                      <span>{option}</span><ArrowRight size={14} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button className="inspiration-trigger" type="button" onClick={() => void requestInspiration()} disabled={sending || inspirationLoading} aria-label="获取 AI 灵感">
              <Lightbulb size={14} />{inspirationLoading ? "生成中" : "AI 灵感"}
            </button>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder={`以${sessionPlayerLabel(activeSession)}的身份行动…`}
              disabled={sending}
            />
            {sending ? (
              <button className="send-button stop-button" type="button" onClick={() => abortRef.current?.abort()} aria-label="停止生成"><Square size={16} /></button>
            ) : (
              <button className="send-button" type="button" onClick={() => void sendMessage()} disabled={!draft.trim()} aria-label="发送"><Send size={18} /></button>
            )}
          </div>
          <div className="composer-hint"><span>Enter 发送 · Shift + Enter 换行</span><span>{activeProvider.model || "尚未选择模型"}</span></div>
        </footer>
      </main>

      <aside className={`inspector ${showMobileInspector ? "mobile-open" : ""}`}>
        <div className="inspector-header">
          <div><span className="eyebrow">当前世界</span><strong>{activeBook.meta.title}</strong></div>
          <IconButton label="关闭世界面板" onClick={() => setShowMobileInspector(false)}><X size={17} /></IconButton>
        </div>
        <div className="inspector-tabs">
          <InspectorTab icon={<Map size={15} />} label="场景" active={settings.rightPanel === "scene"} onClick={() => updateSettings({ rightPanel: "scene" })} />
          <InspectorTab icon={<Users size={15} />} label="关系" active={settings.rightPanel === "relations"} onClick={() => updateSettings({ rightPanel: "relations" })} />
          <InspectorTab icon={<Brain size={15} />} label="记忆" active={settings.rightPanel === "memory"} onClick={() => updateSettings({ rightPanel: "memory" })} />
          <InspectorTab icon={<BookOpen size={15} />} label="世界书" active={settings.rightPanel === "worldbook"} onClick={() => updateSettings({ rightPanel: "worldbook" })} />
        </div>
        <InspectorContent
          panel={settings.rightPanel}
          book={activeBook}
          session={activeSession}
          memories={bookMemories}
          pendingMemories={pendingMemories}
          confirmedMemories={confirmedMemories}
          onMemoryUpdate={updateMemory}
          onExportBook={exportBook}
          onAdjustEntry={() => setShowSessionSetup(true)}
        />
      </aside>

      <div
        className={`drawer-scrim ${showMobileMenu || showMobileInspector ? "is-visible" : ""}`}
        onClick={() => {
          setShowMobileMenu(false);
          setShowMobileInspector(false);
        }}
        aria-hidden="true"
      />

      <div className="toast-stack">
        {toasts.map((toast) => (
          <div className={`toast toast-${toast.tone}`} key={toast.id}>
            {toast.tone === "error" ? <AlertCircle size={16} /> : <Check size={16} />}{toast.message}
          </div>
        ))}
      </div>

      {showSessionSetup && (
        <SessionSetupModal book={activeBook} currentSession={activeSession} onClose={() => setShowSessionSetup(false)} onStart={createSession} />
      )}
      {showSettings && (
        <SettingsModal
          providers={providers}
          provider={activeProvider}
          settings={settings}
          configText={configText}
          importBusy={importBusy}
          bookImportRef={bookImportRef}
          configImportRef={configImportRef}
          onClose={() => setShowSettings(false)}
          onProviderChange={saveProvider}
          onSelectProvider={(providerId) => updateSettings({ activeProviderId: providerId })}
          onSettingsChange={updateSettings}
          onConfigText={setConfigText}
          onImportConfig={importConfig}
          onImportConfigFile={importConfigFile}
          onExportConfig={exportConfig}
          onImportBooks={importBookFiles}
        />
      )}
    </div>
  );
}

function EntryStage({ book, session, chapter, onAdjust }: { book: Book; session: Session; chapter?: ChapterProfile; onAdjust: () => void }) {
  const activeNames = session.scene.activeCharacters
    .map((characterId) => book.characters.find((character) => character.id === characterId)?.name)
    .filter(Boolean)
    .slice(0, 6);
  return (
    <div className="entry-stage">
      <div className="entry-stage-cover"><BookCover book={book} size="large" /></div>
      <div className="entry-stage-copy">
        <span className="eyebrow">CANON ENTRY</span>
        <h2>{session.scene.chapter}</h2>
        <p>{compactText(chapter?.openingExcerpt || session.scene.atmosphere, 260)}</p>
        <div className="entry-facts">
          <span><UserRound size={14} />{sessionPlayerLabel(session)}</span>
          <span><Map size={14} />{session.scene.location}</span>
          <span><Users size={14} />{activeNames.join("、") || "暂无明确人物"}</span>
        </div>
        <button className="outline-button" type="button" onClick={onAdjust}><Compass size={15} />调整穿书起点</button>
      </div>
    </div>
  );
}

function ChatBubble({ message, narrator, player, isStreaming = false }: {
  message: ChatMessage;
  narrator: string;
  player: string;
  isStreaming?: boolean;
}) {
  const assistant = message.role === "assistant";
  const speaker = assistant ? message.speaker || narrator : message.speaker || player;
  const lines = message.content.split("\n");
  return (
    <article className={`chat-message ${assistant ? "from-character" : "from-user"} ${isStreaming ? "is-streaming" : ""}`}>
      <div className="message-avatar">{speaker.slice(0, 1)}</div>
      <div className="message-content">
        <div className="message-label"><strong>{speaker}</strong><span>{timeLabel(message.createdAt)}</span>{assistant && <span className="role-label">世界发展</span>}</div>
        <div className="message-text">{lines.map((line, index) => <span key={`${message.id}-${index}`}>{line}{index < lines.length - 1 && <br />}</span>)}</div>
      </div>
    </article>
  );
}

function InspectorTab({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={`inspector-tab ${active ? "is-active" : ""}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function InspectorContent({ panel, book, session, memories, pendingMemories, confirmedMemories, onMemoryUpdate, onExportBook, onAdjustEntry }: {
  panel: RightPanel;
  book: Book;
  session: Session;
  memories: MemoryRecord[];
  pendingMemories: MemoryRecord[];
  confirmedMemories: MemoryRecord[];
  onMemoryUpdate: (memory: MemoryRecord, status: MemoryRecord["status"]) => void;
  onExportBook: () => void;
  onAdjustEntry: () => void;
}) {
  if (panel === "scene") {
    return (
      <div className="inspector-content">
        <div className="scene-card scene-card-primary">
          <span className="card-kicker">当前场景</span><strong>{session.scene.location}</strong><p>{session.scene.atmosphere}</p>
          <div className="scene-details"><span><Clock3 size={14} />{session.scene.time}</span><span><Map size={14} />{session.scene.weather}</span></div>
        </div>
        <InfoRow label="代入身份" value={`${sessionPlayerLabel(session)} · ${session.entryPoint?.playerRole || "穿书者"}`} />
        <InfoRow label="当前目标" value={session.scene.objective} />
        <InfoRow label="最近发生" value={session.scene.lastEvent} />
        <button className="panel-command" type="button" onClick={onAdjustEntry}><Compass size={15} />从其他章节或角色开始</button>
        <div className="section-label">在场人物</div>
        <div className="mini-character-list">
          {book.characters.filter((character) => session.scene.activeCharacters.includes(character.id)).map((character) => (
            <div className="mini-character" key={character.id}><span className="character-orb">{character.name.slice(0, 1)}</span><span><strong>{character.name}</strong><small>{character.role}</small></span></div>
          ))}
        </div>
      </div>
    );
  }
  if (panel === "relations") {
    return (
      <div className="inspector-content">
        <div className="panel-note"><ShieldCheck size={16} /><span>关系由具体事件与长期互动改变。</span></div>
        {session.relationships.map((relationship) => {
          const character = book.characters.find((item) => item.id === relationship.characterId);
          return (
            <div className="relation-card" key={relationship.characterId}>
              <div className="relation-head"><span className="character-orb">{character?.name.slice(0, 1)}</span><div><strong>{character?.name || relationship.characterId}</strong><small>{character?.role}</small></div></div>
              <div className="meter-row"><span>信任</span><div className="meter"><i style={{ width: `${relationship.trust}%` }} /></div><b>{relationship.trust}</b></div>
              <div className="meter-row"><span>熟悉</span><div className="meter meter-teal"><i style={{ width: `${relationship.familiarity}%` }} /></div><b>{relationship.familiarity}</b></div>
              <p>{relationship.note}</p>
            </div>
          );
        })}
      </div>
    );
  }
  if (panel === "memory") {
    return (
      <div className="inspector-content">
        <div className="panel-note"><Brain size={16} /><span>确认后的内容才会进入长期记忆。</span></div>
        {pendingMemories.length > 0 && <><div className="section-label">待确认 · {pendingMemories.length}</div>{pendingMemories.map((memory) => (
          <div className="memory-card pending" key={memory.id}><span className="memory-type">{memory.kind}</span><p>{memory.content}</p><small>{memory.source}</small><div className="memory-actions"><button type="button" onClick={() => onMemoryUpdate(memory, "confirmed")}><Check size={14} />记住</button><button type="button" onClick={() => onMemoryUpdate(memory, "rejected")}><X size={14} />忽略</button></div></div>
        ))}</>}
        {confirmedMemories.length > 0 && <><div className="section-label">长期记忆 · {confirmedMemories.length}</div>{confirmedMemories.map((memory) => (
          <div className="memory-card" key={memory.id}><span className="memory-type">{memory.kind}</span><p>{memory.content}</p><small>{dateLabel(memory.createdAt)} · 已确认</small></div>
        ))}</>}
        {memories.length === 0 && <div className="empty-panel"><Brain size={20} /><span>还没有记忆记录</span></div>}
      </div>
    );
  }
  const currentChapter = findSessionChapter(book, session);
  return (
    <div className="inspector-content">
      <div className="world-summary"><span className="card-kicker">{book.meta.canonVersion || "tavern-worldbook/v1"}</span><strong>{book.meta.title}</strong><p>{book.meta.summary}</p><button className="outline-button" type="button" onClick={onExportBook}><Download size={15} />导出世界书</button></div>
      <div className="world-stats"><span><b>{book.chapters?.length || 0}</b>章节</span><span><b>{book.characters.length}</b>人物</span><span><b>{book.lorebook.length}</b>条目</span></div>
      {currentChapter && <><div className="section-label">当前原文锚点</div><div className="chapter-anchor"><strong>{chapterLabel(currentChapter)}</strong><p>{compactText(currentChapter.openingExcerpt, 180)}</p><small>{currentChapter.characterIds.length} 名关联人物 · {currentChapter.content.length.toLocaleString("zh-CN")} 字符</small></div></>}
      <div className="section-label">原文叙事特征</div>
      <div className="style-traits">{book.styleGuide?.traits.slice(0, 5).map((trait) => <span key={trait}><Check size={12} />{trait}</span>) || <span>未提供</span>}</div>
      <div className="section-label">本章人物</div>
      {(currentChapter ? book.characters.filter((character) => currentChapter.characterIds.includes(character.id)) : book.characters).slice(0, 14).map((character) => (
        <div className="world-row" key={character.id}><span className="character-orb">{character.name.slice(0, 1)}</span><span><strong>{character.name}</strong><small>{character.traits.slice(0, 3).join(" · ")}</small></span><em>{character.adult ? "成年" : "非成年"}</em></div>
      ))}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="info-row"><span>{label}</span><p>{value || "未设定"}</p></div>;
}

function SessionSetupModal({ book, currentSession, onClose, onStart }: {
  book: Book;
  currentSession: Session;
  onClose: () => void;
  onStart: (entryPoint: SessionEntryPoint, chapter?: ChapterProfile) => void;
}) {
  const chapters = book.chapters || [];
  const currentChapter = findSessionChapter(book, currentSession) || chapters[0];
  const [chapterId, setChapterId] = useState(currentChapter?.id || "");
  const [chapterSearch, setChapterSearch] = useState("");
  const [roleMode, setRoleMode] = useState<SessionEntryPoint["roleMode"]>(currentSession.entryPoint?.roleMode || "traveler");
  const [characterId, setCharacterId] = useState(currentSession.entryPoint?.playerCharacterId || "");
  const [playerName, setPlayerName] = useState(currentSession.entryPoint?.roleMode === "traveler" ? currentSession.entryPoint.playerName : "穿书者");
  const [playerRole, setPlayerRole] = useState(currentSession.entryPoint?.roleMode === "traveler" ? currentSession.entryPoint.playerRole : "身份与来历尚未公开的异世来客");
  const [playerAdult, setPlayerAdult] = useState(currentSession.entryPoint?.roleMode === "traveler" ? currentSession.entryPoint.playerAdult : true);
  const selectedChapter = chapters.find((chapter) => chapter.id === chapterId) || chapters[0];
  const filteredChapters = chapters.filter((chapter) => `${chapter.order} ${chapter.title}`.toLowerCase().includes(chapterSearch.toLowerCase()));
  const chapterCharacters = useMemo(() => {
    if (!selectedChapter) return book.characters;
    const present = book.characters.filter((character) => selectedChapter.characterIds.includes(character.id));
    return present.length ? present : book.characters.filter((character) => chapters.some((chapter) => chapter.order <= selectedChapter.order && chapter.characterIds.includes(character.id)));
  }, [book.characters, chapters, selectedChapter]);
  const selectedCharacter = book.characters.find((character) => character.id === characterId);

  useEffect(() => {
    if (roleMode !== "character") return;
    if (!chapterCharacters.some((character) => character.id === characterId)) setCharacterId(chapterCharacters[0]?.id || "");
  }, [chapterCharacters, characterId, roleMode]);

  const submit = () => {
    const character = roleMode === "character" ? selectedCharacter || chapterCharacters[0] : undefined;
    const entryPoint: SessionEntryPoint = {
      chapterId: selectedChapter?.id,
      chapterOrder: selectedChapter?.order,
      roleMode,
      playerCharacterId: character?.id,
      playerName: character?.name || playerName.trim() || "穿书者",
      playerRole: character?.role || playerRole.trim() || "身份与来历尚未公开的异世来客",
      playerAdult: character?.adult ?? playerAdult,
      canonMode: "strict",
      styleMode: "source",
    };
    onStart(entryPoint, selectedChapter);
  };

  return (
    <div className="modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="entry-modal" role="dialog" aria-modal="true" aria-label="选择穿书起点">
        <header className="modal-header"><div><span className="eyebrow">CANON ENTRY</span><h2>选择穿书起点</h2></div><IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton></header>
        <div className="entry-layout">
          <div className="chapter-picker">
            <div className="picker-heading"><span>章节</span><b>{selectedChapter ? selectedChapter.order : 0}/{Math.max(0, chapters.length - 1)}</b></div>
            <div className="search-box"><Search size={15} /><input value={chapterSearch} onChange={(event) => setChapterSearch(event.target.value)} placeholder="搜索章节" /></div>
            <div className="chapter-list">
              {filteredChapters.map((chapter) => (
                <button className={chapter.id === selectedChapter?.id ? "is-selected" : ""} type="button" key={chapter.id} onClick={() => setChapterId(chapter.id)}>
                  <span>{String(chapter.order).padStart(3, "0")}</span><strong>{chapter.title}</strong><small>{chapter.characterIds.length} 人物</small>
                </button>
              ))}
              {chapters.length === 0 && <div className="empty-picker">此世界书仅提供默认开场</div>}
            </div>
          </div>

          <div className="entry-config">
            <div className="entry-preview">
              <span className="eyebrow">{selectedChapter?.sourceFile || book.meta.canonVersion}</span>
              <h3>{selectedChapter ? chapterLabel(selectedChapter) : book.openingScene?.chapter}</h3>
              <p>{compactText(selectedChapter?.openingExcerpt || book.openingScene?.atmosphere || "", 320)}</p>
              <div className="preview-entities">
                {chapterCharacters.slice(0, 8).map((character) => <span key={character.id}>{character.name}</span>)}
              </div>
            </div>

            <div className="config-section">
              <span className="field-title">代入方式</span>
              <div className="segmented-control">
                <button className={roleMode === "traveler" ? "is-active" : ""} type="button" onClick={() => setRoleMode("traveler")}><UserRound size={16} />原创穿书者</button>
                <button className={roleMode === "character" ? "is-active" : ""} type="button" onClick={() => setRoleMode("character")}><BookMarked size={16} />原作角色</button>
              </div>
            </div>

            {roleMode === "traveler" ? (
              <div className="form-grid entry-form">
                <label className="field"><span>角色名</span><input value={playerName} maxLength={30} onChange={(event) => setPlayerName(event.target.value)} /></label>
                <label className="field"><span>成年状态</span><select value={playerAdult ? "adult" : "minor"} onChange={(event) => setPlayerAdult(event.target.value === "adult")}><option value="adult">已满 18 岁</option><option value="minor">未满或不明确</option></select></label>
                <label className="field span-2"><span>身份</span><textarea value={playerRole} maxLength={240} onChange={(event) => setPlayerRole(event.target.value)} /></label>
              </div>
            ) : (
              <div className="character-picker">
                {chapterCharacters.map((character) => (
                  <button className={character.id === (selectedCharacter?.id || chapterCharacters[0]?.id) ? "is-selected" : ""} type="button" key={character.id} onClick={() => setCharacterId(character.id)}>
                    <span className="character-orb">{character.name.slice(0, 1)}</span>
                    <span><strong>{character.name}</strong><small>{character.role}</small></span>
                    <em>{character.adult ? "成年" : "非成年"}</em>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <footer className="modal-footer"><span><ShieldCheck size={14} />严格章节知识边界</span><div className="inline-actions"><button className="outline-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="button" onClick={submit} disabled={roleMode === "traveler" ? !playerName.trim() : !chapterCharacters.length}>进入本章<ArrowRight size={15} /></button></div></footer>
      </section>
    </div>
  );
}

function SettingsModal({ providers, provider, settings, configText, importBusy, bookImportRef, configImportRef, onClose, onProviderChange, onSelectProvider, onSettingsChange, onConfigText, onImportConfig, onImportConfigFile, onExportConfig, onImportBooks }: {
  providers: ProviderProfile[];
  provider: ProviderProfile;
  settings: AppSettings;
  configText: string;
  importBusy: boolean;
  bookImportRef: React.RefObject<HTMLInputElement | null>;
  configImportRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onProviderChange: (provider: ProviderProfile) => void;
  onSelectProvider: (providerId: string) => void;
  onSettingsChange: (changes: Partial<AppSettings>) => void;
  onConfigText: (value: string) => void;
  onImportConfig: () => void;
  onImportConfigFile: (file: File | undefined) => void;
  onExportConfig: () => void;
  onImportBooks: (files: FileList | null) => void;
}) {
  const [section, setSection] = useState<"provider" | "book" | "preference">("provider");
  const [testState, setTestState] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelState, setModelState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [modelMessage, setModelMessage] = useState("");
  const update = (changes: Partial<ProviderProfile>) => onProviderChange({ ...provider, ...changes });

  useEffect(() => {
    setAvailableModels([]);
    setModelState("idle");
    setModelMessage("");
  }, [provider.baseUrl, provider.apiKey, provider.protocol]);

  const runTest = async () => {
    setTestState("testing");
    try {
      const message = await testProvider(provider);
      setTestState("success");
      setTestMessage(message);
    } catch (error) {
      setTestState("error");
      setTestMessage(error instanceof Error ? error.message : "连接失败");
    }
  };

  const loadModels = async () => {
    setModelState("loading");
    setModelMessage("");
    try {
      const models = await fetchModels(provider);
      setAvailableModels(models);
      setModelState("success");
      setModelMessage(`已获取 ${models.length} 个模型`);
      if (!provider.model && models[0]) update({ model: models[0] });
    } catch (error) {
      setAvailableModels([]);
      setModelState("error");
      setModelMessage(error instanceof Error ? error.message : "获取模型失败");
    }
  };

  return (
    <div className="modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="设置与导入">
        <header className="modal-header"><div><span className="eyebrow">LOCAL WORKSPACE</span><h2>设置与导入</h2></div><IconButton label="关闭设置" onClick={onClose}><X size={18} /></IconButton></header>
        <div className="settings-layout">
          <nav className="settings-nav">
            <button className={section === "provider" ? "is-active" : ""} type="button" onClick={() => setSection("provider")}><KeyRound size={16} />接口配置</button>
            <button className={section === "book" ? "is-active" : ""} type="button" onClick={() => setSection("book")}><Upload size={16} />导入世界书</button>
            <button className={section === "preference" ? "is-active" : ""} type="button" onClick={() => setSection("preference")}><Settings2 size={16} />叙事偏好</button>
          </nav>
          <div className="settings-body">
            {section === "provider" && <>
              <div className="settings-title"><div><span className="eyebrow">API BRIDGE</span><h3>中转站连接</h3></div><span className="local-badge"><ShieldCheck size={13} />仅本机</span></div>
              <div className="provider-switch"><label>当前配置<select value={provider.id} onChange={(event) => onSelectProvider(event.target.value)}>{providers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><button className="outline-button" type="button" onClick={onExportConfig}><Download size={15} />导出</button></div>
              <div className="form-grid">
                <label className="field span-2"><span>配置名称</span><input value={provider.name} onChange={(event) => update({ name: event.target.value })} /></label>
                <label className="field"><span>协议</span><select value={provider.protocol} onChange={(event) => update({ protocol: event.target.value as ProviderProfile["protocol"] })}><option value="openai">OpenAI-compatible</option><option value="anthropic">Anthropic-compatible</option><option value="gemini">Gemini-compatible</option></select></label>
                <label className="field"><span>模型</span><input value={provider.model} onChange={(event) => update({ model: event.target.value })} placeholder="例如 gemini-2.5-flash" /></label>
                <label className="field span-2"><span>Base URL</span><input value={provider.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} placeholder="https://你的中转站" /></label>
                <label className="field span-2"><span>API Key</span><input type="password" value={provider.apiKey} onChange={(event) => update({ apiKey: event.target.value })} /></label>
                <label className="field"><span>Temperature <b>{provider.temperature.toFixed(2)}</b></span><input type="range" min="0" max="1.5" step="0.01" value={provider.temperature} onChange={(event) => update({ temperature: Number(event.target.value) })} /></label>
                <label className="field"><span>Max tokens</span><input type="number" min="200" max="16000" value={provider.maxTokens} onChange={(event) => update({ maxTokens: Number(event.target.value) })} /></label>
              </div>
              <div className="settings-actions"><label className="check-line"><input type="checkbox" checked={provider.persistKey} onChange={(event) => update({ persistKey: event.target.checked })} /><span>在本机保存 API Key</span></label><button className="primary-button" type="button" onClick={() => void runTest()} disabled={testState === "testing"}><TestTube2 size={15} />{testState === "testing" ? "测试中…" : "测试连接"}</button></div>
              {testMessage && <div className={`test-result ${testState}`}><CircleHelp size={15} />{testMessage}</div>}
              <div className="model-discovery"><div className="model-discovery-head"><div><strong>接口模型</strong><small>从当前地址读取模型列表</small></div><button className="outline-button" type="button" onClick={() => void loadModels()} disabled={modelState === "loading"}><Search size={15} />{modelState === "loading" ? "获取中…" : "获取模型"}</button></div>{availableModels.length > 0 && <label className="field"><span>选择模型</span><select value={availableModels.includes(provider.model) ? provider.model : ""} onChange={(event) => update({ model: event.target.value })}><option value="" disabled>请选择模型</option>{availableModels.map((model) => <option value={model} key={model}>{model}</option>)}</select></label>}{modelMessage && <div className={`test-result ${modelState === "success" ? "success" : "error"}`}><CircleHelp size={15} />{modelMessage}</div>}</div>
              <div className="import-config"><div className="section-label">导入接口 JSON</div><textarea value={configText} onChange={(event) => onConfigText(event.target.value)} placeholder={'{ "baseUrl": "https://…/v1", "apiKey": "…", "model": "…" }'} /><div className="inline-actions"><button className="outline-button" type="button" onClick={() => configImportRef.current?.click()}><FileJson size={15} />选择 JSON</button><button className="outline-button" type="button" onClick={onImportConfig}><Upload size={15} />读取配置</button></div><input ref={configImportRef} className="hidden-input" type="file" accept=".json,application/json" onChange={(event) => void onImportConfigFile(event.target.files?.[0])} /></div>
            </>}

            {section === "book" && <>
              <div className="settings-title"><div><span className="eyebrow">WORLD PACK</span><h3>导入穿书世界</h3></div><span className="format-badge">tavern-worldbook/v1</span></div>
              <div className="drop-zone" onClick={() => bookImportRef.current?.click()}><Upload size={24} /><strong>{importBusy ? "正在解析…" : "选择 worldbook.json"}</strong><span>支持逐章原文、人物、地点、时间线和文风画像</span><button className="primary-button" type="button" disabled={importBusy}><Upload size={15} />选择文件</button></div>
              <input ref={bookImportRef} className="hidden-input" type="file" multiple accept=".json,.txt,.md,.markdown,application/json,text/plain,text/markdown" onChange={(event) => void onImportBooks(event.target.files)} />
              <div className="format-guide"><div><Check size={15} /><span>chapters 保存章节顺序与原文锚点</span></div><div><Check size={15} /><span>styleGuide 保存叙事特征</span></div><div><Check size={15} /><span>TXT/Markdown 可作为旧格式参考文本</span></div></div>
              <div className="code-preview"><span>增强结构</span><pre>{`{\n  "format": "tavern-worldbook/v1",\n  "chapters": [\n    { "order": 0, "title": "序章", "content": "…" }\n  ],\n  "styleGuide": { "traits": [ ... ] }\n}`}</pre></div>
            </>}

            {section === "preference" && <>
              <div className="settings-title"><div><span className="eyebrow">NARRATIVE</span><h3>叙事偏好</h3></div></div>
              <label className="preference-row narrative-preset-row"><span><strong>全局叙事预设</strong><small>“原作优先”最贴近章节原文</small></span><select value={settings.narrativePreset} onChange={(event) => onSettingsChange({ narrativePreset: event.target.value as AppSettings["narrativePreset"] })}>{Object.entries(narrativePresetLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <div className="style-setting"><div className="style-setting-head"><span><strong>文风补充</strong><small>默认已经启用世界书中的原文叙事特征</small></span><button className="outline-button" type="button" onClick={() => onSettingsChange({ customStyle: "" })} disabled={!settings.customStyle}>清空</button></div><textarea className="style-textarea" value={settings.customStyle} maxLength={1200} onChange={(event) => onSettingsChange({ customStyle: event.target.value })} placeholder="例如：减少重复环境铺陈，加强人物对白中的含蓄与试探。" /><div className="style-counter">{settings.customStyle.length}/1200</div></div>
              <label className="preference-row"><span><strong>成人内容</strong><small>只对明确成年且同意的角色生效</small></span><input className="switch-input" type="checkbox" checked={settings.adultContent} onChange={(event) => onSettingsChange({ adultContent: event.target.checked })} /></label>
              <label className="preference-row"><span><strong>紧凑对话</strong><small>缩小消息间距</small></span><input className="switch-input" type="checkbox" checked={settings.compactMode} onChange={(event) => onSettingsChange({ compactMode: event.target.checked })} /></label>
              <div className="privacy-box"><ShieldCheck size={18} /><div><strong>本地存储</strong><p>书籍、章节、对话、记忆和接口配置保存在当前浏览器的 IndexedDB。</p></div></div>
            </>}
          </div>
        </div>
        <footer className="modal-footer"><span><ShieldCheck size={14} />API Bridge 监听 127.0.0.1</span><button className="primary-button" type="button" onClick={onClose}><Save size={15} />完成</button></footer>
      </section>
    </div>
  );
}
