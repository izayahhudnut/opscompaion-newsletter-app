const express = require("express");
const path = require("path");

const { port, serviceName } = require("./config");
const {
  captureError,
  emitLog,
  logDatabaseQuery,
  logExternalCall,
  logJob,
  requestLogger
} = require("./observability");

const app = express();
const newsletterSubscribers = new Map();

app.use(express.json());
app.use(requestLogger);
app.use(express.static(path.join(__dirname, "public")));

function upsertSubscriber(email) {
  const existingRecord = newsletterSubscribers.get(email);
  const subscriber = {
    email,
    createdAt: existingRecord ? existingRecord.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  newsletterSubscribers.set(email, subscriber);
  logDatabaseQuery("newsletter_subscriber.upsert", {
    email,
    totalSubscribers: newsletterSubscribers.size
  });

  return subscriber;
}

function sendWelcomeMessage(email) {
  logExternalCall("mock_email_provider", {
    provider: "console",
    action: "welcome_email",
    email
  });
}

function enqueueWelcomeEmail(email) {
  setTimeout(() => {
    const startedAt = Date.now();

    try {
      logJob("welcome_email", "started", { email });
      sendWelcomeMessage(email);

      const durationMs = Date.now() - startedAt;
      logJob("welcome_email", durationMs > 500 ? "slow" : "completed", {
        email,
        durationMs
      });
    } catch (error) {
      captureError(error, {
        jobName: "welcome_email",
        email
      });
      logJob("welcome_email", "failed", { email });
    }
  }, 0);
}

setInterval(() => {
  logJob("subscriber_rollup", "started", {
    totalSubscribers: newsletterSubscribers.size
  });
  logDatabaseQuery("newsletter_subscriber.count", {
    totalSubscribers: newsletterSubscribers.size
  });
  logJob("subscriber_rollup", "completed", {
    totalSubscribers: newsletterSubscribers.size
  });
}, 60000).unref();

process.on("uncaughtException", (error) => {
  captureError(error, {
    scope: "process",
    source: "uncaughtException"
  });
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));

  captureError(error, {
    scope: "process",
    source: "unhandledRejection"
  });
});

app.post("/client-events", (req, res) => {
  const { action, detail, level = "INFO" } = req.body || {};

  emitLog(
    ["DEBUG", "INFO", "WARN", "ERROR"].includes(level) ? level : "INFO",
    "frontend.event",
    {
      action,
      detail
    },
    {
      category: "frontend",
      requestId: req.requestId
    }
  );

  return res.status(202).json({ accepted: true });
});

app.post("/signup", (req, res) => {
  const { email } = req.body;

  if (!email) {
    emitLog(
      "ERROR",
      "newsletter_signup_failed",
      {
        error: "email is required",
        body: req.body
      },
      {
        requestId: req.requestId,
        route: "/signup"
      }
    );

    return res.status(400).json({
      error: "email is required"
    });
  }

  upsertSubscriber(email);
  enqueueWelcomeEmail(email);
  emitLog(
    "INFO",
    "newsletter_signup_succeeded",
    {
      email
    },
    {
      requestId: req.requestId,
      route: "/signup"
    }
  );

  return res.json({ success: true });
});

app.use((error, req, res, next) => {
  captureError(error, {
    requestId: req.requestId,
    route: req.path
  });

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    error: "internal server error"
  });
});

app.listen(port, () => {
  emitLog(
    "INFO",
    "server.started",
    {
      port
    },
    {
      serviceName
    }
  );
  console.log(`Newsletter demo listening on http://localhost:${port}`);
});
