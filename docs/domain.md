# Domain Model

## Product Vocabulary

| Term | Meaning | Source of truth |
| --- | --- | --- |
| Department OA | A LINE Official Account dedicated to one department. | LINE destination mapping config |
| Department ID | Stable ID such as `sales`, `purchasing`, `accounting`, `mechanic`. | `src/config/departments.ts` planned |
| Session key | Isolated memory key, e.g. `session:dept:{deptId}:group:{groupId}:user:{userId}`. | memory service |
| MCP tool allowlist | Set of ERP tools a department can call. | department policy config |
| Mention gate | Rule that group conversations require @mention before the bot responds. | webhook classifier |
| Idempotency lock | Redis atomic lock for duplicate LINE events/messages. | dedup middleware |

## Business Rules

- Rule: only the department inferred from LINE `destination` can select system prompt, channel token, memory namespace, and MCP tools.
- Rule: group messages must mention the bot before entering the queue.
- Rule: mechanics cannot access accounting/sales finance tools; blocked requests must never call ERP.
- Rule: webhook should return `HTTP 200 OK` quickly after validation/enqueue to avoid LINE timeout.
- Exception: admin/system maintenance tools require separate explicit policy and audit trail.
- Validation: destination, signature, event ID, user/group ID, department policy, and tool allowlist.
- Audit/log requirement: log allowed/blocked tool decisions with request/job IDs, but never log channel secrets, provider keys, or raw sensitive ERP payloads.

## User Roles

| Role | Can do | Cannot do |
| --- | --- | --- |
| Sales | Check stock, price, and alternatives. | Read accounting reports or mechanic-only job details unless explicitly allowed. |
| Purchasing | Check PO status, supplier pricing, and low-stock alerts. | Read sales financial summaries unless explicitly allowed. |
| Accounting | Check sales reports, invoices, and unpaid bills. | Access mechanic repair manuals unless explicitly allowed. |
| Mechanic | Query repair manuals, open job cards, and view mechanic schedules. | Access financial reports or sales totals. |
| Admin/Ops | Configure department mapping, secrets, and tool policies. | Store real secrets in tracked files or expose raw tokens in UI/logs. |

## Integrations

| Integration | Purpose | Credentials location | Failure behavior |
| --- | --- | --- | --- |
| LINE Messaging API | Receive webhooks and send replies/push messages per department OA. | Local/deploy secret source | Validate signature; fast-fail invalid requests; retry transient reply failures. |
| Redis / BullMQ | Deduplication, async jobs, sessions, and cache. | Local/deploy secret source | Fail closed for dedup/session writes; expose queue health. |
| LLM providers | Generate responses and tool-call plans. | Local/deploy secret source | Retry rate-limited/transient failures; return safe degraded response on outage. |
| ERP MCP server | Controlled ERP data access through approved tools. | Local/deploy secret source | Enforce allowlist before call; circuit-break on repeated failures. |
