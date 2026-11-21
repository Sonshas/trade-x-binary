# Trade X Binary

Source for https://tradexbinary.com. Vite/React web (`apps/web`) plus a local Express market-data helper (`apps/api`).

Supabase project: `zyofbsgudfqtitirpfjx`.

## Live deploy

Production site is a static build on the Vultr host. Details: [`deploy/vultr/README.md`](deploy/vultr/README.md).

`apps/api` (`PORT` / `CORS_ORIGIN`) is **local development only** and is not deployed.

## Local dev

Root `.env` only (no example env files). Then:

```bash
npm ci
npm run dev
```
