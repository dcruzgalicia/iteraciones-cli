export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // AGENTS.md y CONTRIBUTING exigen scope obligatorio: config-conventional
    // lo acepta sin scope, así que se refuerza aquí.
    'scope-empty': [2, 'never'],
    // Types permitidos (misma lista que AGENTS.md).
    'type-enum': [2, 'always', ['feat', 'fix', 'refactor', 'chore', 'docs', 'test', 'perf', 'style']],
  },
};
