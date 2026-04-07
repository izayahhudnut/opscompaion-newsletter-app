# Newsletter App

Minimal Express + static HTML app with OpsCompanion log forwarding wired in. The signup flow is intentionally broken for demo purposes.

## Run

```bash
npm install
npm start
```

Open http://localhost:3000 and submit any email.

## Expected Demo Behavior

- Frontend sends `{ "userEmail": "..." }`
- Backend expects `{ "email": "..." }`
- User sees `email is required`
- OpsCompanion receives the frontend submit logs, the backend request logs, and the `newsletter_signup_failed` validation log

## OpsCompanion Logs

The server sends OTLP/HTTP JSON logs to `https://otel.opscompanion.ai/v1/logs`.

Set your local key in `.env.local`:

```bash
OPSCOMPANION_API_KEY=your_opscompanion_api_key
```

The app now emits:

- frontend interaction logs through `POST /client-events`
- backend request lifecycle logs for every HTTP request
- newsletter signup success and validation failure logs
- database-style logs for subscriber writes and counts
- external API-style logs for the mocked welcome email provider
- background job logs for the welcome email task and subscriber rollup job

Useful events to search in OpsCompanion:

- `server.started`
- `frontend.event`
- `http.request.started`
- `http.request.completed`
- `http.request.slow`
- `newsletter_signup_succeeded`
- `newsletter_signup_failed`
- `db.query`
- `external_api.call`
- `job.lifecycle`
