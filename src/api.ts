import type { ModelMessage, ProviderProfile } from "./types";

interface StreamPayload {
  type: "delta" | "done";
  text?: string;
}

export async function streamChat(
  provider: ProviderProfile,
  messages: ModelMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, messages }),
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `请求失败（${response.status}）`);
  }
  if (!response.body) throw new Error("中转站没有返回流");
  const reader = response.body.getReader();
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
      if (!raw) continue;
      let payload: StreamPayload;
      try {
        payload = JSON.parse(raw) as StreamPayload;
      } catch {
        continue; // 忽略无法解析的行,避免中断整个流
      }
      if (payload.type === "delta" && payload.text) onDelta(payload.text);
    }
    if (done) break;
  }
}

export async function testProvider(provider: ProviderProfile) {
  const response = await fetch("/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || "连接失败");
  return payload.message as string;
}

export async function fetchModels(provider: ProviderProfile): Promise<string[]> {
  const response = await fetch("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "获取模型列表失败");
  }
  if (!Array.isArray(payload.models) || payload.models.length === 0) {
    throw new Error("接口没有返回可用模型");
  }
  return payload.models.filter((model: unknown): model is string => typeof model === "string" && Boolean(model.trim()));
}
