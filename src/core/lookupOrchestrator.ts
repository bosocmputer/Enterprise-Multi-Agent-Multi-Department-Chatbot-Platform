import type { BusinessProfile } from "../config/businessProfile.js";
import { SmlClient, SmlClientError } from "../integrations/smlClient.js";
import type { CacheService, DedupStore } from "../services/cacheService.js";
import { parseLookupQuery } from "./queryParser.js";
import type { LookupRequest, LookupResult, ProductCandidate } from "./types.js";

export interface LookupOrchestratorOptions {
  businessProfile: BusinessProfile;
  datasetLabel: string;
  searchCacheTtlSeconds?: number;
  stockCacheTtlSeconds?: number;
  priceCacheTtlSeconds?: number;
  tenantStatus?: "demo" | "real";
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
  }

  private readonly businessProfile: BusinessProfile;
  private readonly datasetLabel: string;
  private readonly tenantStatus: "demo" | "real";

  async lookup(request: LookupRequest): Promise<LookupResult> {
    const parsed = parseLookupQuery(request.text, this.businessProfile);
    if (parsed.status === "unsupported") {
      return { status: "unsupported", reason: parsed.reason };
    }

    try {
      const candidates = parsed.isExactCode
        ? [{ code: parsed.keyword, name: parsed.keyword }]
        : await this.searchProductsByTerms(parsed.searchTerms);

      if (candidates.length === 0) {
        return { status: "no_match", intent: parsed.intent, keyword: parsed.keyword };
      }

      if (!parsed.isExactCode && candidates.length > 1) {
        return {
          status: "multiple_matches",
          intent: parsed.intent,
          keyword: parsed.keyword,
          candidates: candidates.slice(0, 5)
        };
      }

      if (parsed.intent === "search_product") {
        return {
          status: "multiple_matches",
          intent: parsed.intent,
          keyword: parsed.keyword,
          candidates: candidates.slice(0, 5)
        };
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
        tenantStatus: this.tenantStatus
      };
    } catch (error) {
      if (error instanceof SmlClientError) {
        if (error.code === "timeout") {
          return { status: "dependency_error", reason: "sml_timeout" };
        }
        if (error.code === "invalid_response") {
          return { status: "dependency_error", reason: "invalid_sml_response" };
        }
        if (error.code === "circuit_open") {
          return { status: "dependency_error", reason: "sml_circuit_open" };
        }
      }
      return { status: "dependency_error", reason: "sml_error" };
    }
  }

  private async searchProductsByTerms(searchTerms: string[]): Promise<ProductCandidate[]> {
    for (const term of searchTerms) {
      const candidates = await this.searchProducts(term);
      const relevantCandidates = candidates.filter((candidate) => productMatchesSearchTerm(candidate, term));
      if (relevantCandidates.length > 0) return relevantCandidates;
    }
    return [];
  }

  private async searchProducts(keyword: string): Promise<ProductCandidate[]> {
    const key = `sml:search:${normalizeCacheKey(keyword)}`;
    const cached = await this.cache.get<ProductCandidate[]>(key);
    if (cached) return cached;

    return this.fetchWithStampedeGuard(key, this.searchCacheTtlSeconds, () => this.smlClient.searchProduct(keyword, 5));
  }

  private async findExactProduct(code: string): Promise<ProductCandidate | undefined> {
    const products = await this.searchProducts(code);
    return (
      products.find((product) => product.code.toLowerCase() === code.toLowerCase()) ??
      products[0]
    );
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
}

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
