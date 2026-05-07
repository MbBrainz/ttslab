# TTSL-25: Reduce Vercel Fluid Compute via ISR + caching

## Problem
ttslab.dev consumes ~40% of all Vercel Fluid Compute despite low traffic.
Cause: every page render triggers SSR + Neon DB queries because no ISR/caching is configured.

## Root cause
- `src/app/(main)/page.tsx`, `models/[slug]/page.tsx`, `compare/[slug]/page.tsx`, `models/page.tsx` call Drizzle/Neon directly inline.
- No `export const revalidate`, no `unstable_cache`, no `force-static`.
- `src/app/sitemap.ts` also queries DB on every crawler fetch.
- `/compare/[slug]` is N×N — combinatorial blast radius for crawlers/social bots.
- 3 `opengraph-image.tsx` edge functions re-render per OG fetch.

`generateStaticParams` exists but without `revalidate` the route still renders dynamically because of the inline DB calls (Next 16 default behavior).

## Approach
Two streams, parallel:

### Stream A: Page-level ISR (revalidate exports)
Add `export const revalidate = 3600;` to:
- `src/app/(main)/page.tsx`
- `src/app/(main)/models/page.tsx`
- `src/app/(main)/models/[slug]/page.tsx`
- `src/app/(main)/compare/page.tsx`
- `src/app/(main)/compare/[slug]/page.tsx`
- `src/app/sitemap.ts` (use 86400 = 1 day)
- `src/app/(main)/opengraph-image.tsx`
- `src/app/(main)/models/[slug]/opengraph-image.tsx`
- `src/app/(main)/compare/[slug]/opengraph-image.tsx`

### Stream B: Tag-based on-demand revalidation for writes
Wrap heavy DB reads (`getAllModelsWithUpvotes`, `getAllModelsWithUpvotesOrdered`, `getModelBySlug`, `getModelBySlugWithUpvotes`, `getComparisonBySlug`, `getAllModels`, `getAllComparisons`, `getSiteStats`) in `unstable_cache` with tags:
- `models` — invalidated by upvote write
- `subscriptions` — invalidated by subscribe write (only if it affects rendered pages; otherwise skip)
- `stats` — invalidated by upvote/subscribe writes

Update `src/app/api/upvote/route.ts` POST to call `revalidateTag('models')` + `revalidateTag('stats')` after a successful upvote.
Update `src/app/api/subscribe/route.ts` POST to call `revalidateTag('stats')` after creating a subscription (if stats reflects subscriber count — skip if not).

## Acceptance criteria
1. All pages above export `revalidate`.
2. DB queries used by those pages are wrapped in `unstable_cache` with appropriate tags.
3. Upvote POST calls `revalidateTag` for affected tags.
4. `npx tsc --noEmit --pretty` passes.
5. `pnpm build` succeeds; build output shows pages as `ISR` or `SSG`, not `λ Dynamic`.

## Out of scope
- Modifying API routes that genuinely need to be dynamic (`/api/upvote` GET with fingerprint, `/api/subscribe/verify`).
- Edge function migration.
- DB query optimization (keep it for a follow-up).

## Files to touch
- 5 page files + 1 sitemap + 3 opengraph-image files (Stream A)
- `src/lib/db/queries/models.ts`, `comparisons.ts`, `stats.ts` (wrap with `unstable_cache`)
- `src/app/api/upvote/route.ts`, `src/app/api/subscribe/route.ts` (revalidateTag)
