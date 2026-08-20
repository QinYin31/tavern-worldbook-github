import { URL } from "node:url";
import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");

const MAX_BODY_SIZE = 8 * 1024 * 1024;

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function fetchErrorMessage(error) {
  if (!(error instanceof Error)) return "无法连接中转站";
  const cause = error.cause instanceof Error ? error.cause : null;
  const code = cause && "code" in cause ? String(cause.code) : "";
  const detail = cause?.message || error.message;
  return `无法连接中转站${code ? `（${code}）` : ""}：${detail}`;
}

async function fetchUpstream(url, init) {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw new Error(fetchErrorMessage(error), { cause: error });
  }
}

export function summarizeUpstreamError(detail, status, endpoint = "") {
  const raw = String(detail || "").trim();
  if (!raw) return `上游请求失败（${status}）`;
  if (/platform\.deepseek\.com|request blocked|<title>error/i.test(raw)) {
    return "这个地址返回的是网页而不是 API。DeepSeek 官方 API 请使用 https://api.deepseek.com；platform.deepseek.com 是网页平台地址。";
  }
  if (/^<!doctype\s+html|^<html[\s>]/i.test(raw)) {
    return "上游返回了网页 HTML，而不是 API 响应。请检查 Base URL 是否为 API 地址。";
  }
  try {
    const payload = JSON.parse(raw);
    const message = payload?.error?.message || payload?.error || payload?.message || payload?.detail;
    if (message) return `上游请求失败（${status}）：${typeof message === "string" ? message : JSON.stringify(message)}`;
  } catch {
    // 非 JSON 响应继续按纯文本处理。
  }
  const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return `上游请求失败（${status}）${endpoint ? `：${endpoint}` : ""}：${text.slice(0, 600)}`;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export function normalizeEndpoint(baseUrl, protocol, model = "", stream = true) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("Base URL 不能为空");
  if (protocol === "gemini") {
    if (base.endsWith(":generateContent") || base.endsWith(":streamGenerateContent")) return base;
    if (!model) throw new Error("Gemini 模型不能为空");
    const versionedBase = base.endsWith("/v1beta") ? base : `${base}/v1beta`;
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${versionedBase}/models/${encodeURIComponent(model)}:${action}`;
  }
  if (base.endsWith("/chat/completions") || base.endsWith("/messages")) return base;
  const suffix = protocol === "anthropic" ? "/messages" : "/chat/completions";
  if (base.endsWith("/v1")) return `${base}${suffix}`;
  return `${base}/v1${suffix}`;
}

export function normalizeModelsEndpoint(baseUrl, protocol, openAiFallback = false) {
  let base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("Base URL 不能为空");
  base = base
    .replace(/\/v1\/(?:chat\/completions|messages|models)$/i, "/v1")
    .replace(/\/v1beta\/models(?:\/[^:]+(?::(?:stream)?generateContent)?)?$/i, "/v1beta");
  if (protocol === "gemini" && !openAiFallback) {
    if (base.endsWith("/v1beta")) return `${base}/models`;
    return `${base}/v1beta/models`;
  }
  if (base.endsWith("/v1")) return `${base}/models`;
  if (base.endsWith("/v1beta")) base = base.slice(0, -"/v1beta".length);
  return `${base}/v1/models`;
}

function getHeaders(provider) {
  const key = String(provider.apiKey || "");
  const common = {
    "Content-Type": "application/json",
    Accept: "text/event-stream, application/json",
  };
  if (provider.protocol === "gemini") return { ...common, "x-goog-api-key": key, Authorization: `Bearer ${key}` };
  if (provider.protocol === "anthropic") {
    return {
      ...common,
      "x-api-key": key,
      Authorization: `Bearer ${key}`,
      "anthropic-version": "2023-06-01",
    };
  }
  return { ...common, Authorization: `Bearer ${key}` };
}

export function buildRequestBody(provider, messages, stream = true) {
  if (provider.protocol === "gemini") {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const contents = [];
    for (const message of messages.filter((item) => item.role !== "system")) {
      const role = message.role === "assistant" ? "model" : "user";
      const previous = contents.at(-1);
      if (previous?.role === role) previous.parts[0].text += `\n\n${message.content}`;
      else contents.push({ role, parts: [{ text: message.content }] });
    }
    return {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: {
        temperature: Number(provider.temperature ?? 0.82),
        maxOutputTokens: Number(provider.maxTokens || 1400),
      },
    };
  }
  if (provider.protocol === "anthropic") {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const conversation = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      }));
    return {
      model: provider.model,
      system,
      messages: conversation,
      max_tokens: Number(provider.maxTokens || 1400),
      temperature: Number(provider.temperature ?? 0.82),
      stream,
    };
  }
  return {
    model: provider.model,
    messages,
    max_tokens: Number(provider.maxTokens || 1400),
    temperature: Number(provider.temperature ?? 0.82),
    stream,
  };
}

function extractDelta(protocol, payload) {
  if (!payload || typeof payload !== "object") return "";
  if (protocol === "gemini") {
    const candidates = Array.isArray(payload) ? payload.flatMap((item) => item?.candidates || []) : payload.candidates || [];
    return candidates.flatMap((candidate) => candidate?.content?.parts || []).map((part) => part?.text || "").join("");
  }
  if (protocol === "anthropic") {
    if (payload.type === "content_block_delta") return payload.delta?.text || "";
    if (payload.type === "message_delta") return "";
    return Array.isArray(payload.content)
      ? payload.content.map((part) => part?.text || "").join("")
      : "";
  }
  return payload.choices?.[0]?.delta?.content || payload.choices?.[0]?.message?.content || "";
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function pipeUpstream(upstream, protocol, res) {
  const contentType = upstream.headers.get("content-type") || "";
  if (!upstream.body || !contentType.includes("text/event-stream")) {
    const payload = await upstream.json().catch(() => ({}));
    const text = extractDelta(protocol, payload);
    writeSse(res, { type: "delta", text });
    writeSse(res, { type: "done" });
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      try {
        const payload = JSON.parse(raw);
        const text = extractDelta(protocol, payload);
        if (text) writeSse(res, { type: "delta", text });
      } catch {
        // 忽略无法解析的上游事件，避免污染对话内容。
      }
    }
    if (done) break;
  }
  writeSse(res, { type: "done" });
  res.end();
}

async function handleChat(req, res, payload) {
  const provider = payload.provider || {};
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (!provider.apiKey) return sendJson(res, 400, { error: "请先填写 API Key" });
  if (!provider.model) return sendJson(res, 400, { error: "请先填写模型名称" });

  let endpoint;
  try {
    endpoint = normalizeEndpoint(provider.baseUrl, provider.protocol, provider.model, true);
  } catch (error) {
    return sendJson(res, 400, { error: error instanceof Error ? error.message : "中转站配置错误" });
  }

  let upstream;
  try {
    upstream = await fetchUpstream(endpoint, {
      method: "POST",
      headers: getHeaders(provider),
      body: JSON.stringify(buildRequestBody(provider, messages, true)),
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    return sendJson(res, 502, { error: error instanceof Error ? error.message : "无法连接中转站" });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return sendJson(res, upstream.status, { error: summarizeUpstreamError(detail, upstream.status, endpoint) });
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
  });
  await pipeUpstream(upstream, provider.protocol, res);
}

async function handleTest(req, res, payload) {
  const provider = payload.provider || {};
  if (!provider.apiKey || !provider.model) {
    return sendJson(res, 400, { ok: false, error: "请填写 API Key 和模型名称" });
  }
  let endpoint;
  try {
    endpoint = normalizeEndpoint(provider.baseUrl, provider.protocol, provider.model, false);
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "中转站配置错误" });
  }
  try {
    const messages = [{ role: "user", content: "只回复：连接成功" }];
    const upstream = await fetchUpstream(endpoint, {
      method: "POST",
      headers: getHeaders(provider),
      body: JSON.stringify(buildRequestBody(provider, messages, false)),
      signal: AbortSignal.timeout(30000),
    });
    const detail = await upstream.text();
    if (!upstream.ok) return sendJson(res, upstream.status, { ok: false, error: summarizeUpstreamError(detail, upstream.status, endpoint) });
    return sendJson(res, 200, { ok: true, message: "连接成功" });
  } catch (error) {
    return sendJson(res, 502, { ok: false, error: error instanceof Error ? error.message : "连接失败" });
  }
}

function parseModels(payload) {
  const source = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : Array.isArray(payload) ? payload : [];
  return [...new Set(source.map((item) => {
    const value = typeof item === "string" ? item : item?.id || item?.name || item?.model;
    return String(value || "").replace(/^models\//, "").trim();
  }).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

async function handleModels(req, res, payload) {
  const provider = payload.provider || {};
  if (!provider.apiKey) return sendJson(res, 400, { ok: false, error: "请先填写 API Key" });
  if (!String(provider.baseUrl || "").trim()) return sendJson(res, 400, { ok: false, error: "Base URL 不能为空" });
  const attempts = provider.protocol === "gemini" ? [false, true] : [false];
  const errors = [];
  for (const openAiFallback of attempts) {
    try {
      const endpoint = normalizeModelsEndpoint(provider.baseUrl, provider.protocol, openAiFallback);
      const upstream = await fetchUpstream(endpoint, {
        method: "GET",
        headers: getHeaders(provider),
        signal: AbortSignal.timeout(30000),
      });
      const detail = await upstream.text();
      if (!upstream.ok) {
        errors.push(summarizeUpstreamError(detail, upstream.status, endpoint));
        continue;
      }
      const models = parseModels(JSON.parse(detail));
      if (models.length) return sendJson(res, 200, { ok: true, models });
      errors.push(`${endpoint}：响应中没有模型列表`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "获取模型失败");
    }
  }
  return sendJson(res, 502, { ok: false, error: errors.join("；") || "获取模型失败" });
}

import { handleSyncRequest } from "./sync.mjs";
export async function handleApiRequest(req, res) {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, service: "tavern-worldbook-bridge" });
    return;
  }
  if (pathname === "/api/sync/state" || pathname === "/api/sync/upsert" || pathname === "/api/sync/delete") {
    try {
      const payload = req.method === "POST" ? await readJson(req) : {};
      if (handleSyncRequest(req, res, pathname, payload)) return;
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "同步请求格式错误" });
      return;
    }
  }
  if (req.method !== "POST" || !["/api/chat", "/api/test", "/api/models"].includes(pathname)) {
    sendJson(res, 404, { error: "接口不存在" });
    return;
  }
  try {
    const payload = await readJson(req);
    if (pathname === "/api/chat") await handleChat(req, res, payload);
    else if (pathname === "/api/test") await handleTest(req, res, payload);
    else await handleModels(req, res, payload);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "请求格式错误" });
  }
}
