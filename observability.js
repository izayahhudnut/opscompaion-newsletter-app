const { AsyncLocalStorage } = require("async_hooks");
const https = require("https");

const {
  opsCompanionApiKey,
  opsCompanionEnv,
  opsCompanionLogsEndpoint,
  opsCompanionServiceName,
  opsCompanionTracesEndpoint,
  slowOperationMs
} = require("./config");

const contextStorage = new AsyncLocalStorage();

const otlpState = {
  logs: [],
  spans: [],
  flushTimer: null,
  isFlushing: false
};

function generateId(bytes = 8) {
  return require("crypto").randomBytes(bytes).toString("hex");
}

function nowNs() {
  return process.hrtime.bigint();
}

function durationMsSince(startNs) {
  return Number(process.hrtime.bigint() - startNs) / 1e6;
}

function timestampToUnixNano(timestamp) {
  return String(BigInt(timestamp.getTime()) * 1000000n);
}

function getContext() {
  return contextStorage.getStore() || null;
}

function createContext(overrides = {}) {
  const parentContext = getContext();

  return {
    traceId: overrides.traceId || parentContext?.traceId || generateId(16),
    requestId: overrides.requestId || parentContext?.requestId || generateId(12),
    spanId: overrides.spanId || generateId(8),
    parentSpanId:
      overrides.parentSpanId !== undefined
        ? overrides.parentSpanId
        : parentContext?.spanId || null,
    source: overrides.source || parentContext?.source || "server"
  };
}

function runWithContext(context, fn) {
  return contextStorage.run(context, fn);
}

function serializeError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
}

function toAttributeValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return { stringValue: value };
  }

  if (typeof value === "boolean") {
    return { boolValue: value };
  }

  if (Number.isInteger(value)) {
    return { intValue: String(value) };
  }

  if (typeof value === "number") {
    return { doubleValue: value };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value
          .map((item) => toAttributeValue(item))
          .filter(Boolean)
      }
    };
  }

  return {
    stringValue: JSON.stringify(value)
  };
}

function toOtlpAttributes(attributes = {}) {
  return Object.entries(attributes)
    .map(([key, value]) => {
      const anyValue = toAttributeValue(value);

      if (!anyValue) {
        return null;
      }

      return { key, value: anyValue };
    })
    .filter(Boolean);
}

function resourceAttributes() {
  return toOtlpAttributes({
    "service.name": opsCompanionServiceName,
    "deployment.environment": opsCompanionEnv
  });
}

function emitTransportError(message, error) {
  const writer = typeof process.stderr.write === "function" ? process.stderr : null;
  const detail = error && error.message ? error.message : String(error || "");

  if (writer) {
    writer.write(`${message}${detail ? `: ${detail}` : ""}\n`);
    return;
  }

  console.error(message, error);
}

function hasExporterConfig() {
  return Boolean(
    opsCompanionApiKey &&
      opsCompanionLogsEndpoint &&
      opsCompanionTracesEndpoint &&
      opsCompanionServiceName
  );
}

function postJson(url, payload) {
  if (!hasExporterConfig()) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opsCompanionApiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (response) => {
        let responseBody = "";

        response.on("data", (chunk) => {
          responseBody += chunk;
        });

        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve(responseBody);
            return;
          }

          reject(
            new Error(
              `OTLP export failed with status ${response.statusCode || "unknown"}: ${responseBody}`
            )
          );
        });
      }
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function scheduleFlush() {
  if (!hasExporterConfig() || otlpState.flushTimer) {
    return;
  }

  otlpState.flushTimer = setTimeout(() => {
    otlpState.flushTimer = null;
    flushQueues().catch((error) => {
      emitTransportError("opscompanion_flush_failed", error);
    });
  }, 400);

  if (typeof otlpState.flushTimer.unref === "function") {
    otlpState.flushTimer.unref();
  }
}

async function flushQueues() {
  if (!hasExporterConfig() || otlpState.isFlushing) {
    return;
  }

  otlpState.isFlushing = true;

  const logBatch = otlpState.logs.splice(0, otlpState.logs.length);
  const spanBatch = otlpState.spans.splice(0, otlpState.spans.length);

  try {
    if (logBatch.length > 0) {
      await postJson(opsCompanionLogsEndpoint, {
        resourceLogs: [
          {
            resource: {
              attributes: resourceAttributes()
            },
            scopeLogs: [
              {
                scope: {
                  name: "newsletter-app-observability"
                },
                logRecords: logBatch
              }
            ]
          }
        ]
      });
    }

    if (spanBatch.length > 0) {
      await postJson(opsCompanionTracesEndpoint, {
        resourceSpans: [
          {
            resource: {
              attributes: resourceAttributes()
            },
            scopeSpans: [
              {
                scope: {
                  name: "newsletter-app-observability"
                },
                spans: spanBatch
              }
            ]
          }
        ]
      });
    }
  } catch (error) {
    if (logBatch.length > 0) {
      otlpState.logs.unshift(...logBatch);
    }

    if (spanBatch.length > 0) {
      otlpState.spans.unshift(...spanBatch);
    }

    throw error;
  } finally {
    otlpState.isFlushing = false;

    if (otlpState.logs.length > 0 || otlpState.spans.length > 0) {
      scheduleFlush();
    }
  }
}

function queueLogRecord(level, event, context, attributes) {
  if (!hasExporterConfig()) {
    return;
  }

  const timestamp = new Date();

  otlpState.logs.push({
    timeUnixNano: timestampToUnixNano(timestamp),
    observedTimeUnixNano: timestampToUnixNano(timestamp),
    severityText: level.toUpperCase(),
    body: {
      stringValue: event
    },
    attributes: toOtlpAttributes({
      "event.name": event,
      traceId: context?.traceId || null,
      requestId: context?.requestId || null,
      spanId: context?.spanId || null,
      parentSpanId: context?.parentSpanId || null,
      source: context?.source || null,
      ...attributes
    })
  });

  if (otlpState.logs.length >= 10) {
    flushQueues().catch((error) => {
      emitTransportError("opscompanion_log_export_failed", error);
    });
    return;
  }

  scheduleFlush();
}

function queueSpanRecord(record) {
  if (!hasExporterConfig()) {
    return;
  }

  otlpState.spans.push(record);

  if (otlpState.spans.length >= 10) {
    flushQueues().catch((error) => {
      emitTransportError("opscompanion_trace_export_failed", error);
    });
    return;
  }

  scheduleFlush();
}

function logEvent(level, event, attributes = {}) {
  const context = getContext();
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    traceId: attributes.traceId || context?.traceId || null,
    requestId: attributes.requestId || context?.requestId || null,
    spanId: attributes.spanId || context?.spanId || null,
    parentSpanId:
      attributes.parentSpanId !== undefined
        ? attributes.parentSpanId
        : context?.parentSpanId || null,
    ...attributes
  };

  const writer = level === "error" ? console.error : console.log;
  writer(JSON.stringify(payload));

  queueLogRecord(level, event, context, attributes);
}

async function withSpan(name, attributes, fn) {
  const spanContext = createContext();
  const startedAtWallTime = new Date();
  const startedAtHrTime = nowNs();

  return runWithContext(spanContext, async () => {
    logEvent("info", "span_started", {
      spanName: name,
      ...attributes
    });

    try {
      const result = await fn(spanContext);
      const elapsedMs = Number(durationMsSince(startedAtHrTime).toFixed(2));

      if (elapsedMs >= slowOperationMs) {
        logEvent("warn", "slow_operation", {
          spanName: name,
          durationMs: elapsedMs,
          thresholdMs: slowOperationMs,
          ...attributes
        });
      }

      logEvent("info", "span_finished", {
        spanName: name,
        durationMs: elapsedMs,
        status: "ok",
        ...attributes
      });

      queueSpanRecord({
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        parentSpanId: spanContext.parentSpanId || undefined,
        name,
        kind: 1,
        startTimeUnixNano: timestampToUnixNano(startedAtWallTime),
        endTimeUnixNano: timestampToUnixNano(new Date()),
        attributes: toOtlpAttributes(attributes),
        status: {
          code: 1
        }
      });

      return result;
    } catch (error) {
      const elapsedMs = Number(durationMsSince(startedAtHrTime).toFixed(2));

      logEvent("error", "span_failed", {
        spanName: name,
        durationMs: elapsedMs,
        status: "error",
        error: serializeError(error),
        ...attributes
      });

      queueSpanRecord({
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        parentSpanId: spanContext.parentSpanId || undefined,
        name,
        kind: 1,
        startTimeUnixNano: timestampToUnixNano(startedAtWallTime),
        endTimeUnixNano: timestampToUnixNano(new Date()),
        attributes: toOtlpAttributes({
          ...attributes,
          error: serializeError(error)
        }),
        status: {
          code: 2,
          message: error.message
        }
      });

      throw error;
    }
  });
}

function createRequestMiddleware(options = {}) {
  const slowResponseMs = options.slowResponseMs || 750;

  return (req, res, next) => {
    const requestContext = createContext({
      traceId: req.get("x-ops-trace-id") || undefined,
      parentSpanId: req.get("x-ops-parent-span-id") || null,
      requestId: req.get("x-request-id") || undefined,
      source: req.path === "/ops/events" ? "client_telemetry" : "http"
    });
    const startedAt = nowNs();

    res.setHeader("x-ops-trace-id", requestContext.traceId);
    res.setHeader("x-ops-span-id", requestContext.spanId);
    res.setHeader("x-request-id", requestContext.requestId);

    return runWithContext(requestContext, () => {
      req.observability = requestContext;

      logEvent("info", "request_started", {
        method: req.method,
        route: req.path,
        url: req.originalUrl,
        userAgent: req.get("user-agent") || null
      });

      res.on("finish", () => {
        const elapsedMs = Number(durationMsSince(startedAt).toFixed(2));
        const level =
          res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

        logEvent(level, "request_finished", {
          method: req.method,
          route: req.path,
          url: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: elapsedMs
        });

        if (elapsedMs >= slowResponseMs) {
          logEvent("warn", "slow_response", {
            method: req.method,
            route: req.path,
            url: req.originalUrl,
            statusCode: res.statusCode,
            durationMs: elapsedMs,
            thresholdMs: slowResponseMs
          });
        }
      });

      next();
    });
  };
}

function recordError(event, error, attributes = {}) {
  logEvent("error", event, {
    error: serializeError(error),
    ...attributes
  });
}

async function instrumentDatabaseQuery(queryName, attributes, fn) {
  return withSpan("db.query", { queryName, ...attributes }, async () => {
    return fn();
  });
}

async function instrumentExternalApiCall(service, operation, attributes, fn) {
  return withSpan(
    "external.api",
    {
      service,
      operation,
      ...attributes
    },
    async () => {
      return fn();
    }
  );
}

function enqueueBackgroundTask(taskName, attributes, fn) {
  const parentContext = getContext();
  const queuedAt = Date.now();

  logEvent("info", "background_task_enqueued", {
    taskName,
    ...attributes
  });

  setTimeout(() => {
    const taskContext = {
      traceId: parentContext?.traceId || generateId(16),
      requestId: parentContext?.requestId || generateId(12),
      spanId: generateId(8),
      parentSpanId: parentContext?.spanId || parentContext?.parentSpanId || null,
      source: "background_task"
    };

    runWithContext(taskContext, () => {
      withSpan(
        "background.task",
        {
          taskName,
          queueDelayMs: Date.now() - queuedAt,
          ...attributes
        },
        async () => {
          return fn();
        }
      ).catch((error) => {
        recordError("background_task_failed", error, {
          taskName,
          ...attributes
        });
      });
    });
  }, 0);
}

function startScheduledJob(jobName, intervalMs, fn) {
  if (!intervalMs || intervalMs <= 0) {
    return null;
  }

  logEvent("info", "scheduled_job_registered", {
    jobName,
    intervalMs
  });

  const handle = setInterval(() => {
    const jobContext = {
      traceId: generateId(16),
      requestId: generateId(12),
      spanId: generateId(8),
      parentSpanId: null,
      source: "scheduled_job"
    };

    runWithContext(jobContext, () => {
      withSpan(
        "scheduled.job",
        {
          jobName,
          intervalMs
        },
        async () => {
          return fn();
        }
      ).catch((error) => {
        recordError("scheduled_job_failed", error, {
          jobName,
          intervalMs
        });
      });
    });
  }, intervalMs);

  if (typeof handle.unref === "function") {
    handle.unref();
  }

  return handle;
}

function recordClientEvent(payload = {}) {
  const clientContext = createContext({
    traceId: payload.traceId || undefined,
    requestId: payload.requestId || undefined,
    parentSpanId: payload.parentSpanId || null,
    source: "client"
  });

  runWithContext(clientContext, () => {
    logEvent(payload.level || "info", "client_event", {
      clientEvent: payload.event || "unknown_client_event",
      action: payload.action || null,
      durationMs: payload.durationMs || null,
      metadata: payload.metadata || {},
      source: "client",
      spanId: payload.spanId || clientContext.spanId,
      parentSpanId:
        payload.parentSpanId !== undefined
          ? payload.parentSpanId
          : clientContext.parentSpanId
    });
  });
}

module.exports = {
  createRequestMiddleware,
  enqueueBackgroundTask,
  flushQueues,
  generateId,
  getContext,
  instrumentDatabaseQuery,
  instrumentExternalApiCall,
  logEvent,
  recordClientEvent,
  recordError,
  startScheduledJob,
  withSpan
};
