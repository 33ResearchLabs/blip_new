// Allow self-signed HTTPS certs for integration tests against local settle
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/*.test.ts'],
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
  verbose: true,
  testTimeout: 30000,
};
