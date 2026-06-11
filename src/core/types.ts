export type LookupIntent = "search_product" | "stock" | "price" | "stock_price";

export type LookupActionId = string;

export interface EntityCandidate {
  description?: string;
  id: string;
  label: string;
  metadata?: Record<string, string | number | boolean | undefined>;
  type: string;
}

export interface LookupDomainMetadata {
  action?: LookupActionId;
  confidenceBand?: "high" | "medium" | "low" | "none";
  entityType?: string;
  source?: string;
  tenantId?: string;
}

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
      action?: LookupActionId;
      entityType?: string;
      intent: LookupIntent;
      keyword: string;
      isExactCode: boolean;
      query?: string;
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
  entity?: EntityCandidate;
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
      action?: LookupActionId;
      entity?: EntityCandidate;
      entityType?: string;
      intent: LookupIntent;
      product: ProductCandidate;
      stock?: StockLine[];
      prices?: PriceLine[];
      cacheHit: boolean;
      datasetLabel: string;
      source?: string;
      tenantId?: string;
      tenantStatus: "demo" | "real";
      assist?: LlmAssistInfo;
    }
  | {
      status: "no_match";
      action?: LookupActionId;
      entityType?: string;
      intent: LookupIntent;
      keyword: string;
      source?: string;
      tenantId?: string;
      assist?: LlmAssistInfo;
    }
  | {
      status: "multiple_matches";
      action?: LookupActionId;
      intent: LookupIntent;
      keyword: string;
      candidates: ProductCandidate[];
      entities?: EntityCandidate[];
      entityType?: string;
      hasMore?: boolean;
      pageSize?: number;
      pageStart?: number;
      returned?: number;
      source?: string;
      tenantId?: string;
      totalFound?: number;
      assist?: LlmAssistInfo;
    }
  | {
      status: "unsupported";
      action?: LookupActionId;
      entityType?: string;
      reason: string;
      source?: string;
      tenantId?: string;
      assist?: LlmAssistInfo;
    }
  | {
      status: "dependency_error";
      action?: LookupActionId;
      entityType?: string;
      reason: "sml_timeout" | "sml_error" | "invalid_sml_response" | "sml_circuit_open";
      source?: string;
      tenantId?: string;
      assist?: LlmAssistInfo;
    };
