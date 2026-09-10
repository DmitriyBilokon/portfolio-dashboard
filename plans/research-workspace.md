# Research workspace and application audit

User request: audit the whole application through 13 independent reviews, deduplicate and challenge findings, then improve design for stock discovery, long/short positions and trading, including entry/exit charts and explicit data freshness.

## Implementation scope

- Preserve the no-build architecture, portfolio ledger, authentication/RBAC and existing local HTML/CSS edits.
- Add a focused research workspace as the default Home view. Keep market overview and advanced tools reachable.
- Deduplicate securities by exchange-qualified symbol and currency, while preserving source tabs and actual portfolio positions.
- Show available historical prices, source timestamps and conservative data-quality gates. Do not label seed/fallback data as live.
- Build one explicit technical scenario per selected direction/horizon: entry, stop, target, risk/reward and position-risk calculator. These are conditional plans, not profit guarantees or executed orders.
- Support short-side calculations without pretending the existing long-only ledger or broker supports short execution. Show borrow/margin verification where relevant.
- Reuse the existing history endpoint. No fabricated OHLC candles, intraday bars, live timestamps or broker borrowing data.
- Resolve verified high-impact cache, stale-response, request-loop and contradictory-data defects with focused regression tests.
- Do not run paid AI endpoints, Telegram actions, production ledger writes, deployment, commits or pushes.

## Audit coverage

1. Freshness/provenance; 2. recommendation conflicts; 3. performance; 4. chart/technical correctness; 5. long/short and position risk; 6. ledger/FX correctness; 7. worker security; 8. auth/sync/data loss; 9. instrument duplication; 10. UX/accessibility; 11. tests/reliability; 12. documentation/deployment and sources; 13. adversarial verification of consolidated findings and final changes.

Each review records concrete locations and reproducible evidence. The synthesis separates fixed findings, confirmed outstanding limitations, and claims that could not be verified. Live checks are restricted to read-only, low-cost public market/version endpoints.

## Files and validation

- New research UI/logic module and CSS; minimal integration in index.html/app.js and test loader.
- Focused fixes in existing app parts, service worker or worker only where verified. Worker changes require a build bump and remain undeployed.
- Unit tests for symbol deduplication, stale/unknown data, long/short level ordering, invalid inputs, position sizing and cache isolation.
- Existing `bash tests/run.sh` plus per-file syntax, browser checks at desktop/mobile widths, both languages/themes, errors/offline and changing a selected stock during loading.
- Audit report and usage documentation, with links to official source documentation for data delays and order/short-sale limitations.

The user explicitly requested implementation in this task; planning is recorded here and implementation continues within the authorized session. No production changes are implied.
