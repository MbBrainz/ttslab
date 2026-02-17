import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

async function main() {
	const sql = neon(DATABASE_URL as string);

	// Delete old "chatterbox" slug — replaced by "chatterbox-turbo"
	const slugsToRemove = ["chatterbox"];

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
}

main().catch(console.error);
