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
  opsCompanionApiKey: process.env.OPSCOMPANION_API_KEY,
  serviceName: process.env.OPSCOMPANION_SERVICE_NAME || "demo-broken-newsletter-app",
  environment: process.env.OPSCOMPANION_ENV || process.env.NODE_ENV || "development",
  port: process.env.PORT || 3000
};
