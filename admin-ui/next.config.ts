import type { NextConfig } from 'next';

/**
 * Amplify Hosting (WEB_COMPUTE) loads env from `.env.production` written in amplify.yml.
 * Do NOT use `env: { KEY: process.env.KEY || '' }` — empty fallbacks bake blanks into the
 * Edge/server bundles when Amplify vars are missing at config-eval time.
 * Do NOT use `output: 'standalone'` — Amplify's Next.js SSR adapter expects normal `.next`.
 */
const nextConfig: NextConfig = {
  serverExternalPackages: ['pg', 'openai'],
};

export default nextConfig;
