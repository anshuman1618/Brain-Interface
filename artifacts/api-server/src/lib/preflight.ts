import { encryptionKey } from "./blob-store";

/**
 * Check the whole production configuration at once, before anything starts.
 *
 * Written after a deployment burned three cycles discovering three missing
 * variables one at a time: the encryption key threw, and only once that was set
 * did the database guard get a chance to throw, and so on. Each round trip is a
 * full build on a managed host.
 *
 * Every required variable is checked here and reported together, so one deploy
 * tells you everything that is wrong. The individual guards stay where they are
 * — this does not replace them, it just gets there first with a better message.
 *
 * Only runs in production. Outside it, every one of these has a working
 * fallback, which is what makes preview mode possible.
 */

type Problem = { key: string; why: string; fix: string };

/** Warnings do not stop the process; they are printed and the boot continues. */
type Warning = { key: string; why: string };

export type Preflight = { problems: Problem[]; warnings: Warning[] };

export function inspectProductionConfig(): Preflight {
  const problems: Problem[] = [];
  const warnings: Warning[] = [];

  if (process.env["NODE_ENV"] !== "production") return { problems, warnings };

  // Encryption. `encryptionKey()` throws on a malformed value rather than
  // returning null, so a bad key is reported as its own distinct problem.
  try {
    if (encryptionKey() === null) {
      problems.push({
        key: "FILE_ENCRYPTION_KEY",
        why: "uploaded case files are privileged and must not be written in the clear",
        fix: "openssl rand -hex 32   (store it somewhere other than the disk it protects)",
      });
    }
  } catch (err) {
    problems.push({
      key: "FILE_ENCRYPTION_KEY",
      why: err instanceof Error ? err.message : "is not a valid key",
      fix: "openssl rand -hex 32",
    });
  }

  if (!process.env["DATABASE_URL"]?.trim()) {
    problems.push({
      key: "DATABASE_URL",
      why: "there is no database to serve from, and the local preview database is refused in production",
      fix: "attach a Postgres instance; the render.yaml blueprint wires this automatically",
    });
  }

  if (!process.env["CLERK_SECRET_KEY"]?.trim()) {
    problems.push({
      key: "CLERK_SECRET_KEY",
      why: "no request could be authenticated",
      fix: "Clerk dashboard -> API keys",
    });
  }

  if (!process.env["CLERK_PUBLISHABLE_KEY"]?.trim()) {
    problems.push({
      key: "CLERK_PUBLISHABLE_KEY",
      why: "no request could be authenticated",
      fix: "Clerk dashboard -> API keys",
    });
  }

  // Not fatal, but the consequences are invisible until they bite: every
  // restart signs everyone out of their workspace, and two replicas reject
  // each other's tokens.
  const secret = process.env["WORKSPACE_TOKEN_SECRET"]?.trim();
  if (!secret) {
    warnings.push({
      key: "WORKSPACE_TOKEN_SECRET",
      why: "unset — a random per-process secret is used, so every restart signs users out of their workspace",
    });
  } else if (secret.length < 16) {
    warnings.push({
      key: "WORKSPACE_TOKEN_SECRET",
      why: "shorter than 16 characters, so it is IGNORED and the random fallback is used instead",
    });
  }

  // Not fatal — the service runs perfectly well without it, which is exactly
  // why this needs saying out loud. Unset, every fault is logged and nothing is
  // forwarded, so the first report of an outage is a chamber's phone call. That
  // is a state you can sit in for weeks without noticing, because the symptom
  // of "no alerting" is silence and so is the symptom of "no faults".
  const errorWebhook = process.env["ERROR_WEBHOOK_URL"]?.trim();
  if (!errorWebhook) {
    warnings.push({
      key: "ERROR_WEBHOOK_URL",
      why: "unset — faults are logged and forwarded nowhere, so you will hear about them from a customer. See DEPLOYMENT.md §4d",
    });
  } else if (!/^https:\/\//i.test(errorWebhook)) {
    // Silently ignored by the reporter otherwise, which looks identical to
    // working right up until the first incident.
    warnings.push({
      key: "ERROR_WEBHOOK_URL",
      why: "is not https, so the error reporter IGNORES it and forwards nothing. Verify with `pnpm --filter @workspace/api-server run check-error-webhook`",
    });
  }

  return { problems, warnings };
}

/**
 * Report everything wrong, then stop. Throws once, listing every problem.
 *
 * The message is written to be read in a deploy log by someone who has not seen
 * this codebase: what is missing, why it matters, and where the value comes
 * from — for all of them at once.
 */
export function assertProductionConfig(warn: (msg: string) => void): void {
  const { problems, warnings } = inspectProductionConfig();

  for (const w of warnings) warn(`${w.key}: ${w.why}`);

  if (problems.length === 0) return;

  const lines = problems.map(
    (p, i) => `  ${i + 1}. ${p.key}\n     ${p.why}\n     set it: ${p.fix}`,
  );
  throw new Error(
    `Refusing to start: ${problems.length} required production ` +
      `${problems.length === 1 ? "setting is" : "settings are"} missing or invalid.\n\n` +
      `${lines.join("\n\n")}\n\n` +
      `All of these are configured for you by the render.yaml blueprint — a service ` +
      `created before it exists will not have them. See DEPLOYMENT.md section 10.`,
  );
}
