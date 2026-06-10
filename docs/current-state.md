# Current State

Last updated: 2026-06-10

## Latest Handoff

- Current production/dev state: blueprint-only project scaffolded from `template-vibe-code`; no application runtime has been implemented yet.
- Last completed change: added Codex/Graphify context template files and converted the supplied blueprint into starter docs.
- Current branch/release: local `main`; no production release yet.
- Known broken or risky areas: implementation choices still need confirmation before code generation begins.

## Runtime Snapshot

- Local path: `/Users/nontawatwongnuk/dev_bos/Enterprise Multi-Agent & Multi-Department Chatbot Platform`
- Server/deploy path: not assigned.
- Public URL: not assigned.
- Ports: not assigned.
- Containers/services: planned Fastify webhook service, Redis/BullMQ, AI/MCP workers, ERP MCP server connection.

## Active Work

- Goal: build an enterprise chatbot platform for 4 LINE OAs with department-isolated memory and MCP tool permissions.
- In progress: project context setup.
- Blocked: no blocker; app stack and first MVP scope need to be selected before coding.
- Next safest step: create the initial TypeScript service skeleton, config model, webhook handler, queue worker, and department policy tests.

## Known Gaps

- Testing: no test harness yet.
- Security: LINE signature verification, destination mapping, RBAC, MCP tool filtering, and secret storage are design-critical.
- Observability: need request/job IDs, per-department metrics, queue latency, LLM/ERP failure logs, and audit logs.
- UX: LINE reply/error states and future admin operations UI are not implemented.
- Documentation: update docs after the first code skeleton is created.
