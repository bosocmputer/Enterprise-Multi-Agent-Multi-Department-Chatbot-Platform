import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config/env.js";
import { SmlClient } from "./integrations/smlClient.js";

const config: AppConfig = {
  NODE_ENV: "test",
  PORT: 3060,
  LOG_LEVEL: "silent",
  APP_VERSION: "test",
  GIT_SHA: undefined,
  PUBLIC_BASE_URL: undefined,
  INTERNAL_API_TOKEN: undefined,
  BUSINESS_PROFILE_PATH: "profiles/construction-demo.json",
  SML_MCP_BASE_URL: "http://sml.test",
  SML_MCP_ACCESS_MODE: "sales",
  SML_REQUEST_TIMEOUT_MS: 1000,
  SML_DATASET_LABEL: "test",
  SML_TENANT_STATUS: "demo",
  SML_CIRCUIT_FAILURE_THRESHOLD: 5,
  SML_CIRCUIT_OPEN_SECONDS: 60,
  SML_MAX_CONCURRENT_CALLS: 10,
  PRODUCT_SEARCH_CACHE_TTL_SECONDS: 300,
  STOCK_CACHE_TTL_SECONDS: 30,
  PRICE_CACHE_TTL_SECONDS: 300,
  LOOKUP_TEST_ENDPOINT_ENABLED: true,
  METRICS_ENABLED: true,
  REDIS_URL: undefined,
  RATE_LIMIT_PER_MINUTE: 20,
  ALERTS_ENABLED: false,
  ALERT_TELEGRAM_BOT_TOKEN: undefined,
  OPS_TELEGRAM_CHAT_ID: undefined,
  ALERT_DEDUP_TTL_SECONDS: 300,
  ASSIST_RESULT_FOOTER_ENABLED: true,
  ASSIST_STATUS_MIN_DELAY_MS: 800,
  ASSIST_USER_STATUS_ENABLED: true,
  ASSIST_USER_STATUS_SHOW_MODEL: true,
  LINE_ENABLED: false,
  LINE_CHANNEL_SECRET: undefined,
  LINE_CHANNEL_ACCESS_TOKEN: undefined,
  LINE_GROUP_PREFIXES: ["/", "!"],
  LLM_PARSER_ENABLED: false,
  LLM_PARSER_MODE: "off",
  LLM_PROVIDER: "litellm",
  LITELLM_BASE_URL: "http://litellm.test",
  LITELLM_API_KEY: undefined,
  LITELLM_MODEL: "openrouter/openrouter/free",
  OPENAI_API_KEY: undefined,
  OPENAI_BASE_URL: undefined,
  LLM_PARSER_TIMEOUT_MS: 6000,
  LLM_MIN_CONFIDENCE: 0.75,
  LLM_MAX_CONCURRENT_CALLS: 2,
  LLM_ASSIST_QUEUE_WAIT_MS: 5000,
  TELEGRAM_CONTEXT_TTL_SECONDS: 300,
  TELEGRAM_DEDUP_TTL_SECONDS: 900,
  TELEGRAM_ENABLED: false,
  TELEGRAM_POLLING_ENABLED: false,
  TELEGRAM_WEBHOOK_ENABLED: false,
  TELEGRAM_POLLING_INTERVAL_MS: 1000,
  TELEGRAM_POLLING_TIMEOUT_SECONDS: 25,
  TELEGRAM_BOT_TOKEN: undefined,
  TELEGRAM_WEBHOOK_SECRET: undefined,
  TELEGRAM_BOT_USERNAME: undefined,
  CLOUDFLARE_TUNNEL_TOKEN: undefined,
  CLOUDFLARE_TUNNEL_HOSTNAME: undefined
};

describe("createApp", () => {
  it("serves health and internal lookup without Telegram credentials", async () => {
    const app = createApp(config, {
      smlClient: {
        health: async () => true,
        getStockBalance: async () => [{ warehouse: "WH-01", qty: 1, unit: "ถัง" }],
        getProductPrice: async () => [{ unitName: "ถัง", price: 99 }]
      } as unknown as SmlClient
    });

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);

    const lookup = await app.inject({
      method: "POST",
      url: "/internal/lookup",
      payload: { text: "PAINT-01424 ราคา" }
    });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json()).toMatchObject({
      result: { status: "success" }
    });

    const metrics = await app.inject({ method: "GET", url: "/metrics" });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain("parts_lookup_requests_total");

    await app.close();
  });

  it("requires bearer auth for internal endpoints in production", async () => {
    const app = createApp(
      { ...config, NODE_ENV: "production", INTERNAL_API_TOKEN: "secret" },
      {
        smlClient: {
          health: async () => true,
          getProductPrice: async () => [{ unitName: "ถัง", price: 99 }]
        } as unknown as SmlClient
      }
    );

    const missingAuth = await app.inject({ method: "GET", url: "/metrics" });
    expect(missingAuth.statusCode).toBe(401);

    const authed = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer secret" }
    });
    expect(authed.statusCode).toBe(200);

    await app.close();
  });

  it("serves internal LLM parse smoke when parser is configured", async () => {
    const app = createApp(
      { ...config, NODE_ENV: "production", INTERNAL_API_TOKEN: "secret", LLM_PARSER_MODE: "shadow" },
      {
        llmParser: {
          parse: async () => ({
            aliases: [],
            confidence: 0.98,
            intent: "stock",
            keyword: "ปูนตราช้าง",
            searchTerms: ["ปูนตราช้าง"],
            status: "parsed"
          })
        },
        smlClient: {
          health: async () => true
        } as unknown as SmlClient
      }
    );

    const missingAuth = await app.inject({
      method: "POST",
      url: "/internal/parse",
      payload: { text: "มีปูนตราช้างเหลือไหม" }
    });
    expect(missingAuth.statusCode).toBe(401);

    const parsed = await app.inject({
      headers: { authorization: "Bearer secret" },
      method: "POST",
      payload: { text: "มีปูนตราช้างเหลือไหม" },
      url: "/internal/parse"
    });

    expect(parsed.statusCode).toBe(200);
    expect(parsed.json()).toMatchObject({
      result: {
        confidence: 0.98,
        intent: "stock",
        keyword: "ปูนตราช้าง",
        status: "parsed"
      }
    });

    await app.close();
  });
});
