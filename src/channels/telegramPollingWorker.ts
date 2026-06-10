import type pino from "pino";
import type { LookupOrchestrator } from "../core/lookupOrchestrator.js";
import { TelegramAdapter } from "./telegramAdapter.js";

export interface TelegramPollingWorkerOptions {
  intervalMs: number;
  timeoutSeconds: number;
  logger: pino.Logger;
}

export class TelegramPollingWorker {
  private offset: number | undefined;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;

  constructor(
    private readonly adapter: TelegramAdapter,
    private readonly lookup: LookupOrchestrator,
    private readonly options: TelegramPollingWorkerOptions
  ) {}

  start(): void {
    if (this.running) return;
    this.stopped = false;
    this.running = true;
    void this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async pollOnce(): Promise<{ received: number; handled: number; ignored: number }> {
    const updates = await this.adapter.getUpdates({
      offset: this.offset,
      timeoutSeconds: this.options.timeoutSeconds
    });

    let handled = 0;
    let ignored = 0;

    for (const update of updates) {
      const updateId = getUpdateId(update);
      if (updateId != null) {
        this.offset = updateId + 1;
      }

      try {
        const result = await this.adapter.handleUpdate(update, this.lookup);
        if (result.ignored) ignored += 1;
        else handled += 1;
      } catch (error) {
        ignored += 1;
        this.options.logger.error({ err: error }, "telegram update handling failed");
      }
    }

    return { received: updates.length, handled, ignored };
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        const result = await this.pollOnce();
        if (result.received > 0) {
          this.options.logger.info(result, "telegram polling batch processed");
        }
      } catch (error) {
        this.options.logger.error({ err: error }, "telegram polling failed");
      }

      await new Promise<void>((resolve) => {
        this.timer = setTimeout(resolve, this.options.intervalMs);
      });
    }
    this.running = false;
  }
}

function getUpdateId(update: unknown): number | undefined {
  if (typeof update !== "object" || update == null) return undefined;
  const value = (update as { update_id?: unknown }).update_id;
  return typeof value === "number" ? value : undefined;
}
