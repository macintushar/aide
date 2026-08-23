## API contracts and Bruno tests

The server's HTTP surface is defined by `@workspace/contracts` (`packages/contracts`). The Bruno collection in `bruno-api-test/` is the executable contract check for that surface.

**Whenever API contracts change, update the Bruno collection in the same change.**

### Contract sources

- Commands: `packages/contracts/src/commands.ts` (`commandSchema`, route names, request bodies, receipts)
- Events and snapshots: `packages/contracts/src/events.ts`, `packages/contracts/src/snapshots.ts`
- Domain payloads: `packages/contracts/src/domain.ts`
- Server wiring: `src/commands/router.ts`, `src/events/router.ts`, `src/security/command-guard.ts`

### Bruno collection

- Root: `bruno-api-test/opencollection.yml`
- Environment: `bruno-api-test/environments/local.yml`
- Requests: `bruno-api-test/health/`, `bruno-api-test/commands/`, `bruno-api-test/events/`

Use OpenCollection YAML (`.yml`), not legacy `.bru` files.

### When to update `bruno-api-test/`

Update the collection when you change any of the following:

- A command name, route path, or request/receipt shape
- Auth or origin requirements for `/commands/*`
- Session or instance event/snapshot routes or query params
- Required headers, status codes, or response fields agents rely on
- Environment variables needed to exercise the API (`baseUrl`, `origin`, `bearerToken`, chained ids)

Add or edit request files for new endpoints. Update existing request bodies, tests, assertions, and `after-response` variable chaining when fields rename or move.

### Running tests

```bash
cd apps/server/bruno-api-test
cp .env.example .env   # set AIDE_BEARER_TOKEN to the token the server printed at boot

bun run --cwd .. test:api
bun run --cwd .. test:api:smoke
```

The server must expose the full command and event routers for command/event requests to pass. `GET /` is the only route on the bare `src/index.ts` app today.

### Checklist for contract changes

1. Change the zod schema in `packages/contracts`
2. Update server handlers/routes if needed
3. Update matching files under `bruno-api-test/`
4. Run `bun run test:api` (or at least the affected requests)
5. Keep `.env.example` in sync if new secrets or env vars are required
