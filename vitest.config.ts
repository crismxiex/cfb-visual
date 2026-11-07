import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/gamedeck*.test.{ts,tsx}'], environment: 'node' } });
