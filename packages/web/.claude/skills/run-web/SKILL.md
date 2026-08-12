---
name: run-web
description: Launch and test the Money App web server (Next.js)
---

# Run: Web App

Money App is a Next.js 14 personal finance management web application. It runs on a local dev server (default port 3002) and requires authentication to access the main dashboard.

## Prerequisites

- Node.js 18+
- pnpm 9.15+

```bash
apt-get update && apt-get install -y curl
```

## Build & Setup

From the monorepo root, install dependencies (already done on first `pnpm install`):

```bash
pnpm install
```

The web package uses Tailwind CSS and Next.js with TypeScript — no extra build step needed for dev mode.

## Run: Agent Path

Start the dev server and run a smoke test:

```bash
cd packages/web
pnpm dev > /tmp/web-dev.log 2>&1 &
sleep 8

# Run the smoke test script
bash .claude/skills/run-web/driver.sh
```

The driver script (`driver.sh`) tests:
- Login page loads (GET /login → 200)
- Signup page loads (GET /signup → 200)
- Static CSS asset loads
- Port binding (defaults to 3002 if 3000/3001 in use)

**Verify it works:**
```bash
curl -s http://localhost:3002/login | grep -q "Money App" && echo "✓ Web app loaded"
```

Kill the dev server when done:
```bash
pkill -f "next dev"
```

## Run: Human Path

From `packages/web`:

```bash
pnpm dev
```

Opens http://localhost:3002 in a browser (actual port shown in console if 3000/3001 busy). Navigate to `/login`, fill in email/password, or go to `/signup` to create an account.

## Gotchas

- **Port contention**: The dev server tries 3000, then 3001, then 3002. If the target port is busy, check `lsof -i :3000` and kill the process, or the server will auto-shift up.
- **Auth token required**: Most pages (dashboard, assets, categories) redirect to `/login` if no valid `accessToken` cookie exists. The smoke test only checks unauthenticated page loads; full navigation requires logging in or mocking auth state.
- **Database required**: The app expects a running API backend (see `packages/api`). Without it, login will fail. For isolated frontend testing, mock API responses or bypass auth.
- **HMR (Hot Module Reload)**: Next.js dev mode auto-recompiles on file save. Compilation is fast (~1s) but may briefly serve stale pages during the build.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Port 3000 is in use` | Automatic; server tries 3001, 3002, etc. Or `lsof -i :3000 \| grep node \| awk '{print $2}' \| xargs kill -9` to force clear. |
| `Cannot find module '@money/types'` | Missing workspace dependency. From monorepo root, run `pnpm install` again. |
| `GET /login 404` | Rare race condition during server startup. Retry the curl after waiting 2-3 more seconds. |
| Login redirects to `/login` instead of `/dashboard` | API is unreachable or auth endpoint failed. Check that `packages/api` is running (see its SKILL if present) and accessible at the configured URL. |

## Test

From `packages/web`, run unit tests (if configured):

```bash
pnpm test
```

Type-check:
```bash
pnpm type-check
```
