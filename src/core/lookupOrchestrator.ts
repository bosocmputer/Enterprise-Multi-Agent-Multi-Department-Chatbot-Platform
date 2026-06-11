import type { BusinessProfile } from "../config/businessProfile.js";
import { SmlClient, SmlClientError } from "../integrations/smlClient.js";
import type pino from "pino";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { CacheService, DedupStore } from "../services/cacheService.js";
import type { LlmParserMode, LookupLlmParser } from "./llmParser.js";
import { runLlmParseWithTelemetry } from "./llmParser.js";
import { assistInfo, startAssist, understandLookupQuery } from "./queryUnderstanding.js";
import type {
  LlmAssistInfo,
  LlmAssistStartEvent,
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
      return { status: "unsupported", reason: parsed.reason, assist: parsed.assist };
    }

    try {
      let searchResult = parsed.isExactCode
        ? { candidates: [{ code: parsed.keyword, name: parsed.keyword }], returned: 1, totalFound: 1 }
        : await this.searchProductsByTerms(parsed.searchTerms);
      let candidates = searchResult.candidates;

      if (candidates.length === 0) {
        const assisted = await this.retryNoMatchWithAssist(request.text, parsed, telemetry);
        if (assisted?.status === "found") {
          parsed = assisted.parsed;
          searchResult = assisted.searchResult;
          candidates = searchResult.candidates;
        } else {
          this.triggerShadowParse(request.text, telemetry);
          return { status: "no_match", intent: parsed.intent, keyword: parsed.keyword, assist: assisted?.assist };
        }
      }

      if (!parsed.isExactCode && candidates.length > 1) {
        return multipleMatches(parsed, searchResult);
      }

      if (parsed.intent === "search_product") {
        return multipleMatches(parsed, searchResult);
      }

      const product = candidates[0] as ProductCandidate;
      const productDetailPromise = parsed.isExactCode
        ? this.findExactProduct(product.code).catch(() => undefined)
        : undefined;
      let stock = undefined;
      let prices = undefined;
      let cacheHit = true;

      const stockPromise =
        parsed.intent === "stock" || parsed.intent === "stock_price"
          ? this.getCachedStock(product.code)
          : undefined;
      const pricePromise =
        parsed.intent === "price" || parsed.intent === "stock_price"
          ? this.getCachedPrice(product.code)
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

      const displayProduct = resolveDisplayProduct(product, productDetail, stock?.[0]?.name);

      return {
        status: "success",
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
          return { status: "dependency_error", reason: "sml_timeout", assist: parsed.assist };
        }
        if (error.code === "invalid_response") {
          return { status: "dependency_error", reason: "invalid_sml_response", assist: parsed.assist };
        }
        if (error.code === "circuit_open") {
          return { status: "dependency_error", reason: "sml_circuit_open", assist: parsed.assist };
        }
      }
      return { status: "dependency_error", reason: "sml_error", assist: parsed.assist };
    }
  }

  private async searchProductsByTerms(searchTerms: string[]): Promise<CandidateSearchResult> {
    for (const term of searchTerms) {
      const result = await this.searchProducts(term);
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

  private async searchProducts(keyword: string): Promise<ProductSearchResult> {
    const key = `sml:search:v2:${normalizeCacheKey(keyword)}`;
    const cached = await this.cache.get<ProductSearchResult | ProductCandidate[]>(key);
    if (cached) return normalizeCachedSearchResult(cached);

    return this.fetchWithStampedeGuard(key, this.searchCacheTtlSeconds, () => this.fetchProductSearch(keyword));
  }

  private async findExactProduct(code: string): Promise<ProductCandidate | undefined> {
    const { products } = await this.searchProducts(code);
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
      intent: llmParsed.intent,
      keyword: llmParsed.keyword,
      isExactCode: exactCodePattern.test(llmParsed.keyword),
      searchTerms: llmParsed.searchTerms,
      assist,
      source: "llm"
    };
    const searchResult = assistedParsed.isExactCode
      ? { candidates: [{ code: assistedParsed.keyword, name: assistedParsed.keyword }], returned: 1, totalFound: 1 }
      : await this.searchProductsByTerms(assistedParsed.searchTerms);
    if (searchResult.candidates.length === 0) return { status: "not_found", assist };
    return { status: "found", parsed: assistedParsed, searchResult };
  }

  private async getCachedStock(code: string) {
    const key = `sml:stock:${code}`;
    const cached = await this.cache.get<Awaited<ReturnType<SmlClient["getStockBalance"]>>>(key);
    if (cached) return { value: cached, cacheHit: true };

    const value = await this.fetchWithStampedeGuard(key, this.stockCacheTtlSeconds, () =>
      this.smlClient.getStockBalance(code)
    );
    return { value, cacheHit: false };
  }

  private async getCachedPrice(code: string) {
    const key = `sml:price:${code}`;
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
}

function multipleMatches(parsed: ParsedLookup, searchResult: CandidateSearchResult): LookupResult {
  const totalFound = searchResult.totalFound ?? searchResult.candidates.length;
  const pageSize = MULTI_MATCH_PAGE_SIZE;
  return {
    status: "multiple_matches",
    intent: parsed.intent,
    keyword: parsed.keyword,
    candidates: searchResult.candidates,
    hasMore: searchResult.candidates.length > pageSize,
    pageSize,
    pageStart: 0,
    returned: searchResult.returned ?? searchResult.candidates.length,
    totalFound,
    assist: parsed.assist
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
