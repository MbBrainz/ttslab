import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) {
	throw new Error(
		"DATABASE_URL is not set. Add it to .env.local to connect to Neon Postgres.",
	);
}

export default defineConfig({
	out: "./drizzle/migrations",
	schema: "./src/lib/db/schema.ts",
	dialect: "postgresql",
	dbCredentials: {
		url,
	},
});
