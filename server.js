const express = require("express");
const path = require("path");

const {
  failWelcomeEmail,
  port,
  slowResponseMs,
  subscriberAuditIntervalMs,
  welcomeEmailLatencyMs
} = require("./config");
const {
  createRequestMiddleware,
  enqueueBackgroundTask,
  flushQueues,
  instrumentDatabaseQuery,
  instrumentExternalApiCall,
  logEvent,
  recordClientEvent,
  recordError,
  startScheduledJob,
  withSpan
} = require("./observability");

const app = express();
const newsletterSubscribers = new Map();

app.use(express.json());
app.use(createRequestMiddleware({ slowResponseMs }));
app.use(express.static(path.join(__dirname, "public")));

async function upsertSubscriber(email) {
  return instrumentDatabaseQuery(
    "newsletter_subscribers.upsert",
    {
      dbSystem: "in_memory_map",
      emailDomain: email.split("@")[1] || null
    },
    async () => {
      const existingRecord = newsletterSubscribers.get(email);
      const subscriber = {
        email,
        createdAt: existingRecord ? existingRecord.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      newsletterSubscribers.set(email, subscriber);

      logEvent("info", "subscriber_upserted", {
        email,
        subscriberCount: newsletterSubscribers.size
      });

      return subscriber;
    }
  );
}

async function sendWelcomeMessage(email) {
  return instrumentExternalApiCall(
    "welcome_email_provider",
    "send_welcome_message",
    {
      email
    },
    async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, welcomeEmailLatencyMs);
      });

      if (failWelcomeEmail) {
        throw new Error("welcome email provider rejected the request");
      }

      logEvent("info", "welcome_email_accepted", {
        email
      });

      return { accepted: true };
    }
  );
}

function enqueueWelcomeEmail(email) {
  enqueueBackgroundTask(
    "welcome_email",
    {
      email
    },
    async () => {
      await sendWelcomeMessage(email);
    }
  );
}

app.post("/ops/events", (req, res) => {
  recordClientEvent(req.body);

  return res.status(202).json({ accepted: true });
});

app.post("/signup", async (req, res, next) => {
  try {
    return withSpan(
      "signup.request",
      {
        route: "/signup"
      },
      async () => {
        const { email } = req.body;

        if (!email) {
          logEvent("warn", "signup_rejected", {
            reason: "missing_email"
          });

          return res.status(400).json({
            error: "email is required"
          });
        }

        await upsertSubscriber(email);
        enqueueWelcomeEmail(email);

        return res.json({
          success: true,
          requestId: req.observability.requestId,
          traceId: req.observability.traceId
        });
      }
    );
  } catch (error) {
    return next(error);
  }
});

app.use((error, req, res, next) => {
  recordError("server_error", error, {
    route: req.path,
    method: req.method
  });

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    error: "internal server error"
  });
});

startScheduledJob("subscriber_audit", subscriberAuditIntervalMs, async () => {
  logEvent("info", "subscriber_audit_snapshot", {
    subscriberCount: newsletterSubscribers.size
  });
});

process.on("beforeExit", () => {
  flushQueues().catch((error) => {
    recordError("opscompanion_flush_failed", error);
  });
});

app.listen(port, () => {
  logEvent("info", "server_started", {
    port
  });
  console.log(`Newsletter demo listening on http://localhost:${port}`);
});
