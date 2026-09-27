export default {
  displayName: 'server',
  testMatch: ['<rootDir>/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'CommonJS',
          moduleResolution: 'node',
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          types: ['jest', 'node'],
          rootDir: './', // ← фиксирует ошибку TS5011
          ignoreDeprecations: '6.0', // ← глушит предупреждения об устаревших опциях
        },
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testEnvironment: 'node',
  // Coverage of the unit suites over every source file (issue #409), not only
  // the ones a test happens to import: the bench, the migrations and the
  // bootstrap are exercised by CI in other ways (the plan guard, the Postgres
  // job, the production smoke) and stay out. The thresholds are the current
  // figures rounded down — a change that lowers them fails `test:cov`
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/__tests__/**',
    '!src/bench/**',
    '!src/db/migrations/**',
    '!src/db/dataset-migrations/**',
    '!src/main.ts',
  ],
  coverageThreshold: {
    global: { statements: 75, branches: 64, functions: 65, lines: 74 },
  },
};
