/**
 * Jest configuration for auth-customer service.
 * Maps shared module requires to mocks directory.
 */

module.exports = {
  testEnvironment: 'node',
  globals: {},
  setupFiles: ['<rootDir>/tests/setup.js'],
  moduleNameMapper: {
    '^(\.\.[\\/])*shared[\\/]auth-middleware$': '<rootDir>/tests/__mocks__/auth-middleware.js',
    '^(\.\.[\\/])*shared[\\/]common[\\/]constants$': '<rootDir>/tests/__mocks__/constants.js',
    '^(\.\.[\\/])*shared[\\/]common[\\/]errors$': '<rootDir>/tests/__mocks__/errors.js',
    '^(\.\.[\\/])*shared[\\/]common[\\/]response$': '<rootDir>/tests/__mocks__/response.js'
  }
};
