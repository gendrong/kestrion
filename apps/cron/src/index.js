/**
 * kestrion-cron — a tiny Cloudflare Worker whose Cron Trigger starts the GitHub "ingest" workflow every 5 minutes.
 *
 * Why: GitHub's own `schedule:` trigger is best-effort (often delayed or skipped, especially on new repositories).
 * Cloudflare Cron Triggers fire on time. The scanning itself still runs on GitHub Actions; this Worker only sends
 * one API call (workflow_dispatch), well within the free plan's CPU limit.
 * API: https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
 *
 * Secret: GITHUB_TOKEN — fine-grained token limited to the kestrion repo with "Actions: Read and write".
 */

const REPO = 'gendrong/kestrion';
const WORKFLOW = 'ingest.yml';

/** @param {{ GITHUB_TOKEN?: string }} env */
async function dispatch(env) {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN secret is not set');
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kestrion-cron',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  // 204 = accepted. If a run is already in progress, the workflow's concurrency group queues this one.
  if (res.status !== 204) throw new Error(`GitHub dispatch failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

export default {
  /** Cron Trigger (see wrangler.jsonc). */
  async scheduled(_event, env) {
    await dispatch(env);
  },

  /** No public endpoint: workers_dev is off, this only answers if someone adds a route. */
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
