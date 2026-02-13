import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
	console.warn(
		"DATABASE_URL is not set. Database queries will fail. Add it to .env.local",
	);
}

const sql = neon(process.env.DATABASE_URL ?? "");

export const db = drizzle({ client: sql, schema });
