# PhoenixCore: safe deployment to Bot-Hosting.net

Source: `OasisWorks-lab/convergence-codex`; deployment target: the existing **PhoenixCore** Node.js service for **Convergence: Phoenix Rising only**.

GitHub Pages publishes the public Codex website. The **Node backend and Discord gateway** are a separate deployment. Merging a pull request does not guarantee that the running bot has pulled the new code.

## First production rollout

1. Open the existing PhoenixCore deployment in Bot-Hosting. **Create a downloadable database/volume backup** using its Backups panel, and verify that the database file or PostgreSQL instance is covered. Record the last known-good commit SHA.
2. Verify the linked GitHub repo is `OasisWorks-lab/convergence-codex` on `main`. Do not delete/recreate the deployment or wipe the container: that may remove its persistent SQLite database and other state.
3. Open the deployment's Environment tab and verify Discord credentials, `SQLITE_FILE` or `DATABASE_URL`, the OAuth redirect and `SERVICE_ORIGIN`. Keep tokens and database values private; never paste them into repository files.
4. In Bot-Hosting Developer/API, create a scoped API key with **`deployments:write`** for the PhoenixCore deployment. GitHub will use it only to invoke the supported `POST /deployments/:id/sync` endpoint. Do not grant shell, SFTP, files-write or environment-read scopes to the deployment workflow.
5. In **GitHub repository Settings → Secrets and variables → Actions**, add two **repository secrets**: `BOT_HOSTING_API_KEY` (the API key) and `BOT_HOSTING_DEPLOYMENT_ID` (the exact deployment ID). Never add these strings to a commit.
6. In the repository's Actions **variables**, set `PHOENIXCORE_DEPLOY_ENABLED=true` only **after** the backup and environment checks. Optionally set `PHOENIXCORE_HEALTH_URL` to the deployment's current HTTPS `/health` endpoint. This flag defaults to absent/disabled so no new workflow can silently deploy by itself.
7. Trigger **Actions → PhoenixCore production deployment → Run workflow** for the first supervised sync. The workflow pulls `main`, restarts the Node service and checks `/health`. Inspect the Bot-Hosting console, confirm slash command registration and gateway connectivity, and test one RP post before enabling unattended rollouts.
8. Once enabled, each successful `PhoenixCore checks` **push run on `main`** triggers the deployment workflow. PR checks and other repositories do not trigger a live push. To stop auto-deployment, set `PHOENIXCORE_DEPLOY_ENABLED=false` (or remove the variable).

**Rollback:** If a release fails, disable auto-deployment, restore the reviewed backup where a data migration is involved, and deliberately redeploy the known-good commit/branch. Do not assume rolling back JavaScript alone reverses a persisted schema migration. A successful `/health` is only a baseline check; inspect Discord interactions, bot logs and database persistence after each migration.

This workflow is intentionally opt-in: the API key is never supplied in chat or the public repository. The existing live bot is not modified merely by merging this document/workflow.

Official provider contract: <https://bot-hosting.net/api> (`deployments.sync`).
