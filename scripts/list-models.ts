import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

async function main() {
	const sql = neon(DATABASE_URL as string);
	const rows = await sql`SELECT slug, status, name FROM models ORDER BY type, status, slug`;
	for (const r of rows) {
		console.log(`${String(r.status).padEnd(12)} ${String(r.slug).padEnd(30)} ${r.name}`);
	}
}

main().catch(console.error);
