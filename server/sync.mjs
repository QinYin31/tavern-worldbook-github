// 跨设备同步存储：以服务端 JSON 文件为主副本，支持按记录合并。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, "data");
const DATA_FILE = join(DATA_DIR, "sync.json");
const STORES = ["books", "sessions", "memories", "providers", "settings"];

function emptyState() {
  return { books: [], sessions: [], memories: [], providers: [], settings: null };
}

function loadState() {
  try {
    if (!existsSync(DATA_FILE)) return emptyState();
    const raw = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    const state = emptyState();
    for (const store of STORES) {
      if (store === "settings") state.settings = raw.settings ?? null;
      else state[store] = Array.isArray(raw[store]) ? raw[store] : [];
    }
    return state;
  } catch {
    return emptyState();
  }
}

function saveState(state) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
}

// 记录级合并：同 id 取 updatedAt 较新者；无 updatedAt 时后写入者优先。
function mergeRecords(local, remote) {
  const map = new Map();
  for (const item of [...(remote || []), ...(local || [])]) {
    const prev = map.get(item.id);
    if (!prev || (item.updatedAt ?? 0) >= (prev.updatedAt ?? 0)) map.set(item.id, item);
  }
  return [...map.values()];
}

export function handleSyncRequest(req, res, pathname, body) {
  if (pathname === "/api/sync/state" && req.method === "GET") {
    const state = loadState();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true, state }));
    return true;
  }

  if (pathname === "/api/sync/upsert" && req.method === "POST") {
    const store = String(body?.store || "");
    const records = Array.isArray(body?.records) ? body.records : [];
    if (!STORES.includes(store) || !records.length) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "store 或 records 无效" }));
      return true;
    }
    const state = loadState();
    if (store === "settings") {
      const incoming = records[0] ?? null;
      const existing = state.settings;
      // settings 无记录级合并时按 updatedAt 取新，避免旧端覆盖新端。
      if (!existing || !incoming || (incoming.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
        state.settings = incoming;
      }
    } else {
      state[store] = mergeRecords(state[store], records);
    }
    saveState(state);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  if (pathname === "/api/sync/delete" && req.method === "POST") {
    const store = String(body?.store || "");
    const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
    if (!STORES.includes(store) || !ids.length) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "store 或 ids 无效" }));
      return true;
    }
    const state = loadState();
    const keep = new Set(ids);
    if (store === "settings") {
      state.settings = null;
    } else {
      state[store] = (state[store] || []).filter((item) => !keep.has(String(item?.id)));
    }
    saveState(state);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  return false;
}