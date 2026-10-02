# Finder automatic search and editor entry clarity

The user first could not locate the forms, then found the editor and reported that searching `ifm` failed. Live reproduction proves productName=ifm gives zero results while vendorName=ifm returns 2597 approved products. The input promised product or manufacturer but defaulted to Product name. Fix the default query behavior instead of changing the data engine.

Default Automatic mode searches product names, then manufacturer names, then product IDs, then numeric device IDs until a category has matching records. Explicit category selections remain exact. Use totalElements rather than current-page emptiness to choose categories, retain pagination and expose the selected match category. Errors remain actionable; no result must have useful guidance. Search remains explicit GET with no project upload.

Clarify the start view with the actual title IODD editor and direct create/open/example guidance. No wholesale redesign is required after the user's clarification. Preserve the existing verified engine and export flows.

Acceptance: exact ifm automatic search returns manufacturer records; SDAT uses product names; explicit product search may return zero with guidance; manufacturer pagination does not fall back spuriously. Tests prove network query selection and UI behavior. Run live ifm search/import, source-bundle checks, CI merge and deployment.
