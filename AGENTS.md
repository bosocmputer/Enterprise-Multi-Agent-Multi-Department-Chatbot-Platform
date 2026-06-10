# AGENTS.md — Domain-Agnostic Inventory Lookup Chatbot Platform

Use this as the short Codex index for this repository. Keep it under 10KB; put details in `docs/`.

## Project Shape

- Product: speed-first read-only chatbot for staff to ask stock and price questions across business domains.
- Audience: internal store staff using Telegram for fast pilot testing and LINE for real operations.
- Core workflow: chat webhook -> channel verification/dedup/group gate -> normalized query -> tenant Business Profile -> query understanding/cache -> SML MCP read-only lookup -> channel reply.
- Runtime type: TypeScript Node.js service with Fastify webhooks, Redis cache/session/dedup, optional BullMQ slow jobs, and stateless horizontal scaling.
- Critical integrations: Telegram Bot API, LINE Messaging API, Redis, SML MCP HTTP `/call`, optional LLM parser for ambiguous queries.

## Stack

- Backend: TypeScript, Fastify.
- Channels: Telegram first for pilot/debug speed; LINE next for production staff groups and 1-1 chats.
- Database/cache: Redis for dedup locks, rate limits, short-lived stock/price cache, and last-query session context.
- Queue: BullMQ only for slow/background work, not every lookup hot path.
- ERP/source of truth: SML MCP read-only tools via HTTP `/call`.
- AI/model usage: optional provider-swappable parser for ambiguous language; never required for exact stock/price hot path, and never allowed to answer stock/price facts directly.
- Frontend: none required initially; admin/ops UI is optional later.

## Read First

- Current blueprint: `blueprint Enterprise Multi-Agent & Multi-Department Chatbot Platform.md`
- Current state: `docs/current-state.md`
- Architecture: `docs/architecture.md`
- Data flow: `docs/data-flow.md`
- Domain model: `docs/domain.md`
- SML MCP integration: `docs/sml-mcp-integration.md`
- Tech stack: `docs/tech-stack.md`
- Deploy/runtime: `docs/deploy-instances.md`
- Testing: `docs/testing.md`
- Operations: `docs/operations.md`
- ADRs: `docs/adr/`

Read only the files needed for the current task.

## Non-Negotiable Rules

- Do not call write/create endpoints such as `create_sale_reserve` unless the user explicitly approves and a sandbox/test target is confirmed.
- Never commit real passwords, API keys, tokens, private keys, customer exports, or production DB dumps.
- Keep runtime secrets in local/deploy secret sources, not tracked docs.
- Preserve user data and current production behavior unless the task explicitly changes behavior.
- For external APIs, design idempotency, retries, rate-limit handling, partial failure behavior, and audit logs.
- For stock/price answers, prefer deterministic lookup and explicit uncertainty over hallucinated AI answers.
- Do not hardcode tenant-specific product keywords, brand aliases, or business examples in source code; put them in Business Profile or catalog-derived alias/index data.
- For UI/chat replies, handle no match, multiple matches, timeout, disabled channel, and unsupported message states clearly.

## Graphify Auto-Lite

Use Graphify as a context map for cross-subsystem work, not as source of truth.

Use Graphify before broad raw searches when work spans multiple modules, services, routes, schemas, infrastructure, or docs.

Skip Graphify for small single-file edits, exact symbol lookups, logs, or test failure triage where `rg` and source reads are faster.

Commands:

```bash
bash scripts/graphify-update.sh
bash scripts/graphify-query.sh "question or symbol"
bash scripts/graphify-preflight.sh
```

Rules:

- Always open source files before editing.
- If Graphify disagrees with code or docs, code/docs win.
- `graphify-out/` is local-only and must remain untracked.
- Update Graphify manually after flow or architecture changes.
- Do not install Graphify hooks until the manual workflow has proven stable.

## Validation

Define project-specific commands in `docs/testing.md`. Initial expected gates:

```bash
npm test
npm run build
curl -fsS http://localhost:<port>/health
```

## Default Skill Routing

- Product / strategy / PRD / roadmap: `shared-pm-skills`
- Dev / review / refactor / migration / release: `production-engineering`
- UI polish: `impeccable`
- Animation: GSAP skills
