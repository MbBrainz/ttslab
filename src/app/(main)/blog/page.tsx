import type { Metadata } from "next";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { BLOG_POSTS, blogPostPath } from "@/lib/blog-posts";
import { APP_NAME, APP_URL } from "@/lib/constants";
import { serializeJsonLd } from "@/lib/jsonld";

export const metadata: Metadata = {
	title: "Blog | TTSLab",
	description:
		"Long-form write-ups from the TTSLab lab notebook: porting voice models to the browser, WebGPU engineering, and appreciation posts for the small-model releases that make on-device speech possible.",
	alternates: {
		canonical: "/blog",
	},
};

const breadcrumbJsonLd = {
	"@context": "https://schema.org",
	"@type": "BreadcrumbList",
	itemListElement: [
		{
			"@type": "ListItem",
			position: 1,
			name: APP_NAME,
			item: APP_URL,
		},
		{
			"@type": "ListItem",
			position: 2,
			name: "Blog",
			item: `${APP_URL}/blog`,
		},
	],
};

function formatDate(iso: string): string {
	return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});
}

export default function BlogIndexPage() {
	return (
		<div className="space-y-12">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
			/>

			<section className="space-y-4">
				<h1 className="text-3xl font-bold tracking-tight">Blog</h1>
				<p className="max-w-2xl text-lg text-muted-foreground">
					Long-form posts from the {APP_NAME} lab notebook: ports, kernels,
					measurements, and appreciation for the model releases that make
					on-device speech possible.
				</p>
			</section>

			<Separator />

			<div className="space-y-10">
				{BLOG_POSTS.map((post) => (
					<article key={post.slug} className="space-y-2">
						<p className="text-sm font-medium text-primary">
							{formatDate(post.datePublished)}
						</p>
						<h2 className="text-xl font-semibold">
							<Link href={blogPostPath(post.slug)} className="hover:underline">
								{post.title}
							</Link>
						</h2>
						<p className="max-w-2xl text-muted-foreground">{post.dek}</p>
						<Link
							href={blogPostPath(post.slug)}
							className="text-sm text-primary hover:underline"
						>
							Read the post
						</Link>
					</article>
				))}
			</div>
		</div>
	);
}
