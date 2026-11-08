/**
 * Serializes structured data for a <script type="application/ld+json"> tag.
 *
 * Escapes every "<" as the unicode escape \u003c so no raw "<" can ever appear
 * inside script markup — a "<" in model metadata or prose would otherwise
 * allow a literal "</script>" to terminate the tag early and break the page
 * (relaunch-plan task #25). JSON parsers treat \u003c identically to "<", so
 * crawlers read the same value.
 */
export function serializeJsonLd(data: unknown): string {
	return JSON.stringify(data).replace(/</g, "\\u003c");
}
