
---

## `README.en.md` (English)

```markdown
# Ligue de Mousse

A keeper NHL fantasy league web app built for a private 12-team league. Replaces the old Pool Expert setup with cumulative season scoring, a trade marketplace, salary cap tracking, and live NHL game tracking.

**Live demo → [liguedemousse.com](https://liguedemousse.com)** (browsable without an account)

[Version française →](README.md)

---

## About

Ligue de Mousse is a full-stack application built for a private fantasy hockey league. The league has existed for several years but relied on a generic platform (Pool Expert) that didn't support its custom rules. This app implements the league's specific rules in a dedicated system: append-only status history for scoring, salary cap with retention, draft picks limited to the next two seasons, and a trade marketplace with counter-offer support.

The 12 current users access the app exclusively from their mobile phones. **The application is therefore designed mobile-first.** An **installable PWA** is available from the hamburger menu (Chrome, Edge, Android; on iOS Safari, use "Add to Home Screen" from the Share button). The desktop version partially exists but is still being polished — it will be prioritized once the mobile experience is complete.

## Features

- **Cumulative season scoring** (no weekly matchups) — each team accumulates points from its active players across the entire season
- **Flexible roster** — 12 active forwards + 6 active defensemen + 1 active goalie, 7 bench players, 3 prospects, with an append-only history of every status change
- **Trade marketplace** — public listings, direct offers, counter-offers, with draft pick support
- **Salary cap** — cap hit tracking, 5-year projection, protected contracts (salary retention)
- **Draft** — 2027 and 2028 picks, lottery, transfers
- **Game Day** — live scores, game boxscores, fantasy ownership overlay on every game
- **Stats** — top scorers, NHL standings, injuries
- **Commissioner panel** — roster management, trade execution, manual contracts, DB backups, audit trail

## Mobile app (PWA)

The app is an **installable Progressive Web App**:

- **Android / Chrome / Edge** — open the hamburger menu, tap "Installer l'application".
- **iOS Safari** — open the hamburger menu, read the on-screen instructions, then use Safari's **Share** button and choose "Add to Home Screen".
- Once installed, the app launches full-screen like a native app, with offline support for static assets.

## Tech stack

**Backend** — ASP.NET Core 8 · Entity Framework Core 8 · PostgreSQL 18 · Identity (cookie auth) · Data Protection persisted to DB
**Frontend** — React 19 · TypeScript · Vite · Tailwind CSS 4 · shadcn/ui · TanStack Virtual · PWA (service worker, install prompt)
**Deployment** — Docker Compose on an OVH VPS (Ubuntu 24.04) · Nginx reverse proxy · self-hosted

## Architecture — notable technical points

- **Append-only scoring history** — `RosterStatusHistory` records every status change with an effective date. To credit a game to a team, the recompute engine resolves the player's effective state at puck drop. A player traded mid-season therefore credits both teams, each for the portion of games during which he was Active on that team.

- **NHL API rate limiting** — a singleton `NhlApiRateLimiter` shared across all scheduled jobs, with an `AsyncLocal` flag that lets user-initiated requests through while throttling background jobs. The rate-limit handler is registered innermost so a slow DB write (from the logging handler) can never hold the semaphore.

- **In-memory response cache** — standings, roster, and leaderboard endpoints are cached for 30 seconds. Mutations (trades, status changes, recompute) explicitly invalidate the affected prefixes.

- **Priority-based job scheduler** — rare jobs (weekly, daily) can't be interrupted by frequent jobs and can't be skipped because another job is running. Guaranteed by `CancellationToken.None` and a separate priority lock on critical jobs.

- **External integrations** — NHL API (stats + game logs + schedule), ESPN (injuries), CapFreeze (contracts), with error handlers that log failures into `SystemEventLogs` for the admin dashboard.

- **Optimistic concurrency** — `FantasyTeamSeason` uses Postgres' `xmin` system column as a concurrency token, with bounded retry for races between season recompute and live in-game updates.

- **Salary retention handling** — contracts with salary retention are marked with a `ProtectedSalary` that survives CapFreeze syncs and clears automatically when the contract expires and CapFreeze returns a new one.

- **DB-persisted Data Protection keys** — cookie encryption keys are stored in the database so user sessions survive an API container rebuild.

## Running locally

Prerequisites: .NET 8 SDK, Node.js 22, PostgreSQL 18 (or Docker).

```bash
# Backend (from repo root)
dotnet restore
dotnet ef database update
dotnet run   # listens on https://localhost:7081

# Frontend (new terminal)
cd frontend
npm install
npm run dev  # listens on http://localhost:5173, proxies /api → https://localhost:7081


Configuration (in appsettings.Development.json):

ConnectionStrings:DefaultConnection — PostgreSQL connection string

Auth:InviteCode — invite code required to create an account

Auth:CommissionerUsernames — array of usernames granted the Commissioner role at startup


Deployment
See docker-compose.example.yml for the topology. Production runs on an OVH VPS with Docker Compose (three services: db, api, web), and Nginx reverse-proxies to the API on /api/*. Backend and frontend Dockerfiles live at the repo root and in frontend/ respectively.

