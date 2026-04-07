const express = require("express");
const path = require("path");

const { port } = require("./config");

const app = express();
const newsletterSubscribers = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function upsertSubscriber(email) {
  const existingRecord = newsletterSubscribers.get(email);
  const subscriber = {
    email,
    createdAt: existingRecord ? existingRecord.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  newsletterSubscribers.set(email, subscriber);

  return subscriber;
}

function sendWelcomeMessage(email) {}

function enqueueWelcomeEmail(email) {
  setTimeout(() => {
    try {
      sendWelcomeMessage(email);
    } catch (error) {
      console.error("welcome_email_failed", error);
    }
  }, 0);
}

app.post("/signup", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      error: "email is required"
    });
  }

  upsertSubscriber(email);
  enqueueWelcomeEmail(email);

  return res.json({ success: true });
});

app.use((error, req, res, next) => {
  console.error("server_error", error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    error: "internal server error"
  });
});

app.listen(port, () => {
  console.log(`Newsletter demo listening on http://localhost:${port}`);
});
