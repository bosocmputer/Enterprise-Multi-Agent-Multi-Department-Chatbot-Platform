# ADR: Multi-Tenant LINE OA Webhooks With Async Workers

## Status

Accepted as starting architecture from the supplied blueprint.

## Context

The platform must support 4 LINE OAs for sales, purchasing, accounting, and mechanics while keeping context memory, MCP tool access, and LINE credentials isolated per department. LINE webhook requests must be acknowledged quickly, and LLM/ERP work may exceed the webhook timeout window.

## Options

- One service per department: strongest isolation, but duplicates infrastructure and operational work.
- One shared service with department policy isolation: cheaper and easier to scale, but requires careful destination mapping, RBAC, and audit logs.
- One shared bot without department isolation: simplest, but not acceptable for ERP/security boundaries.

## Decision

Use one shared Fastify webhook service with department resolution from LINE destination, Redis idempotency locks, BullMQ async jobs, department-scoped prompts, isolated session keys, and MCP tool allowlists enforced before any ERP call.

## Consequences

- Positive: efficient infrastructure, consistent observability, and reusable AI/MCP worker logic.
- Negative: policy bugs can affect multiple departments, so tests and audit logging are mandatory.
- Follow-up: implement destination mapping tests, tool-policy tests, webhook signature tests, and duplicate-event tests before connecting production credentials.

## Regret Check

At larger scale, noisy departments may starve others unless queues are partitioned or prioritized by department. Watch queue latency, worker saturation, blocked policy counts, and LLM/ERP error rates from the first MVP.
