# TTSL-26: Switch ISR pages and unstable_cache to tag-only invalidation

Followup to TTSL-25. The 1h time-based revalidate added in TTSL-25 was still
causing unnecessary cold revalidations for data that almost never drifts
(seeded model metadata). Tag-based invalidation already handles upvote/stats
freshness. So: drop the time-based knob entirely.

## Changes
- All page `export const revalidate = N;` → `revalidate = false`
- All `unstable_cache` options → `revalidate: false`
- Sitemap + OG images same
- Note added to CLAUDE.md explaining the tradeoff and when to revisit

## Verification
- `pnpm build` passes 212/212 static pages
- Routes still report Static/SSG markers
- The "1h" column in build output is Next 16's default soft SWR window, not our setting
