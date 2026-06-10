# AGENTS.md — Enterprise Multi-Agent & Multi-Department Chatbot Platform

Use this as the short Codex index for this repository. Keep it under 10KB; put details in `docs/`.

## Project Shape

- Product: enterprise multi-agent chatbot platform for 4 department-specific LINE OAs with MCP/ERP access control.
- Audience: internal sales, purchasing, accounting, and mechanic teams using LINE for daily operations.
- Core workflow: LINE webhook -> signature/dedup/mention classifier -> BullMQ job -> AI/MCP worker -> ERP MCP tool call -> LINE reply.
- Runtime type: TypeScript Node.js service with Fastify webhooks, Redis/BullMQ workers, and stateless horizontal scaling.
- Critical integrations: LINE Messaging API, Redis, LLM providers, MCP ERP server, Cloudflare/ALB, internal ERP/read replica.

## Stack

- Backend: TypeScript, Fastify, BullMQ workers.
- Frontend: none required initially; admin/ops UI is optional later.
- Database: Redis for queues/dedup/session cache; ERP data via MCP server/read replica.
- Deploy: containerized service behind Cloudflare/ALB.
- AI/model usage: provider-swappable OpenAI/Claude adapters with department-scoped system prompts and tool allowlists.

## Read First

- Original blueprint: `blueprint Enterprise Multi-Agent & Multi-Department Chatbot Platform.md`
- Current state: `docs/current-state.md`
- Architecture: `docs/architecture.md`
- Domain model: `docs/domain.md`
- Deploy/runtime: `docs/deploy-instances.md`
- Testing: `docs/testing.md`
- ADRs: `docs/adr/`

Read only the files needed for the current task.

## Non-Negotiable Rules

- Never commit real passwords, API keys, tokens, private keys, customer exports, or production DB dumps.
- Keep runtime secrets in local/deploy secret sources, not tracked docs.
- Preserve user data and current production behavior unless the task explicitly changes behavior.
- For external APIs, design idempotency, retries, rate-limit handling, partial failure behavior, and audit logs.
- For migrations, define rollback, backup, validation, and production impact.
- For UI, handle empty/loading/error/disabled states clearly.

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

Define project-specific commands in `docs/testing.md`. Typical gates:

```bash
# Backend
# cd backend && go test ./...

# Frontend
# cd frontend && npm run build
```

## Default Skill Routing

- Product / strategy / PRD / roadmap: `shared-pm-skills`
- Dev / review / refactor / migration / release: `production-engineering`
- UI polish: `impeccable`
- Animation: GSAP skills
