/*
 * Fictional candidates from fixtures/candidates/*.json, so the interview simulator works without scraping.
 *
 *   npm run seed:candidates -- --check     validate fixtures only
 *
 * Seeding itself happens in the running app, because the local database belongs to the server process and
 * personas belong to the visitor's cookie: with `npm run dev` running, open
 * http://localhost:4000/api/dev/seed-candidates in the browser you use the app in.
 */
import { loadFixtures } from "../src/lib/fixtures";

async function main() {
  const fixtures = await loadFixtures();
  console.log(`Fixtures OK: ${fixtures.map((f) => f.slug).join(", ")}`);
  if (process.argv.includes("--check")) return;
  console.log("\nTo seed them, run `npm run dev` and open this in your browser:\n  http://localhost:4000/api/dev/seed-candidates\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
