import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Cloudflare Workers adapter config. Defaults are intentional: no R2 bucket
// is bound, so there is no incremental cache — every route renders dynamically,
// which matches this app (all routes are dynamic; documents are no-store by
// design, see next.config.ts headers()). Add the R2 incremental cache override
// here if ISR/SSG caching is ever needed.
export default defineCloudflareConfig();
