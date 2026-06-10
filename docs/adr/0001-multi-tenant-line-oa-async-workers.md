# ADR: Multi-Tenant LINE OA Webhooks With Async Workers

## Status

Superseded by `0002-read-only-parts-lookup-chatbot.md`.

## Context

The original supplied blueprint described a platform for 4 LINE OAs for sales, purchasing, accounting, and mechanics while keeping context memory, MCP tool access, and LINE credentials isolated per department. LINE webhook requests would be acknowledged quickly, and LLM/ERP work would run in async workers.

## Original Decision

Use one shared Fastify webhook service with department resolution from LINE destination, Redis idempotency locks, BullMQ async jobs, department-scoped prompts, isolated session keys, and MCP tool allowlists enforced before any ERP call.

## Why Superseded

The real first customer use case is narrower and more urgent: auto parts store staff need fast stock and price lookup from LINE groups/private chats, with Telegram added for easier testing. Speed and read-only SML lookup are more important than multi-department agent routing.

The multi-tenant architecture may return later if the product expands, but it is not the MVP baseline.
