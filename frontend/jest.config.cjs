/** @type {import('jest').Config} */
module.exports = {
  roots: ['<rootDir>/src'],
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  testPathIgnorePatterns: ['/node_modules/'],
};
