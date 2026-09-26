import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3200";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node src/server.js",
    url: baseURL + "/health/ready",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: "3200",
      SITE_URL: baseURL,
      PUBLIC_INDEXING: "false",
    },
  },
});
