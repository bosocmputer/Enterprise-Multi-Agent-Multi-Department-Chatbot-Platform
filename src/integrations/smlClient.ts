import { z } from "zod";
import type { ProductCandidate, ProductSearchResult, StockLine, PriceLine } from "../core/types.js";
import type { MetricsRegistry } from "../observability/metrics.js";

const allowedTools = new Set(["search_product", "get_stock_balance", "get_product_price"]);

const envelopeSchema = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string()
    })
  )
});

const productCandidateSchema = z
  .object({
    code: z.string().optional(),
    item_code: z.string().optional(),
    itemCode: z.string().optional(),
    name: z.string().optional(),
    name_1: z.string().optional(),
    unit: z.string().optional(),
    unit_code: z.string().optional()
  })
  .passthrough();

const searchProductSchema = z
  .object({
    total_found: z.number().optional(),
    returned: z.number().optional(),
    summary: z.string().optional(),
    products: z.array(productCandidateSchema).default([])
  })
  .passthrough();

const stockLineSchema = z
  .object({
    name: z.string().optional(),
    warehouse: z.string().optional(),
    location: z.string().optional(),
    unit: z.string().optional(),
    qty: z.coerce.number()
  })
  .passthrough();

const stockResponseSchema = z
  .object({
    stocks: z.array(stockLineSchema).default([])
  })
  .passthrough();

const priceLineSchema = z
  .object({
    unit_code: z.string().optional(),
    unit_name: z.string().optional(),
    price: z.coerce.number(),
    price_source_label: z.string().optional(),
    price_source: z.string().optional()
  })
  .passthrough();

const priceProductSchema = z
  .object({
    prices: z.array(priceLineSchema).default([])
  })
  .passthrough();

const priceResponseSchema = z
  .object({
    products: z.array(priceProductSchema).default([])
  })
  .passthrough();

export class SmlClientError extends Error {
  constructor(
    message: string,
    readonly code: "timeout" | "http_error" | "invalid_response" | "blocked_tool" | "circuit_open"
  ) {
    super(message);
  }
}

export interface SmlClientOptions {
  baseUrl: string;
  accessMode: string;
  timeoutMs: number;
  circuitFailureThreshold?: number;
  circuitOpenSeconds?: number;
  fetchImpl?: typeof fetch;
  maxConcurrentCalls?: number;
  metrics?: MetricsRegistry;
}

export class SmlClient {
  private readonly fetchImpl: typeof fetch;
  private activeCalls = 0;
  private circuitFailures = 0;
  private circuitOpenUntil = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly options: SmlClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(): Promise<boolean> {
    if (this.isCircuitOpen()) return false;
    try {
      const response = await this.fetchWithTimeout(`${this.options.baseUrl}/health`, {
        method: "GET",
        headers: { "mcp-access-mode": this.options.accessMode }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async searchProduct(keyword: string, limit = 5): Promise<ProductCandidate[]> {
    return (await this.searchProductWithMeta(keyword, limit)).products;
  }

  async searchProductWithMeta(keyword: string, limit = 5): Promise<ProductSearchResult> {
    const data = await this.callTool("search_product", { keyword, limit });
    const parsed = searchProductSchema.safeParse(data);
    if (!parsed.success) {
      throw new SmlClientError("Invalid search_product response", "invalid_response");
    }
    const products = parsed.data.products
      .map((product) => ({
        code: product.code ?? product.item_code ?? product.itemCode ?? "",
        name: product.name ?? product.name_1 ?? "",
        unit: product.unit ?? product.unit_code
      }))
      .filter((product) => product.code && product.name);
    return {
      products,
      returned: parsed.data.returned ?? products.length,
      summary: parsed.data.summary,
      totalFound: parsed.data.total_found
    };
  }

  async getStockBalance(code: string): Promise<StockLine[]> {
    const data = await this.callTool("get_stock_balance", { code });
    const parsed = stockResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new SmlClientError("Invalid get_stock_balance response", "invalid_response");
    }
    return parsed.data.stocks.map((line) => ({
      name: line.name,
      warehouse: line.warehouse,
      location: line.location,
      unit: line.unit,
      qty: line.qty
    }));
  }

  async getProductPrice(code: string): Promise<PriceLine[]> {
    const data = await this.callTool("get_product_price", { code, price_type: "auto", limit: 5 });
    const parsed = priceResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new SmlClientError("Invalid get_product_price response", "invalid_response");
    }
    return parsed.data.products.flatMap((product) =>
      product.prices.map((price) => ({
        unitCode: price.unit_code,
        unitName: price.unit_name,
        price: price.price,
        source: price.price_source_label ?? price.price_source
      }))
    );
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!allowedTools.has(name)) {
      throw new SmlClientError(`Blocked SML tool: ${name}`, "blocked_tool");
    }
    const startedAt = Date.now();
    if (this.isCircuitOpen()) {
      this.options.metrics?.recordSmlTool(name, "circuit_open", Date.now() - startedAt);
      throw new SmlClientError("SML circuit is open", "circuit_open");
    }

    let outcome = "success";
    await this.acquireSlot();
    try {
      const response = await this.fetchWithTimeout(`${this.options.baseUrl}/call`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-access-mode": this.options.accessMode
        },
        body: JSON.stringify({ name, arguments: args })
      });

      const rawBody = await response.text();
      if (!response.ok) {
        outcome = "http_error";
        throw new SmlClientError(`SML HTTP ${response.status}`, "http_error");
      }

      let envelope: z.infer<typeof envelopeSchema>;
      try {
        envelope = envelopeSchema.parse(JSON.parse(rawBody));
      } catch {
        outcome = "invalid_response";
        throw new SmlClientError("Invalid SML envelope", "invalid_response");
      }

      const text = envelope.content[0]?.text;
      if (!text) {
        outcome = "invalid_response";
        throw new SmlClientError("Missing SML content text", "invalid_response");
      }

      try {
        const parsed = JSON.parse(text);
        this.recordSuccess();
        return parsed;
      } catch {
        outcome = "invalid_response";
        throw new SmlClientError("Invalid SML JSON text payload", "invalid_response");
      }
    } catch (error) {
      if (error instanceof SmlClientError) {
        outcome = error.code;
      } else {
        outcome = "network_error";
      }
      this.recordFailure();
      throw error;
    } finally {
      this.releaseSlot();
      this.options.metrics?.recordSmlTool(name, outcome, Date.now() - startedAt);
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new SmlClientError("SML request timed out", "timeout");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private isCircuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  private recordSuccess(): void {
    this.circuitFailures = 0;
  }

  private recordFailure(): void {
    this.circuitFailures += 1;
    const threshold = this.options.circuitFailureThreshold ?? 5;
    if (this.circuitFailures >= threshold) {
      this.circuitOpenUntil = Date.now() + (this.options.circuitOpenSeconds ?? 60) * 1000;
    }
  }

  private async acquireSlot(): Promise<void> {
    const maxConcurrent = Math.max(1, this.options.maxConcurrentCalls ?? 10);
    if (this.activeCalls < maxConcurrent) {
      this.activeCalls += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private releaseSlot(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.activeCalls = Math.max(0, this.activeCalls - 1);
  }
}
