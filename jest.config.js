module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts', '**/*.test.js'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    '**/*.{ts,js}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/coverage/**',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
}; 