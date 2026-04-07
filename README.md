# Demo Broken Newsletter App

Minimal Express + static HTML app that intentionally breaks newsletter signup.

## Run

```bash
npm install
npm start
```

Open http://localhost:3000 and submit any email.

## Expected demo behavior

- Frontend sends `{ "userEmail": "..." }`
- Backend expects `{ "email": "..." }`
- User sees `email is required`
- Server logs:

```js
console.error("newsletter_signup_failed", {
  body: req.body,
  error: "email is required"
});
```

## One-line fix

Change this line in `/public/app.js`:

```js
userEmail: email
```

to:

```js
email: email
```

# opscompaion-newsletter-app
