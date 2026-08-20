import { describe, expect, it } from "vitest";
import { resolveActiveProviderId } from "./storage";

describe("provider settings persistence", () => {
  it("keeps the saved provider after a new conversation is opened", () => {
    const providers = [
      { id: "provider_default", updatedAt: 1 },
      { id: "provider_last_used", updatedAt: 2 },
    ];

    expect(resolveActiveProviderId(providers, "provider_last_used")).toBe("provider_last_used");
  });

  it("uses the most recently saved provider when the old id is unavailable", () => {
    const providers = [
      { id: "provider_default", updatedAt: 1 },
      { id: "provider_last_used", updatedAt: 2 },
    ];

    expect(resolveActiveProviderId(providers, "provider_removed")).toBe("provider_last_used");
  });
});
