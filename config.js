const fs = require("fs");
const path = require("path");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function loadEnv() {
  parseEnvFile(path.join(__dirname, ".env"));
  parseEnvFile(path.join(__dirname, ".env.local"));
}

loadEnv();

module.exports = {
  port: Number(process.env.PORT || 3000),
  slowResponseMs: Number(process.env.SLOW_RESPONSE_MS || 750),
  slowOperationMs: Number(process.env.SLOW_OPERATION_MS || 250),
  welcomeEmailLatencyMs: Number(process.env.WELCOME_EMAIL_LATENCY_MS || 40),
  subscriberAuditIntervalMs: Number(process.env.SUBSCRIBER_AUDIT_INTERVAL_MS || 300000),
  failWelcomeEmail: process.env.FAIL_WELCOME_EMAIL === "true",
  opsCompanionApiKey: process.env.OPSCOMPANION_API_KEY || "",
  opsCompanionServiceName:
    process.env.OPSCOMPANION_SERVICE_NAME || "demo-broken-newsletter-app",
  opsCompanionEnv: process.env.OPSCOMPANION_ENV || "local",
  opsCompanionLogsEndpoint:
    process.env.OPSCOMPANION_LOGS_ENDPOINT || "https://otel.opscompanion.ai/v1/logs",
  opsCompanionTracesEndpoint:
    process.env.OPSCOMPANION_TRACES_ENDPOINT || "https://otel.opscompanion.ai/v1/traces"
};
