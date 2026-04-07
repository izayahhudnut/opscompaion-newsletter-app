# Newsletter App

Minimal Express + static HTML app with end-to-end structured logs and lightweight tracing for OpsCompanion.

## Run

```bash
npm install
npm start
```

Open http://localhost:3000 and submit any email.

The signup flow remains intentionally broken for demo purposes: the browser sends
`{ "userEmail": "..." }` while the backend still expects `{ "email": "..." }`.
That means the UI continues to show `email is required`, and the failed request is
captured in the new logs and traces.

## Observability Coverage

- User actions are emitted from the browser to `POST /ops/events`
- API requests carry `x-ops-trace-id`, `x-ops-parent-span-id`, and `x-request-id`
- Express requests log start, finish, errors, and slow responses
- Subscriber writes are traced as database queries
- Welcome email delivery is traced as an external API call inside a background task
- A scheduled `subscriber_audit` job logs periodic snapshots of subscriber counts

## Environment

- `OPSCOMPANION_API_KEY`: API key for OTLP export to OpsCompanion
- `OPSCOMPANION_SERVICE_NAME`: service label in OpsCompanion, default `demo-broken-newsletter-app`
- `OPSCOMPANION_ENV`: deployment environment label, default `local`
- `OPSCOMPANION_LOGS_ENDPOINT`: OTLP logs endpoint, default `https://otel.opscompanion.ai/v1/logs`
- `OPSCOMPANION_TRACES_ENDPOINT`: OTLP traces endpoint, default `https://otel.opscompanion.ai/v1/traces`
- `PORT`: HTTP port, default `3000`
- `SLOW_RESPONSE_MS`: slow response threshold, default `750`
- `SLOW_OPERATION_MS`: slow span threshold, default `250`
- `WELCOME_EMAIL_LATENCY_MS`: simulated welcome email latency, default `40`
- `FAIL_WELCOME_EMAIL`: set to `true` to simulate provider failures
- `SUBSCRIBER_AUDIT_INTERVAL_MS`: scheduled audit interval, default `300000`
