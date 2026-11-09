import { neon } from "@neondatabase/serverless";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle } from "drizzle-orm/neon-http";
import { wrapNeonClient } from "./retry";
import * as schema from "./schema";

let _db: NeonHttpDatabase<typeof schema> | null = null;

function getDb(): NeonHttpDatabase<typeof schema> {
	if (_db) return _db;

	if (!process.env.DATABASE_URL) {
		throw new Error(
			"DATABASE_URL is not set. Add it to .env.local to connect to Neon Postgres.",
		);
	}

	// Every query through drizzle funnels into this client, so connection-
	// class failures (fetch failed / ETIMEDOUT) that flake Vercel prerender
	// get retried here. Data errors (SQLSTATE 23xxx/42xxx) still throw.
	const sql = wrapNeonClient(neon(process.env.DATABASE_URL));
	_db = drizzle({ client: sql, schema });
	return _db;
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
	get(_target, prop) {
		return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
	},
});
