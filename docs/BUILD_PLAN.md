# Telegram Rewarded-Ad Gaming — Execution Plan

Project name: Merge Streak (working title). Last revised: 2026-11-09 (Bangladesh time).

## Strategic verdict

**Conditionally viable** as a low-cost, virtual-rewards game experiment. **Unproven** as a profitable advertising business. Real-money rewards are explicitly deferred. Do not transfer users, assets, credentials or accounts from the separate Sponsored Tasks & Rewards project.

## Design and economy decisions

- Product: 4×4 tile-merging puzzle with distinct visual branding; accessible without advertisements.
- Initial monetization: none. Ad integration will be gated by written publisher approval and verified callback/postback mapping.
- Progression: player score, best run, virtual coins, rank badge. Coins are non-redeemable.
- Target: 100–200 *genuine players* as a private beta, not 5,000 assumed DAU.
- Infra: Cloudflare Workers + static assets + D1, Github repository when authorized, Telegram BotFather for distinct bot.
- Cash rewards: NOT implemented. Requires explicit network approval, compliant disbursement, real net CPM/fill data, fraud budget, payment buffer and legal review.

## Build stages and acceptance gates

### Phase 0 — feasibility baseline
DONE as research assessment: Monetag and AdsGram support Mini App ad formats; Bangladesh-specific profitability and payouts remain unverified. Before ads, seek network acceptance and publisher payout confirmation.

### Phase 1 — offline playable MVP
**Source implemented, basic unit tests passed.** Includes tile engine, score display, player controls and local practice. Gate: browser/Telegram user testing without critical gameplay bugs. Unverified: live mobile visual tests.

### Phase 2 — authenticated game and cloud deployment
**Source implemented; LIVE validation pending.** Includes Telegram initData verification, signed cookie, server-seeded runs, score replay, D1 score tables and atomic reward trigger. Gate: deploy Cloudflare Worker, configure new bot, test login, game start/finish, retry/duplication and daily analytics. Needs account authorization and private credentials configured by operator, not chat-shared.

### Phase 3 — private beta
Invite 100–200 real volunteers. Collect a minimum of 7 full days of data. Count verified distinct Telegram players and actual run activity, not subscribers. Track:
  - Acquisition: channel viewers -> Mini App opens -> verified new players.
  - Daily distinct players; day-1 and day-7 retention cohorts.
  - Games started and saved per user, session duration, crash/error rate.
  - Scores and abandonments; whether players voluntarily return without financial reward.
  - Feedback on fun, visual clarity, control responsiveness, bugs.

**Decision thresholds are internal hypotheses, not industry-certified benchmarks:** aim for >=20% day-1 return and >=8% day-7 return before serious monetization work; if much lower, revise the game rather than adding ads. Require no critical account/data-loss bugs.

### Phase 4 — Monetag eligibility and SDK
Contact publisher support and register this exact app; verify Bangladesh account eligibility, permitted ad incentives, payout instrument, and content rules. Only after approval, implement an optional rewarded-interstitial placement with a server-issued unique `ymid` and authenticated user mapping, then use secure Monetag postbacks.

**Critical detail:** Monetag documentation says an `impression` postback may be triggered when the ad starts rendering, not necessarily after the entire video completes. Do not equate an impression with guaranteed full watch time. Follow the specific approved reward event and conditions agreed with the network.

Gate: confirm callbacks/postbacks, `valued` status, duplicate protection, invalid-traffic rejection, event observability, and a stable no-fill experience. Do not reward based solely on browser-side claims.

### Phase 5 — paid-impression experiment
Run small, controlled volumes with permission. Capture publisher dashboard revenue and actual eligible events. Compare daily cohort eCPM, requests, fill, valid impressions, reward triggers, payout fees and actual cash received. No public earnings statements from projections. Test a user-initiated frequency cap (starting hypothesis: maximum two requested ad views per active day) and confirm player retention does not decline.

### Phase 6 — scale decision
Scale past private beta only if D1/D7 retention is acceptable, verification is robust and publisher funds can actually be received. Operating profit must be computed after fees, marketing, staff, support, currency conversion, fraud, taxes, and infrastructure. If base-case net profit <=0, do not scale ad requests.

## Financial guardrail

Illustrative only: 1,000 DAU × 2 requests × 50% fill × 80% completion × 90% payable × $0.50 CPM / 1,000 = $0.36 per day, $10.80 per 30-day month (gross publisher revenue before business costs). A 40% hypothetical cash-reward allocation would leave $6.48 monthly before fees; this is why the MVP does NOT include a cash economy. Actual CPM is unknown.

## Key risks to test cheaply

1. Subscriber to DAU conversion may be small, especially with entertainment-channel audiences.
2. Puzzle retention may fail without strong game design and regular content updates.
3. Bangladesh rewarded-ad fill/CPM may be too low for worthwhile operations.
4. Publisher approval and cash-reward permissions may be unavailable.
5. Abuse may defeat naive coin rewards or leaderboards (server replay helps only partly).
6. Payment fees and schedules may overwhelm small revenue.
7. Free-tier quotas are limited and can change; monitor API and D1 usage.

## Decision record

2026-11-09: Begin actual coding with an original-branded 2048-like puzzle engine and virtual score coins. Use a single Cloudflare Worker with static assets and D1 (official docs now support this). Keep Monetag disabled until ad-zone, publisher acceptance, and server verification are available. No real-money or crypto features.

## Next external actions

1. Operator creates a new Telegram bot and Cloudflare account (or chooses existing independent Cloudflare account). Keep bot token private.
2. Operator applies D1 schema, inserts Worker secrets, deploys and configures bot menu URL.
3. Run real-device QA, record at least one verified Telegram game submission and admin metrics.
4. Recruit 100–200 voluntary testers before attempting 5,000-person acquisition.

## v0.2 implementation update — 2026-11-09

The product was upgraded from a bare puzzle page into a six-section gaming hub while retaining the original low-cost infrastructure and virtual-only economy. Implemented: responsive overview, game arena, seeded daily challenge, daily/all-time leaderboards, six milestones, four cosmetic themes with atomic D1 spend triggers, recent history and player profile. Database migration `0002_arcade_progression.sql` adds the necessary fields; apply it when upgrading an existing v0.1 database.

**Next gate:** Real Telegram/Cloudflare integration and user acceptance tests. Do not treat visual completeness or local tests as proof of commercial readiness. Assess a second genuinely distinct game only after retention/usage research from the first beta.
