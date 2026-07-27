# Lucas Aqua Life API

The storefront now has a PostgreSQL-backed API for durable multi-user data. Browser `localStorage` should be treated as a temporary client cache only; accounts, catalog data, orders, reviews, and customer support messages belong in this database.

## Start locally

1. Copy `.env.example` to `.env` and set a unique `JWT_SECRET` of at least 32 characters.
2. Start PostgreSQL with `docker compose up -d` (or supply a managed PostgreSQL `DATABASE_URL`).
3. Run `npm install`, `npm run migrate`, then `npm run dev`.
4. The API health check is available at `GET /health`.

## API overview

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/me`
- `GET /api/products`, `POST /api/products` (admin)
- `POST /api/orders`, `GET /api/orders`, `POST /api/orders/:id/cancel`
- `PATCH /api/orders/:id/status` (admin)
- `GET|POST /api/conversations`, `GET|POST /api/conversations/:id/messages`
- `PATCH /api/conversations/:id/archive`, `DELETE /api/conversations/:id` (admin)

Pass access tokens as `Authorization: Bearer <token>`. List endpoints use `page` and `limit` parameters, capped at 100 records per request.

## Production notes

- Use a managed PostgreSQL service with backups, point-in-time recovery, and encrypted connections.
- Keep `DATABASE_URL` and `JWT_SECRET` in the deployment secret manager, never in the browser or repository.
- Promote the first administrator directly in PostgreSQL: `UPDATE users SET role='admin' WHERE email='owner@example.com';`.
- Run the API behind HTTPS and set `CORS_ORIGIN` to the deployed storefront domain.
