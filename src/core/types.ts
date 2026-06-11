export type LookupIntent = "search_product" | "stock" | "price" | "stock_price";

export type LlmAssistReason = "no_match_retry" | "unsupported";

export interface LlmAssistInfo {
  durationMs?: number;
  model: string;
  outcome?: string;
  provider: string;
  reason: LlmAssistReason;
  status: "parsed" | "rejected";
  timeoutMs: number;
}

export interface LlmAssistStartEvent {
  model: string;
  provider: string;
  reason: LlmAssistReason;
  timeoutMs: number;
}

export type ParseOutcome =
  | {
      status: "parsed";
      intent: LookupIntent;
      keyword: string;
      isExactCode: boolean;
      searchTerms: string[];
      assist?: LlmAssistInfo;
      source?: "deterministic" | "llm";
    }
  | {
      status: "unsupported";
      reason: string;
      assist?: LlmAssistInfo;
    };

export interface ProductCandidate {
  code: string;
  name: string;
  unit?: string;
}

export interface ProductSearchResult {
  products: ProductCandidate[];
  returned?: number;
  summary?: string;
  totalFound?: number;
}

export interface StockLine {
  name?: string;
  warehouse?: string;
  location?: string;
  unit?: string;
  qty: number;
}

export interface PriceLine {
  unitCode?: string;
  unitName?: string;
  price: number;
  source?: string;
}

export interface LookupRequest {
  text: string;
  channel?: string;
  chatId?: string;
  userId?: string;
}

export type LookupResult =
  | {
      status: "success";
      intent: LookupIntent;
      product: ProductCandidate;
      stock?: StockLine[];
      prices?: PriceLine[];
      cacheHit: boolean;
      datasetLabel: string;
      tenantStatus: "demo" | "real";
      assist?: LlmAssistInfo;
    }
  | {
      status: "no_match";
      intent: LookupIntent;
      keyword: string;
      assist?: LlmAssistInfo;
    }
  | {
      status: "multiple_matches";
      intent: LookupIntent;
      keyword: string;
      candidates: ProductCandidate[];
      hasMore?: boolean;
      pageSize?: number;
      pageStart?: number;
      returned?: number;
      totalFound?: number;
      assist?: LlmAssistInfo;
    }
  | {
      status: "unsupported";
      reason: string;
      assist?: LlmAssistInfo;
    }
  | {
      status: "dependency_error";
      reason: "sml_timeout" | "sml_error" | "invalid_sml_response" | "sml_circuit_open";
      assist?: LlmAssistInfo;
    };
