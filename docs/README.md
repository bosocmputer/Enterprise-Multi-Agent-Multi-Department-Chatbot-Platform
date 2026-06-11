# Domain-Agnostic Inventory Lookup Chatbot Docs Index

Use docs as on-demand context. Keep `AGENTS.md` short and point here for details.

## Start Here

- `../blueprint Enterprise Multi-Agent & Multi-Department Chatbot Platform.md` — current product and architecture blueprint
- `system-design-th.md` — Thai system design explainer for team/staff pilot briefings
- `current-state.md` — latest handoff, runtime state, known gaps
- `architecture.md` — system components, boundaries, and failure design
- `data-flow.md` — hot path, slow path, channel path, and error flow
- `domain.md` — product concepts, vocabulary, and business rules
- `sml-mcp-integration.md` — SML MCP read-only tool contract and safety rules
- `tech-stack.md` — chosen libraries, repos, and rationale
- `deploy-instances.md` — environments, runtime config, and release checklist
- `testing.md` — test gates, acceptance scenarios, and manual QA
- `operations.md` — observability, alerts, and incident runbooks
- `adr/` — architecture decisions

## Context Rules

- Do not store real secrets in docs.
- Prefer stable facts over chat/session transcripts.
- Move old handoff notes into dated sections inside `current-state.md`.
- Keep docs accurate after behavior, deploy, integration, or schema changes.
- Treat SML as source of truth for stock and price; do not document guessed business values.
- Keep tenant vocabulary, aliases, and examples in Business Profile docs/config, not source-code behavior.
