import { describe, expect, it } from "vitest";
import { resolveBenchApiRoutes } from "./bench-api-routes";

describe("resolveBenchApiRoutes", () => {
  it("returns both routes when both capabilities are true", () => {
    expect(
      resolveBenchApiRoutes({ openaiChat: true, anthropicMessages: true }),
    ).toEqual(["chat_completions", "messages"]);
  });

  it("returns chat_completions only for Ollama-style caps", () => {
    expect(
      resolveBenchApiRoutes({ openaiChat: true, anthropicMessages: false }),
    ).toEqual(["chat_completions"]);
  });

  it("restricts to intersection when restrictTo is given", () => {
    expect(
      resolveBenchApiRoutes(
        { openaiChat: true, anthropicMessages: true },
        ["chat_completions"],
      ),
    ).toEqual(["chat_completions"]);
  });

  it("ignores restrict when intersection is empty", () => {
    expect(
      resolveBenchApiRoutes(
        { openaiChat: true, anthropicMessages: false },
        ["messages"],
      ),
    ).toEqual(["chat_completions"]);
  });
});
