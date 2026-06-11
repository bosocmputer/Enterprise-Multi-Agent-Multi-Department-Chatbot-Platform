import Fastify from "fastify";
import { z } from "zod";
import { LineAdapter } from "./channels/lineAdapter.js";
import { loadBusinessProfile, suggestedReadOnlyMcpTools, type BusinessProfile } from "./config/businessProfile.js";
import type { AppConfig } from "./config/env.js";
import type { LookupLlmParser } from "./core/llmParser.js";
import { runLlmParseWithTelemetry } from "./core/llmParser.js";
import { createLlmParser } from "./core/llmParserFactory.js";
import { LookupOrchestrator } from "./core/lookupOrchestrator.js";
import { runLookupWithTelemetry } from "./core/lookupTelemetry.js";
import { formatLookupReply } from "./core/responseFormatter.js";
import { SmlClient } from "./integrations/smlClient.js";
import type { AlertService } from "./observability/alertService.js";
import { createLogger } from "./observability/logger.js";
import { MetricsRegistry } from "./observability/metrics.js";
import { logQaTrace, qaTraceConfigFromAppConfig } from "./observability/qaTrace.js";
import { TelegramAdapter } from "./channels/telegramAdapter.js";
import { requireInternalAuth } from "./security/internalAuth.js";
import { MemoryCacheService } from "./services/cacheService.js";
import type { StateService } from "./services/cacheService.js";

const lookupBodySchema = z.object({
  text: z.string().min(1),
  channel: z.string().optional(),
  chatId: z.string().optional(),
  userId: z.string().optional()
});

const parseBodySchema = z.object({
  text: z.string().min(1)
});

export interface AppDependencies {
  alerts?: AlertService;
  businessProfile?: BusinessProfile;
  llmParser?: LookupLlmParser;
  smlClient?: SmlClient;
  lookup?: LookupOrchestrator;
  metrics?: MetricsRegistry;
  state?: StateService;
}

export function createApp(config: AppConfig, dependencies: AppDependencies = {}) {
  const logger = createLogger(config);
  const app = Fastify({ loggerInstance: logger });
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    try {
      const rawBody = typeof body === "string" ? body : body.toString();
      (_request as unknown as { rawBody: string }).rawBody = rawBody;
      done(null, rawBody ? JSON.parse(rawBody) : {});
    } catch (error) {
      done(error as Error);
    }
  });
  const metrics = dependencies.metrics ?? new MetricsRegistry();
  const qaTrace = qaTraceConfigFromAppConfig(config);
  const alerts = dependencies.alerts;
  const businessProfile = dependencies.businessProfile ?? loadBusinessProfile(config.BUSINESS_PROFILE_PATH);
  const llmParser = dependencies.llmParser ?? createLlmParser(config, businessProfile);
  const datasetLabel = businessProfile.sml.datasetLabel ?? config.SML_DATASET_LABEL;
  const tenantStatus = businessProfile.sml.tenantStatus ?? config.SML_TENANT_STATUS;

  const smlClient =
    dependencies.smlClient ??
    new SmlClient({
      baseUrl: config.SML_MCP_BASE_URL,
      circuitFailureThreshold: config.SML_CIRCUIT_FAILURE_THRESHOLD,
      circuitOpenSeconds: config.SML_CIRCUIT_OPEN_SECONDS,
      accessMode: config.SML_MCP_ACCESS_MODE,
      maxConcurrentCalls: config.SML_MAX_CONCURRENT_CALLS,
      timeoutMs: config.SML_REQUEST_TIMEOUT_MS,
      metrics
    });

  const state = dependencies.state ?? new MemoryCacheService();

  const lookup =
    dependencies.lookup ??
    new LookupOrchestrator(smlClient, state, {
      businessProfile,
      datasetLabel,
      llmParser,
      llmParserMode: config.LLM_PARSER_MODE,
      priceCacheTtlSeconds: config.PRICE_CACHE_TTL_SECONDS,
      refinementCacheTtlSeconds: config.REFINEMENT_CACHE_TTL_SECONDS,
      resultQualityMode: config.RESULT_QUALITY_MODE,
      searchCacheTtlSeconds: config.PRODUCT_SEARCH_CACHE_TTL_SECONDS,
      stockCacheTtlSeconds: config.STOCK_CACHE_TTL_SECONDS,
      tenantStatus
    });

  app.addHook("onClose", async () => {
    if (!dependencies.state) {
      await state.close();
    }
  });

  app.get("/health", async () => ({
    gitSha: config.GIT_SHA,
    status: "ok",
    service: "parts-lookup-chatbot",
    businessProfile: {
      businessType: businessProfile.businessType,
      tenantId: businessProfile.tenantId
    },
    dataset: datasetLabel,
    tenantStatus,
    version: config.APP_VERSION
  }));

  app.get("/version", async () => ({
    gitSha: config.GIT_SHA,
    service: "parts-lookup-chatbot",
    version: config.APP_VERSION
  }));

  app.get("/ready", async (_request, reply) => {
    if (!requireInternalAuth(config, _request, reply)) return reply;
    const suggestedTools = suggestedReadOnlyMcpTools(businessProfile);
    const toolDiscoveryClient = smlClient as SmlClient & { listTools?: () => Promise<string[]> };
    const [smlHealthy, stateReady, discoveredTools] = await Promise.all([
      smlClient.health(),
      state.isReady(),
      suggestedTools.length > 0 && typeof toolDiscoveryClient.listTools === "function"
        ? toolDiscoveryClient.listTools().catch(() => undefined)
        : Promise.resolve(undefined)
    ]);
    const redisStatus = config.REDIS_URL ? (stateReady ? "ok" : "unavailable") : "not_configured";
    const missingSuggestedMcpTools = discoveredTools
      ? suggestedTools.filter((tool) => !discoveredTools.includes(tool))
      : [];
    if (!smlHealthy || !stateReady) {
      await alerts?.send("readiness_degraded", `Readiness degraded: sml=${smlHealthy ? "ok" : "unavailable"} redis=${redisStatus}`);
      return reply.code(503).send({
        status: "degraded",
        dependencies: {
          sml: smlHealthy ? "ok" : "unavailable",
          redis: redisStatus
        },
        warnings: {
          missingSuggestedMcpTools
        }
      });
    }
    return {
      status: "ok",
      dependencies: { sml: "ok", redis: redisStatus },
      warnings: {
        missingSuggestedMcpTools
      }
    };
  });

  if (config.LOOKUP_TEST_ENDPOINT_ENABLED) {
    app.post("/internal/lookup", async (request, reply) => {
      if (!requireInternalAuth(config, request, reply)) return reply;
      const parsed = lookupBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_request",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message
          }))
        });
      }

      const lookupRequest = { ...parsed.data, channel: parsed.data.channel ?? "internal" };
      const result = await runLookupWithTelemetry(
        lookup,
        lookupRequest,
        { logger, metrics }
      );
      const formattedReply = formatLookupReply(result, businessProfile, {
        assistResultFooterEnabled: config.ASSIST_RESULT_FOOTER_ENABLED,
        assistShowModel: config.ASSIST_USER_STATUS_SHOW_MODEL,
        capabilityGapShowTechnicalHint: config.CAPABILITY_GAP_SHOW_TECHNICAL_HINT
      });
      logQaTrace(logger, qaTrace, {
        botReply: formattedReply,
        businessType: businessProfile.businessType,
        channel: lookupRequest.channel,
        chatId: lookupRequest.chatId,
        inputText: lookupRequest.text,
        result,
        tenantId: businessProfile.tenantId,
        userId: lookupRequest.userId
      });
      return {
        result,
        reply: formattedReply
      };
    });

    app.post("/internal/parse", async (request, reply) => {
      if (!requireInternalAuth(config, request, reply)) return reply;
      if (!llmParser) {
        return reply.code(503).send({ error: "llm_parser_unavailable" });
      }

      const parsed = parseBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_request",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message
          }))
        });
      }

      const result = await runLlmParseWithTelemetry(llmParser, parsed.data.text, {
        logger,
        metrics,
        mode: config.LLM_PARSER_MODE
      });
      return { result };
    });
  }

  if (config.METRICS_ENABLED) {
    app.get("/metrics", async (request, reply) => {
      if (!requireInternalAuth(config, request, reply)) return reply;
      return reply.type("text/plain; version=0.0.4").send(metrics.renderPrometheus());
    });
  }

  if (config.LINE_ENABLED) {
    const line = new LineAdapter({
      alerts,
      assistResultFooterEnabled: config.ASSIST_RESULT_FOOTER_ENABLED,
      assistStatusMinDelayMs: config.ASSIST_STATUS_MIN_DELAY_MS,
      assistUserStatusEnabled: config.ASSIST_USER_STATUS_ENABLED,
      assistUserStatusShowModel: config.ASSIST_USER_STATUS_SHOW_MODEL,
      businessProfile,
      batchLookupEnabled: config.BATCH_LOOKUP_ENABLED,
      capabilityGapShowTechnicalHint: config.CAPABILITY_GAP_SHOW_TECHNICAL_HINT,
      channelAccessToken: config.LINE_CHANNEL_ACCESS_TOKEN as string,
      channelSecret: config.LINE_CHANNEL_SECRET as string,
      contextStore: state,
      contextTtlSeconds: config.TELEGRAM_CONTEXT_TTL_SECONDS,
      dedupStore: state,
      dedupTtlSeconds: config.TELEGRAM_DEDUP_TTL_SECONDS,
      groupPrefixes: config.LINE_GROUP_PREFIXES,
      logger,
      llmParser,
      llmParserMode: config.LLM_PARSER_MODE,
      maxBatchItems: config.MAX_BATCH_ITEMS,
      maxBatchTextChars: config.MAX_BATCH_TEXT_CHARS,
      metrics,
      qaTrace,
      rateLimiter: state,
      rateLimitPerMinute: config.RATE_LIMIT_PER_MINUTE
    });

    app.post("/webhooks/line", async (request, reply) => {
      const rawBody = (request as unknown as { rawBody?: string }).rawBody ?? "";
      if (!line.verifySignature(rawBody, request.headers["x-line-signature"])) {
        return reply.code(401).send({ error: "invalid_line_signature" });
      }

      const result = await line.handleWebhook(request.body, lookup);
      return { ok: true, ...result };
    });
  }

  if (config.TELEGRAM_WEBHOOK_ENABLED) {
    const telegram = new TelegramAdapter({
      botToken: config.TELEGRAM_BOT_TOKEN as string,
      businessProfile,
      batchLookupEnabled: config.BATCH_LOOKUP_ENABLED,
      alerts,
      assistResultFooterEnabled: config.ASSIST_RESULT_FOOTER_ENABLED,
      assistStatusMinDelayMs: config.ASSIST_STATUS_MIN_DELAY_MS,
      assistUserStatusEnabled: config.ASSIST_USER_STATUS_ENABLED,
      assistUserStatusShowModel: config.ASSIST_USER_STATUS_SHOW_MODEL,
      capabilityGapShowTechnicalHint: config.CAPABILITY_GAP_SHOW_TECHNICAL_HINT,
      webhookSecret: config.TELEGRAM_WEBHOOK_SECRET as string,
      botUsername: config.TELEGRAM_BOT_USERNAME,
      contextStore: state,
      contextTtlSeconds: config.TELEGRAM_CONTEXT_TTL_SECONDS,
      dedupStore: state,
      dedupTtlSeconds: config.TELEGRAM_DEDUP_TTL_SECONDS,
      logger,
      llmParser,
      llmParserMode: config.LLM_PARSER_MODE,
      maxBatchItems: config.MAX_BATCH_ITEMS,
      maxBatchTextChars: config.MAX_BATCH_TEXT_CHARS,
      metrics,
      qaTrace,
      rateLimiter: state,
      rateLimitPerMinute: config.RATE_LIMIT_PER_MINUTE
    });

    app.post("/webhooks/telegram", async (request, reply) => {
      if (!telegram.verifySecret(request.headers["x-telegram-bot-api-secret-token"])) {
        return reply.code(401).send({ error: "invalid_telegram_secret" });
      }

      const result = await telegram.handleUpdate(request.body, lookup);
      return { ok: true, ...result };
    });
  }

  return app;
}
