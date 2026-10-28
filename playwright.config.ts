import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  globalSetup: "./e2e/server-setup.ts",
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    // service-course.spec.ts pins a 360px viewport itself, so it runs once, as the phone it is written for.
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /service-course\.spec\.ts/ },
    { name: "tablet", use: { ...devices["iPad Mini"], defaultBrowserType: "chromium" }, testIgnore: /service-course\.spec\.ts/ },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
