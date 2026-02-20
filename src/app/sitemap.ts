import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/constants";
import { getAllComparisons, getAllModels } from "@/lib/db/queries";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const allModels = await getAllModels();
	const allComparisons = await getAllComparisons();

	const staticPages: MetadataRoute.Sitemap = [
		{
			url: APP_URL,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 1,
		},
		{
			url: `${APP_URL}/models`,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 0.9,
		},
		{
			url: `${APP_URL}/compare`,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${APP_URL}/voice-agent`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${APP_URL}/benchmark`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.6,
		},
		{
			url: `${APP_URL}/about`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.5,
		},
		{
			url: `${APP_URL}/contribute`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.5,
		},
	];

	const modelPages: MetadataRoute.Sitemap = allModels.map((model) => ({
		url: `${APP_URL}/models/${model.slug}`,
		lastModified: model.updatedAt ?? new Date(),
		changeFrequency: "weekly" as const,
		priority: 0.7,
	}));

	const comparisonPages: MetadataRoute.Sitemap = allComparisons.map(
		(comparison) => ({
			url: `${APP_URL}/compare/${comparison.slug}`,
			lastModified: new Date(),
			changeFrequency: "weekly" as const,
			priority: 0.6,
		}),
	);

	return [...staticPages, ...modelPages, ...comparisonPages];
}
