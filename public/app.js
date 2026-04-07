const form = document.getElementById("signup-form");
const emailInput = document.getElementById("email");
const message = document.getElementById("message");

function createRequestId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function logClientEvent(action, detail, level = "INFO") {
  try {
    await fetch("/client-events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": createRequestId()
      },
      body: JSON.stringify({
        action,
        detail,
        level
      })
    });
  } catch (error) {
    console.error("client_event_log_failed", error);
  }
}

window.addEventListener("error", (event) => {
  logClientEvent(
    "window.error",
    {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno
    },
    "ERROR"
  );
});

window.addEventListener("unhandledrejection", (event) => {
  logClientEvent(
    "window.unhandledrejection",
    {
      reason: event.reason && event.reason.message ? event.reason.message : String(event.reason)
    },
    "ERROR"
  );
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  const requestId = createRequestId();
  message.textContent = "Submitting...";
  message.className = "";

  logClientEvent("signup.submit.clicked", {
    emailDomain: email.includes("@") ? email.split("@")[1] : "unknown"
  });

  try {
    const startedAt = performance.now();
    const response = await fetch("/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": requestId
      },
      body: JSON.stringify({
        userEmail: email
      })
    });

    const result = await response.json();
    const durationMs = Math.round(performance.now() - startedAt);

    logClientEvent(
      response.ok ? "signup.submit.succeeded" : "signup.submit.failed",
      {
        durationMs,
        statusCode: response.status
      },
      response.ok ? "INFO" : "WARN"
    );

    if (!response.ok) {
      throw new Error(result.error || "Something went wrong");
    }

    message.textContent = "Signup successful";
    message.className = "success";
    form.reset();
  } catch (error) {
    logClientEvent(
      "signup.submit.exception",
      {
        message: error.message
      },
      "ERROR"
    );
    message.textContent = error.message;
    message.className = "error";
  }
});
