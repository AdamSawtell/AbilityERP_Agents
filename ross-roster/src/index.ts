/**
 * SAW048 — Express entry removed.
 * Ross API + workers now run as Next.js App Router handlers under admin-ui/.
 * Keep this package only for historical reference / SQL migrate tooling until
 * Amplify smoke tests pass, then delete ross-roster/ per docs/MIGRATE-TO-AMPLIFY.md.
 */
console.error(
  '[ross-roster] Express entry point removed (SAW048). Use admin-ui Next.js API routes.',
);
process.exit(1);
