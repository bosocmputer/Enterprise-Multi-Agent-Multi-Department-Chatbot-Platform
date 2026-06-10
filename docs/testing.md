# Testing

## Required Gates

```bash
# Backend
# npm test

# Frontend
# not applicable until an admin UI exists

# Integration / smoke
# npm run build
# curl -fsS http://localhost:<port>/health
```

## Acceptance Scenarios

- Happy path: department LINE webhook enqueues a job and replies through the correct LINE channel.
- Empty state: unsupported text or missing ERP record returns a helpful department-specific response.
- Permission failure: mechanic asks for financial report and the system blocks before any ERP MCP call.
- External API timeout: LLM or MCP timeout returns safe fallback and records retry/error metrics.
- Duplicate/retry/idempotency: same LINE event/message ID is processed once despite retries.
- Migration rollback: no migrations yet; define before adding persistent storage beyond Redis.

## Manual QA

- Browser: not applicable until admin UI exists.
- Admin flow: not applicable until admin UI exists.
- LINE group flow: bot ignores normal group chatter and responds only to @mention.
- LINE 1-1 flow: department-specific bot remembers prior context within isolated session.
- Production smoke: verify health endpoint, Redis connectivity, queue worker active state, LINE signature validation, and one mocked MCP policy decision.
