# Vibe Code Project Template Usage

This repository was scaffolded from `/Users/nontawatwongnuk/dev_bos/template-vibe-code`.

## New Project Setup Checklist

1. Keep the original blueprint in the repo root as the product source.
2. Keep `AGENTS.md` short; put long-lived facts in `docs/`.
3. Update `docs/current-state.md`, `docs/architecture.md`, `docs/domain.md`, `docs/deploy-instances.md`, and `docs/testing.md` as implementation progresses.
4. Install Graphify if needed:

   ```bash
   uv tool install graphifyy==0.8.35
   ```

5. Build or refresh the local graph:

   ```bash
   bash scripts/graphify-update.sh
   bash scripts/graphify-query.sh "main architecture"
   ```

## Rules

- Keep `AGENTS.md` short and stable.
- Put long-lived facts in docs.
- Keep generated `graphify-out/` local-only.
- Never store real secrets in tracked files.
- Commit context/tooling changes separately from product code changes.
