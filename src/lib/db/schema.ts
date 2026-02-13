import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	real,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

export const models = pgTable(
	"models",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		slug: text("slug").unique().notNull(),
		name: text("name").notNull(),
		type: text("type", { enum: ["tts", "stt"] }).notNull(),
		status: text("status", {
			enum: ["supported", "planned", "unsupported"],
		}).notNull(),
		sizeMb: real("size_mb"),
		paramsMillions: real("params_millions"),
		architecture: text("architecture"),
		languages: text("languages").array().default(sql`'{}'::text[]`),
		voices: integer("voices"),
		hfModelId: text("hf_model_id"),
		hfOnnxId: text("hf_onnx_id"),
		npmPackage: text("npm_package"),
		loaderConfig: jsonb("loader_config").$type<Record<string, unknown>>(),
		supportsStreaming: boolean("supports_streaming").default(false),
		supportsWebgpu: boolean("supports_webgpu").default(true),
		supportsWasm: boolean("supports_wasm").default(true),
		description: text("description"),
		websiteUrl: text("website_url"),
		paperUrl: text("paper_url"),
		license: text("license"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [index("idx_models_status").on(table.status, table.type)],
);

export const upvotes = pgTable(
	"upvotes",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		modelId: uuid("model_id")
			.notNull()
			.references(() => models.id),
		fingerprint: text("fingerprint").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		unique("upvotes_model_fingerprint").on(table.modelId, table.fingerprint),
		index("idx_upvotes_model").on(table.modelId),
	],
);

export const subscriptions = pgTable(
	"subscriptions",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		email: text("email").notNull(),
		modelId: uuid("model_id").references(() => models.id),
		comparisonKey: text("comparison_key"),
		verified: boolean("verified").default(false),
		verifyToken: text("verify_token"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		unique("subscriptions_email_model").on(table.email, table.modelId),
		unique("subscriptions_email_comparison").on(
			table.email,
			table.comparisonKey,
		),
		index("idx_subscriptions_model").on(table.modelId),
	],
);

export const comparisons = pgTable(
	"comparisons",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		modelAId: uuid("model_a_id")
			.notNull()
			.references(() => models.id),
		modelBId: uuid("model_b_id")
			.notNull()
			.references(() => models.id),
		slug: text("slug").unique().notNull(),
	},
	(table) => [
		check(
			"comparisons_order_check",
			sql`${table.modelAId} < ${table.modelBId}`,
		),
	],
);

export type Model = typeof models.$inferSelect;
export type NewModel = typeof models.$inferInsert;
export type Upvote = typeof upvotes.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Comparison = typeof comparisons.$inferSelect;
