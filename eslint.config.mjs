import obsidianmd from 'eslint-plugin-obsidianmd'

export default [
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.*'],
        },
      },
    },
    rules: {
      'obsidianmd/ui/sentence-case': ['warn', { brands: ['CoffeeCatKanBan'] }],
    },
  },
]
