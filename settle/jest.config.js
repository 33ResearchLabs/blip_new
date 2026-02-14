/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/tests/integration/',
    '<rootDir>/tests/flows/',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^settlement-core/db$': '<rootDir>/../packages/settlement-core/src/db/client.ts',
    '^settlement-core/finalization$': '<rootDir>/../packages/settlement-core/src/finalization/index.ts',
    '^settlement-core/state-machine$': '<rootDir>/../packages/settlement-core/src/state-machine/index.ts',
    '^settlement-core$': '<rootDir>/../packages/settlement-core/src/index.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(settlement-core)/)',
  ],
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    '!src/lib/types/**',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  setupFilesAfterEnv: [],
  verbose: true,
};
