module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup.js'],
  moduleNameMapper: {
    '^(\\.\\.[\\\\/])*shared[\\\\/]auth-middleware$': '<rootDir>/tests/__mocks__/auth-middleware.js',
    '^(\\.\\.[\\\\/])*shared[\\\\/]common[\\\\/]constants$': '<rootDir>/tests/__mocks__/constants.js',
    '^(\\.\\.[\\\\/])*shared[\\\\/]common[\\\\/]errors$': '<rootDir>/tests/__mocks__/errors.js',
    '^(\\.\\.[\\\\/])*shared[\\\\/]common[\\\\/]response$': '<rootDir>/tests/__mocks__/response.js'
  }
};
