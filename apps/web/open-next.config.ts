import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * Cloudflare Workers adapter (same setup as the user's other Workers projects).
 * No incremental cache: every page that matters is force-dynamic (it reads the latest scans).
 */
export default defineCloudflareConfig();
