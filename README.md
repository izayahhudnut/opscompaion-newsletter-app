# Newsletter App

Minimal Express + static HTML app. The signup flow is intentionally broken for demo purposes.

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
