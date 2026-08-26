# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NOCameraNews monitors new arrivals on the New Old Camera used-photography site by polling its Azure Gateway API, filtering products against user keywords (with optional min/max price and exclusion terms), and notifying matches via macOS desktop notifications and/or a Telegram bot. All user-facing text (UI and notifications) is in Italian.

## Commands

```bash
npm install                # install dependencies
npm start                  # run server locally (http://localhost:3000)

# Local run requires PostgreSQL; set connection first:
export DATABASE_URL=postgresql://postgres:postgrespassword@localhost:5432/nocameranews

docker compose up -d --build   # full stack (app maps host port 3010 → container 3000)
docker compose logs -f         # view logs
```

No test suite or linter is configured. Environment variables come from `.env` for docker-compose (`DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `ADMIN_PASSWORD`) and from the shell (`DATABASE_URL`, `ADMIN_PASSWORD`) when running locally. See `.env.example`.

## Architecture

**Single-file backend**: everything lives in `server.js` (~1140 lines). The frontend is vanilla HTML/CSS/JS in `public/` served statically by Express — three pages sharing one stylesheet: `index.html` (dashboard), `settings.html` (config), `all-daily.html` (full daily product feed). No build step.

### Storage (PostgreSQL via `pg` Pool)

Two tables created/seeded by `initDb()` at startup (with retry loop for slow DB startup):

- `app_preferences`: key-value JSONB store. All read-modify-write cycles (scraper matching, keywords/settings mutations, Telegram commands) are serialized through the `withDbLock()` async mutex — never mutate and write outside it.
  - key `'db'`: `{ keywords, history, settings }` — read/written wholesale through `readDb()`/`writeDb()`.
  - key `'seen_ids'`: `{ lastClearedDate, ids }` — daily dedup cache of scraped product IDs.
- `all_daily_products`: every product seen during the day, keyed by product ID. Rewritten transactionally (DELETE-all then re-insert) by `writeAllDaily()`.

**Self-migrating settings**: `readDb()` checks for missing setting fields (e.g. telegram keys) and writes defaults back. When adding a new setting, add it here *and* in `initDb()` seed data *and* in the POST `/api/settings` merge logic.

### Crawler flow (`checkNewProducts()`)

1. Auto-clear pass: on new day or after 20:00, wipes history, `all_daily_products`, and seen IDs (`lastDailyClearDate`/`lastDailyClearHour` guards).
2. Schedule gate: skips unless within `activeHoursStart..activeHoursEnd` and `activeDays` (0=Sunday).
3. Fetches product list from the Azure Gateway API (`fetchProductList()`).
4. For each item: upsert into daily feed; if ID unseen, evaluate keyword match (keyword objects support `minPrice`/`maxPrice`/`exclude`); matched items go to `history`; notifications fire only for genuinely new items after first boot (`isFirstBoot` seeds existing items silently).
5. Scheduler is a plain `setInterval` recreated by `startPolling()` whenever interval/settings change.

### Notifications

- **Desktop**: `node-notifier` rich macOS notifications with click-to-open product page; only works running natively on macOS, not in Docker.
- **Telegram**: `sendTelegramNotification()` sends photo-with-caption (text fallback). Additionally, `startTelegramPolling()` long-polls `getUpdates` every 4s so the bot accepts remote commands (`/status`, `/keywords`, `/add`, `/remove`) from the authorized chat ID only.

### API & Auth

Middleware `requireAdminPassword()` checks the `x-admin-password` header; it is bypassed entirely when `ADMIN_PASSWORD` is unset. Public endpoints: `GET /api/status`, `GET /api/history`, `GET /api/all-daily`. All mutating endpoints and settings/keywords reads require the password. The frontend implements an auth-modal interceptor that attaches this header (stored client-side) on protected calls.
