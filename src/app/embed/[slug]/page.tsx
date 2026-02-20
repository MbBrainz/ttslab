import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TtsDemo } from "@/components/tts-demo";
import { APP_NAME } from "@/lib/constants";
import { getAllModelSlugs, getModelBySlug } from "@/lib/db/queries";

type PageProps = {
	params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
	const allModels = await getAllModelSlugs();
	return allModels.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { slug } = await params;
	const model = await getModelBySlug(slug);

	if (!model) {
		return { title: "Model Not Found" };
	}

	return {
		title: `${model.name} | ${APP_NAME} Embed`,
		robots: { index: false, follow: false },
	};
}

export default async function EmbedPage({ params }: PageProps) {
	const { slug } = await params;
	const model = await getModelBySlug(slug);

	if (!model || model.status !== "supported" || model.type !== "tts") {
		notFound();
	}

	return <TtsDemo model={model} variant="compact" />;
}
