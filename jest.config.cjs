/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'mjs'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.js'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.(ts)$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'CommonJS',
        },
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
    // Transform ESM packages that Jest can't handle directly
    '^.+\\.mjs$': 'babel-jest',
  },
  transformIgnorePatterns: [
    // Allow transformation of @toon-format/toon which uses ESM
    '/node_modules/(?!@toon-format/toon)',
  ],
};