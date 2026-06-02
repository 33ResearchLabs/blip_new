/**
 * Slack alerting helper (core-api).
 *
 * Fire-and-forget POST to an incoming-webhook URL. Gated on the SLACK_WEBHOOK
 * env var exactly like ENABLE_ERROR_TRACKING gates safeLog: if no webhook is
 * configured this is a no-op, so the helper is safe to ship before a webhook
 * exists. It NEVER throws — alerting must not be able to break a caller.
 *
 * Used by the worker health checker to page on dead/stalled workers. Not wired
 * into the checker until the alerting phase (after SLACK_WEBHOOK is set and
 * staleness thresholds are tuned against real heartbeat data).
 */

export interface SlackAlertOpts {
  /** Optional Slack Block Kit blocks for richer formatting. */
  blocks?: unknown[];
  /** Override the channel the webhook posts to (if the webhook allows it). */
  channel?: string;
}

/**
 * Post a plain-text (optionally block-formatted) message to Slack.
 * Resolves to true if a request was sent and accepted, false otherwise
 * (no webhook configured, network error, or non-2xx). Always resolves.
 */
export async function postSlackAlert(
  text: string,
  opts: SlackAlertOpts = {},
): Promise<boolean> {
  const url = process.env.SLACK_WEBHOOK;
  if (!url) return false; // no webhook configured → no-op

  try {
    const body: Record<string, unknown> = { text };
    if (opts.blocks) body.blocks = opts.blocks;
    if (opts.channel) body.channel = opts.channel;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    // Alerting must never throw into the caller (e.g. the health checker loop).
    return false;
  }
}
