/**
 * Who performed a BFF admin action. UI may omit the field; Amplify sets REVIEWER_NAME.
 */
export function resolveActor(
  body: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string {
  for (const key of keys) {
    const raw = body?.[key];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  const fromEnv = (process.env.REVIEWER_NAME ?? '').trim();
  return fromEnv || 'admin-ui';
}
