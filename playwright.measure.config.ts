import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/// Measurements, not tests: `npm run measure` prints what the app costs, to
/// compare before and after a change. They pass whatever the numbers are,
/// so they stay out of the end-to-end run.
export default defineConfig({ ...base, testMatch: "**/*.measure.ts" });
