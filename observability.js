const crypto = require("crypto");
const https = require("https");

const { environment, opsCompanionApiKey, serviceName } = require("./config");

const OTEL_LOGS_URL = "https://otel.opscompanion.ai/v1/logs";
const SLOW_REQUEST_MS = 750;
const pendingRecords = [];
let isFlushing = false;

function nowInUnixNano() {
  return `${BigInt(Date.now()) * 1000000n}`;
}

function generateRequestId() {
  return crypto.randomUUID();
}

function levelToSeverityNumber(level) {
  switch (level) {
    case "DEBUG":
      return 5;
    case "WARN":
      return 13;
    case "ERROR":
      return 17;
    default:
      return 9;
  }
}

function toAnyValue(value) {
  if (value === null || value === undefined) {
    return { stringValue: "" };
  }

  if (Array.isArray(value) || typeof value === "object") {
    return { stringValue: JSON.stringify(value) };
  }

  if (typeof value === "boolean") {
    return { boolValue: value };
  }

  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return { intValue: value };
    }

    return { doubleValue: value };
  }

  return { stringValue: String(value) };
}

function toAttributes(attributes) {
  return Object.entries(attributes || {}).map(([key, value]) => ({
    key,
    value: toAnyValue(value)
  }));
}

function queueRecord(record) {
  pendingRecords.push(record);

  if (pendingRecords.length >= 10) {
    flushLogs().catch((error) => {
      console.error("opscompanion_flush_failed", error.message);
    });
  }
}

function emitLog(level, eventName, body, attributes = {}) {
  const record = {
    timeUnixNano: nowInUnixNano(),
    severityText: level,
    severityNumber: levelToSeverityNumber(level),
    eventName,
    body: toAnyValue(body),
    attributes: toAttributes({
      "service.name": serviceName,
      "deployment.environment": environment,
      ...attributes
    })
  };

  console.log(
    JSON.stringify({
      level,
      eventName,
      body,
      attributes: {
        serviceName,
        environment,
        ...attributes
      },
      timestamp: new Date().toISOString()
    })
  );

  if (!opsCompanionApiKey) {
    return;
  }

  queueRecord(record);
}

function flushLogs() {
  if (isFlushing || pendingRecords.length === 0 || !opsCompanionApiKey) {
    return Promise.resolve();
  }

  isFlushing = true;

  const records = pendingRecords.splice(0, pendingRecords.length);
  const payload = JSON.stringify({
    resourceLogs: [
      {
        resource: {
          attributes: toAttributes({
            "service.name": serviceName,
            "deployment.environment": environment
          })
        },
        scopeLogs: [
          {
            scope: {
              name: "newsletter-app"
            },
            logRecords: records
          }
        ]
      }
    ]
  });

  return new Promise((resolve) => {
    const request = https.request(
      OTEL_LOGS_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opsCompanionApiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 400) {
            console.error("opscompanion_export_failed", `status ${response.statusCode}`);
          }

          isFlushing = false;
          resolve();
        });
      }
    );

    request.on("error", (error) => {
      isFlushing = false;
      console.error("opscompanion_export_failed", error.message);
      resolve();
    });

    request.write(payload);
    request.end();
  });
}

function requestLogger(req, res, next) {
  const requestId = req.headers["x-request-id"] || generateRequestId();
  const startTime = Date.now();

  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  emitLog(
    "INFO",
    "http.request.started",
    {
      method: req.method,
      path: req.path
    },
    {
      requestId,
      method: req.method,
      path: req.path,
      ip: req.ip
    }
  );

  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    const isServerError = res.statusCode >= 500;
    const isClientError = res.statusCode >= 400;
    const isSlow = durationMs >= SLOW_REQUEST_MS;
    const level = isServerError ? "ERROR" : isClientError || isSlow ? "WARN" : "INFO";
    const eventName = isServerError
      ? "http.request.failed"
      : isClientError
        ? "http.request.client_error"
        : isSlow
          ? "http.request.slow"
          : "http.request.completed";

    emitLog(
      level,
      eventName,
      {
        statusCode: res.statusCode,
        durationMs
      },
      {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs
      }
    );
  });

  next();
}

function captureError(error, context = {}) {
  emitLog(
    "ERROR",
    "app.error",
    {
      message: error.message,
      stack: error.stack
    },
    context
  );
}

function logDatabaseQuery(operation, metadata = {}) {
  emitLog(
    "INFO",
    "db.query",
    {
      operation,
      ...metadata
    },
    {
      category: "database",
      operation
    }
  );
}

function logExternalCall(target, metadata = {}) {
  emitLog(
    "INFO",
    "external_api.call",
    {
      target,
      ...metadata
    },
    {
      category: "external_api",
      target
    }
  );
}

function logJob(name, status, metadata = {}) {
  const level = status === "failed" ? "ERROR" : status === "slow" ? "WARN" : "INFO";

  emitLog(
    level,
    "job.lifecycle",
    {
      name,
      status,
      ...metadata
    },
    {
      category: "background_job",
      jobName: name,
      status
    }
  );
}

setInterval(() => {
  flushLogs().catch((error) => {
    console.error("opscompanion_flush_failed", error.message);
  });
}, 2000).unref();

process.on("beforeExit", () => {
  flushLogs().catch(() => {});
});

module.exports = {
  captureError,
  emitLog,
  flushLogs,
  logDatabaseQuery,
  logExternalCall,
  logJob,
  requestLogger
};
