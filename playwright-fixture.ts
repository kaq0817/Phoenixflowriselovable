// Re-export the base fixture from the package
// Override or extend test/expect here if needed
import { test as baseTest, expect } from "@playwright/test"; // Use Playwright's default test
export const test = baseTest; // Export as test
