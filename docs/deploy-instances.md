# Deploy Instances

Do not store real passwords, tokens, or private keys here.

## Environments

| Environment | URL | Deploy path | Branch | Notes |
| --- | --- | --- | --- | --- |
| local | not assigned | `/Users/nontawatwongnuk/dev_bos/Enterprise Multi-Agent & Multi-Department Chatbot Platform` | main | use local `.env` only; do not commit secrets |
| production | not assigned | not assigned | main | deploy target not selected |

## Commands

```bash
# install
# npm install

# build
# npm run build

# health check
# curl -fsS http://localhost:<port>/health
```

## Release Checklist

- Worktree clean before deploy.
- Tests/build passed.
- Migrations reviewed and reversible.
- Required env vars/secrets present in deploy environment: LINE channel secrets/tokens, Redis URL, LLM provider keys, MCP endpoint/auth.
- Rollback path known.
- Smoke test defined.
