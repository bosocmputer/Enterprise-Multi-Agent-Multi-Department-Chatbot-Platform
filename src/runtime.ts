import type { AppConfig } from "./config/env.js";
import { loadBusinessProfile, type BusinessProfile } from "./config/businessProfile.js";
import { LookupOrchestrator } from "./core/lookupOrchestrator.js";
import { SmlClient } from "./integrations/smlClient.js";
import { AlertService } from "./observability/alertService.js";
import { MetricsRegistry } from "./observability/metrics.js";
import { MemoryCacheService, type StateService } from "./services/cacheService.js";
import { RedisStateService } from "./services/redisStateService.js";

export interface RuntimeServices {
  businessProfile: BusinessProfile;
  smlClient: SmlClient;
  state: StateService;
  lookup: LookupOrchestrator;
  metrics: MetricsRegistry;
  alerts?: AlertService;
  close(): Promise<void>;
}

export function createRuntime(config: AppConfig): RuntimeServices {
  const businessProfile = loadBusinessProfile(config.BUSINESS_PROFILE_PATH);
  const metrics = new MetricsRegistry();
  const smlClient = new SmlClient({
    baseUrl: config.SML_MCP_BASE_URL,
    circuitFailureThreshold: config.SML_CIRCUIT_FAILURE_THRESHOLD,
    circuitOpenSeconds: config.SML_CIRCUIT_OPEN_SECONDS,
    accessMode: config.SML_MCP_ACCESS_MODE,
    maxConcurrentCalls: config.SML_MAX_CONCURRENT_CALLS,
    timeoutMs: config.SML_REQUEST_TIMEOUT_MS,
    metrics
  });

  const state = config.REDIS_URL ? new RedisStateService(config.REDIS_URL) : new MemoryCacheService();
  const alertBotToken = config.ALERT_TELEGRAM_BOT_TOKEN ?? config.TELEGRAM_BOT_TOKEN;
  const alerts =
    config.ALERTS_ENABLED && alertBotToken && config.OPS_TELEGRAM_CHAT_ID
      ? new AlertService({
          botToken: alertBotToken,
          chatId: config.OPS_TELEGRAM_CHAT_ID,
          dedupStore: state,
          dedupTtlSeconds: config.ALERT_DEDUP_TTL_SECONDS,
          enabled: config.ALERTS_ENABLED
        })
      : undefined;
  const lookup = new LookupOrchestrator(smlClient, state, {
    businessProfile,
    datasetLabel: businessProfile.sml.datasetLabel ?? config.SML_DATASET_LABEL,
    priceCacheTtlSeconds: config.PRICE_CACHE_TTL_SECONDS,
    searchCacheTtlSeconds: config.PRODUCT_SEARCH_CACHE_TTL_SECONDS,
    stockCacheTtlSeconds: config.STOCK_CACHE_TTL_SECONDS,
    tenantStatus: businessProfile.sml.tenantStatus ?? config.SML_TENANT_STATUS
  });

  return {
    businessProfile,
    smlClient,
    state,
    lookup,
    metrics,
    alerts,
    async close() {
      await state.close();
    }
  };
}
