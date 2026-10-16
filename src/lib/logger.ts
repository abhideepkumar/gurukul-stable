// Central logger: console in dev, extensible to Sentry/PostHog later.
// Keeps prod console clean and gives one place to add tracking.
type Ctx = Record<string, unknown>;

function fmt(level: string, msg: string, ctx?: Ctx) {
  const base = `[${level}] ${msg}`;
  return ctx ? `${base} ${JSON.stringify(ctx)}` : base;
}

export const logger = {
  warn(msg: string, ctx?: Ctx) {
    if (import.meta.env.DEV) console.warn(fmt('warn', msg, ctx));
  },
  error(msg: string, err?: unknown, ctx?: Ctx) {
    const detail = err instanceof Error ? err.message : String(err ?? '');
    if (import.meta.env.DEV) {
      console.error(fmt('error', msg, ctx), detail || '', err ?? '');
    }
    // TODO: Sentry.captureException(err, { extra: ctx }) — tracked in PENDING_FEATURES.md
  },
};
