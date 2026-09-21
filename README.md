# Filokreto Cost & Margin Monitor

A responsive operations dashboard for monitoring shed revenue, direct costs,
crew-trip allocations, and gross margin.

## Requirements

- Node.js 22.13 or newer
- npm

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The command starts both services:

- Frontend: `http://localhost:3000`
- SQLite API: `http://localhost:4000`

Demo account:

- Email: `admin@filokreto.com`
- Password: `Demo2026!`

The local database is created automatically at
`backend/data/filokreto.db`. This directory is ignored by Git.

## Environment

Copy `.env.example` values into the deployment environment when needed.
Important settings include:

- `NEXT_PUBLIC_API_URL`: public backend API address
- `FRONTEND_ORIGIN`: comma-separated frontend origins allowed by CORS
- `DATABASE_PATH`: local SQLite database location
- `SESSION_HOURS`: authenticated session lifetime
- `COOKIE_SECURE` and `COOKIE_SAME_SITE`: production cookie settings

## Commands

- `npm run dev`: start the frontend and SQLite backend
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

The local SQLite schema uses portable table and column types to simplify the
future PostgreSQL migration. Replace the demo account and local credential flow
with the selected managed identity provider before production launch.
