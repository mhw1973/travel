# Travel API (Cloudflare Worker + Turso)

## Run

```bash
npm run worker:dev
```

## Deploy

```bash
npm run worker:deploy
```

## Auth

- `POST /auth/verify` with JSON body `{ "password": "..." }`
- Protected APIs require one header:
  - `X-App-Password: <APP_PASSWORD>`
  - or `Authorization: Bearer <APP_PASSWORD>`

## Main Endpoints

- `GET /health`
- `GET /api/trips`
- `POST /api/trips`
- `GET /api/trips/:tripId`
- `PATCH /api/trips/:tripId`
- `DELETE /api/trips/:tripId`
- `GET /api/trips/:tripId/days|plans|expenses|flights|hotels`
- `POST /api/trips/:tripId/days|plans|expenses|flights|hotels`
- `PATCH /api/days|plans|expenses|flights|hotels/:id`
- `DELETE /api/days|plans|expenses|flights|hotels/:id`
- `GET /api/meta/:key`
- `PUT /api/meta/:key`

