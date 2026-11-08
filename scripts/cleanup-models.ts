import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

async function main() {
	const sql = neon(DATABASE_URL as string);

	// "chatterbox" stays: it runs on WASM and its WebGPU INT64 failure is core
	// to the site's limits story — seed-models.ts seeds it as supported.
	// Delete old "kitten-tts" slug — replaced by "kitten-tts-nano" (now supported)
	const slugsToRemove = ["kitten-tts"];

	for (const slug of slugsToRemove) {
		// Delete comparisons first (foreign key)
		await sql`DELETE FROM comparisons WHERE model_a_id IN (SELECT id FROM models WHERE slug = ${slug}) OR model_b_id IN (SELECT id FROM models WHERE slug = ${slug})`;
		// Delete upvotes
		await sql`DELETE FROM upvotes WHERE model_id IN (SELECT id FROM models WHERE slug = ${slug})`;
		// Delete subscriptions
		await sql`DELETE FROM subscriptions WHERE model_id IN (SELECT id FROM models WHERE slug = ${slug})`;
		// Delete model
		const result = await sql`DELETE FROM models WHERE slug = ${slug}`;
		console.log(`Deleted: ${slug} (${result.length} rows)`);
	}

	// Prune stale comparisons: seed-models.ts only ever INSERTS (idempotent
	// upserts + onConflictDoNothing), so when a model loses "supported" status
	// its old comparison rows linger — prerendered /compare pages and sitemap
	// entries advertising a model that cannot run. Enforce the seed invariant:
	// a comparison exists only between two supported same-type models.
	const pruned =
		await sql`DELETE FROM comparisons WHERE model_a_id IN (SELECT id FROM models WHERE status != 'supported') OR model_b_id IN (SELECT id FROM models WHERE status != 'supported')`;
	console.log(`Pruned stale comparisons: ${pruned.length} rows`);
}

main().catch(console.error);
