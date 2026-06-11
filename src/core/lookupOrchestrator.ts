import {
  actionForLegacyIntent,
  normalizeDomainProfile,
  type BusinessProfile,
  type DomainProfileV2
} from "../config/businessProfile.js";
import { SmlClient, SmlClientError } from "../integrations/smlClient.js";
import type pino from "pino";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { CacheService, DedupStore } from "../services/cacheService.js";
import type { LlmParserMode, LookupLlmParser } from "./llmParser.js";
import { runLlmParseWithTelemetry } from "./llmParser.js";
import { assistInfo, startAssist, understandLookupQuery } from "./queryUnderstanding.js";
import { attachEntities, attachEntity, entitiesFromProducts } from "./entityAdapter.js";
import type {
  ConversationMetadata,
  LlmAssistInfo,
  LlmAssistStartEvent,
  LookupActionId,
  LookupRequest,
  LookupResult,
  ParseOutcome,
  ProductCandidate,
  ProductSearchResult
} from "./types.js";

const SEARCH_RESULT_LIMIT = 20;
const MULTI_MATCH_PAGE_SIZE = 5;

type ParsedLookup = Extract<ParseOutcome, { status: "parsed" }>;

interface CandidateSearchResult {
  candidates: ProductCandidate[];
  returned?: number;
  totalFound?: number;
}

export interface LookupOrchestratorOptions {
  businessProfile: BusinessProfile;
  datasetLabel: string;
  llmParser?: LookupLlmParser;
  llmParserMode?: LlmParserMode;
  searchCacheTtlSeconds?: number;
  stockCacheTtlSeconds?: number;
  priceCacheTtlSeconds?: number;
  tenantStatus?: "demo" | "real";
}

export interface LookupTelemetryOptions {
  logger?: pino.Logger;
  metrics?: MetricsRegistry;
  onAssistStart?: (event: LlmAssistStartEvent) => void | Promise<void>;
}

export class LookupOrchestrator {
  private readonly searchCacheTtlSeconds: number;
  private readonly stockCacheTtlSeconds: number;
  private readonly priceCacheTtlSeconds: number;
  private readonly domainProfile: DomainProfileV2;
  private readonly source: string;
  private readonly tenantId: string;

  constructor(
    private readonly smlClient: SmlClient,
    private readonly cache: CacheService & Partial<DedupStore>,
    options: LookupOrchestratorOptions
  ) {
    this.businessProfile = options.businessProfile;
    this.searchCacheTtlSeconds = options.searchCacheTtlSeconds ?? 300;
    this.stockCacheTtlSeconds = options.stockCacheTtlSeconds ?? 30;
    this.priceCacheTtlSeconds = options.priceCacheTtlSeconds ?? 300;
    this.datasetLabel = options.datasetLabel;
    this.tenantStatus = options.tenantStatus ?? "demo";
    this.llmParser = options.llmParser;
    this.llmParserMode = options.llmParserMode ?? "off";
    this.domainProfile = normalizeDomainProfile(options.businessProfile);
    this.source = this.domainProfile.connectors.find((connector) => connector.readOnly)?.source ?? "sml";
    this.tenantId = options.businessProfile.tenantId;
  }

  private readonly businessProfile: BusinessProfile;
  private readonly datasetLabel: string;
  private readonly llmParser: LookupLlmParser | undefined;
  private readonly llmParserMode: LlmParserMode;
  private readonly tenantStatus: "demo" | "real";

  async lookup(request: LookupRequest, telemetry: LookupTelemetryOptions = {}): Promise<LookupResult> {
    let parsed = await understandLookupQuery(request.text, this.businessProfile, {
      llmParser: this.llmParser,
      llmParserMode: this.llmParserMode,
      logger: telemetry.logger,
      metrics: telemetry.metrics,
      onAssistStart: telemetry.onAssistStart
    });
    if (parsed.status === "unsupported") {
      this.triggerShadowParse(request.text, telemetry);
      return {
        status: "unsupported",
        reason: parsed.reason,
        assist: parsed.assist,
        ...this.unsupportedMetadata(parsed)
      };
    }
    const metadata = this.metadataForParsed(parsed);

    try {
      let searchResult = parsed.isExactCode
        ? {
            candidates: [attachEntity({ code: parsed.keyword, name: parsed.keyword }, metadata.entityType)],
            returned: 1,
            totalFound: 1
          }
        : await this.searchProductsByTerms(parsed.searchTerms, metadata.entityType);
      let candidates = searchResult.candidates;

      if (candidates.length === 0) {
        const assisted = await this.retryNoMatchWithAssist(request.text, parsed, telemetry);
        if (assisted?.status === "found") {
          parsed = assisted.parsed;
          Object.assign(metadata, this.metadataForParsed(parsed));
          searchResult = assisted.searchResult;
          candidates = searchResult.candidates;
        } else {
          this.triggerShadowParse(request.text, telemetry);
          return {
            status: "no_match",
            intent: parsed.intent,
            keyword: parsed.keyword,
            assist: assisted?.assist,
            ...metadata,
            parserPath: assisted?.assist ? "llm_assist" : metadata.parserPath
          };
        }
      }

      if (!parsed.isExactCode && candidates.length > 1) {
        return multipleMatches(parsed, searchResult, metadata);
      }

      if (parsed.intent === "search_product") {
        return multipleMatches(parsed, searchResult, metadata);
      }

      const product = candidates[0] as ProductCandidate;
      const productDetailPromise = parsed.isExactCode
        ? this.findExactProduct(product.code, metadata.entityType).catch(() => undefined)
        : undefined;
      let stock = undefined;
      let prices = undefined;
      let cacheHit = true;

      const stockPromise =
        parsed.intent === "stock" || parsed.intent === "stock_price"
          ? this.getCachedStock(product.code, metadata.entityType, metadata.action)
          : undefined;
      const pricePromise =
        parsed.intent === "price" || parsed.intent === "stock_price"
          ? this.getCachedPrice(product.code, metadata.entityType, metadata.action)
          : undefined;

      const [stockResult, priceResult, productDetail] = await Promise.all([
        stockPromise,
        pricePromise,
        productDetailPromise
      ]);

      if (stockResult) {
        stock = stockResult.value;
        cacheHit = cacheHit && stockResult.cacheHit;
      }
      if (priceResult) {
        prices = priceResult.value;
        cacheHit = cacheHit && priceResult.cacheHit;
      }

      const displayProduct = attachEntity(
        resolveDisplayProduct(product, productDetail, stock?.[0]?.name),
        metadata.entityType,
        true
      );

      return {
        status: "success",
        ...metadata,
        entity: displayProduct.entity,
        intent: parsed.intent,
        product: displayProduct,
        stock,
        prices,
        cacheHit,
        datasetLabel: this.datasetLabel,
        tenantStatus: this.tenantStatus,
        assist: parsed.assist
      };
    } catch (error) {
      if (error instanceof SmlClientError) {
        if (error.code === "timeout") {
          return { status: "dependency_error", reason: "sml_timeout", assist: parsed.assist, ...metadata };
        }
        if (error.code === "invalid_response") {
          return { status: "dependency_error", reason: "invalid_sml_response", assist: parsed.assist, ...metadata };
        }
        if (error.code === "circuit_open") {
          return { status: "dependency_error", reason: "sml_circuit_open", assist: parsed.assist, ...metadata };
        }
      }
      return { status: "dependency_error", reason: "sml_error", assist: parsed.assist, ...metadata };
    }
  }

  private async searchProductsByTerms(searchTerms: string[], entityType: string): Promise<CandidateSearchResult> {
    for (const term of searchTerms) {
      const result = await this.searchProducts(term, entityType);
      const relevantCandidates = result.products.filter((candidate) => productMatchesSearchTerm(candidate, term));
      if (relevantCandidates.length > 0) {
        const keptAllReturnedProducts = relevantCandidates.length === result.products.length;
        return {
          candidates: relevantCandidates,
          returned: keptAllReturnedProducts ? result.returned : relevantCandidates.length,
          totalFound: keptAllReturnedProducts ? result.totalFound : relevantCandidates.length
        };
      }
    }
    return { candidates: [] };
  }

  private async searchProducts(keyword: string, entityType: string): Promise<ProductSearchResult> {
    const key = `lookup:${this.tenantId}:entity:${entityType}:search:v3:${normalizeCacheKey(keyword)}`;
    const cached = await this.cache.get<ProductSearchResult | ProductCandidate[]>(key);
    if (cached) return attachSearchEntities(normalizeCachedSearchResult(cached), entityType);

    const result = await this.fetchWithStampedeGuard(key, this.searchCacheTtlSeconds, () => this.fetchProductSearch(keyword));
    return attachSearchEntities(result, entityType);
  }

  private async findExactProduct(code: string, entityType: string): Promise<ProductCandidate | undefined> {
    const { products } = await this.searchProducts(code, entityType);
    return (
      products.find((product) => product.code.toLowerCase() === code.toLowerCase()) ??
      products[0]
    );
  }

  private async fetchProductSearch(keyword: string): Promise<ProductSearchResult> {
    const clientWithMeta = this.smlClient as SmlClient & {
      searchProductWithMeta?: (keyword: string, limit?: number) => Promise<ProductSearchResult>;
    };
    if (typeof clientWithMeta.searchProductWithMeta === "function") {
      return clientWithMeta.searchProductWithMeta(keyword, SEARCH_RESULT_LIMIT);
    }
    const products = await this.smlClient.searchProduct(keyword, SEARCH_RESULT_LIMIT);
    return { products, returned: products.length, totalFound: products.length };
  }

  private async retryNoMatchWithAssist(
    text: string,
    parsed: ParsedLookup,
    telemetry: LookupTelemetryOptions
  ): Promise<
    | { status: "found"; parsed: ParsedLookup; searchResult: CandidateSearchResult }
    | { status: "not_found"; assist: LlmAssistInfo }
    | undefined
  > {
    if (this.llmParserMode !== "assist" || !this.llmParser || parsed.source === "llm") return undefined;

    const assistStart = startAssist(this.llmParser, "no_match_retry", {
      llmParserMode: this.llmParserMode,
      metrics: telemetry.metrics,
      onAssistStart: telemetry.onAssistStart
    });
    const llmParsed = await runLlmParseWithTelemetry(this.llmParser, text, {
      logger: telemetry.logger,
      metrics: telemetry.metrics,
      mode: "assist"
    }).catch((error) => {
      telemetry.logger?.warn({ error }, "llm assist parser failed");
      return undefined;
    });
    if (!llmParsed) return undefined;
    let assist = assistInfo(assistStart, llmParsed);
    if (!llmParsed || llmParsed.status !== "parsed" || llmParsed.intent === "unsupported") {
      return { status: "not_found", assist };
    }
    if (!this.businessProfile.enabledIntents.includes(llmParsed.intent)) {
      assist = { ...assist, outcome: "rejected_intent_disabled", status: "rejected" };
      return { status: "not_found", assist };
    }

    const assistedParsed: ParsedLookup = {
      status: "parsed",
      action: llmParsed.action ?? actionForLegacyIntent(this.businessProfile, llmParsed.intent)?.id,
      entityType: llmParsed.entityType ?? parsed.entityType ?? this.domainProfile.defaultEntityType,
      intent: llmParsed.intent,
      keyword: llmParsed.keyword,
      isExactCode: exactCodePattern.test(llmParsed.keyword),
      query: llmParsed.query,
      searchTerms: llmParsed.searchTerms,
      assist,
      source: "llm"
    };
    const metadata = this.metadataForParsed(assistedParsed);
    const searchResult = assistedParsed.isExactCode
      ? {
          candidates: [attachEntity({ code: assistedParsed.keyword, name: assistedParsed.keyword }, metadata.entityType)],
          returned: 1,
          totalFound: 1
        }
      : await this.searchProductsByTerms(assistedParsed.searchTerms, metadata.entityType);
    if (searchResult.candidates.length === 0) return { status: "not_found", assist };
    return { status: "found", parsed: assistedParsed, searchResult };
  }

  private async getCachedStock(code: string, entityType: string, action: LookupActionId | undefined) {
    const key = `lookup:${this.tenantId}:entity:${entityType}:action:${action ?? "availability"}:stock:${code}`;
    const cached = await this.cache.get<Awaited<ReturnType<SmlClient["getStockBalance"]>>>(key);
    if (cached) return { value: cached, cacheHit: true };

    const value = await this.fetchWithStampedeGuard(key, this.stockCacheTtlSeconds, () =>
      this.smlClient.getStockBalance(code)
    );
    return { value, cacheHit: false };
  }

  private async getCachedPrice(code: string, entityType: string, action: LookupActionId | undefined) {
    const key = `lookup:${this.tenantId}:entity:${entityType}:action:${action ?? "price"}:price:${code}`;
    const cached = await this.cache.get<Awaited<ReturnType<SmlClient["getProductPrice"]>>>(key);
    if (cached) return { value: cached, cacheHit: true };

    const value = await this.fetchWithStampedeGuard(key, this.priceCacheTtlSeconds, () =>
      this.smlClient.getProductPrice(code)
    );
    return { value, cacheHit: false };
  }

  private async fetchWithStampedeGuard<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
    const lockKey = `${key}:lock`;
    const claimed = this.cache.claim ? await this.cache.claim(lockKey, 5) : true;
    if (claimed) {
      const value = await fetcher();
      await this.cache.set(key, value, ttlSeconds);
      return value;
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await sleep(50);
      const cached = await this.cache.get<T>(key);
      if (cached) return cached;
    }

    const value = await fetcher();
    await this.cache.set(key, value, ttlSeconds);
    return value;
  }

  private triggerShadowParse(text: string, telemetry: LookupTelemetryOptions): void {
    if (this.llmParserMode !== "shadow" || !this.llmParser) return;
    void runLlmParseWithTelemetry(this.llmParser, text, {
      logger: telemetry.logger,
      metrics: telemetry.metrics,
      mode: "shadow"
    }).catch((error) => {
      telemetry.logger?.warn({ error }, "llm shadow parser failed");
    });
  }

  private metadataForParsed(parsed: ParsedLookup): {
    action?: LookupActionId;
    conversationScope: "lookup_like";
    entityType: string;
    outOfScopeCategory: "none";
    parserPath: "deterministic" | "llm_assist";
    replyPolicy: "lookup";
    source: string;
    tenantId: string;
  } {
    return {
      action: parsed.action ?? actionForLegacyIntent(this.businessProfile, parsed.intent)?.id,
      conversationScope: "lookup_like",
      entityType: parsed.entityType ?? this.domainProfile.defaultEntityType,
      outOfScopeCategory: "none",
      parserPath: parsed.source === "llm" || parsed.assist?.status === "parsed" ? "llm_assist" : "deterministic",
      replyPolicy: "lookup",
      source: this.source,
      tenantId: this.tenantId
    };
  }

  private unsupportedMetadata(parsed: Extract<ParseOutcome, { status: "unsupported" }>): {
    entityType: string;
    source: string;
    tenantId: string;
  } & ConversationMetadata {
    return {
      conversationScope: parsed.conversationScope ?? "lookup_like",
      entityType: this.domainProfile.defaultEntityType,
      outOfScopeCategory: parsed.outOfScopeCategory ?? "none",
      parserPath: parsed.parserPath ?? (parsed.assist ? "llm_assist" : "none"),
      replyPolicy: parsed.replyPolicy ?? "lookup",
      source: "none",
      tenantId: this.tenantId
    };
  }
}

function multipleMatches(
  parsed: ParsedLookup,
  searchResult: CandidateSearchResult,
  metadata: {
    action?: LookupActionId;
    conversationScope: "lookup_like";
    entityType: string;
    outOfScopeCategory: "none";
    parserPath: "deterministic" | "llm_assist";
    replyPolicy: "lookup";
    source: string;
    tenantId: string;
  }
): LookupResult {
  const totalFound = searchResult.totalFound ?? searchResult.candidates.length;
  const pageSize = MULTI_MATCH_PAGE_SIZE;
  return {
    status: "multiple_matches",
    ...metadata,
    intent: parsed.intent,
    keyword: parsed.keyword,
    candidates: searchResult.candidates,
    entities: entitiesFromProducts(searchResult.candidates, metadata.entityType),
    hasMore: searchResult.candidates.length > pageSize,
    pageSize,
    pageStart: 0,
    returned: searchResult.returned ?? searchResult.candidates.length,
    totalFound,
    assist: parsed.assist
  };
}

function attachSearchEntities(result: ProductSearchResult, entityType: string): ProductSearchResult {
  return {
    ...result,
    products: attachEntities(result.products, entityType)
  };
}

function normalizeCachedSearchResult(value: ProductSearchResult | ProductCandidate[]): ProductSearchResult {
  if (Array.isArray(value)) {
    return { products: value, returned: value.length, totalFound: value.length };
  }
  return value;
}

const exactCodePattern = /^[A-Z0-9][A-Z0-9_-]{2,}$/i;

function normalizeCacheKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function productMatchesSearchTerm(product: ProductCandidate, term: string): boolean {
  const normalizedTerm = normalizeForMatch(term);
  if (!normalizedTerm) return false;

  const haystack = normalizeForMatch(`${product.code} ${product.name}`);
  const tokens = normalizedTerm.split(" ").filter(Boolean);
  if (tokens.length === 0) return false;

  return tokens.every((token) => haystack.includes(token));
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function resolveDisplayProduct(
  product: ProductCandidate,
  productDetail: ProductCandidate | undefined,
  stockName: string | undefined
): ProductCandidate {
  if (product.name !== product.code) return product;
  if (productDetail?.name && productDetail.name !== productDetail.code) {
    return { ...product, name: productDetail.name, unit: productDetail.unit ?? product.unit };
  }
  if (stockName) return { ...product, name: stockName };
  return product;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
