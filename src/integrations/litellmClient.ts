import { z } from "zod";

const chatCompletionResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            finish_reason: z.string().optional(),
            message: z
              .object({
                content: z.string().optional()
              })
              .passthrough()
              .optional()
          })
          .passthrough()
      )
      .min(1),
    model: z.string().optional(),
    usage: z.unknown().optional()
  })
  .passthrough();

export interface LiteLlmClientOptions {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  maxTokens?: number;
  model: string;
  timeoutMs: number;
}

export interface LiteLlmChatMessage {
  content: string;
  role: "system" | "user";
}

export interface LiteLlmChatResult {
  content: string;
  finishReason?: string;
  model?: string;
  usage?: unknown;
}

export type LiteLlmClientErrorCode = "http_error" | "invalid_response" | "timeout";

export class LiteLlmClientError extends Error {
  constructor(
    message: string,
    readonly code: LiteLlmClientErrorCode
  ) {
    super(message);
    this.name = "LiteLlmClientError";
  }
}

export class LiteLlmClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxTokens: number;

  constructor(private readonly options: LiteLlmClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxTokens = options.maxTokens ?? 220;
  }

  async createJsonChatCompletion(messages: LiteLlmChatMessage[]): Promise<LiteLlmChatResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await this.fetchImpl(`${trimTrailingSlash(this.options.baseUrl)}/v1/chat/completions`, {
        body: JSON.stringify({
          max_tokens: this.maxTokens,
          messages,
          model: this.options.model,
          response_format: { type: "json_object" },
          temperature: 0
        }),
        headers: {
          "content-type": "application/json",
          "x-litellm-api-key": this.options.apiKey
        },
        method: "POST",
        signal: controller.signal
      });

      if (!response.ok) {
        throw new LiteLlmClientError(`LiteLLM returned HTTP ${response.status}`, "http_error");
      }

      const body = chatCompletionResponseSchema.safeParse(await response.json());
      if (!body.success) {
        throw new LiteLlmClientError("LiteLLM returned an invalid response shape", "invalid_response");
      }

      const firstChoice = body.data.choices[0];
      const content = firstChoice.message?.content?.trim();
      if (!content) {
        throw new LiteLlmClientError("LiteLLM returned an empty message", "invalid_response");
      }

      return {
        content,
        finishReason: firstChoice.finish_reason,
        model: body.data.model,
        usage: body.data.usage
      };
    } catch (error) {
      if (error instanceof LiteLlmClientError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new LiteLlmClientError("LiteLLM request timed out", "timeout");
      }
      throw new LiteLlmClientError("LiteLLM returned an invalid response", "invalid_response");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}
