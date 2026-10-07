# Filokreto Cost & Margin Monitor

A responsive operations dashboard for monitoring shed revenue, direct costs,
crew-trip allocations, and gross margin.

## Requirements

- Node.js 22.13 or newer
- npm
- A Neon PostgreSQL database

## Run locally

```bash
npm install
copy .env.example .env
npm run dev
```

Before starting, replace the placeholder values in `.env` with your Neon
connection strings and a private admin email/password. On macOS or Linux, use
`cp .env.example .env` instead of `copy`.

Open `http://localhost:3000`. The command starts both services:

- Frontend: `http://localhost:3000`
- PostgreSQL API: `http://localhost:4000`

Sign in with the values you supplied for `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
There is no hardcoded demo login. Demo project records are also disabled unless
`SEED_DEMO_DATA=true` is set explicitly.

## Environment

Copy `.env.example` values into the deployment environment when needed.
Important settings include:

- `NEXT_PUBLIC_API_URL`: public backend API address
- `FRONTEND_ORIGIN`: comma-separated frontend origins allowed by CORS
- `DATABASE_URL`: pooled Neon URL used by normal API requests
- `DATABASE_URL_UNPOOLED`: direct Neon URL used for startup schema migrations
- `ADMIN_EMAIL` and `ADMIN_PASSWORD`: credentials for the production admin
- `ADMIN_DISPLAY_NAME`: optional name shown for the admin
- `SEED_DEMO_DATA`: leave `false` in production
- `SESSION_HOURS`: authenticated session lifetime
- `COOKIE_SECURE` and `COOKIE_SAME_SITE`: production cookie settings

Use a unique password with at least 12 characters (16 or more is recommended).
Never commit the real Neon URLs or admin password.

## Commands

- `npm run dev`: start the frontend and PostgreSQL backend
- `npm run frontend:dev`: start only the frontend
- `npm run backend:dev`: start only the backend with file watching
- `npm run build`: build the frontend
- `npm run lint`: run code-quality checks
- `npm test`: build and run frontend and backend tests

## Deployment direction

The intended production architecture is:

- Next.js frontend on Vercel
- API backend on Render
- PostgreSQL database on Neon

For Render, use `npm ci` as the build command and
`npm run backend:start` as the start command. Set the health check path to
`/api/health`. The backend applies the idempotent schema in
`backend/schema.sql` through the direct Neon connection before it begins
serving requests, then uses the pooled connection for normal traffic.

Set `FRONTEND_ORIGIN` to the deployed Vercel site URL, not the GitHub repository
URL. Set `COOKIE_SECURE=true` and `COOKIE_SAME_SITE=None` because the frontend
and API are hosted on different sites.
