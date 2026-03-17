import { defineConfig } from "@playwright/test";

export default defineConfig({
  // Add your custom Playwright configuration here
  timeout: 30000, // Example: default timeout
  use: {
    baseURL: 'http://localhost:8080', // Example: point to your dev server
  },
});