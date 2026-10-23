import obsidianmd from 'eslint-plugin-obsidianmd'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['main.js', 'node_modules/**', 'test/**', '*.mjs'] },
  ...tseslint.configs.recommended,
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: { allowDefaultProject: ['eslint.config.mjs'] }, tsconfigRootDir: import.meta.dirname },
    },
  },
)
