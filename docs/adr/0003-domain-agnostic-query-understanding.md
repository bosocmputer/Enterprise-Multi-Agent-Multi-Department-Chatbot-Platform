# ADR: Domain-Agnostic Query Understanding Layer

## Status

Accepted.

## Context

The chatbot started from a concrete stock/price lookup use case, but the product should support different businesses without source-code changes for each domain. Product names, brand nicknames, local phrasing, and examples vary widely across auto parts, construction materials, pharmacy, stationery, and other retail/wholesale domains.

Hardcoding terms such as brand aliases or product categories in TypeScript would make the system brittle, hard to validate, and expensive to reuse. Adding an LLM directly to the hot path would improve flexibility but would also add latency, cost, and hallucination risk.

## Options

- Hardcode more parser terms in source: fastest short-term, but does not scale across businesses and creates hidden behavior changes during deploy.
- LLM-first parser for every message: flexible, but slower, more expensive, and harder to prove safe.
- Domain-agnostic query understanding with tenant Business Profiles: keeps fast deterministic parsing where possible while moving business vocabulary into data/config and using LLM only for ambiguity.

## Scale And Failure Modes

- At 10x tenants, hardcoded terms become unreviewable. Business Profile validation lets each tenant change vocabulary independently.
- If Business Profile is invalid or missing, the affected tenant should fail fast at startup or fall back to clarification rather than guessing.
- If LLM parsing is slow or unavailable, the bot should skip it and ask a concise clarification.
- If alias expansion is too broad, no-match may become multi-match. The bot must ask the user to choose instead of selecting automatically.

## Hidden Costs

- Need schema validation and a rollout process for Business Profile changes.
- Need tests/evals for tenant examples and ambiguous language.
- Need observability for parser source, confidence, LLM latency, and no-match/multi-match rates.
- Need a future admin or config workflow if non-developers will maintain aliases/examples.

## Decision

Introduce a Domain-Agnostic Query Understanding Layer:

- Source code defines generic schemas, safety rules, and parser contracts.
- Tenant Business Profile provides intent phrases, examples, aliases, locale, reply style, and data-source labels.
- Deterministic parser uses Business Profile first for the hot path.
- Session context can infer follow-up intent when the user omits stock/price wording.
- Optional LLM parser is a slow-path helper that returns schema-validated JSON only.
- Lookup facts still come only from SML MCP read-only tools.

## Consequences

- Positive: the platform can support multiple business domains without code changes for product vocabulary.
- Positive: exact/common queries remain fast and cheap.
- Positive: LLM output is constrained to query understanding and cannot fabricate stock/price.
- Negative: we need profile schema, validation, cache invalidation, and regression tests before broad tenant rollout.
- Negative: initial implementation is slightly more complex than adding ad hoc parser terms.

## Regret Check

If the product becomes a single-tenant custom bot, this may feel heavier than necessary. That tradeoff is acceptable because the stated blueprint goal is a reusable platform, and the Business Profile boundary is the cleanest way to avoid hardcoded domain knowledge while preserving speed and safety.
