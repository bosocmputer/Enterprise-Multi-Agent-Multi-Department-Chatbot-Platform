# Architecture

## System Overview

- Product boundary: central chatbot runtime that receives messages from 4 department-specific LINE OAs, classifies department/context, and safely answers through LLM + MCP tools.
- Main components: Fastify webhook service, LINE signature/dedup middleware, mention classifier, BullMQ queue, AI/MCP worker pool, provider-swappable LLM adapters, department memory service.
- External systems: LINE Messaging API, OpenAI/Claude or compatible LLM providers, internal ERP MCP server, Cloudflare/ALB.
- Data stores: Redis for idempotency locks, BullMQ jobs, session memory, and semantic/vector cache; ERP data remains behind MCP/read replica.

## Component Map

| Component | Responsibility | Key files |
| --- | --- | --- |
| Webhook backend | Validate LINE requests, map destination to department, filter group @mentions, enqueue jobs fast. | planned `src/server.ts`, `src/controllers/webhookController.ts`, `src/middleware/*` |
| Worker/jobs | Process queued messages, build department-scoped prompts, call LLM, call allowed MCP tools, reply through LINE. | planned `src/queues/messageWorker.ts`, `src/ai/*`, `src/services/*` |
| Policy/RBAC | Enforce department tool allowlists and block cross-department data access. | planned `src/config/departments.ts`, `src/services/toolPolicy.ts` |
| Database/cache | Store dedup locks, queue state, session memory, and cache. | planned Redis/BullMQ config |
| Frontend | Not in MVP unless an admin/ops console is added later. | none |

## Data Flow

1. Input: LINE sends HTTPS webhook events from one of 4 department OAs.
2. Processing: Fastify verifies signature, deduplicates event/message ID, resolves department from bot destination, and checks group @mention rules.
3. Storage: webhook stores only queue/session metadata needed for async processing; secrets stay in local/deploy secret sources.
4. Output: worker calls LLM and allowed MCP tools, then replies/pushes through the correct LINE channel token.
5. Audit/observability: log request ID, LINE destination, department, user/group/session key, allowed/blocked tool calls, worker latency, and external failure status without logging secrets or sensitive payloads.

## Failure Boundaries

- Retryable failures: Redis transient errors, LLM 429/5xx, MCP 5xx/timeouts, LINE push transient failures.
- Non-retryable failures: invalid LINE signature, unknown destination, blocked tool by department policy, malformed message payload.
- Partial success: LLM succeeds but MCP fails, MCP succeeds but LINE reply fails, or some tool calls are blocked while others are allowed.
- Idempotency key: LINE event/message ID plus department destination; Redis atomic lock prevents duplicate processing.
- Rollback path: disable worker consumers, drain/park queues, revert latest deploy image, and keep webhook fast-ack behavior available.
