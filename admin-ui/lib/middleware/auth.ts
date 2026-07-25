/** Shared auth helpers (cron scripts / Node). Edge auth lives in middleware.ts. */

export function bearerMatches(authorizationHeader: string | null | undefined, apiKey: string): boolean {
  if (!apiKey) return false;
  const header = authorizationHeader ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim();
  return Boolean(token && token === apiKey);
}

export function cronHeaderMatches(header: string | null | undefined, cronSecret: string): boolean {
  if (!cronSecret) return false;
  return header === cronSecret;
}
