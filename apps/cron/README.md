# apps/cron: kestrion-cron

A tiny Cloudflare Worker with a Cron Trigger (`*/5 * * * *`) that starts the GitHub **ingest** workflow
(`workflow_dispatch`). GitHub's own `schedule:` is best-effort and often late; Cloudflare's cron is on time.
The scanning still happens on GitHub Actions. The workflow's `concurrency` group prevents overlapping runs.

```
npm run deploy:cron                                                    # deploy (from the repo root)
npx wrangler secret put GITHUB_TOKEN --config apps/cron/wrangler.jsonc # set the token once
```

`GITHUB_TOKEN`: a **fine-grained** GitHub token, repository access *Only select repositories → kestrion*,
permission *Actions: Read and write*. Renew it before it expires (GitHub emails a reminder).
