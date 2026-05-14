// GitHub App authentication helpers.
//
// Two layers handled here:
//   1. Loading + validating env-var config (synchronous, easy to test).
//   2. Wrapping Octokit's App class to mint installation-scoped Octokit
//      clients (delegates JWT signing + token caching to Octokit).
//
// Octokit's App.getInstallationOctokit(id) handles the whole flow:
//   - Signs RS256 JWT with our app private key (10-min TTL)
//   - POSTs /app/installations/{id}/access_tokens with the JWT
//   - Caches the resulting installation token (1-hour TTL) per id
//   - Re-mints near expiry transparently
//
// We don't reimplement any of that — we just give callers an
// Octokit instance that's already authenticated for one installation.
//
// Design: eval/strategy/github-app-skeleton-2026-05.md.

import { App } from "octokit";
import type { Octokit } from "octokit";

export interface GitHubAppConfig {
  appId: number;
  /** PEM-decoded private key (base64-decoded from env). */
  privateKey: string;
  webhookSecret: string;
  /** Optional — only used by the install-redirect flow (Commit 8+). */
  clientId: string | undefined;
}

/**
 * Load + validate GitHub App config from environment variables.
 *
 * Throws a descriptive Error if anything is missing or malformed.
 * Caller handles the throw (typically: return 503 from a route).
 */
export function loadGitHubAppConfig(): GitHubAppConfig {
  const appIdRaw = process.env.GITHUB_APP_ID;
  const privateKeyB64 = process.env.GITHUB_APP_PRIVATE_KEY;
  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  const clientId = process.env.GITHUB_APP_CLIENT_ID || undefined;

  const missing: string[] = [];
  if (!appIdRaw) missing.push("GITHUB_APP_ID");
  if (!privateKeyB64) missing.push("GITHUB_APP_PRIVATE_KEY");
  if (!webhookSecret) missing.push("GITHUB_APP_WEBHOOK_SECRET");
  if (missing.length > 0) {
    throw new Error(
      `GitHub App is not configured. Missing env vars: ${missing.join(", ")}`,
    );
  }

  const appId = Number.parseInt(appIdRaw as string, 10);
  if (!Number.isFinite(appId) || appId <= 0) {
    throw new Error(
      `GITHUB_APP_ID must be a positive integer, got ${JSON.stringify(appIdRaw)}`,
    );
  }

  let privateKey: string;
  try {
    privateKey = Buffer.from(privateKeyB64 as string, "base64").toString(
      "utf8",
    );
  } catch (err) {
    throw new Error(
      `Failed to base64-decode GITHUB_APP_PRIVATE_KEY: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // Sanity check: must look like a PEM-encoded private key. Matches
  // both PKCS#1 ("RSA PRIVATE KEY") and PKCS#8 ("PRIVATE KEY") headers.
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKey)) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY does not appear to be a PEM-encoded private key after base64 decode (missing '-----BEGIN ... PRIVATE KEY-----' header). Did you remember to base64-encode the .pem file?",
    );
  }

  return {
    appId,
    privateKey,
    webhookSecret: webhookSecret as string,
    clientId,
  };
}

/**
 * Cheap presence check — are all required env vars set?
 *
 * For routes that want to fast-fail with 503 without doing full
 * validation (which throws). Doesn't decode or validate format.
 */
export function isGitHubAppConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_PRIVATE_KEY &&
      process.env.GITHUB_APP_WEBHOOK_SECRET,
  );
}

let appInstance: App | null = null;

/**
 * Get the singleton App instance.
 *
 * Lazy-init so that importing this module doesn't throw at build time
 * when env isn't configured. First call validates config; subsequent
 * calls reuse the cached instance (which holds Octokit's installation-
 * token cache internally — sharing it is the whole point).
 */
export function getApp(): App {
  if (appInstance) return appInstance;
  const config = loadGitHubAppConfig();
  appInstance = new App({
    appId: config.appId,
    privateKey: config.privateKey,
    webhooks: { secret: config.webhookSecret },
  });
  return appInstance;
}

/**
 * Get an Octokit client authenticated for one specific installation.
 *
 * Octokit handles JWT + installation-token minting + caching
 * internally. Callers just use the returned octokit normally:
 *
 *   const oct = await getInstallationClient(123);
 *   await oct.rest.issues.createComment({ ... });
 *
 * Throws if config is missing (throws synchronously via getApp) or
 * if GitHub rejects the installation_id (returns 404 asynchronously).
 */
export async function getInstallationClient(
  installationId: number,
): Promise<Octokit> {
  if (!Number.isFinite(installationId) || installationId <= 0) {
    throw new Error(
      `installationId must be a positive integer, got ${installationId}`,
    );
  }
  const app = getApp();
  return await app.getInstallationOctokit(installationId);
}

/**
 * Test-only: clear the cached App instance so tests can re-init with
 * different env vars. Never call from production code.
 */
export function _resetAppForTesting(): void {
  appInstance = null;
}
