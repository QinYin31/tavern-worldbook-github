import { describe, expect, it } from "vitest";
import { buildRequestBody, normalizeEndpoint, normalizeModelsEndpoint, summarizeUpstreamError } from "./bridge.mjs";

describe("Gemini bridge", () => {
  it("builds the native streaming endpoint from a relay root URL", () => {
    expect(normalizeEndpoint("https://www.poke2api.com", "gemini", "gemini-2.5-flash-lite", true))
      .toBe("https://www.poke2api.com/v1beta/models/gemini-2.5-flash-lite:streamGenerateContent?alt=sse");
  });

  it("converts system and chat messages to Gemini contents", () => {
    const body = buildRequestBody({ protocol: "gemini", model: "gemini-2.5-flash-lite", temperature: 0.7, maxTokens: 900 }, [
      { role: "system", content: "保持人设。" },
      { role: "user", content: "你好" },
      { role: "assistant", content: "请说。" },
    ]);
    expect(body.systemInstruction.parts[0].text).toBe("保持人设。");
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "你好" }] },
      { role: "model", parts: [{ text: "请说。" }] },
    ]);
    expect(body.generationConfig.maxOutputTokens).toBe(900);
  });

  it("builds native and OpenAI-compatible model list endpoints", () => {
    expect(normalizeModelsEndpoint("https://www.poke2api.com", "gemini"))
      .toBe("https://www.poke2api.com/v1beta/models");
    expect(normalizeModelsEndpoint("https://www.poke2api.com", "gemini", true))
      .toBe("https://www.poke2api.com/v1/models");
    expect(normalizeModelsEndpoint("https://api.deepseek.com", "openai"))
      .toBe("https://api.deepseek.com/v1/models");
  });

  it("turns DeepSeek web-page responses into an actionable API error", () => {
    expect(summarizeUpstreamError("<!DOCTYPE html><title>Error - Request Blocked</title>", 403, "https://platform.deepseek.com/v1/chat/completions"))
      .toContain("https://api.deepseek.com");
  });
});
