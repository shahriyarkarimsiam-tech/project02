# Merge Streak Arcade — Telegram Mini App v0.2

**Status:** Expanded source-level prototype with independently tested browser practice mode. Not deployed. No live publisher account, ads, cryptocurrency, payment processing, or cash payouts.

The application is an early-stage free-to-play Telegram Mini App. It includes an original-branded number-merging puzzle, six-page arcade UI, classic and daily modes, virtual coin cosmetics, milestones and online leaderboard endpoints.

## Delivered in v0.2

- Six mobile-responsive arcade sections: Overview, Play, Challenges, Rankings, Theme Shop, Profile.
- Fully playable classic puzzle with keyboard, touch swipe, and directional buttons.
- Daily seeded challenge: server issues a common daily seed, allows **one daily game record per Telegram player per UTC date** and validates the replay when completed. Unfinished games can be resumed with the locally cached move history.
- Two online leaderboards: all-time best score and current UTC day's completed challenge scores.
- Six achievement badges from recorded gameplay stats; they do not grant money.
- Four cosmetic themes: Neo Mint (free), Aurora (25 coins), Solar Flare (60), Midnight (100).
- Atomic virtual coin spending in SQLite triggers; invalid/duplicate shop purchases do not spend coins.
- Player profiles, recent completed games and daily-play streaks.
- Telegram `initData` validation, signed HttpOnly cookies, server-seeded games and server replay validation.
- Cloudflare Worker API with D1 migrations and basic admin game statistics.
- Monetag/AdsGram placeholders remain **disabled pending publisher approval**.
- Standalone single-file HTML demo bundled separately; **guest data stays in the browser** and cannot enter online rankings.

## Quick test without Cloudflare

From this directory:

```bash
python3 -m http.server 8080 --directory public
```

Open `http://localhost:8080`. You can play as a guest. Online leaderboard calls return no results because there is no backend in this static preview. `node --test tests/*.test.mjs` runs the JavaScript suite (Node 20+). SQLite migration triggers were also tested with Python's `sqlite3` module.

You can also open the supplied **merge-streak-arcade-v0.2-demo.html** in a modern browser; this version has its frontend resources inlined. Its daily practice seed is different from the authoritative Telegram daily seed.

## Deploy to Cloudflare + Telegram (not executed)

1. Create a separate bot for this game with [@BotFather](https://t.me/BotFather); do not reuse your Sponsored Tasks & Rewards bot.
2. Create/log in to Cloudflare. Install Node 20+ and run `npm install` in the project directory.
3. Run `npx wrangler login`.
4. Run `npx wrangler d1 create merge-streak-db` if this is a new app.
5. Update the `database_id` placeholder in `wrangler.jsonc` using Cloudflare's output.
6. Run `npx wrangler d1 migrations apply merge-streak-db --remote`. **For an existing v0.1 database**, the new `0002_arcade_progression.sql` migration must be applied. Back up production data before migration.
7. Store private secrets in Cloudflare via `npx wrangler secret put BOT_TOKEN`, `npx wrangler secret put SESSION_SECRET`, and optionally `npx wrangler secret put ADMIN_TELEGRAM_ID`. Use a fresh high-entropy secret. Never commit tokens, keys or `.dev.vars`.
8. Run `npx wrangler deploy` and record the assigned HTTPS address.
9. Use BotFather `/setmenubutton` to point your new Telegram bot at the deployed Mini App URL.
10. Validate Telegram account creation, daily attempt enforcement, streaks, classic start and finish, theme purchase and equipment, leaderboard results, duplicate requests, mobile controls, D1 errors and rate limits on real devices.

For local Worker development: apply migrations locally with `npx wrangler d1 migrations apply merge-streak-db --local`, configure `.dev.vars` privately, then run `npx wrangler dev`.

## API endpoints

| Verb | URL | Purpose |
| --- | --- | --- |
| GET | `/api/health` | API status, payments and ads disabled flags |
| POST | `/api/auth/telegram` | Verify signed Telegram user data; issue session cookie |
| GET | `/api/me` | Profile, unlocked cosmetics, recent games, daily state, active runs |
| POST | `/api/game/start` | Start or resume classic/daily game, mode in JSON body |
| POST | `/api/game/finish` | Replay and verify score; credit bounded virtual coins |
| GET | `/api/leaderboard?mode=classic` | Top 20 all-time players |
| GET | `/api/leaderboard?mode=daily` | Top 20 scores for today's UTC challenge |
| POST | `/api/shop/buy` | Atomically purchase a cosmetic by `themeId` with virtual coins |
| POST | `/api/shop/equip` | Switch to an unlocked cosmetic |
| GET | `/api/admin/metrics` | Private aggregate game metrics, not advertising revenue |

All private routes require a valid signed session. State-changing requests check same-origin. The client does not choose a game seed or control the virtual shop price. Guest progress is completely separate from server-verified Telegram progress.

## Known limits and release blockers

- **Not yet production-tested:** Cloudflare Worker, D1 integration in the actual Cloudflare runtime, real Telegram webviews, cross-device restoring and Cloudflare publisher deployments. Passing JavaScript/browser-practice tests does not prove these.
- **Not advertising-ready:** No publisher agreement, ad zone or server-side ad completion postback integration. Ads do not deliver or earn revenue.
- **No cash rewards:** Coins are virtual-only, non-transferable and non-redeemable.
- **Fraud:** Deterministic replay blocks invented scores but not automated optimal play, real-account farming or all forms of abuse. Per-day coin cap is computed before game update and should be made concurrency-safe before any valuable reward model.
- **Daily challenge:** A Telegram user can create one daily entry per UTC day; there is no enforced end-to-end clock-time restriction beyond existing minimum-duration heuristics. An unfinished entry can resume until the day expires. Local practice has no online authority.
- **Data retention:** We store numeric Telegram ID, public display name, scores and game activity. A privacy notice, data deletion endpoint/process and user support path are required before a broad public release.
- **API usage:** On free hosting, watch Worker and D1 quotas, abuse patterns, error rates and data storage.
- **Reward economics:** Cosmetics create no cash obligation and have no implied monetary value. Do not market coins as earnings.

## Project files

```
public/           index.html, styles.css, app.mjs, engine.mjs, catalog.mjs, favicon.svg
src/              worker.mjs, auth.mjs
migrations/       0001_initial.sql, 0002_arcade_progression.sql
tests/            authentication, puzzle engine, publisher-disabled API, catalog
wrangler.jsonc     Cloudflare Worker/D1 config (database ID is still a placeholder)
docs/             BUILD_PLAN.md and HANDOFF.md
```

## Official references

- Telegram Mini Apps: https://core.telegram.org/bots/webapps
- Cloudflare Workers static assets: https://developers.cloudflare.com/workers/static-assets/
- Cloudflare D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
- Monetag Mini App SDK: https://docs.monetag.com/
