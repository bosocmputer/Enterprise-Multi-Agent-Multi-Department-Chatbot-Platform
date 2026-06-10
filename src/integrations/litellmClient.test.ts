import { describe, expect, it } from "vitest";
import { LiteLlmClient, LiteLlmClientError } from "./litellmClient.js";

describe("LiteLlmClient", () => {
  it("sends OpenAI-compatible JSON chat completion requests through LiteLLM", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "{\"intent\":\"stock\"}" } }],
          model: "openrouter/openrouter/free",
          usage: { total_tokens: 10 }
        })
      );
    };

    const client = new LiteLlmClient({
      apiKey: "test-key",
      baseUrl: "http://litellm.test/",
      fetchImpl,
      model: "openrouter/openrouter/free",
      timeoutMs: 1000
    });

    await expect(client.createJsonChatCompletion([{ role: "user", content: "hello" }])).resolves.toMatchObject({
      content: "{\"intent\":\"stock\"}",
      model: "openrouter/openrouter/free"
    });

    expect(capturedUrl).toBe("http://litellm.test/v1/chat/completions");
    expect((capturedInit?.headers as Record<string, string>)["x-litellm-api-key"]).toBe("test-key");
    const body = JSON.parse(String(capturedInit?.body));
    expect(body).toMatchObject({
      max_tokens: 220,
      model: "openrouter/openrouter/free",
      response_format: { type: "json_object" },
      temperature: 0
    });
  });

  it("raises a typed timeout error", async () => {
    const fetchImpl: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });

    const client = new LiteLlmClient({
      apiKey: "test-key",
      baseUrl: "http://litellm.test",
      fetchImpl,
      model: "openrouter/openrouter/free",
      timeoutMs: 1
    });

    await expect(client.createJsonChatCompletion([{ role: "user", content: "hello" }])).rejects.toMatchObject({
      code: "timeout"
    } satisfies Partial<LiteLlmClientError>);
  });
});
