export type LookupIntent = "search_product" | "stock" | "price" | "stock_price";

export type ParseOutcome =
  | {
      status: "parsed";
      intent: LookupIntent;
      keyword: string;
      isExactCode: boolean;
      searchTerms: string[];
    }
  | {
      status: "unsupported";
      reason: string;
    };

export interface ProductCandidate {
  code: string;
  name: string;
  unit?: string;
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
    }
  | {
      status: "no_match";
      intent: LookupIntent;
      keyword: string;
    }
  | {
      status: "multiple_matches";
      intent: LookupIntent;
      keyword: string;
      candidates: ProductCandidate[];
    }
  | {
      status: "unsupported";
      reason: string;
    }
  | {
      status: "dependency_error";
      reason: "sml_timeout" | "sml_error" | "invalid_sml_response" | "sml_circuit_open";
    };
