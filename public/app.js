const form = document.getElementById("signup-form");
const emailInput = document.getElementById("email");
const message = document.getElementById("message");

function generateId() {
  const bytes = new Uint8Array(8);
  window.crypto.getRandomValues(bytes);

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function postTelemetry(payload) {
  const body = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon("/ops/events", blob);
    return;
  }

  fetch("/ops/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body
  }).catch(() => {});
}

function reportClientEvent(level, event, context, metadata = {}) {
  postTelemetry({
    level,
    event,
    action: "newsletter_signup",
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: context.parentSpanId || null,
    requestId: context.requestId || null,
    metadata
  });
}

function createClientSpan(parentContext) {
  return {
    traceId: parentContext?.traceId || generateId() + generateId(),
    spanId: generateId(),
    parentSpanId: parentContext?.spanId || null,
    requestId: parentContext?.requestId || null
  };
}

window.addEventListener("error", (event) => {
  reportClientEvent(
    "error",
    "client_error",
    createClientSpan(),
    {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno
    }
  );
});

window.addEventListener("unhandledrejection", (event) => {
  reportClientEvent(
    "error",
    "client_unhandled_rejection",
    createClientSpan(),
    {
      reason: event.reason && event.reason.message ? event.reason.message : String(event.reason)
    }
  );
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  const actionContext = createClientSpan();
  const actionStartedAt = performance.now();

  message.textContent = "Submitting...";
  message.className = "";

  reportClientEvent("info", "user_action_started", actionContext, {
    actionName: "submit_signup_form",
    emailDomain: email.includes("@") ? email.split("@")[1] : null
  });

  try {
    const requestContext = createClientSpan(actionContext);
    const requestStartedAt = performance.now();

    reportClientEvent("info", "api_request_started", requestContext, {
      method: "POST",
      route: "/signup"
    });

    const response = await fetch("/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ops-trace-id": requestContext.traceId,
        "x-ops-parent-span-id": requestContext.parentSpanId || "",
        "x-request-id": requestContext.requestId || generateId()
      },
      body: JSON.stringify({
        userEmail: email
      })
    });

    const result = await response.json();
    const requestDurationMs = Number((performance.now() - requestStartedAt).toFixed(2));

    requestContext.requestId = result.requestId || response.headers.get("x-request-id");

    reportClientEvent(
      response.ok ? "info" : "error",
      response.ok ? "api_request_finished" : "api_request_failed",
      requestContext,
      {
        method: "POST",
        route: "/signup",
        statusCode: response.status,
        durationMs: requestDurationMs,
        slow: requestDurationMs >= 750,
        userVisibleMessage: response.ok ? null : result.error || "Something went wrong",
        likelyCause: response.ok
          ? null
          : "Frontend sends `userEmail` while the backend expects `email`.",
        fix: response.ok
          ? null
          : "Update the request body to send `{ email }` from the signup form."
      }
    );

    if (!response.ok) {
      throw new Error(result.error || "Something went wrong");
    }

    message.textContent = "Signup successful";
    message.className = "success";
    form.reset();
  } catch (error) {
    reportClientEvent("error", "user_action_failed", actionContext, {
      message: error.message
    });
    message.textContent = error.message;
    message.className = "error";
    return;
  }

  reportClientEvent("info", "user_action_finished", actionContext, {
    actionName: "submit_signup_form",
    durationMs: Number((performance.now() - actionStartedAt).toFixed(2))
  });
});
