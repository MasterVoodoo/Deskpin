import { defineConfig } from 'vitest/config';

// Pin a timezone west of UTC so UTC-vs-local date bugs fail tests
// (the user is UTC+8, where many of these bugs hide).
process.env.TZ = 'America/Los_Angeles';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
