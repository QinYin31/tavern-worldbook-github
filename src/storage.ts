import type { AppSettings, Book, MemoryRecord, ProviderProfile, Session, SessionEntryPoint, WorldbookPack } from "./types";
import { createSceneFromChapter } from "./chapter";
import { defaultProvider } from "./data";

const DB_NAME = "tavern-worldbook-db";
const DB_VERSION = 1;
const stores = ["books", "sessions", "memories", "providers", "settings"] as const;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const store of stores) {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function put<T extends { id: string }>(store: string, value: T) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(store, "readwrite");
    transaction.objectStore(store).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function remove(store: string, key: string) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(store, "readwrite");
    transaction.objectStore(store).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function removeMany(store: string, keys: string[]) {
  if (!keys.length) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(store, "readwrite");
    const objectStore = transaction.objectStore(store);
    for (const key of keys) objectStore.delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function getAll<T>(store: string): Promise<T[]> {
  const database = await openDatabase();
  const result = await new Promise<T[]>((resolve, reject) => {
    const request = database.transaction(store, "readonly").objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return result;
}

async function getOne<T>(store: string, key: string): Promise<T | undefined> {
  const database = await openDatabase();
  const result = await new Promise<T | undefined>((resolve, reject) => {
    const request = database.transaction(store, "readonly").objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return result;
}

const settingsId = "app_settings";

const packagedBookId = "book_demo_worldbook";
const legacyPackagedBookId = "book_legacy_worldbook";
const packagedWorldbookUrl = "/worldbooks/demo-worldbook.json";
const syncStateUrl = "/api/sync/state";
const syncUpsertUrl = "/api/sync/upsert";
const syncDeleteUrl = "/api/sync/delete";

export const isPackagedBookId = (id: string) => id === packagedBookId || id === legacyPackagedBookId;

interface SyncState {
  books: Book[];
  sessions: Session[];
  memories: MemoryRecord[];
  providers: ProviderProfile[];
  settings: (AppSettings & { id: string; updatedAt?: number }) | null;
}

async function syncPull(): Promise<SyncState | null> {
  try {
    const response = await fetch(syncStateUrl, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    return (payload && payload.state) || null;
  } catch {
    return null;
  }
}

function notifySyncError(message: string) {
  try {
    window.dispatchEvent(new CustomEvent("app-sync-error", { detail: message }));
  } catch {
    // 非浏览器环境（测试/SSR）忽略
  }
}

function syncPush(store: string, records: unknown[]) {
  void fetch(syncUpsertUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ store, records }),
  }).then((response) => {
    if (!response.ok) notifySyncError(`同步失败（${store}：HTTP ${response.status}）`);
  }).catch(() => notifySyncError("同步失败：无法连接服务端，改动仅保存在本机"));
}

function syncRemove(store: string, ids: string[]) {
  void fetch(syncDeleteUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ store, ids }),
  }).then((response) => {
    if (!response.ok) notifySyncError(`删除同步失败（${store}：HTTP ${response.status}）`);
  }).catch(() => notifySyncError("删除同步失败：无法连接服务端"));
}

// 记录级合并：同 id 取 updatedAt 较新者；无 updatedAt 时后写入者优先（本地优先）。
export function mergeRecords<T extends { id: string; updatedAt?: number }>(local: T[], remote: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of [...(remote || []), ...(local || [])]) {
    const prev = map.get(item.id);
    if (!prev || (item.updatedAt ?? 0) >= (prev.updatedAt ?? 0)) map.set(item.id, item);
  }
  return [...map.values()];
}

export function resolveActiveProviderId(providers: Array<{ id: string; updatedAt?: number }>, requestedId?: string): string {
  if (requestedId && providers.some((provider) => provider.id === requestedId)) return requestedId;
  return [...providers]
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))[0]?.id || "";
}


async function loadPackagedWorldbook(): Promise<WorldbookPack> {
  const response = await fetch(packagedWorldbookUrl, { cache: "no-cache" });
  if (!response.ok) throw new Error(`无法读取内置世界书（${response.status}）`);
  return response.json() as Promise<WorldbookPack>;
}

function packagedBook(preloadedWorldbook: WorldbookPack): Book {
  const now = Date.now();
  return { ...preloadedWorldbook, id: packagedBookId, createdAt: now, updatedAt: now } as Book;
}

function initialSession(book: Book): Session {
  const chapter = book.chapters?.[0];
  const entryPoint: SessionEntryPoint = {
    chapterId: chapter?.id,
    chapterOrder: chapter?.order,
    roleMode: "traveler",
    playerName: "穿书者",
    playerRole: "身份与来历尚未公开的异世来客",
    playerAdult: true,
    canonMode: "strict",
    styleMode: "source",
  };
  const scene = chapter ? createSceneFromChapter(book, chapter, entryPoint) : book.openingScene!;
  const relationships = book.characters.map((character) => ({
    characterId: character.id,
    trust: 0,
    familiarity: 0,
    tension: 0,
    note: "尚未建立关系。",
  }));
  return {
    id: `${packagedBookId}_session`,
    bookId: book.id,
    title: `${scene.chapter} · 初始会话`,
    chapter: scene.chapter,
    messages: [],
    scene,
    relationships,
    entryPoint,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function loadAppData() {
  let [books, sessions, memories, providers, settings] = await Promise.all([
    getAll<Book>("books"),
    getAll<Session>("sessions"),
    getAll<MemoryRecord>("memories"),
    getAll<ProviderProfile>("providers"),
    getOne<AppSettings>("settings", settingsId),
  ]);
  const preloadedWorldbook = await loadPackagedWorldbook();
  const remote = await syncPull();
  if (remote) {
    let remoteSettingsIsNewer = false;
    // 服务端数据合并到本地：内置书始终以本地打包版本为准（由 canonVersion 驱动更新），其余按记录合并。
    const remoteBooks = (remote.books || []).filter((book) => !isPackagedBookId(book.id));
    const mergedBooks = mergeRecords(books.filter((book) => !isPackagedBookId(book.id)), remoteBooks);
    const mergedSessions = mergeRecords(sessions, remote.sessions || []);
    const memoryMap = new Map<string, MemoryRecord>();
    for (const item of [...(remote.memories || []), ...memories]) memoryMap.set(item.id, item);
    const mergedMemories = [...memoryMap.values()];
    const mergedProviders = mergeRecords(providers, remote.providers || []);
    if (mergedProviders.length) providers = mergedProviders;
    if (remote.settings) {
      const localSettings = settings;
      if (!localSettings || (remote.settings.updatedAt ?? 0) > ((localSettings as { updatedAt?: number }).updatedAt ?? 0)) {
        settings = remote.settings;
        remoteSettingsIsNewer = true;
      }
    }
    if (mergedBooks.length || mergedSessions.length || mergedMemories.length || remote.providers?.length || remote.settings) {
      await Promise.all([
        ...mergedBooks.map((book) => put("books", book)),
        ...mergedSessions.map((session) => put("sessions", session)),
        ...mergedMemories.map((memory) => put("memories", memory)),
        ...(remote.providers?.length ? mergedProviders.map((provider) => put("providers", provider)) : []),
        ...(remoteSettingsIsNewer ? [put("settings", remote.settings!)] : []),
      ]);
      books = [...mergedBooks, ...books.filter((book) => isPackagedBookId(book.id))];
      sessions = mergedSessions;
      memories = mergedMemories;
    }
  }


  // 首次打开或已有旧数据时，自动补入项目内置的用户 TXT 世界书，不覆盖现有会话。
  const storedPackagedBook = books.find((book) => book.id === packagedBookId);
  if (!storedPackagedBook) {
    const book = packagedBook(preloadedWorldbook);
    const session = initialSession(book);
    await put("books", book);
    await put("sessions", session);
    books = [...books, book];
    sessions = [...sessions, session];
  } else if (storedPackagedBook.meta.canonVersion !== preloadedWorldbook.meta.canonVersion) {
    const book = { ...packagedBook(preloadedWorldbook), id: storedPackagedBook.id, createdAt: storedPackagedBook.createdAt };
    await put("books", book);
    books = books.map((item) => item.id === book.id ? book : item);
    const oldSession = sessions.find((session) => session.bookId === book.id);
        if (oldSession) {
      // 内置世界书更新时，将穿书人物列表与新角色对齐：
      // 保留已有角色的关系进度，补充新增角色，移除已不存在的角色。
      const existing = new Map(oldSession.relationships.map((r) => [r.characterId, r]));
      const relationships = book.characters.map((character) => {
        const prev = existing.get(character.id);
        return prev ?? { characterId: character.id, trust: 0, familiarity: 0, tension: 0, note: "尚未建立关系。" };
      });
      const session = {
        ...oldSession,
        relationships,
        ...(oldSession.messages.length === 0 && book.chapters?.[0] && oldSession.entryPoint ? { scene: createSceneFromChapter(book, book.chapters[0], oldSession.entryPoint) } : {}),
        updatedAt: Date.now(),
      };
      await put("sessions", session);
      sessions = sessions.map((item) => item.id === session.id ? session : item);
    }
  }

  if (!providers.length) {
    await put("providers", defaultProvider);
    providers = [defaultProvider];
  } else {
    const migratedProviders = providers.map((provider) => {
      if (provider.id !== defaultProvider.id) return provider;
      if (provider.model === defaultProvider.model && provider.protocol === defaultProvider.protocol && provider.baseUrl) return provider;
      const next = { ...provider, name: defaultProvider.name, model: defaultProvider.model, protocol: defaultProvider.protocol, baseUrl: provider.baseUrl || defaultProvider.baseUrl };
      void put("providers", next);
      return next;
    });
    providers = migratedProviders;
  }
  const defaultBook = books.find((book) => book.id === packagedBookId) || books[0];
  const requestedBookId = settings?.activeBookId === legacyPackagedBookId ? packagedBookId : settings?.activeBookId;
  const activeBookId = books.some((book) => book.id === requestedBookId) ? requestedBookId! : defaultBook.id;
  const activeSessionId = sessions.some((session) => session.id === settings?.activeSessionId && session.bookId === activeBookId)
    ? settings!.activeSessionId
    : sessions.find((session) => session.bookId === activeBookId)?.id || "";
  const narrativePreset = settings?.activeBookId === legacyPackagedBookId ? "none" : settings?.narrativePreset || "none";
  const activeProviderId = resolveActiveProviderId(providers, settings?.activeProviderId);
  const normalizedSettings: AppSettings = {
    activeProviderId,
    rightPanel: "scene",
    adultContent: false,
    compactMode: false,
    customStyle: "",
    ...(settings || {}),
    activeBookId,
    activeSessionId,
    narrativePreset,
  };
  if (!settings
    || settings.activeProviderId !== activeProviderId
    || settings.activeBookId !== activeBookId
    || settings.activeSessionId !== activeSessionId) {
    await put("settings", { id: settingsId, ...normalizedSettings });
  }
  // 双向同步：将合并后的本地数据回推服务端（首次接入时上传已有配置/对话/自定义书）。
  const syncableBooks = books.filter((book) => !isPackagedBookId(book.id));
  if (syncableBooks.length) syncPush("books", syncableBooks);
  if (sessions.length) syncPush("sessions", sessions);
  if (memories.length) syncPush("memories", memories);
  if (providers.length) syncPush("providers", providers);
  if (normalizedSettings) syncPush("settings", [{ id: settingsId, ...normalizedSettings, updatedAt: Date.now() }]);

  return {
    books,
    sessions,
    memories,
    providers,
    settings: normalizedSettings,
  };
}

function localFail(store: string, error: unknown) {
  notifySyncError(`本地保存失败（${store}）：${error instanceof Error ? error.message : String(error)}`);
}

export const db = {
  putBook: (book: Book) => {
    void put("books", book).catch((error) => localFail("books", error));
    if (!isPackagedBookId(book.id)) syncPush("books", [book]);
  },
  putSession: (session: Session) => {
    void put("sessions", session).catch((error) => localFail("sessions", error));
    syncPush("sessions", [session]);
  },
  putMemory: (memory: MemoryRecord) => {
    void put("memories", memory).catch((error) => localFail("memories", error));
    syncPush("memories", [memory]);
  },
  putProvider: (provider: ProviderProfile) => {
    void put("providers", provider).catch((error) => localFail("providers", error));
    syncPush("providers", [provider]);
  },
  putSettings: (settings: AppSettings) => {
    const stamped = { id: settingsId, ...settings, updatedAt: Date.now() };
    void put("settings", stamped).catch((error) => localFail("settings", error));
    syncPush("settings", [stamped]);
  },
  deleteMemory: (memoryId: string) => {
    void remove("memories", memoryId).catch((error) => localFail("memories", error));
    syncRemove("memories", [memoryId]);
  },
  deleteSession: (sessionId: string) => {
    void remove("sessions", sessionId).catch((error) => localFail("sessions", error));
    syncRemove("sessions", [sessionId]);
  },
  deleteMemoriesBySession: async (sessionId: string) => {
    const memories = await getAll<MemoryRecord>("memories");
    const targets = memories.filter((memory) => memory.sessionId === sessionId).map((memory) => memory.id);
    await removeMany("memories", targets).catch((error) => localFail("memories", error));
    syncRemove("memories", targets);
  },
};
