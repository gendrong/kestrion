# apps/cron: kestrion-cron

A tiny Cloudflare Worker with a Cron Trigger (`*/5 * * * *`) that starts the GitHub **ingest** workflow
(`workflow_dispatch`). It is a **backup**: each ingest run already starts the next one itself. If that chain
ever breaks, this Worker (or GitHub's own `schedule:`) starts it again. The workflow's `concurrency` group
prevents overlapping runs, so the backup never creates a second chain.

Note (2026-10-12): after deploying, Cloudflare showed the schedule as registered but the Worker never ran in
~50 minutes (also not with `* * * * *`). That's why the workflow chains itself instead of relying on this.

```
npm run deploy:cron                                                    # deploy (from the repo root)
npx wrangler secret put GITHUB_TOKEN --config apps/cron/wrangler.jsonc # set the token once
```

`GITHUB_TOKEN`: a **fine-grained** GitHub token, repository access *Only select repositories → kestrion*,
permission *Actions: Read and write*. Renew it before it expires (GitHub emails a reminder).
