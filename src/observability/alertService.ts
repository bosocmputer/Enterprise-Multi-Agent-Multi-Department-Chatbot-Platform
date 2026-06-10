import type pino from "pino";
import type { DedupStore } from "../services/cacheService.js";

export interface AlertServiceOptions {
  botToken: string;
  chatId: string;
  dedupStore?: DedupStore;
  dedupTtlSeconds: number;
  enabled: boolean;
  fetchImpl?: typeof fetch;
  logger?: pino.Logger;
}

export class AlertService {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AlertServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(key: string, message: string): Promise<void> {
    if (!this.options.enabled) return;
    if (this.options.dedupStore) {
      const claimed = await this.options.dedupStore.claim(`alert:${key}`, this.options.dedupTtlSeconds);
      if (!claimed) return;
    }

    try {
      const response = await this.fetchImpl(`https://api.telegram.org/bot${this.options.botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: this.options.chatId,
          disable_web_page_preview: true,
          text: `[parts-lookup] ${message}`
        })
      });
      if (!response.ok) {
        this.options.logger?.error({ statusCode: response.status }, "alert send failed");
      }
    } catch (error) {
      this.options.logger?.error({ err: error }, "alert send failed");
    }
  }
}
