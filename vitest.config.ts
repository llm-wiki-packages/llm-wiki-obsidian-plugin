import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node', setupFiles: ['test/setup.ts'] },
  resolve: { alias: { obsidian: new URL('./test/mocks/obsidian.ts', import.meta.url).pathname } },
})
