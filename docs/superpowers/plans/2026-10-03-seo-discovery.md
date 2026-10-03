# iolinki search discovery

Goal: improve crawler discovery and accurate search/share metadata without changing product capability claims.

- Check crawler-visible titles, descriptions, canonical URLs, structured data and sitemap coverage. Add a check that fails on missing discoverable documentation and indexable checkout callback/template pages.
- Include documentation URLs in the primary sitemap and advertise the documentation sitemap. Remove checkout callbacks from the sitemap and mark callbacks plus legacy template pages noindex. Preserve immutable terms.
- Improve specific IO-Link/IODD titles and descriptions; add Open Graph/Twitter metadata and a shared original code-generated social card.
- Add truthful software/organization and breadcrumb structured data. Keep FAQ content synchronized with published IODD checker evidence; do not claim certification or directory publication.
- Run crawler checks, documentation reproducibility, static links and relevant browser checks through CI. Merge normally and verify published metadata, sitemap and image bytes. No ranking or indexing promise.
